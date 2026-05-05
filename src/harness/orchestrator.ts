// Harness Enforcement Engine — Phase Orchestrator (Layer 4)
// Spawns separate Claude Code sessions per agent phase with prompt injection

import * as fs from 'fs';
import * as path from 'path';
import {
  HarnessState,
  HarnessPhase,
  HARNESS_PHASE_SEQUENCES,
  PHASE_AGENT_FILES,
  PHASE_CHECKPOINT_FILES,
} from './types';
import { loadHarnessState, advancePhase, getNextPhase } from './state';
import { validateCheckpoint } from './checkpoints';
import { getRequiredReads } from './rules';
import { appendLedgerEvent } from './ledger';

/**
 * Build the initial prompt for a phase session.
 * This is injected when spawning a new Claude Code session for the phase.
 */
export function buildPhasePrompt(state: HarnessState, phase: HarnessPhase): string {
  const agentFile = PHASE_AGENT_FILES[phase];
  const previousPhase = getPreviousPhaseInSequence(state, phase);
  const previousCheckpoint = previousPhase ? PHASE_CHECKPOINT_FILES[previousPhase] : null;
  const requiredReads = getRequiredReads(state.harnessType, phase, state.harnessMode);

  const lines: string[] = [
    `You are entering the **${phase}** phase of the **${state.harnessType}** harness.`,
    '',
    `PROJECT: ${state.harnessProject}`,
    `MODE: ${state.harnessMode}`,
    `HARNESS: ${state.harnessType}`,
    `PHASE: ${phase}`,
    '',
    '## MANDATORY FIRST ACTIONS',
    '',
    'You CANNOT write, edit, or run commands until these files have been read.',
    'The Command Centre enforces this — tool calls will be denied until prerequisites are met.',
    '',
  ];

  let step = 1;

  // Agent prompt is always first
  lines.push(`${step}. Read the agent prompt: \`${agentFile}\``);
  step++;

  // Feature list
  lines.push(`${step}. Read the feature list: \`feature-list.json\``);
  step++;

  // Progress file
  lines.push(`${step}. Read the progress file: \`progress.txt\``);
  step++;

  // Previous checkpoint
  if (previousCheckpoint) {
    lines.push(`${step}. Read the previous phase's checkpoint: \`.harness/${previousCheckpoint}\``);
    step++;
  }

  // Phase-specific reads
  if (phase === 'dev' && state.harnessType === 'build') {
    lines.push(`${step}. Read the design spec: \`design-spec.md\``);
    step++;
  }

  if (phase === 'test') {
    lines.push(`${step}. Read the testing standards: \`.claude-docs/testing-standards.md\``);
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
      break;
    case 'test':
      lines.push('- You CANNOT modify production code in `src/` (only test files)');
      lines.push('- You MUST write `test-report.md` before the checkpoint');
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
  lines.push(`When this phase is complete, you MUST write \`.harness/${PHASE_CHECKPOINT_FILES[phase]}\`.`);
  lines.push('See the agent prompt for the exact schema. The Command Centre validates it server-side.');
  lines.push('');
  lines.push('Begin.');

  return lines.join('\n');
}

/**
 * Build the system prompt append string for launching via CLI.
 * This is used with `claude --append-system-prompt "..."` or `happy --append-system-prompt "..."`.
 */
export function buildSystemPromptAppend(state: HarnessState, phase: HarnessPhase): string {
  return buildPhasePrompt(state, phase);
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
  const errors = validateCheckpoint(state.harnessProjectPath, state.harnessCurrentPhase);

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

  const updated = advancePhase(state, sessionId);
  if (!updated) {
    return { success: false, errors: ['Failed to advance phase'] };
  }

  const prompt = buildPhasePrompt(updated, readiness.nextPhase);

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
