// Harness Enforcement Engine — State Machine
// Manages per-project harness state and phase transitions

import * as fs from 'fs';
import * as path from 'path';
import {
  HarnessState,
  HarnessPhase,
  HarnessType,
  HarnessMode,
  HarnessOverride,
  HARNESS_PHASE_SEQUENCES,
} from './types';
import { appendLedgerEvent } from './ledger';

const HARNESS_DIR = '.harness';
const STATE_FILE = 'harness-state.json';

/**
 * Load harness state from a project directory.
 * Returns null if no harness is active for this project.
 */
export function loadHarnessState(projectPath: string): HarnessState | null {
  if (!projectPath) return null;

  const statePath = path.join(projectPath, HARNESS_DIR, STATE_FILE);
  try {
    if (!fs.existsSync(statePath)) return null;
    const raw = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as HarnessState;
  } catch (err) {
    console.log(`[Harness] Could not load state from ${statePath}: ${err}`);
    return null;
  }
}

/**
 * Save harness state to the project directory.
 */
export function saveHarnessState(state: HarnessState): void {
  const harnessDir = path.join(state.harnessProjectPath, HARNESS_DIR);
  try {
    if (!fs.existsSync(harnessDir)) {
      fs.mkdirSync(harnessDir, { recursive: true });
    }
    state.harnessUpdatedAt = new Date().toISOString();
    const statePath = path.join(harnessDir, STATE_FILE);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.log(`[Harness] Could not save state: ${err}`);
  }
}

/**
 * Create a new harness state for a project.
 */
export function createHarnessState(
  projectPath: string,
  projectName: string,
  harnessType: HarnessType,
  mode: HarnessMode
): HarnessState {
  const now = new Date().toISOString();
  const state: HarnessState = {
    harnessProject: projectName,
    harnessProjectPath: projectPath,
    harnessType: harnessType,
    harnessMode: mode,
    harnessCurrentPhase: 'init',
    harnessPhaseHistory: [
      {
        harnessPhase: 'init',
        harnessPhaseSessionId: null,
        harnessPhaseStartedAt: now,
        harnessPhaseCompletedAt: null,
      },
    ],
    harnessGatesCleared: {},
    harnessReworkCycles: 0,
    harnessOverrides: [],
    harnessPaused: false,
    harnessCreatedAt: now,
    harnessUpdatedAt: now,
  };

  saveHarnessState(state);

  appendLedgerEvent({
    ledgerEventType: 'harness_start',
    ledgerTimestamp: now,
    ledgerProjectPath: projectPath,
    ledgerProjectName: projectName,
    ledgerHarness: harnessType,
    ledgerMode: mode,
    ledgerPhase: 'init',
    ledgerSessionId: null,
    ledgerDetail: {},
  });

  return state;
}

/**
 * Get the next phase in the harness sequence.
 * Returns null if the current phase is the last one.
 */
export function getNextPhase(state: HarnessState): HarnessPhase | null {
  const sequence = HARNESS_PHASE_SEQUENCES[state.harnessType];
  if (!sequence) return null;

  const currentIndex = sequence.indexOf(state.harnessCurrentPhase);
  if (currentIndex === -1 || currentIndex >= sequence.length - 1) return null;

  return sequence[currentIndex + 1];
}

/**
 * Get the previous phase in the harness sequence.
 * Returns null if the current phase is the first one.
 */
export function getPreviousPhase(state: HarnessState): HarnessPhase | null {
  const sequence = HARNESS_PHASE_SEQUENCES[state.harnessType];
  if (!sequence) return null;

  const currentIndex = sequence.indexOf(state.harnessCurrentPhase);
  if (currentIndex <= 0) return null;

  return sequence[currentIndex - 1];
}

/**
 * Advance the harness to the next phase.
 * Returns the updated state, or null if advancement is not possible.
 */
export function advancePhase(
  state: HarnessState,
  sessionId: string | null
): HarnessState | null {
  const nextPhase = getNextPhase(state);
  if (!nextPhase) return null;

  const now = new Date().toISOString();

  // Mark current phase as complete
  const currentEntry = state.harnessPhaseHistory.find(
    (e) => e.harnessPhase === state.harnessCurrentPhase && !e.harnessPhaseCompletedAt
  );
  if (currentEntry) {
    currentEntry.harnessPhaseCompletedAt = now;
  }

  // Log phase completion
  appendLedgerEvent({
    ledgerEventType: 'phase_complete',
    ledgerTimestamp: now,
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: state.harnessCurrentPhase,
    ledgerSessionId: sessionId,
    ledgerDetail: { nextPhase },
  });

  // Start next phase
  state.harnessCurrentPhase = nextPhase;
  state.harnessPhaseHistory.push({
    harnessPhase: nextPhase,
    harnessPhaseSessionId: sessionId,
    harnessPhaseStartedAt: now,
    harnessPhaseCompletedAt: null,
  });

  appendLedgerEvent({
    ledgerEventType: 'phase_start',
    ledgerTimestamp: now,
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: nextPhase,
    ledgerSessionId: sessionId,
    ledgerDetail: { previousPhase: currentEntry?.harnessPhase },
  });

  saveHarnessState(state);
  return state;
}

/**
 * Send the harness back to the dev phase for rework (from test phase).
 */
export function initiateRework(
  state: HarnessState,
  sessionId: string | null
): HarnessState | null {
  if (state.harnessCurrentPhase !== 'test') return null;
  if (state.harnessReworkCycles >= 2) return null;

  const now = new Date().toISOString();
  state.harnessReworkCycles++;

  // Mark test phase entry as complete
  const testEntry = state.harnessPhaseHistory.find(
    (e) => e.harnessPhase === 'test' && !e.harnessPhaseCompletedAt
  );
  if (testEntry) {
    testEntry.harnessPhaseCompletedAt = now;
  }

  state.harnessCurrentPhase = 'dev';
  state.harnessPhaseHistory.push({
    harnessPhase: 'dev',
    harnessPhaseSessionId: sessionId,
    harnessPhaseStartedAt: now,
    harnessPhaseCompletedAt: null,
  });

  appendLedgerEvent({
    ledgerEventType: 'rework',
    ledgerTimestamp: now,
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: 'dev',
    ledgerSessionId: sessionId,
    ledgerDetail: { reworkCycle: state.harnessReworkCycles },
  });

  saveHarnessState(state);
  return state;
}

/**
 * Record an override in the harness state.
 */
export function recordOverride(
  state: HarnessState,
  override: HarnessOverride
): void {
  state.harnessOverrides.push(override);

  appendLedgerEvent({
    ledgerEventType: 'override',
    ledgerTimestamp: override.harnessOverrideTimestamp,
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: state.harnessCurrentPhase,
    ledgerSessionId: override.harnessOverrideSessionId,
    ledgerDetail: {
      overrideType: override.harnessOverrideType,
      rule: override.harnessOverrideRule,
      reason: override.harnessOverrideReason,
    },
  });

  saveHarnessState(state);
}

/**
 * Pause or unpause harness enforcement.
 */
export function setHarnessPaused(state: HarnessState, paused: boolean): void {
  state.harnessPaused = paused;
  saveHarnessState(state);
}

/**
 * Clear a governance gate.
 */
export function clearGate(
  state: HarnessState,
  gateName: string,
  sessionId: string | null
): void {
  state.harnessGatesCleared[gateName] = true;

  appendLedgerEvent({
    ledgerEventType: 'gate_cleared',
    ledgerTimestamp: new Date().toISOString(),
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: state.harnessCurrentPhase,
    ledgerSessionId: sessionId,
    ledgerDetail: { gateType: gateName, decision: 'approved' },
  });

  saveHarnessState(state);
}
