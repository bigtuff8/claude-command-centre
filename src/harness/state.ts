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
  HarnessManualOverride,
  HarnessManualOverrideOp,
  HARNESS_PHASE_SEQUENCES,
} from './types';
import { appendLedgerEvent, trackDeadlockPrevented } from './ledger';
import { validateCheckpoint } from './checkpoints';

const HARNESS_DIR = '.harness';
const STATE_FILE = 'harness-state.json';
const CURRENT_STATE_VERSION = 2;

/**
 * Migrate legacy (v1) harness state to current schema.
 * Transparently upgrades state loaded from disk.
 */
function migrateState(state: any): HarnessState {
  const version = state.harnessStateVersion || 1;
  if (version < 2) {
    state.harnessStateVersion = CURRENT_STATE_VERSION;
    state.harnessWorkFolder = state.harnessWorkFolder ?? null;
    state.harnessBrief = state.harnessBrief ?? '';
  }
  // RISK-05: Ensure pendingSpawn field exists (added in v0.4.0)
  if (state.harnessPendingSpawn === undefined) {
    state.harnessPendingSpawn = null;
  }
  return state as HarnessState;
}

/**
 * Get the artefact base path for a harness state.
 * With work folders, artefacts live in {projectPath}/{workFolder}/.
 * Without (legacy), they live in {projectPath}/.
 */
export function getArtefactBasePath(state: HarnessState): string {
  if (state.harnessWorkFolder) {
    return path.join(state.harnessProjectPath, state.harnessWorkFolder);
  }
  return state.harnessProjectPath;
}

/**
 * Get the .harness directory path for a harness state.
 */
export function getHarnessDir(state: HarnessState): string {
  return path.join(getArtefactBasePath(state), HARNESS_DIR);
}

/**
 * F001: Resolve a project path that may have been stored with a different
 * user profile name (e.g. JamesBrown vs james). Checks if the stored path
 * exists; if not, swaps the Users\{name} segment with the current USERPROFILE.
 * Returns the path that actually exists on disk, or the original if neither works.
 */
export function resolveProjectPath(storedPath: string): string {
  if (!storedPath) return storedPath;

  // If it exists as-is, use it
  if (fs.existsSync(storedPath)) return storedPath;

  // Try replacing the user profile segment with the current one
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return storedPath;

  // Match C:\Users\{anyName}\ at the start of the path
  const userMatch = storedPath.match(/^([A-Za-z]:\\Users\\)([^\\]+)(\\.*)/);
  if (userMatch) {
    const currentUser = path.basename(home);
    if (userMatch[2] !== currentUser) {
      const candidate = userMatch[1] + currentUser + userMatch[3];
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return storedPath;
}

/**
 * Load harness state from a project directory.
 * Returns null if no harness is active for this project.
 * F001: Resolves cross-machine path mismatches on load.
 *
 * @param projectPath - The project root directory
 * @param workFolder - Optional relative path to work folder. If provided,
 *   loads state from {projectPath}/{workFolder}/.harness/. If omitted,
 *   falls back to legacy {projectPath}/.harness/ location.
 */
export function loadHarnessState(projectPath: string, workFolder?: string | null): HarnessState | null {
  if (!projectPath) return null;

  // Determine where to look for state
  const basePath = workFolder
    ? path.join(projectPath, workFolder)
    : projectPath;
  const statePath = path.join(basePath, HARNESS_DIR, STATE_FILE);

  try {
    if (!fs.existsSync(statePath)) {
      // If workFolder was specified but state doesn't exist there,
      // do NOT fall back to project root (caller was explicit)
      if (workFolder) return null;

      // Legacy fallback: no workFolder specified, check project root
      return null;
    }
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = migrateState(JSON.parse(raw));

    // F001: Resolve the stored project path to match the current machine.
    const resolvedPath = resolveProjectPath(state.harnessProjectPath);
    if (resolvedPath !== state.harnessProjectPath) {
      console.log(`[Harness] F001 path fix: ${state.harnessProjectPath} → ${resolvedPath}`);
      state.harnessProjectPath = resolvedPath;
    }

    return state;
  } catch (err) {
    console.log(`[Harness] Could not load state from ${statePath}: ${err}`);
    return null;
  }
}

/**
 * Save harness state to the correct directory.
 * Routes through work folder when present (DR-07 fix).
 * F001: Resolves project path before writing.
 */
export function saveHarnessState(state: HarnessState): void {
  // F001: Always resolve the path before writing
  state.harnessProjectPath = resolveProjectPath(state.harnessProjectPath);
  const harnessDir = getHarnessDir(state);
  try {
    if (!fs.existsSync(harnessDir)) {
      fs.mkdirSync(harnessDir, { recursive: true });
    }
    state.harnessUpdatedAt = new Date().toISOString();
    const statePath = path.join(harnessDir, STATE_FILE);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.log(`[Harness] Could not save state to ${harnessDir}: ${err}`);
  }
}

/**
 * Create a new harness state for a project.
 * @param workFolder - Relative path to work folder (e.g., '2026-06-04T14-32-05')
 * @param brief - The original work brief (used for auto-rename at completion)
 */
export function createHarnessState(
  projectPath: string,
  projectName: string,
  harnessType: HarnessType,
  mode: HarnessMode,
  workFolder?: string | null,
  brief?: string
): HarnessState {
  const now = new Date().toISOString();
  const state: HarnessState = {
    harnessStateVersion: CURRENT_STATE_VERSION,
    harnessProject: projectName,
    harnessProjectPath: projectPath,
    harnessWorkFolder: workFolder || null,
    harnessBrief: brief || '',
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
    ledgerWorkFolder: workFolder || null,
    ledgerHarness: harnessType,
    ledgerMode: mode,
    ledgerPhase: 'init',
    ledgerSessionId: null,
    ledgerDetail: { workFolder: workFolder || null },
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
 * F001: Validates current phase checkpoint before allowing advancement.
 * Returns discriminated union: { state } on success, { error } on failure.
 */
export function advancePhase(
  state: HarnessState,
  sessionId: string | null
): { state: HarnessState; error?: undefined } | { state?: undefined; error: string } {
  const nextPhase = getNextPhase(state);
  if (!nextPhase) return { error: 'Cannot advance — already at final phase' };

  // F001: Validate current phase checkpoint before allowing advancement.
  // This prevents the deadlock scenario where phase advances but checkpoint is missing.
  const currentPhase = state.harnessCurrentPhase;
  const checkpointErrors = validateCheckpoint(state, currentPhase);
  if (checkpointErrors.length > 0) {
    trackDeadlockPrevented();
    return {
      error: `Cannot advance from "${currentPhase}" to "${nextPhase}": checkpoint-${currentPhase}.json is invalid. `
        + `Fix: ${checkpointErrors[0]}. `
        + `Write a valid checkpoint-${currentPhase}.json before advancing.`,
    };
  }

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
    ledgerWorkFolder: state.harnessWorkFolder,
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
    ledgerWorkFolder: state.harnessWorkFolder,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: nextPhase,
    ledgerSessionId: sessionId,
    ledgerDetail: { previousPhase: currentEntry?.harnessPhase },
  });

  saveHarnessState(state);
  return { state };
}

/**
 * RW-06: General backward phase movement for rework cycles.
 * No checkpoint validation on regression — going backward should never block.
 * Forward movement validates; backward movement does not.
 */
export function regressPhase(
  state: HarnessState,
  targetPhase: string,
  sessionId: string | null,
  reason: string
): { state: HarnessState; error?: undefined } | { state?: undefined; error: string } {
  const sequence = HARNESS_PHASE_SEQUENCES[state.harnessType];
  if (!sequence) return { error: `Unknown harness type: "${state.harnessType}"` };

  const currentIndex = sequence.indexOf(state.harnessCurrentPhase);
  const targetIndex = sequence.indexOf(targetPhase as HarnessPhase);

  if (targetIndex < 0) {
    return { error: `Unknown phase: "${targetPhase}"` };
  }

  if (targetIndex >= currentIndex) {
    return { error: `Cannot regress forward. Current: "${state.harnessCurrentPhase}", target: "${targetPhase}". Use advancePhase() instead.` };
  }

  const now = new Date().toISOString();

  // Mark current phase as incomplete (rework)
  const currentEntry = state.harnessPhaseHistory.find(
    (e) => e.harnessPhase === state.harnessCurrentPhase && !e.harnessPhaseCompletedAt
  );
  if (currentEntry) {
    currentEntry.harnessPhaseCompletedAt = now;
  }

  appendLedgerEvent({
    ledgerEventType: 'phase_regress' as any,
    ledgerTimestamp: now,
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerWorkFolder: state.harnessWorkFolder,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: state.harnessCurrentPhase,
    ledgerSessionId: sessionId,
    ledgerDetail: { targetPhase, reason },
  });

  state.harnessCurrentPhase = targetPhase as HarnessPhase;
  state.harnessPhaseHistory.push({
    harnessPhase: targetPhase as HarnessPhase,
    harnessPhaseSessionId: sessionId,
    harnessPhaseStartedAt: now,
    harnessPhaseCompletedAt: null,
  });

  appendLedgerEvent({
    ledgerEventType: 'phase_start',
    ledgerTimestamp: now,
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerWorkFolder: state.harnessWorkFolder,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: targetPhase as HarnessPhase,
    ledgerSessionId: sessionId,
    ledgerDetail: { rework: true, regressionFrom: currentEntry?.harnessPhase, reason },
  });

  saveHarnessState(state);
  return { state };
}

/**
 * Send the harness back to the dev phase for rework (from test phase).
 * Legacy convenience wrapper around regressPhase().
 */
export function initiateRework(
  state: HarnessState,
  sessionId: string | null
): HarnessState | null {
  if (state.harnessCurrentPhase !== 'test') return null;
  if (state.harnessReworkCycles >= 2) return null;

  state.harnessReworkCycles++;

  const result = regressPhase(state, 'dev', sessionId, `Tester rework cycle ${state.harnessReworkCycles}`);
  if (result.error) return null;

  return result.state!;
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
    ledgerWorkFolder: state.harnessWorkFolder,
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
 * RISK-05: Set a pendingSpawn flag before attempting to spawn a session.
 * If the spawn fails after advancePhase() has committed, this flag remains set
 * so reconciliation can detect the orphaned phase and retry or alert.
 */
export function setPendingSpawn(state: HarnessState, phase: HarnessPhase): void {
  state.harnessPendingSpawn = {
    harnessPendingPhase: phase,
    harnessPendingSetAt: new Date().toISOString(),
    harnessPendingAttempts: (state.harnessPendingSpawn?.harnessPendingAttempts || 0) + 1,
  };
  saveHarnessState(state);
}

/**
 * RISK-05: Clear the pendingSpawn flag after a successful session spawn.
 * CT-3: Reloads state from disk before clearing to avoid overwriting
 * changes made by the spawned agent between spawn and this callback.
 */
export function clearPendingSpawn(state: HarnessState): void {
  // Reload fresh state from disk to avoid saving stale in-memory version
  const fresh = loadHarnessState(state.harnessProjectPath, state.harnessWorkFolder);
  if (fresh && fresh.harnessPendingSpawn) {
    fresh.harnessPendingSpawn = null;
    saveHarnessState(fresh);
  }
  // Also update the in-memory reference for caller consistency
  state.harnessPendingSpawn = null;
}

/**
 * RISK-05: Check if a harness state has a stale pendingSpawn.
 * Returns the pending phase if spawn was set but never cleared (spawn failure),
 * or null if no pending spawn or it was recently set (within 30s grace period).
 */
export function checkPendingSpawn(state: HarnessState): HarnessPhase | null {
  if (!state.harnessPendingSpawn) return null;

  const setAt = new Date(state.harnessPendingSpawn.harnessPendingSetAt).getTime();
  const gracePeriodMs = 30_000; // 30s — allow time for spawn + retry
  if (Date.now() - setAt < gracePeriodMs) return null;

  return state.harnessPendingSpawn.harnessPendingPhase;
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
    ledgerWorkFolder: state.harnessWorkFolder,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: state.harnessCurrentPhase,
    ledgerSessionId: sessionId,
    ledgerDetail: { gateType: gateName, decision: 'approved' },
  });

  saveHarnessState(state);
}

// ---- P1 / R-HARN-5: Manual gate-bypass ("Repair") overrides ----

/**
 * P1 / CR-02 / R-HARN-5: Record a manual gate-bypass on the run.
 * Stamps a DURABLE marker into state.harnessManuallyOverridden AND emits a distinct
 * `repair_override` ledger event (NEVER `gate_cleared{approved}` — a bypass must never look
 * like a genuine human approval). Does NOT save state — the caller saves once, so this
 * composes with the mutation it accompanies (force-advance, gate clear/un-clear).
 */
export function recordManualOverride(
  state: HarnessState,
  params: {
    op: HarnessManualOverrideOp;
    reason: string;
    operator: string;
    fromPhase: HarnessPhase | null;
    toPhase: HarnessPhase | null;
    gate?: string | null;
    checkpointValid: boolean;
  }
): HarnessManualOverride {
  const now = new Date().toISOString();
  const entry: HarnessManualOverride = {
    manualOverrideOp: params.op,
    manualOverrideReason: params.reason,
    manualOverrideTimestamp: now,
    manualOverrideFromPhase: params.fromPhase,
    manualOverrideToPhase: params.toPhase,
    manualOverrideGate: params.gate ?? null,
    manualOverrideOperator: params.operator,
    manualOverrideCheckpointValid: params.checkpointValid,
  };

  if (!Array.isArray(state.harnessManuallyOverridden)) {
    state.harnessManuallyOverridden = [];
  }
  state.harnessManuallyOverridden.push(entry);

  appendLedgerEvent({
    ledgerEventType: 'repair_override',
    ledgerTimestamp: now,
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerWorkFolder: state.harnessWorkFolder,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: state.harnessCurrentPhase,
    ledgerSessionId: params.operator,
    ledgerDetail: {
      op: params.op,
      reason: params.reason,
      operator: params.operator,
      fromPhase: params.fromPhase,
      toPhase: params.toPhase,
      gate: params.gate ?? null,
      checkpointValidAtOverride: params.checkpointValid,
    },
  });

  return entry;
}

/**
 * P1 / CR-01: Guarded force-advance / deadlock recovery.
 * Deliberately SKIPS checkpoint validation (that is the entire point — advancePhase() refuses
 * an invalid checkpoint, so it cannot recover a deadlocked run). Records a manual-override
 * marker + `repair_override` ledger event. Moves FORWARD only (use regressPhase for backward).
 * Does NOT write phase-prompt.md — the caller (route) does that via orchestrator.writePhasePrompt
 * to avoid a state->orchestrator circular import.
 *
 * @param toPhase Optional explicit target; defaults to the immediate next phase.
 */
export function forceAdvancePhase(
  state: HarnessState,
  sessionId: string | null,
  reason: string,
  toPhase?: HarnessPhase,
  op: HarnessManualOverrideOp = 'force-advance'
): { state: HarnessState; fromPhase: HarnessPhase; toPhase: HarnessPhase; checkpointValid: boolean; error?: undefined }
  | { state?: undefined; error: string } {
  const sequence = HARNESS_PHASE_SEQUENCES[state.harnessType];
  if (!sequence) return { error: `Unknown harness type: "${state.harnessType}"` };

  const fromPhase = state.harnessCurrentPhase;
  const target = toPhase || getNextPhase(state);
  if (!target) return { error: 'Cannot force-advance — already at the final phase' };

  const currentIndex = sequence.indexOf(fromPhase);
  const targetIndex = sequence.indexOf(target);
  if (targetIndex < 0) return { error: `Unknown target phase: "${target}" for harness type "${state.harnessType}"` };
  if (targetIndex <= currentIndex) {
    return { error: `Force-advance must move forward (current "${fromPhase}", target "${target}"). Use regress for backward moves.` };
  }

  // Record whether the checkpoint WOULD have been valid — for the audit trail — but do NOT block.
  const checkpointValid = validateCheckpoint(state, fromPhase).length === 0;

  const now = new Date().toISOString();
  const currentEntry = state.harnessPhaseHistory.find(
    (e) => e.harnessPhase === fromPhase && !e.harnessPhaseCompletedAt
  );
  if (currentEntry) currentEntry.harnessPhaseCompletedAt = now;

  state.harnessCurrentPhase = target;
  state.harnessPhaseHistory.push({
    harnessPhase: target,
    harnessPhaseSessionId: sessionId,
    harnessPhaseStartedAt: now,
    harnessPhaseCompletedAt: null,
  });

  recordManualOverride(state, {
    op,
    reason,
    operator: sessionId || 'dashboard',
    fromPhase,
    toPhase: target,
    checkpointValid,
  });

  saveHarnessState(state);
  return { state, fromPhase, toPhase: target, checkpointValid };
}

/**
 * P1 / IM-04: Un-clear a governance gate (there was no un-clear path before).
 * Records a manual-override marker + `repair_override` ledger event. Caller constrains
 * `gateName` to the run's actual gate(s).
 */
export function unclearGate(
  state: HarnessState,
  gateName: string,
  sessionId: string | null,
  reason: string
): void {
  state.harnessGatesCleared[gateName] = false;

  recordManualOverride(state, {
    op: 'gate-unclear',
    reason,
    operator: sessionId || 'dashboard',
    fromPhase: state.harnessCurrentPhase,
    toPhase: state.harnessCurrentPhase,
    gate: gateName,
    checkpointValid: validateCheckpoint(state, state.harnessCurrentPhase).length === 0,
  });

  saveHarnessState(state);
}

/**
 * P1 / CR-02: Force-clear a gate via the Repair control (bypass, not an approval).
 * Unlike clearGate() — which emits `gate_cleared{approved}` for genuine reviews — this marks
 * the gate cleared AND stamps a manual-override trace so it can never be mistaken for a real
 * James approval. Caller constrains `gateName` to the run's actual pending gate(s).
 */
export function forceClearGate(
  state: HarnessState,
  gateName: string,
  sessionId: string | null,
  reason: string
): void {
  state.harnessGatesCleared[gateName] = true;

  recordManualOverride(state, {
    op: 'gate-clear',
    reason,
    operator: sessionId || 'dashboard',
    fromPhase: state.harnessCurrentPhase,
    toPhase: state.harnessCurrentPhase,
    gate: gateName,
    checkpointValid: validateCheckpoint(state, state.harnessCurrentPhase).length === 0,
  });

  saveHarnessState(state);
}
