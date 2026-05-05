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
  test('Read tools should always pass (auto-pass, no enforcement)', async () => {
    const result = await simulateRead(path.join(TEMP_PROJECT, 'agents/initialisation.md'));

    // Read tools return empty response (auto-pass) — no permissionDecision
    expect(result.hookSpecificOutput).toBeUndefined();
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
