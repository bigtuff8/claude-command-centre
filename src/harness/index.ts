// Harness Enforcement Engine — Public API

export { loadHarnessState, saveHarnessState, createHarnessState, advancePhase, initiateRework, recordOverride, setHarnessPaused, clearGate, getNextPhase } from './state';
export { validateCheckpoint, readCheckpoint, isPreviousCheckpointValid } from './checkpoints';
export { checkPhaseRules, getRequiredReads } from './rules';
export { initLedger, appendLedgerEvent, readLedgerEvents, readProjectsSnapshot } from './ledger';
export { buildPhasePrompt, buildSystemPromptAppend, isPhaseTransitionReady, executePhaseTransition, getHarnessSummary } from './orchestrator';
export type { HarnessProjectSnapshot } from './ledger';
export type { HarnessState, HarnessPhase, HarnessType, HarnessMode, CheckpointData, LedgerEvent, RuleViolation } from './types';
export { HARNESS_PHASE_SEQUENCES, PHASE_AGENT_FILES, PHASE_CHECKPOINT_FILES } from './types';
