import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Harness Enforcement Engine — Integration Tests
 *
 * Tests the enforcement layer via the Command Centre HTTP hook endpoints.
 * Server must be running at localhost:4111 before executing.
 *
 * These tests simulate what Claude Code does: send PreToolUse/PostToolUse
 * hooks and verify that the harness enforces rules correctly.
 */

const BASE_URL = 'http://localhost:4111';
const TEST_SESSION_ID = `test-harness-${Date.now()}`;

// Create a temp project directory for tests
const TEMP_PROJECT = path.join(os.tmpdir(), `harness-test-${Date.now()}`);
const HARNESS_DIR = path.join(TEMP_PROJECT, '.harness');

// --- Helpers ---

async function postHook(endpoint: string, data: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/hooks/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function apiGet(endpoint: string): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/harness/${endpoint}`);
  return res.json();
}

async function apiPost(endpoint: string, data: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/harness/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

/** Simulate a Read tool call (auto-pass, tracked for mustReadBefore) */
async function simulateRead(filePath: string): Promise<any> {
  // Read tools go through pre-tool-use but are auto-passed
  const preResult = await postHook('pre-tool-use', {
    session_id: TEST_SESSION_ID,
    cwd: TEMP_PROJECT,
    tool_name: 'Read',
    tool_input: { file_path: filePath },
    tool_use_id: `tu_read_${Date.now()}`,
  });

  // Then through post-tool-use (where reads are also tracked)
  await postHook('post-tool-use', {
    session_id: TEST_SESSION_ID,
    cwd: TEMP_PROJECT,
    tool_name: 'Read',
    tool_input: { file_path: filePath },
    tool_use_id: `tu_read_${Date.now()}`,
  });

  return preResult;
}

/** Simulate a Write tool call and return the hook response */
async function simulateWrite(filePath: string): Promise<any> {
  return postHook('pre-tool-use', {
    session_id: TEST_SESSION_ID,
    cwd: TEMP_PROJECT,
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: 'test content' },
    tool_use_id: `tu_write_${Date.now()}`,
  });
}

/** Simulate a Bash tool call and return the hook response */
async function simulateBash(command: string): Promise<any> {
  return postHook('pre-tool-use', {
    session_id: TEST_SESSION_ID,
    cwd: TEMP_PROJECT,
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: `tu_bash_${Date.now()}`,
  });
}

// --- Setup & Teardown ---

test.beforeAll(async () => {
  // Create temp project directory with harness state
  fs.mkdirSync(HARNESS_DIR, { recursive: true });

  // Start a session
  await postHook('session-start', {
    session_id: TEST_SESSION_ID,
    cwd: TEMP_PROJECT,
  });
});

test.afterAll(async () => {
  // End the session
  await postHook('session-end', {
    session_id: TEST_SESSION_ID,
    cwd: TEMP_PROJECT,
  });

  // Cleanup temp directory
  try {
    fs.rmSync(TEMP_PROJECT, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }

  // Cleanup test session from server
  try {
    await fetch(`${BASE_URL}/api/sessions/test-cleanup`, { method: 'DELETE' });
  } catch {
    // Best effort
  }
});

// --- Tests ---

test.describe('Harness API — Create & Status', () => {
  test('should report no harness when none exists', async () => {
    const status = await apiGet(`status/${encodeURIComponent(TEMP_PROJECT)}`);
    expect(status.active).toBe(false);
  });

  test('should create a build harness for the test project', async () => {
    const result = await apiPost('create', {
      projectPath: TEMP_PROJECT,
      projectName: 'Harness Test Project',
      harnessType: 'build',
      mode: 'airedale',
    });

    expect(result.ok).toBe(true);
    expect(result.state.harnessType).toBe('build');
    expect(result.state.harnessMode).toBe('airedale');
    expect(result.state.harnessCurrentPhase).toBe('init');
  });

  test('should report active harness after creation', async () => {
    const status = await apiGet(`status/${encodeURIComponent(TEMP_PROJECT)}`);
    expect(status.active).toBe(true);
    expect(status.state.harnessCurrentPhase).toBe('init');
    expect(status.phaseSequence).toEqual(['init', 'design', 'dev', 'test', 'release']);
  });

  test('harness-state.json should exist on disk', async () => {
    const statePath = path.join(HARNESS_DIR, 'harness-state.json');
    expect(fs.existsSync(statePath)).toBe(true);

    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(state.harnessProject).toBe('Harness Test Project');
    expect(state.harnessCurrentPhase).toBe('init');
  });
});

test.describe('Harness Enforcement — Init Phase', () => {
  test('Read tools should always pass (auto-pass)', async () => {
    const result = await simulateRead(path.join(TEMP_PROJECT, 'agents/initialisation.md'));

    // Read tools are auto-passed with explicit allow decision
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  test('Write to src/ should be DENIED during init phase', async () => {
    // First, read the agent prompt so mustReadBefore is satisfied
    await simulateRead(path.join(TEMP_PROJECT, 'agents', 'initialisation.md'));

    const result = await simulateWrite(path.join(TEMP_PROJECT, 'src', 'Program.cs'));

    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('[HARNESS]');
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('Init phase');
  });

  test('git commit should be DENIED during init phase', async () => {
    const result = await simulateBash('git commit -m "test"');

    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('[HARNESS]');
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('Init phase');
  });

  test('Write to non-src/ should require reading agent prompt first', async () => {
    // Use a fresh session to test mustReadBefore from scratch
    const freshSessionId = `test-harness-fresh-${Date.now()}`;
    await postHook('session-start', {
      session_id: freshSessionId,
      cwd: TEMP_PROJECT,
    });

    // Try to write without reading the agent prompt first
    const result = await postHook('pre-tool-use', {
      session_id: freshSessionId,
      cwd: TEMP_PROJECT,
      tool_name: 'Write',
      tool_input: { file_path: path.join(TEMP_PROJECT, 'progress.txt'), content: 'test' },
      tool_use_id: `tu_write_${Date.now()}`,
    });

    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain('initialisation.md');

    // Cleanup
    await postHook('session-end', { session_id: freshSessionId, cwd: TEMP_PROJECT });
  });

  test('Write to progress.txt should PASS after reading agent prompt', async () => {
    // Read the agent prompt first
    await simulateRead(path.join(TEMP_PROJECT, 'agents', 'initialisation.md'));

    const result = await simulateWrite(path.join(TEMP_PROJECT, 'progress.txt'));

    // If it passes harness, it goes to auto-approve (which may allow or hold)
    // The key check: it should NOT be a harness deny
    const hasHarnessDeny =
      result.hookSpecificOutput?.permissionDecision === 'deny' &&
      result.hookSpecificOutput?.permissionDecisionReason?.includes('[HARNESS]');

    expect(hasHarnessDeny).toBe(false);
  });
});

test.describe('Harness Enforcement — Phase Advancement', () => {
  test('should advance from init to design when checkpoint is valid', async () => {
    // Create the required artefacts for init checkpoint
    fs.writeFileSync(path.join(TEMP_PROJECT, 'feature-list.json'), JSON.stringify({
      project: 'test',
      features: [{ id: 'F001', description: 'Test feature', passes: false }],
    }));
    fs.writeFileSync(path.join(TEMP_PROJECT, 'progress.txt'), 'Test progress');
    fs.writeFileSync(path.join(TEMP_PROJECT, 'PROJECT_STATUS.md'), '# Test\n**Status:** Active');
    fs.writeFileSync(path.join(TEMP_PROJECT, 'DATA_DICTIONARY.md'), '# Data Dictionary');

    // Write checkpoint-init.json
    const checkpoint = {
      checkpointPhase: 'init',
      checkpointCompletedAt: new Date().toISOString(),
      checkpointHarness: 'build',
      checkpointMode: 'airedale',
      checkpointAgentFile: 'agents/initialisation.md',
      checkpointAgentFileReadConfirmed: true,
      checkpointRequiredArtefacts: {
        featureList: { checkpointArtefactPath: 'feature-list.json', checkpointArtefactExists: true, checkpointArtefactHash: null },
        progressFile: { checkpointArtefactPath: 'progress.txt', checkpointArtefactExists: true, checkpointArtefactHash: null },
        projectStatus: { checkpointArtefactPath: 'PROJECT_STATUS.md', checkpointArtefactExists: true, checkpointArtefactHash: null },
      },
      checkpointNextAgent: 'designer',
      checkpointUserConfirmed: true,
      checkpointDetail: {},
    };
    fs.writeFileSync(path.join(HARNESS_DIR, 'checkpoint-init.json'), JSON.stringify(checkpoint, null, 2));

    // Advance phase via API
    const result = await apiPost('advance', {
      projectPath: TEMP_PROJECT,
      sessionId: TEST_SESSION_ID,
    });

    expect(result.ok).toBe(true);
    expect(result.state.harnessCurrentPhase).toBe('design');
  });

  test('should block src/ writes in design phase (except prototype/)', async () => {
    await simulateRead(path.join(TEMP_PROJECT, 'agents', 'designer.md'));

    const srcResult = await simulateWrite(path.join(TEMP_PROJECT, 'src', 'Program.cs'));
    expect(srcResult.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(srcResult.hookSpecificOutput?.permissionDecisionReason).toContain('Design phase');
  });

  test('should allow prototype/ writes in design phase', async () => {
    await simulateRead(path.join(TEMP_PROJECT, 'agents', 'designer.md'));

    const protoResult = await simulateWrite(path.join(TEMP_PROJECT, 'prototype', 'index.html'));
    const hasHarnessDeny =
      protoResult.hookSpecificOutput?.permissionDecision === 'deny' &&
      protoResult.hookSpecificOutput?.permissionDecisionReason?.includes('[HARNESS]');
    expect(hasHarnessDeny).toBe(false);
  });
});

test.describe('Harness Enforcement — Override & Pause', () => {
  test('should allow pausing enforcement', async () => {
    const result = await apiPost('pause', {
      projectPath: TEMP_PROJECT,
      paused: true,
    });
    expect(result.ok).toBe(true);
    expect(result.state.harnessPaused).toBe(true);
  });

  test('should allow src/ writes when harness is paused', async () => {
    const result = await simulateWrite(path.join(TEMP_PROJECT, 'src', 'Program.cs'));

    // When paused, harness rules are skipped — no harness deny
    const hasHarnessDeny =
      result.hookSpecificOutput?.permissionDecision === 'deny' &&
      result.hookSpecificOutput?.permissionDecisionReason?.includes('[HARNESS]');
    expect(hasHarnessDeny).toBe(false);
  });

  test('should resume enforcement after unpausing', async () => {
    await apiPost('pause', { projectPath: TEMP_PROJECT, paused: false });

    // Now use a fresh session so mustReadBefore isn't already satisfied
    const freshId = `test-harness-unpause-${Date.now()}`;
    await postHook('session-start', { session_id: freshId, cwd: TEMP_PROJECT });

    // Read designer prompt for this session
    await postHook('pre-tool-use', {
      session_id: freshId, cwd: TEMP_PROJECT,
      tool_name: 'Read', tool_input: { file_path: path.join(TEMP_PROJECT, 'agents', 'designer.md') },
      tool_use_id: `tu_${Date.now()}`,
    });
    await postHook('post-tool-use', {
      session_id: freshId, cwd: TEMP_PROJECT,
      tool_name: 'Read', tool_input: { file_path: path.join(TEMP_PROJECT, 'agents', 'designer.md') },
      tool_use_id: `tu_${Date.now()}`,
    });

    const result = await postHook('pre-tool-use', {
      session_id: freshId, cwd: TEMP_PROJECT,
      tool_name: 'Write', tool_input: { file_path: path.join(TEMP_PROJECT, 'src', 'App.cs'), content: 'x' },
      tool_use_id: `tu_${Date.now()}`,
    });

    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('[HARNESS]');

    await postHook('session-end', { session_id: freshId, cwd: TEMP_PROJECT });
  });

  test('should record an override in state', async () => {
    const result = await apiPost('override', {
      projectPath: TEMP_PROJECT,
      overrideType: 'skipRule',
      rule: 'blockWrite:src/**',
      sessionId: TEST_SESSION_ID,
      reason: 'Testing override mechanism',
    });

    expect(result.ok).toBe(true);
    expect(result.state.harnessOverrides.length).toBeGreaterThan(0);
    expect(result.state.harnessOverrides[0].harnessOverrideReason).toBe('Testing override mechanism');
  });
});

test.describe('Harness Enforcement — Checkpoint Validation', () => {
  test('should validate checkpoint via API', async () => {
    const result = await apiGet(
      `validate/${encodeURIComponent(TEMP_PROJECT)}?phase=init`
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('should fail validation for missing checkpoint', async () => {
    const result = await apiGet(
      `validate/${encodeURIComponent(TEMP_PROJECT)}?phase=dev`
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('does not exist');
  });
});

test.describe('Harness Ledger', () => {
  test('should have ledger events from harness operations', async () => {
    const events = await apiGet('ledger');

    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);

    // Should have harness_start and phase_start/complete events
    const eventTypes = events.map((e: any) => e.ledgerEventType);
    expect(eventTypes).toContain('harness_start');
  });

  test('should have project snapshot from ledger', async () => {
    const projects = await apiGet('projects');

    expect(Array.isArray(projects)).toBe(true);

    const testProject = projects.find(
      (p: any) => p.snapshotProjectPath === TEMP_PROJECT
    );
    expect(testProject).toBeDefined();
    expect(testProject.snapshotProjectName).toBe('Harness Test Project');
    expect(testProject.snapshotHarness).toBe('build');
  });
});

test.describe('Harness Orchestrator — Phase Prompt & Transition', () => {
  test('should generate a phase prompt for the current phase', async () => {
    const result = await apiGet(
      `phase-prompt/${encodeURIComponent(TEMP_PROJECT)}?phase=design`
    );

    expect(result.phase).toBe('design');
    expect(result.prompt).toContain('design');
    expect(result.prompt).toContain('MANDATORY FIRST ACTIONS');
    expect(result.prompt).toContain('agents/designer.md');
    expect(result.prompt).toContain('ENFORCEMENT NOTICE');
  });

  test('should report transition readiness', async () => {
    const result = await apiGet(
      `transition-ready/${encodeURIComponent(TEMP_PROJECT)}`
    );

    // We're in design phase — need checkpoint-design.json to transition
    expect(result.nextPhase).toBe('dev');
    // May or may not be ready depending on checkpoint state
    expect(typeof result.ready).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  test('should provide harness summary', async () => {
    const result = await apiGet(
      `summary/${encodeURIComponent(TEMP_PROJECT)}`
    );

    expect(result.project).toBe('Harness Test Project');
    expect(result.harness).toBe('build');
    expect(result.mode).toBe('airedale');
    expect(result.phaseSequence).toEqual(['init', 'design', 'dev', 'test', 'release']);
    expect(result.completedPhases).toContain('init');
    expect(typeof result.reworkCycles).toBe('number');
    expect(typeof result.overrideCount).toBe('number');
  });

  test('should execute transition when checkpoint is valid', async () => {
    // Create design checkpoint so transition from design -> dev can proceed
    fs.writeFileSync(path.join(TEMP_PROJECT, 'design-spec.md'), '# Design Spec\nTest design');
    fs.mkdirSync(path.join(TEMP_PROJECT, 'prototype'), { recursive: true });
    fs.writeFileSync(path.join(TEMP_PROJECT, 'prototype', 'index.html'), '<html>Prototype</html>');

    const designCheckpoint = {
      checkpointPhase: 'design',
      checkpointCompletedAt: new Date().toISOString(),
      checkpointHarness: 'build',
      checkpointMode: 'airedale',
      checkpointAgentFile: 'agents/designer.md',
      checkpointAgentFileReadConfirmed: true,
      checkpointRequiredArtefacts: {
        designSpec: { checkpointArtefactPath: 'design-spec.md', checkpointArtefactExists: true, checkpointArtefactHash: null },
        prototype: { checkpointArtefactPath: 'prototype/index.html', checkpointArtefactExists: true, checkpointArtefactHash: null },
        featureList: { checkpointArtefactPath: 'feature-list.json', checkpointArtefactExists: true, checkpointArtefactHash: null },
      },
      checkpointNextAgent: 'developer',
      checkpointUserConfirmed: true,
      checkpointDetail: { designIterations: 1, featuresDesigned: 1 },
    };
    fs.writeFileSync(
      path.join(HARNESS_DIR, 'checkpoint-design.json'),
      JSON.stringify(designCheckpoint, null, 2)
    );

    // Clear the design gate (governance requirement)
    await apiPost('gate/clear', {
      projectPath: TEMP_PROJECT,
      gateName: 'designGate',
      sessionId: TEST_SESSION_ID,
    });

    const result = await apiPost('transition', {
      projectPath: TEMP_PROJECT,
      sessionId: TEST_SESSION_ID,
    });

    expect(result.ok).toBe(true);
    expect(result.nextPhase).toBe('dev');
    expect(result.prompt).toContain('dev');
    expect(result.prompt).toContain('MANDATORY FIRST ACTIONS');
    expect(result.prompt).toContain('agents/developer.md');
    expect(result.prompt).toContain('design-spec.md');
  });
});

// ---- Wave 1+2 Feature Tests (2026-05-21) ----

test.describe('F001 — Path Normalisation', () => {
  test('resolveProjectPath should fix JamesBrown to current user', async () => {
    // Create a harness state with a mismatched user profile path
    const mismatchProject = path.join(os.tmpdir(), `harness-path-test-${Date.now()}`);
    const mismatchHarness = path.join(mismatchProject, '.harness');
    fs.mkdirSync(mismatchHarness, { recursive: true });

    // Write state with a fake "OtherUser" path that doesn't exist
    const fakeState = {
      harnessProject: 'Path Test',
      harnessProjectPath: mismatchProject.replace(path.basename(os.homedir()), 'FakeUserProfile'),
      harnessType: 'build',
      harnessMode: 'airedale',
      harnessCurrentPhase: 'init',
      harnessPhaseHistory: [{ harnessPhase: 'init', harnessPhaseSessionId: null, harnessPhaseStartedAt: new Date().toISOString(), harnessPhaseCompletedAt: null }],
      harnessGatesCleared: {},
      harnessReworkCycles: 0,
      harnessOverrides: [],
      harnessPaused: false,
      harnessCreatedAt: new Date().toISOString(),
      harnessUpdatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(mismatchHarness, 'harness-state.json'), JSON.stringify(fakeState, null, 2));

    // Load via API — the path resolution should fix the path on read
    const status = await apiGet(`status/${encodeURIComponent(mismatchProject)}`);
    expect(status.active).toBe(true);
    // The returned state should have the resolved path (matching the actual temp dir)
    expect(status.state.harnessProjectPath).toBe(mismatchProject);

    // Save via pause (triggers saveHarnessState with resolved path)
    await apiPost('pause', { projectPath: mismatchProject, paused: true });
    const savedState = JSON.parse(fs.readFileSync(path.join(mismatchHarness, 'harness-state.json'), 'utf-8'));
    // After save, the on-disk path should be resolved to the actual path
    expect(savedState.harnessProjectPath).toBe(mismatchProject);

    fs.rmSync(mismatchProject, { recursive: true, force: true });
  });
});

test.describe('F005 — Checkpoint Detection in PostToolUse', () => {
  test('should detect checkpoint write and emit event', async () => {
    // Create a fresh project with harness
    const detectProject = path.join(os.tmpdir(), `harness-detect-${Date.now()}`);
    const detectHarness = path.join(detectProject, '.harness');
    fs.mkdirSync(detectHarness, { recursive: true });
    fs.writeFileSync(path.join(detectProject, 'feature-list.json'), JSON.stringify({ features: [{ id: 'F1' }] }));
    fs.writeFileSync(path.join(detectProject, 'progress.txt'), 'test');
    fs.writeFileSync(path.join(detectProject, 'PROJECT_STATUS.md'), '# Test');

    // Create harness state
    await apiPost('create', {
      projectPath: detectProject,
      projectName: 'Detect Test',
      harnessType: 'build',
      mode: 'airedale',
    });

    // Write a valid checkpoint file
    const checkpoint = {
      checkpointPhase: 'init',
      checkpointCompletedAt: new Date().toISOString(),
      checkpointHarness: 'build',
      checkpointMode: 'airedale',
      checkpointAgentFile: 'agents/initialisation.md',
      checkpointAgentFileReadConfirmed: true,
      checkpointRequiredArtefacts: {},
      checkpointNextAgent: 'designer',
      checkpointUserConfirmed: true,
      checkpointDetail: {},
    };
    fs.writeFileSync(path.join(detectHarness, 'checkpoint-init.json'), JSON.stringify(checkpoint, null, 2));

    const detectSessionId = `test-detect-${Date.now()}`;
    await postHook('session-start', { session_id: detectSessionId, cwd: detectProject });

    // Simulate PostToolUse for the checkpoint write
    const postResult = await postHook('post-tool-use', {
      session_id: detectSessionId,
      cwd: detectProject,
      tool_name: 'Write',
      tool_input: { file_path: path.join(detectHarness, 'checkpoint-init.json') },
      tool_use_id: `tu_${Date.now()}`,
    });

    // PostToolUse always returns {} — the checkpoint detection is server-side
    expect(postResult).toEqual({});

    // Verify the ledger has a gate_pending event for this project
    const events = await apiGet('ledger');
    const gatePending = events.filter(
      (e: any) => e.ledgerEventType === 'gate_pending' && e.ledgerProjectPath === detectProject
    );
    expect(gatePending.length).toBeGreaterThan(0);
    expect(gatePending[gatePending.length - 1].ledgerDetail.valid).toBe(true);

    await postHook('session-end', { session_id: detectSessionId, cwd: detectProject });
    try { fs.rmSync(detectProject, { recursive: true, force: true }); } catch { /* auto-spawn may hold lock briefly */ }
  });
});

test.describe('F006 — Gate Feedback Endpoint', () => {
  test('should accept gate feedback and advance on full approval', async () => {
    // Create a project with a valid init checkpoint ready for gate
    const gateProject = path.join(os.tmpdir(), `harness-gate-${Date.now()}`);
    const gateHarness = path.join(gateProject, '.harness');
    fs.mkdirSync(gateHarness, { recursive: true });
    fs.writeFileSync(path.join(gateProject, 'feature-list.json'), JSON.stringify({ features: [{ id: 'F1' }] }));
    fs.writeFileSync(path.join(gateProject, 'progress.txt'), 'test');
    fs.writeFileSync(path.join(gateProject, 'PROJECT_STATUS.md'), '# Test');

    await apiPost('create', {
      projectPath: gateProject,
      projectName: 'Gate Test',
      harnessType: 'integration',
      mode: 'airedale',
    });

    // Write valid init checkpoint
    const checkpoint = {
      checkpointPhase: 'init',
      checkpointCompletedAt: new Date().toISOString(),
      checkpointHarness: 'integration',
      checkpointMode: 'airedale',
      checkpointAgentFile: 'agents/initialisation.md',
      checkpointAgentFileReadConfirmed: true,
      checkpointRequiredArtefacts: {},
      checkpointNextAgent: 'researcher',
      checkpointUserConfirmed: true,
      checkpointDetail: {},
    };
    fs.writeFileSync(path.join(gateHarness, 'checkpoint-init.json'), JSON.stringify(checkpoint, null, 2));

    // Advance to research first (init→research is auto-gate)
    await apiPost('advance', { projectPath: gateProject, sessionId: 'test' });

    // Now write research checkpoint
    const researchCheckpoint = {
      checkpointPhase: 'research',
      checkpointCompletedAt: new Date().toISOString(),
      checkpointHarness: 'integration',
      checkpointMode: 'airedale',
      checkpointAgentFile: 'agents/researcher.md',
      checkpointAgentFileReadConfirmed: true,
      checkpointRequiredArtefacts: {},
      checkpointNextAgent: 'developer',
      checkpointUserConfirmed: true,
      checkpointDetail: {},
    };
    fs.writeFileSync(path.join(gateHarness, 'checkpoint-research.json'), JSON.stringify(researchCheckpoint, null, 2));

    // Submit gate feedback via the /api/gate/feedback endpoint (simulating HTML review doc)
    const feedbackRes = await fetch(`${BASE_URL}/api/gate/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewType: 'design-gate',
        project: 'Gate Test',
        projectPath: gateProject,
        timestamp: new Date().toISOString(),
        sections: {
          'section-1': { decision: 'approve', comment: '' },
          'section-2': { decision: 'approve', comment: '' },
        },
      }),
    });
    const feedbackResult = await feedbackRes.json();

    expect(feedbackResult.ok).toBe(true);
    expect(feedbackResult.decision).toBe('approved');

    // Verify the project advanced
    const status = await apiGet(`status/${encodeURIComponent(gateProject)}`);
    expect(status.state.harnessCurrentPhase).toBe('dev');

    try { fs.rmSync(gateProject, { recursive: true, force: true }); } catch { /* auto-spawn may hold lock briefly */ }
  });

  test('should return needs-work when feedback has amendments', async () => {
    const amendProject = path.join(os.tmpdir(), `harness-amend-${Date.now()}`);
    const amendHarness = path.join(amendProject, '.harness');
    fs.mkdirSync(amendHarness, { recursive: true });
    fs.writeFileSync(path.join(amendProject, 'feature-list.json'), JSON.stringify({ features: [{ id: 'F1' }] }));
    fs.writeFileSync(path.join(amendProject, 'progress.txt'), 'test');
    fs.writeFileSync(path.join(amendProject, 'PROJECT_STATUS.md'), '# Test');

    await apiPost('create', {
      projectPath: amendProject,
      projectName: 'Amend Test',
      harnessType: 'build',
      mode: 'airedale',
    });

    const feedbackRes = await fetch(`${BASE_URL}/api/gate/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewType: 'design-gate',
        project: 'Amend Test',
        projectPath: amendProject,
        sections: {
          'section-1': { decision: 'approve' },
          'section-2': { decision: 'amend', comment: 'Needs more detail' },
        },
      }),
    });
    const feedbackResult = await feedbackRes.json();

    expect(feedbackResult.ok).toBe(true);
    expect(feedbackResult.decision).toBe('needs-work');
    expect(feedbackResult.amended).toBe(1);
    expect(feedbackResult.approved).toBe(1);

    fs.rmSync(amendProject, { recursive: true, force: true });
  });
});

test.describe('F008 — Handoff Brief Validation', () => {
  test('phase prompt should reference handoff brief when it exists', async () => {
    // Create a project in research phase with a handoff brief from init
    const handoffProject = path.join(os.tmpdir(), `harness-handoff-${Date.now()}`);
    const handoffHarness = path.join(handoffProject, '.harness');
    fs.mkdirSync(handoffHarness, { recursive: true });
    fs.writeFileSync(path.join(handoffProject, 'feature-list.json'), JSON.stringify({ features: [{ id: 'F1' }] }));
    fs.writeFileSync(path.join(handoffProject, 'progress.txt'), 'test');
    fs.writeFileSync(path.join(handoffProject, 'PROJECT_STATUS.md'), '# Test');

    await apiPost('create', {
      projectPath: handoffProject,
      projectName: 'Handoff Test',
      harnessType: 'integration',
      mode: 'airedale',
    });

    // Write handoff brief from init phase
    fs.writeFileSync(path.join(handoffHarness, 'handoff-init.md'),
      '## What Was Done\nInitialisation complete.\n\n## Key Decisions\nUsing integration harness.\n\n## Next Phase Instructions\nBegin research.');

    // Advance to research
    const initCheckpoint = {
      checkpointPhase: 'init',
      checkpointCompletedAt: new Date().toISOString(),
      checkpointHarness: 'integration',
      checkpointMode: 'airedale',
      checkpointAgentFile: 'agents/initialisation.md',
      checkpointAgentFileReadConfirmed: true,
      checkpointRequiredArtefacts: {},
      checkpointNextAgent: 'researcher',
      checkpointUserConfirmed: true,
      checkpointDetail: {},
    };
    fs.writeFileSync(path.join(handoffHarness, 'checkpoint-init.json'), JSON.stringify(initCheckpoint, null, 2));
    await apiPost('advance', { projectPath: handoffProject, sessionId: 'test' });

    // Get phase prompt for research — should reference the handoff brief
    const promptResult = await apiGet(`phase-prompt/${encodeURIComponent(handoffProject)}?phase=research`);
    expect(promptResult.prompt).toContain('handoff-init.md');

    fs.rmSync(handoffProject, { recursive: true, force: true });
  });
});

test.describe('F013 — Metrics & Health', () => {
  test('should return enforcement metrics', async () => {
    const metrics = await apiGet('metrics');
    expect(typeof metrics.metricsUptimeSeconds).toBe('number');
    expect(typeof metrics.metricsTotalToolCalls).toBe('number');
    expect(typeof metrics.metricsViolations).toBe('number');
    expect(typeof metrics.metricsGatesCleared).toBe('number');
    expect(metrics.metricsStartedAt).toBeDefined();
  });

  test('should return health at /api/health', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    const health = await res.json();
    expect(health.status).toBe('ok');
    expect(typeof health.uptime).toBe('number');
    expect(health.service).toBe('command-centre');
  });
});

test.describe('F014 — Success Criteria', () => {
  test('should return computed success criteria', async () => {
    const criteria = await apiGet('success-criteria');
    // Phase compliance rate (may be null if no data, or a number)
    expect(criteria.phaseComplianceRate === null || typeof criteria.phaseComplianceRate === 'number').toBe(true);
    expect(typeof criteria.manualCheckpointEdits).toBe('number');
    expect(criteria.violationsPerSession === null || typeof criteria.violationsPerSession === 'number').toBe(true);
  });
});

test.describe('Harness Enforcement — No Harness Active', () => {
  test('should not enforce anything for projects without a harness', async () => {
    const noHarnessProject = path.join(os.tmpdir(), `no-harness-${Date.now()}`);
    fs.mkdirSync(noHarnessProject, { recursive: true });

    const sessionId = `test-no-harness-${Date.now()}`;
    await postHook('session-start', { session_id: sessionId, cwd: noHarnessProject });

    // Write to src/ — should pass (no harness, no enforcement)
    const result = await postHook('pre-tool-use', {
      session_id: sessionId,
      cwd: noHarnessProject,
      tool_name: 'Write',
      tool_input: { file_path: path.join(noHarnessProject, 'src', 'App.cs'), content: 'test' },
      tool_use_id: `tu_${Date.now()}`,
    });

    const hasHarnessDeny =
      result.hookSpecificOutput?.permissionDecision === 'deny' &&
      result.hookSpecificOutput?.permissionDecisionReason?.includes('[HARNESS]');
    expect(hasHarnessDeny).toBe(false);

    await postHook('session-end', { session_id: sessionId, cwd: noHarnessProject });
    fs.rmSync(noHarnessProject, { recursive: true, force: true });
  });
});
