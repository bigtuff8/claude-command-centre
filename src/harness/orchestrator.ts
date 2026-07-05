// Harness Enforcement Engine — Phase Orchestrator (Layer 4)
// Spawns separate Claude Code sessions per agent phase with prompt injection

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, exec, execSync } from 'child_process';
import {
  HarnessState,
  HarnessPhase,
  HARNESS_PHASE_SEQUENCES,
  PHASE_AGENT_FILES,
  PHASE_CHECKPOINT_FILES,
} from './types';
import { loadHarnessState, advancePhase, getNextPhase, getArtefactBasePath } from './state';
import { validateCheckpoint } from './checkpoints';
import { getRequiredReads } from './rules';
import { appendLedgerEvent } from './ledger';

// F004: Active spawned sessions tracked for cleanup
const activeSpawnedSessions = new Map<string, { pid: number; phase: HarnessPhase; projectPath: string }>();

// Broadcast function injected at init
let orchestratorBroadcast: ((event: string, data: any) => void) | null = null;

/**
 * F004: Initialise the orchestrator with a broadcast function for Socket.IO events.
 */
export function initOrchestrator(broadcast: (event: string, data: any) => void): void {
  orchestratorBroadcast = broadcast;
}

/**
 * Build the initial prompt for a phase session.
 * This is injected when spawning a new Claude Code session for the phase.
 */
export function buildPhasePrompt(state: HarnessState, phase: HarnessPhase): string {
  const agentFile = PHASE_AGENT_FILES[phase];
  const previousPhase = getPreviousPhaseInSequence(state, phase);
  const previousCheckpoint = previousPhase ? PHASE_CHECKPOINT_FILES[previousPhase] : null;
  const requiredReads = getRequiredReads(state.harnessType, phase, state.harnessMode);

  // Absolute harness-asset paths. A spawned session's cwd is the PROJECT folder, NOT the
  // Claude Agents folder, so bare relative paths like `agents/designer.md` fail to resolve
  // and the session stalls at its mandatory first read. Anchor to the Command Centre's own
  // location: <...>/Claude Agents/Command Centre/dist/harness -> up 3 = <...>/Claude Agents.
  const claudeAgentsRoot = path.resolve(__dirname, '..', '..', '..');
  const agentFileAbs = path.join(claudeAgentsRoot, agentFile);
  const standardsDir = path.resolve(claudeAgentsRoot, '..', '..', '.claude', '.claude-docs');

  const wf = state.harnessWorkFolder;
  const lines: string[] = [
    `You are entering the **${phase}** phase of the **${state.harnessType}** harness.`,
    '',
    `PROJECT: ${state.harnessProject}`,
    `MODE: ${state.harnessMode}`,
    `HARNESS: ${state.harnessType}`,
    `PHASE: ${phase}`,
    `AGENTS & HARNESS SPECS LOCATION: ${claudeAgentsRoot}`,
    `  (agent prompts under agents/, harness specs under harnesses/ — use the absolute paths given below)`,
  ];

  // Work folder context (DR-06)
  if (wf) {
    lines.push(`WORK FOLDER: ${wf}/`);
    lines.push('');
    lines.push('IMPORTANT: ALL harness artefacts MUST be written to the work folder, not the project root.');
    lines.push(`  Write to: ${wf}/feature-list.json (NOT feature-list.json)`);
    lines.push(`  Write to: ${wf}/progress.txt (NOT progress.txt)`);
    lines.push(`  Write to: ${wf}/design-spec.md (NOT design-spec.md)`);
    lines.push(`  Checkpoints: ${wf}/.harness/checkpoint-{phase}.json`);
  }

  lines.push('');
  lines.push('## MANDATORY FIRST ACTIONS');
  lines.push('');
  lines.push('You CANNOT write, edit, or run commands until these files have been read.');
  lines.push('The Command Centre enforces this — tool calls will be denied until prerequisites are met.');
  lines.push('');

  let step = 1;

  // MISSED-01: Phase prompt file contains the formatted version of this prompt
  if (wf) {
    lines.push(`${step}. Read the formatted phase prompt: \`${wf}/.harness/phase-prompt.md\` (this prompt with full formatting)`);
    step++;
  }

  // Agent prompt is always first (absolute path — session cwd is the project folder)
  lines.push(`${step}. Read the agent prompt: \`${agentFileAbs}\``);
  step++;

  // Feature list (work-folder aware)
  const artefactPrefix = wf ? `${wf}/` : '';
  lines.push(`${step}. Read the feature list: \`${artefactPrefix}feature-list.json\``);
  step++;

  // Progress file
  lines.push(`${step}. Read the progress file: \`${artefactPrefix}progress.txt\``);
  step++;

  // Previous checkpoint
  if (previousCheckpoint) {
    lines.push(`${step}. Read the previous phase's checkpoint: \`${artefactPrefix}.harness/${previousCheckpoint}\``);
    step++;
  }

  // F008: Handoff brief from previous phase (DR-01: use artefact base path)
  if (previousPhase) {
    const handoffFile = `.harness/handoff-${previousPhase}.md`;
    const artefactBase = getArtefactBasePath(state);
    const handoffPath = path.join(artefactBase, handoffFile);
    if (fs.existsSync(handoffPath)) {
      lines.push(`${step}. Read the handoff brief from the previous phase: \`${artefactPrefix}${handoffFile}\``);
      step++;
    }
  }

  // Phase-specific reads
  if (phase === 'dev' && state.harnessType === 'build') {
    lines.push(`${step}. Read the design spec: \`${artefactPrefix}design-spec.md\``);
    step++;
  }

  if (phase === 'test') {
    lines.push(`${step}. Read the testing standards: \`${path.join(standardsDir, 'testing-standards.md')}\``);
    step++;
  }

  lines.push('');
  lines.push('## ENFORCEMENT NOTICE');
  lines.push('');
  lines.push('This session is managed by the Harness Enforcement Engine. The Command Centre');
  lines.push('will automatically deny tool calls that violate phase rules:');
  lines.push('');

  // Phase-specific enforcement summary
  switch (phase) {
    case 'init':
      lines.push('- You CANNOT write to `src/` (no code during initialisation)');
      lines.push('- You CANNOT run `git commit` (artefact setup only)');
      break;
    case 'design':
      lines.push('- You CANNOT write to `src/` (only `prototype/` is allowed)');
      lines.push('- Previous phase checkpoint must be valid');
      break;
    case 'dev':
      lines.push('- You MUST read all required files before writing code');
      lines.push('- Previous phase checkpoint must be valid');
      if (state.harnessMode === 'airedale') {
        lines.push('- You MUST read `csharp-blazor-standards.md` AND `security-standards.md` before writing code (GAP-02 enforcement)');
      }
      lines.push('- You MUST write `code-audit.md` BEFORE the checkpoint — this is enforced');
      lines.push('- The code audit MUST include checks for: functions defined but never called, dead code, secrets/credentials');
      lines.push('- The checkpoint will be REJECTED if code-audit.md is missing or incomplete');
      break;
    case 'test':
      lines.push('- You CANNOT modify production code in `src/` (only test files)');
      lines.push('- You MUST write `test-report.md` before the checkpoint');
      lines.push('- You MUST write `verification-report.md` BEFORE the checkpoint — this is enforced');
      lines.push('- The verification report must trace EVERY feature ID from `feature-list.json`');
      lines.push('- For each feature, walk through its `verification_steps` and confirm pass/fail against the actual code');
      lines.push('- The checkpoint will be REJECTED if any feature ID is missing from the verification report');
      lines.push('- Previous phase checkpoint must be valid');
      break;
    case 'release':
      lines.push('- You CANNOT `git push` if test-report.md has failures');
      lines.push('- Previous phase checkpoint must be valid');
      break;
    case 'research':
      lines.push('- Previous phase checkpoint must be valid');
      break;
    case 'write':
      lines.push('- Previous phase checkpoint must be valid');
      break;
  }

  lines.push('');
  lines.push('## CHECKPOINT REQUIREMENT');
  lines.push('');
  lines.push(`When this phase is complete, you MUST write \`${artefactPrefix}.harness/${PHASE_CHECKPOINT_FILES[phase]}\`.`);
  lines.push('See the agent prompt for the exact schema. The Command Centre validates it server-side.');
  lines.push('');
  lines.push('Begin.');

  return lines.join('\n');
}

// ---- F008: Handoff brief generation + validation ----

const HANDOFF_REQUIRED_SECTIONS = ['## What Was Done', '## Key Decisions', '## Next Phase Instructions'];

/**
 * G011: Generate a handoff brief template for a completing phase.
 * The agent session is expected to fill this in before writing its checkpoint.
 * If the file already exists (agent wrote it), this is a no-op.
 */
export function generateHandoffBriefTemplate(
  state: HarnessState,
  completingPhase: HarnessPhase
): string {
  const briefPath = path.join(getArtefactBasePath(state), '.harness', `handoff-${completingPhase}.md`);

  // Don't overwrite if the agent already wrote one
  if (fs.existsSync(briefPath)) return briefPath;

  const template = `# Handoff Brief: ${completingPhase} Phase

**Project:** ${state.harnessProject}
**Harness:** ${state.harnessType} (${state.harnessMode})
**Phase:** ${completingPhase}
**Date:** ${new Date().toISOString()}

## What Was Done

<!-- Describe what was accomplished in this phase -->

## Key Decisions

<!-- List important decisions made and their rationale -->

## Blockers & Open Issues

<!-- Any unresolved issues or blockers for the next phase -->

## Artefacts Created

<!-- List files created or modified, with brief descriptions -->

## Next Phase Instructions

<!-- Specific instructions for the next agent/phase -->
`;

  try {
    fs.writeFileSync(briefPath, template, 'utf-8');
    console.log(`[Orchestrator] Handoff brief template generated: ${briefPath}`);
  } catch (err) {
    console.log(`[Orchestrator] Could not generate handoff brief template: ${err}`);
  }

  return briefPath;
}

/**
 * F008: Validate a handoff brief has required sections and references valid artefacts.
 */
export function validateHandoffBrief(
  state: HarnessState,
  phase: HarnessPhase
): { valid: boolean; errors: string[] } {
  const artefactBase = getArtefactBasePath(state);
  const briefPath = path.join(artefactBase, '.harness', `handoff-${phase}.md`);
  const errors: string[] = [];

  if (!fs.existsSync(briefPath)) {
    errors.push(`Handoff brief not found: .harness/handoff-${phase}.md`);
    return { valid: false, errors };
  }

  const content = fs.readFileSync(briefPath, 'utf-8');

  // Check required sections
  for (const section of HANDOFF_REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  // Cross-reference artefacts: find file references and check they exist
  const fileRefs = content.match(/`([^`]+\.\w+)`/g);
  if (fileRefs) {
    for (const ref of fileRefs) {
      const filePath = ref.replace(/`/g, '');
      // Only check relative paths (not code snippets or patterns)
      if (!filePath.includes('*') && !filePath.includes(' ') && filePath.includes('/')) {
        const fullPath = path.join(artefactBase, filePath);
        if (!fs.existsSync(fullPath)) {
          errors.push(`Referenced artefact not found: ${filePath}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a phase transition is ready (checkpoint validated, gates cleared).
 * Returns { ready, errors } — ready=true means the next phase can start.
 */
export function isPhaseTransitionReady(
  state: HarnessState
): { ready: boolean; errors: string[]; nextPhase: HarnessPhase | null } {
  const nextPhase = getNextPhase(state);
  if (!nextPhase) {
    return { ready: false, errors: ['Already at the final phase'], nextPhase: null };
  }

  // Validate current phase's checkpoint
  const currentCheckpointFile = PHASE_CHECKPOINT_FILES[state.harnessCurrentPhase];
  const errors = validateCheckpoint(state, state.harnessCurrentPhase);

  if (errors.length > 0) {
    return {
      ready: false,
      errors: errors.map((e) => `Checkpoint validation: ${e}`),
      nextPhase,
    };
  }

  // Check governance gates
  if (state.harnessCurrentPhase === 'design' && !state.harnessGatesCleared['designGate']) {
    return {
      ready: false,
      errors: ['Design Gate has not been cleared — user approval required'],
      nextPhase,
    };
  }

  if (state.harnessCurrentPhase === 'release' && !state.harnessGatesCleared['preDeployment']) {
    // Pre-deployment gate is optional in some flows — only block if explicitly required
    // For now, don't block on this gate
  }

  // G012: Validate handoff brief if it exists (advisory — log but don't block)
  const handoffResult = validateHandoffBrief(state, state.harnessCurrentPhase);
  if (!handoffResult.valid && handoffResult.errors[0] && !handoffResult.errors[0].includes('not found')) {
    // Brief exists but is invalid — warn but don't block transition
    console.log(`[Orchestrator] Handoff brief validation warnings: ${handoffResult.errors.join('; ')}`);
  }

  return { ready: true, errors: [], nextPhase };
}

/**
 * Execute a phase transition: validate, advance state, generate next prompt.
 * Returns the prompt to inject into the new session, or errors if not ready.
 */
export function executePhaseTransition(
  state: HarnessState,
  sessionId: string | null
): { success: boolean; prompt?: string; nextPhase?: HarnessPhase; errors?: string[] } {
  const readiness = isPhaseTransitionReady(state);

  if (!readiness.ready || !readiness.nextPhase) {
    return { success: false, errors: readiness.errors };
  }

  const advanceResult = advancePhase(state, sessionId);
  if (!advanceResult.state) {
    return { success: false, errors: [advanceResult.error || 'Failed to advance phase'] };
  }

  const prompt = buildPhasePrompt(advanceResult.state, readiness.nextPhase);

  return {
    success: true,
    prompt,
    nextPhase: readiness.nextPhase,
  };
}

/**
 * Get the previous phase in the sequence for a given phase.
 */
function getPreviousPhaseInSequence(state: HarnessState, phase: HarnessPhase): HarnessPhase | null {
  const sequence = HARNESS_PHASE_SEQUENCES[state.harnessType];
  if (!sequence) return null;

  const index = sequence.indexOf(phase);
  if (index <= 0) return null;

  return sequence[index - 1];
}

/**
 * Generate a summary of the current harness state for dashboard display.
 */
export function getHarnessSummary(state: HarnessState): {
  project: string;
  harness: string;
  mode: string;
  currentPhase: string;
  phaseSequence: string[];
  completedPhases: string[];
  pendingPhases: string[];
  reworkCycles: number;
  overrideCount: number;
  isPaused: boolean;
  nextPhaseReady: boolean;
} {
  const sequence = HARNESS_PHASE_SEQUENCES[state.harnessType] || [];
  const currentIndex = sequence.indexOf(state.harnessCurrentPhase);

  const completedPhases = sequence.slice(0, currentIndex);
  const pendingPhases = sequence.slice(currentIndex + 1);

  const readiness = isPhaseTransitionReady(state);

  return {
    project: state.harnessProject,
    harness: state.harnessType,
    mode: state.harnessMode,
    currentPhase: state.harnessCurrentPhase,
    phaseSequence: sequence,
    completedPhases,
    pendingPhases,
    reworkCycles: state.harnessReworkCycles,
    overrideCount: state.harnessOverrides.length,
    isPaused: state.harnessPaused,
    nextPhaseReady: readiness.ready,
  };
}

// ---- F004: Session-per-phase spawning ----

/**
 * Gate type mapping: which transitions are auto-approved vs manual.
 * Auto gates: logged but don't require human approval.
 * Manual gates: produce HTML review docs and wait for POST to /api/gate/feedback.
 */
const GATE_CONFIG: Record<string, { auto: boolean; steerco: boolean }> = {
  'init→research': { auto: true, steerco: false },
  'init→design': { auto: true, steerco: false },
  'research→dev': { auto: false, steerco: false },
  'research→write': { auto: false, steerco: false },
  'design→dev': { auto: false, steerco: true },
  'dev→test': { auto: true, steerco: false },
  'test→release': { auto: false, steerco: true },
};

function getGateKey(from: HarnessPhase, to: HarnessPhase): string {
  return `${from}→${to}`;
}

/**
 * F004: Check if a gate transition is auto-approved.
 */
export function isAutoGate(from: HarnessPhase, to: HarnessPhase): boolean {
  const config = GATE_CONFIG[getGateKey(from, to)];
  return config?.auto ?? true;
}

/**
 * F004: Check if a gate transition requires SteerCo review.
 */
export function isSteerCoGate(from: HarnessPhase, to: HarnessPhase): boolean {
  const config = GATE_CONFIG[getGateKey(from, to)];
  return config?.steerco ?? false;
}

/**
 * Escape a string for use as a double-quoted argument in cmd.exe.
 */
function escapeCmdArg(arg: string): string {
  return '"' + arg.replace(/"/g, '""').replace(/%/g, '%%') + '"';
}

/**
 * G019: Write a prompt to a temp file and return the path.
 * Avoids cmd.exe buffer overflow for long prompts (F015).
 * CRITICAL: Flattens newlines to spaces — `set /p` in cmd.exe only reads
 * the first line, so the entire prompt must be on a single line.
 *
 * MISSED-01 note: This function is ONLY used by invokeSteerCoReview() for
 * headless SteerCo sessions (which still use the cmd.exe `set /p` pattern).
 * Interactive phase sessions use session-spawn.ts instead.
 */
function writePromptToTempFile(prompt: string, label: string): string {
  const tmpFile = path.join(os.tmpdir(), `claude-${label}-${Date.now()}.txt`);
  const flattened = prompt.replace(/\r?\n/g, ' ');
  fs.writeFileSync(tmpFile, flattened, 'utf-8');
  return tmpFile;
}

/**
 * F004: Spawn a new interactive Claude Code session for the given phase.
 * G003 fix: Opens a NEW TERMINAL WINDOW (not headless). The user can see
 * and interact with the session. Hooks fire from the user's Claude Code
 * settings, ensuring Command Centre enforcement is active (G005).
 * G019 fix: Prompt written to temp file, avoiding cmd.exe buffer overflow.
 * G020 fix: Session timeout (configurable, default 2 hours).
 * Retry with backoff on failure (max 2 attempts per SteerCo condition).
 */
export async function spawnPhaseSession(
  state: HarnessState,
  phase: HarnessPhase,
  maxRetries: number = 2
): Promise<{ success: boolean; pid?: number; error?: string; command?: string; degraded?: boolean }> {
  const prompt = buildPhasePrompt(state, phase);
  const cwd = state.harnessProjectPath;
  const ZOMBIE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // DR-15: 12h safety net for genuine zombies

  // Verify project directory exists
  if (!fs.existsSync(cwd)) {
    return { success: false, error: `Project directory does not exist: ${cwd}` };
  }

  // Lazy import to avoid circular dependency
  const { spawnHappySession } = require('../services/session-spawn');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const displayName = `${state.harnessProject} / ${phase.charAt(0).toUpperCase() + phase.slice(1)}`;
      console.log(`[Orchestrator] Spawning ${phase} session (attempt ${attempt}/${maxRetries}) for ${state.harnessProject}`);

      const result = await spawnHappySession({
        projectPath: cwd,
        displayName,
        systemPrompt: prompt,
        initialMessage: `Begin the ${phase} phase. Read all mandatory prerequisites listed in your system prompt, then start working autonomously.`,
        workFolderPath: state.harnessWorkFolder || undefined,
        harnessContext: {
          type: state.harnessType,
          phase,
          mode: state.harnessMode,
        },
      }, orchestratorBroadcast || undefined);

      // Track the spawned session
      const sessionKey = `${cwd}:${phase}`;
      if (result.pid) {
        activeSpawnedSessions.set(sessionKey, { pid: result.pid, phase, projectPath: cwd });
      }

      // DR-15: 12-hour zombie safety net (proc.on('close') handles normal exit)
      setTimeout(() => {
        if (activeSpawnedSessions.has(sessionKey)) {
          console.log(`[Orchestrator] Zombie timeout: ${phase} for ${state.harnessProject}`);
          activeSpawnedSessions.delete(sessionKey);
          if (orchestratorBroadcast) {
            orchestratorBroadcast('phase-session-ended', { projectPath: cwd, phase, exitCode: null, timedOut: true });
          }
        }
      }, ZOMBIE_TIMEOUT_MS);

      // DR-12: Log if spawn degraded to claude
      if (result.degraded) {
        console.log(`[Orchestrator] Session spawned in DEGRADED mode (claude, not happy)`);
      }

      appendLedgerEvent({
        ledgerEventType: 'phase_start',
        ledgerTimestamp: new Date().toISOString(),
        ledgerProjectPath: state.harnessProjectPath,
        ledgerProjectName: state.harnessProject,
        ledgerWorkFolder: state.harnessWorkFolder,
        ledgerHarness: state.harnessType,
        ledgerMode: state.harnessMode,
        ledgerPhase: phase,
        ledgerSessionId: null,
        ledgerDetail: { pid: result.pid, attempt, spawned: true, degraded: result.degraded },
      });

      if (orchestratorBroadcast) {
        orchestratorBroadcast('phase-session-started', {
          projectPath: cwd, phase, pid: result.pid, attempt, displayName, degraded: result.degraded,
        });
      }

      return { success: true, pid: result.pid, command: result.command, degraded: result.degraded };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Orchestrator] Spawn attempt ${attempt} failed: ${errorMsg}`);

      if (attempt < maxRetries) {
        const delay = attempt === 1 ? 2000 : 5000;
        await new Promise((r) => setTimeout(r, delay));
      } else {
        if (orchestratorBroadcast) {
          orchestratorBroadcast('phase-session-failed', { projectPath: cwd, phase, error: errorMsg, attempts: maxRetries });
        }
        return { success: false, error: `Failed after ${maxRetries} attempts: ${errorMsg}` };
      }
    }
  }

  return { success: false, error: 'Unexpected: exhausted retry loop' };
}

/**
 * F004: Get the list of currently spawned phase sessions.
 */
export function getActiveSpawnedSessions(): Array<{ pid: number; phase: HarnessPhase; projectPath: string }> {
  return Array.from(activeSpawnedSessions.values());
}

// ---- G008: Gate Review HTML Generation ----

/**
 * G008: Generate an interactive HTML review document for a governance gate.
 * Same pattern as the design gate review — approve/amend/reject per section,
 * POSTs feedback to Command Centre on submit.
 * Returns the file path of the generated HTML, or null on failure.
 */
export function generateGateReviewHtml(
  state: HarnessState,
  completedPhase: HarnessPhase,
  nextPhase: HarnessPhase,
  steerCoReview: string | null = null
): string | null {
  const checkpointFile = PHASE_CHECKPOINT_FILES[completedPhase];
  const artefactBase = getArtefactBasePath(state);
  const checkpointPath = path.join(artefactBase, '.harness', checkpointFile);

  let checkpointData: any = {};
  try {
    if (fs.existsSync(checkpointPath)) {
      checkpointData = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
    }
  } catch { /* skip */ }

  // Collect artefact info for review sections
  const artefacts = checkpointData.checkpointRequiredArtefacts || {};
  const artefactSections = Object.entries(artefacts).map(([name, art]: [string, any]) => ({
    id: `artefact-${name}`,
    title: `Artefact: ${name}`,
    content: `Path: <code>${art.checkpointArtefactPath || 'N/A'}</code><br>Exists: ${art.checkpointArtefactExists ? 'Yes' : 'No'}${art.checkpointArtefactHash ? '<br>Hash: <code>' + art.checkpointArtefactHash + '</code>' : ''}`,
  }));

  const sections = [
    {
      id: 'phase-summary',
      title: `Phase Summary: ${completedPhase}`,
      content: `<p>Project: <strong>${state.harnessProject}</strong></p>
        <p>Harness: ${state.harnessType} / ${state.harnessMode}</p>
        <p>Phase completing: <strong>${completedPhase}</strong></p>
        <p>Next phase: <strong>${nextPhase}</strong></p>
        <p>Rework cycles: ${state.harnessReworkCycles}</p>
        <p>Overrides: ${state.harnessOverrides.length}</p>`,
    },
    {
      id: 'checkpoint-data',
      title: 'Checkpoint Validation',
      content: `<p>Completed at: ${checkpointData.checkpointCompletedAt || 'N/A'}</p>
        <p>Agent file read confirmed: ${checkpointData.checkpointAgentFileReadConfirmed ? 'Yes' : 'No'}</p>
        <p>User confirmed: ${checkpointData.checkpointUserConfirmed ? 'Yes' : 'No'}</p>`,
    },
    ...artefactSections,
  ];

  // Add code audit section for dev→test gate
  if (completedPhase === 'dev') {
    const auditPath = path.join(artefactBase, 'code-audit.md');
    if (fs.existsSync(auditPath)) {
      const auditContent = fs.readFileSync(auditPath, 'utf-8');
      sections.push({
        id: 'code-audit',
        title: 'Code Audit Report',
        content: `<pre>${auditContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`,
      });
    }
  }

  // Add SteerCo review if available
  if (steerCoReview) {
    sections.push({
      id: 'steerco-review',
      title: 'SteerCo Companion Review',
      content: `<pre>${steerCoReview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`,
    });
  }

  // Generate the HTML
  const sectionIds = sections.map(s => `'${s.id}'`).join(',');
  const sectionsHtml = sections.map(s => `
    <div class="section" data-section="${s.id}">
      <div class="section-header"><div class="section-title">${s.title}</div></div>
      ${s.content}
      <div class="controls">
        <button class="btn" onclick="setDecision('${s.id}','approve')">Approve</button>
        <button class="btn" onclick="setDecision('${s.id}','amend')">Amend</button>
        <button class="btn" onclick="setDecision('${s.id}','reject')">Reject</button>
      </div>
      <div class="comment-box" id="comment-${s.id}"><label>Comments:</label><textarea></textarea></div>
    </div>`).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gate Review: ${completedPhase} → ${nextPhase} — ${state.harnessProject}</title>
<style>
:root{--bg:#0f1117;--surface:#1a1d27;--surface2:#242834;--border:#2e3345;--text:#e2e4ea;--text-dim:#8b8fa3;--accent:#6c8cff;--green:#4ade80;--green-dim:#16532e;--red:#f87171;--red-dim:#5c2020;--amber:#fbbf24;--amber-dim:#5c4a10;}
*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;padding:2rem;max-width:1000px;margin:0 auto;}
h1{font-size:1.6rem;margin-bottom:.5rem;}
.subtitle{color:var(--text-dim);margin-bottom:1.5rem;}
.section{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.5rem;margin-bottom:1rem;transition:border-color .2s;}
.section.approved{border-color:var(--green);}.section.amended{border-color:var(--amber);}.section.rejected{border-color:var(--red);}
.section-header{margin-bottom:.75rem;}.section-title{font-size:1.05rem;font-weight:600;}
.controls{display:flex;gap:.5rem;margin-top:1rem;padding-top:.75rem;border-top:1px solid var(--border);}
.btn{padding:.4rem 1rem;border:1px solid var(--border);border-radius:4px;background:var(--surface2);color:var(--text);cursor:pointer;font-size:.85rem;}
.btn:hover{background:var(--border);}
.btn.active-approve{background:var(--green-dim);border-color:var(--green);color:var(--green);}
.btn.active-amend{background:var(--amber-dim);border-color:var(--amber);color:var(--amber);}
.btn.active-reject{background:var(--red-dim);border-color:var(--red);color:var(--red);}
.comment-box{display:none;margin-top:.75rem;}.comment-box.visible{display:block;}
.comment-box textarea{width:100%;min-height:60px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:.5rem;font-family:inherit;font-size:.85rem;}
code{background:var(--surface2);padding:.1rem .3rem;border-radius:3px;font-size:.85em;}
pre{background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:1rem;overflow-x:auto;font-size:.82rem;white-space:pre-wrap;margin:.5rem 0;}
p{margin-bottom:.4rem;font-size:.9rem;}
.submit-bar{position:sticky;bottom:0;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1rem;margin-top:1.5rem;display:flex;justify-content:space-between;align-items:center;}
.submit-btn{padding:.6rem 2rem;background:var(--accent);color:white;border:none;border-radius:4px;font-size:.95rem;font-weight:600;cursor:pointer;}
.submit-btn:disabled{background:#3d5199;cursor:not-allowed;}
.status-text{font-size:.85rem;color:var(--text-dim);}
.result{font-size:.85rem;color:var(--green);display:none;margin-top:.5rem;}
</style></head><body>
<h1>Gate Review: ${completedPhase} → ${nextPhase}</h1>
<p class="subtitle">${state.harnessProject} — ${state.harnessType} harness (${state.harnessMode})</p>
${sectionsHtml}
<div class="submit-bar">
  <span class="status-text" id="status">0 of ${sections.length} sections reviewed</span>
  <div><button class="submit-btn" id="submitBtn" onclick="submitFeedback()" disabled>Submit to Command Centre</button>
  <div class="result" id="result"></div></div>
</div>
<script>
var decisions={};var sections=[${sectionIds}];
function setDecision(id,d){decisions[id]=d;var s=document.querySelector('[data-section="'+id+'"]');s.querySelectorAll('.controls .btn').forEach(function(b){b.className='btn';});var idx={approve:0,amend:1,reject:2}[d];var cls={approve:'active-approve',amend:'active-amend',reject:'active-reject'}[d];s.querySelectorAll('.controls .btn')[idx].classList.add(cls);s.className='section '+(d==='approve'?'approved':d==='amend'?'amended':'rejected');var cb=document.getElementById('comment-'+id);if(d==='amend'||d==='reject'){cb.classList.add('visible');cb.querySelector('textarea').focus();}else{cb.classList.remove('visible');}var n=Object.keys(decisions).length;document.getElementById('status').textContent=n+' of '+sections.length+' sections reviewed';document.getElementById('submitBtn').disabled=n<sections.length;}
async function submitFeedback(){var fb={reviewType:'${completedPhase === 'design' ? 'design-gate' : 'pre-deployment'}',project:'${state.harnessProject.replace(/'/g, "\\'")}',projectPath:${JSON.stringify(state.harnessProjectPath)},workFolder:${JSON.stringify(state.harnessWorkFolder || '')},timestamp:new Date().toISOString(),sections:{}};sections.forEach(function(id){var c=document.getElementById('comment-'+id);fb.sections[id]={decision:decisions[id]||'not-reviewed',comment:c?c.querySelector('textarea').value.trim():''};});try{var r=await fetch('http://localhost:4111/api/gate/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fb)});if(r.ok){var res=await r.json();document.getElementById('result').textContent=res.decision==='approved'?'Approved — advancing to ${nextPhase}':'Feedback submitted ('+res.decision+')';document.getElementById('result').style.display='block';}else{throw new Error('not ok');}}catch(e){await navigator.clipboard.writeText(JSON.stringify(fb,null,2));document.getElementById('result').textContent='CC unavailable — feedback copied to clipboard';document.getElementById('result').style.display='block';}}
</script></body></html>`;

  // Write to project directory and open in browser
  const reviewDir = path.join(artefactBase, '.harness');
  const reviewFile = path.join(reviewDir, `gate-review-${completedPhase}-${Date.now()}.html`);
  try {
    fs.writeFileSync(reviewFile, html, 'utf-8');
    console.log(`[Orchestrator] Gate review HTML generated: ${reviewFile}`);

    // Open in default browser
    if (process.platform === 'win32') {
      exec(`start "" "${reviewFile}"`, { windowsHide: true });
    } else {
      exec(`open "${reviewFile}"`, { windowsHide: true });
    }

    return reviewFile;
  } catch (err) {
    console.error(`[Orchestrator] Could not generate gate review HTML: ${err}`);
    return null;
  }
}

// ---- F007: SteerCo Companion Auto-invocation ----

/**
 * F007: Spawn a short SteerCo Companion review session at governance gates.
 * Captures the companion's output as a governance review string.
 * Advisory only — 30s timeout, non-blocking. Returns null on failure.
 */
export async function invokeSteerCoReview(
  state: HarnessState,
  checkpointPhase: HarnessPhase
): Promise<string | null> {
  const companionPath = path.join(state.harnessProjectPath, 'agents', 'steerco-companion.md');

  // Try to find the companion prompt — may be in a parent directory
  let companionPrompt = '';
  const searchPaths = [
    companionPath,
    path.join(state.harnessProjectPath, '..', 'agents', 'steerco-companion.md'),
    path.join(state.harnessProjectPath, '..', '..', 'agents', 'steerco-companion.md'),
  ];
  for (const sp of searchPaths) {
    try {
      if (fs.existsSync(sp)) {
        companionPrompt = fs.readFileSync(sp, 'utf-8');
        break;
      }
    } catch { /* skip */ }
  }

  if (!companionPrompt) {
    console.log('[Orchestrator] SteerCo Companion prompt not found — skipping review');
    return null;
  }

  // Build the review request (DR-01: use artefact base path)
  const steercoArtefactBase = getArtefactBasePath(state);
  const checkpointPath = path.join(steercoArtefactBase, '.harness', PHASE_CHECKPOINT_FILES[checkpointPhase]);
  let checkpointData = '';
  try {
    if (fs.existsSync(checkpointPath)) {
      checkpointData = fs.readFileSync(checkpointPath, 'utf-8');
    }
  } catch { /* skip */ }

  const prompt = [
    'You are performing an automated governance review at a harness gate.',
    `Project: ${state.harnessProject}`,
    `Harness: ${state.harnessType}`,
    `Phase completing: ${checkpointPhase}`,
    `Gate type: ${isSteerCoGate(checkpointPhase, getNextPhase(state)!) ? 'SteerCo Gate (design/pre-deployment)' : 'Standard Gate'}`,
    '',
    'Checkpoint data:',
    checkpointData || '(no checkpoint data available)',
    '',
    'Provide a concise governance review. Use the format:',
    '- BLOCKING: [issues that must be resolved]',
    '- ADVISORY: [concerns for awareness]',
    '- ENDORSED: [things done well]',
    '',
    'Be specific. If there are no blocking concerns, say so explicitly.',
    'Keep the review under 500 words.',
  ].join('\n');

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[Orchestrator] SteerCo review timed out (30s)');
      resolve(null);
    }, 30000);

    try {
      const safePrompt = prompt.replace(/\r?\n/g, ' ');
      // G010: Write companion prompt to temp file to avoid cmd.exe buffer overflow
      const companionFile = writePromptToTempFile(
        companionPrompt.replace(/\r?\n/g, ' ').substring(0, 4000),
        'steerco-companion'
      );
      let proc;

      if (process.platform === 'win32') {
        // Use launcher script to read prompt from temp file
        const launchScript = path.join(os.tmpdir(), `steerco-${Date.now()}.cmd`);
        fs.writeFileSync(launchScript, [
          '@echo off',
          `set /p SPROMPT=<"${companionFile}"`,
          `claude -p --output-format text --append-system-prompt "%SPROMPT%"`,
          `del "${companionFile}" 2>nul`,
          `del "${launchScript}" 2>nul`,
        ].join('\r\n'), 'utf-8');
        proc = spawn('cmd.exe', ['/c', launchScript], {
          cwd: state.harnessProjectPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        proc = spawn('claude', ['-p', '--output-format', 'text', '--append-system-prompt', companionPrompt.substring(0, 4000)], {
          cwd: state.harnessProjectPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }

      let output = '';
      proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => {
        console.log(`[SteerCo:err] ${data.toString().trim()}`);
      });

      // Send the review prompt via stdin
      proc.stdin?.write(safePrompt);
      proc.stdin?.end();

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0 && output.trim()) {
          console.log(`[Orchestrator] SteerCo review complete (${output.length} chars)`);
          resolve(output.trim());
        } else {
          console.log(`[Orchestrator] SteerCo review failed (exit code ${code})`);
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        console.log(`[Orchestrator] SteerCo spawn error: ${err.message}`);
        resolve(null);
      });
    } catch (err) {
      clearTimeout(timeout);
      console.log(`[Orchestrator] SteerCo invocation error: ${err}`);
      resolve(null);
    }
  });
}

// ---- Gate Audit Agent ----

/**
 * Spawn an independent audit agent at a gate.
 * The audit agent is a headless `claude -p` session that:
 * 1. Reads feature-list.json verification steps
 * 2. Reads the actual implementation code
 * 3. Traces each verification step against the code (does the path exist end-to-end?)
 * 4. Produces a structured audit report
 *
 * The report is included in the gate review HTML for James to review.
 * This catches "built but not wired" gaps — functions that exist but aren't called,
 * endpoints that exist but have no consumer, declarations without implementation.
 *
 * Timeout: 120s (audits take longer than SteerCo reviews because they read code).
 * Non-blocking for auto-gates. Blocking for manual gates (report goes in HTML).
 */
export async function invokeGateAudit(
  state: HarnessState,
  completedPhase: HarnessPhase
): Promise<string | null> {
  const AUDIT_TIMEOUT_MS = 120000;

  const auditArtefactBase = getArtefactBasePath(state);
  const featureListPath = path.join(auditArtefactBase, 'feature-list.json');
  let featureListContent = '';
  try {
    if (fs.existsSync(featureListPath)) {
      featureListContent = fs.readFileSync(featureListPath, 'utf-8');
    }
  } catch { /* skip */ }

  if (!featureListContent) {
    console.log('[Audit] No feature-list.json found — skipping audit');
    return null;
  }

  // Read checkpoint for phase-specific context (DR-01: use artefact base)
  const checkpointPath = path.join(auditArtefactBase, '.harness', PHASE_CHECKPOINT_FILES[completedPhase]);
  let checkpointContent = '';
  try {
    if (fs.existsSync(checkpointPath)) {
      checkpointContent = fs.readFileSync(checkpointPath, 'utf-8');
    }
  } catch { /* skip */ }

  // Read the harness state for milestone tracking
  const stateContent = JSON.stringify(state, null, 2);

  // Build the audit prompt
  const auditPrompt = [
    'You are an independent gate audit agent. Your job is to verify that the implementation COMPLETELY and CORRECTLY matches the design.',
    '',
    'IMPORTANT: You are NOT the developer. You are an independent auditor. Assume nothing works until you verify it in the code. Be sceptical and thorough.',
    '',
    `Project: ${state.harnessProject}`,
    `Phase completing: ${completedPhase}`,
    `Harness: ${state.harnessType} (${state.harnessMode})`,
    '',
    '## AUDIT SCOPE — Three Mandatory Checks',
    '',
    '### Check 1: NOTHING MISSED',
    'For EVERY feature in feature-list.json:',
    '- Read each verification_step',
    '- Find the code that implements it',
    '- Verify the code actually executes (trace the call chain from entry point to implementation)',
    '- If ANY step cannot be traced to working code, mark it FAIL',
    '',
    '### Check 2: EVERYTHING CONNECTED',
    'Trace every integration point end-to-end:',
    '- Functions defined → verify they are CALLED from somewhere (not just exported)',
    '- API endpoints → verify they have at least one consumer (UI, test, or other code)',
    '- Socket.IO events emitted → verify the dashboard or another consumer listens for them',
    '- Database/file writes → verify something reads the written data',
    '- Config values → verify they are referenced in application logic',
    '- Error handlers → verify they surface errors (not silently catch and ignore)',
    'Report any function, endpoint, event, or value that exists but is never consumed.',
    '',
    '### Check 3: PLAN vs DELIVERY TRACEABILITY',
    'Trace everything that was PLANNED against what was actually DELIVERED:',
    '- Read feature-list.json — for each feature, is `passes` set correctly? If true, verify it actually works. If false, why not — was it descoped, blocked, or just not done?',
    '- Read the checkpoint — does it declare artefacts? Do those artefacts exist on disk?',
    '- Read progress.txt — does the work log match what was actually built?',
    '- Read PROJECT_STATUS.md — are Next Steps and Current State accurate?',
    '- If dev phase: does code-audit.md exist with the mandatory checks (functions never called, dead code, secrets)?',
    '- If test phase: does test-report.md exist? Does verification-report.md exist with every feature ID?',
    '- If a handoff brief exists: are the required sections filled in (not just template placeholders)?',
    '- Are there any features in the plan that have NO corresponding code? Report these as UNDELIVERED.',
    '- Are there any code changes NOT traceable to a feature? Report these as UNPLANNED.',
    '',
    '## OUTPUT FORMAT',
    '',
    '### CHECK 1: Feature Verification',
    'For each feature:',
    '#### F{id}: {short description}',
    '- Step 1: {step text} — **PASS** / **FAIL**: {evidence with file:line}',
    '- Step 2: ...',
    '',
    '### CHECK 2: Integration Tracing',
    '- **Dead exports:** {list of exported functions never imported}',
    '- **Unhandled events:** {Socket.IO events emitted but not listened for}',
    '- **Unconsumed endpoints:** {API routes with no caller}',
    '- **Silent error handlers:** {catch blocks that swallow errors}',
    '',
    '### CHECK 3: Plan vs Delivery Traceability',
    '- Checkpoint valid: PASS/FAIL',
    '- Artefacts on disk: PASS/FAIL (list missing)',
    '- Feature passes accurate: PASS/FAIL (list stale/incorrect entries)',
    '- PROJECT_STATUS.md current: PASS/FAIL',
    '- Undelivered features: {list any planned but not built}',
    '- Unplanned changes: {list any code not traceable to a feature}',
    '- Phase artefacts complete: PASS/FAIL (code-audit.md, test-report.md, verification-report.md as applicable)',
    '',
    '### AUDIT VERDICT',
    '- **PASS**: All three checks clear. Gate can proceed.',
    '- **FAIL**: List every failure. Gate should NOT proceed until resolved.',
    '',
    '---',
    '',
    '## FEATURE LIST',
    featureListContent,
    '',
    '## CHECKPOINT DATA',
    checkpointContent || '(no checkpoint found)',
    '',
    '## HARNESS STATE',
    stateContent,
  ].join('\n');

  // Write audit prompt to temp file
  const promptFile = writePromptToTempFile(auditPrompt, `gate-audit-${completedPhase}`);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`[Audit] Gate audit timed out (${AUDIT_TIMEOUT_MS / 1000}s)`);
      try { fs.unlinkSync(promptFile); } catch { /* best effort */ }
      resolve(null);
    }, AUDIT_TIMEOUT_MS);

    try {
      let proc;

      if (process.platform === 'win32') {
        // Use launcher script to pass the prompt via stdin
        const launchScript = path.join(os.tmpdir(), `audit-${Date.now()}.cmd`);
        fs.writeFileSync(launchScript, [
          '@echo off',
          `claude -p --output-format text < "${promptFile}"`,
          `del "${promptFile}" 2>nul`,
          `del "${launchScript}" 2>nul`,
        ].join('\r\n'), 'utf-8');
        proc = spawn('cmd.exe', ['/c', launchScript], {
          cwd: state.harnessProjectPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        proc = spawn('claude', ['-p', '--output-format', 'text'], {
          cwd: state.harnessProjectPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Send prompt via stdin on non-Windows
        proc.stdin?.write(auditPrompt);
        proc.stdin?.end();
      }

      let output = '';
      proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
      proc.stderr?.on('data', (data: Buffer) => {
        console.log(`[Audit:err] ${data.toString().trim()}`);
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        try { fs.unlinkSync(promptFile); } catch { /* best effort */ }

        if (code === 0 && output.trim()) {
          console.log(`[Audit] Gate audit complete (${output.length} chars)`);

          // Save audit report to project (DR-01: use artefact base)
          const reportPath = path.join(auditArtefactBase, '.harness', `audit-${completedPhase}-${Date.now()}.md`);
          try {
            fs.writeFileSync(reportPath, output.trim(), 'utf-8');
          } catch { /* best effort */ }

          appendLedgerEvent({
            ledgerEventType: 'gate_pending',
            ledgerTimestamp: new Date().toISOString(),
            ledgerProjectPath: state.harnessProjectPath,
            ledgerProjectName: state.harnessProject,
            ledgerWorkFolder: state.harnessWorkFolder,
            ledgerHarness: state.harnessType,
            ledgerMode: state.harnessMode,
            ledgerPhase: completedPhase,
            ledgerSessionId: null,
            ledgerDetail: { auditType: 'gate-audit', reportLength: output.length },
          });

          if (orchestratorBroadcast) {
            orchestratorBroadcast('gate-audit-complete', {
              projectPath: state.harnessProjectPath,
              phase: completedPhase,
              reportLength: output.length,
              reportPath,
            });
          }

          resolve(output.trim());
        } else {
          console.log(`[Audit] Gate audit failed (exit code ${code})`);
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        console.log(`[Audit] Gate audit spawn error: ${err.message}`);
        try { fs.unlinkSync(promptFile); } catch { /* best effort */ }
        resolve(null);
      });
    } catch (err) {
      clearTimeout(timeout);
      console.log(`[Audit] Gate audit invocation error: ${err}`);
      try { fs.unlinkSync(promptFile); } catch { /* best effort */ }
      resolve(null);
    }
  });
}

// F005: Startup reconciliation — scan checkpoint files against event log
export function reconcileCheckpoints(projectPath: string): void {
  const state = loadHarnessState(projectPath);
  if (!state) return;

  const sequence = HARNESS_PHASE_SEQUENCES[state.harnessType] || [];
  const currentIndex = sequence.indexOf(state.harnessCurrentPhase);

  // Check if there are unprocessed checkpoints ahead of the current phase position
  for (let i = currentIndex; i < sequence.length; i++) {
    const phase = sequence[i];
    const checkpointFile = PHASE_CHECKPOINT_FILES[phase];
    const checkpointPath = path.join(projectPath, '.harness', checkpointFile);

    if (fs.existsSync(checkpointPath)) {
      const errors = validateCheckpoint(state, phase);
      if (errors.length === 0 && phase === state.harnessCurrentPhase) {
        console.log(`[Orchestrator] Reconciliation: found valid checkpoint for current phase ${phase}`);
        if (orchestratorBroadcast) {
          orchestratorBroadcast('checkpoint-detected', {
            projectPath,
            phase,
            valid: true,
            errors: [],
            reconciled: true,
          });
        }
      }
    }
  }
}
