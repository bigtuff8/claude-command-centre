// Harness Enforcement Engine — Type definitions
// All types prefixed to avoid collision with existing Command Centre types

export type HarnessType = 'build' | 'integration' | 'research' | 'automation' | 'admin';
export type HarnessMode = 'airedale' | 'unconstrained';

export type HarnessPhase =
  | 'init'
  | 'design'
  | 'research'
  | 'dev'
  | 'test'
  | 'write'
  | 'release';

export interface HarnessPhaseEntry {
  harnessPhase: HarnessPhase;
  harnessPhaseSessionId: string | null;
  harnessPhaseStartedAt: string;
  harnessPhaseCompletedAt: string | null;
}

export interface HarnessOverride {
  harnessOverrideType: 'skipRule' | 'skipPhase' | 'pauseHarness' | 'abortHarness';
  harnessOverrideRule?: string;
  harnessOverridePhase?: HarnessPhase;
  harnessOverrideTimestamp: string;
  harnessOverrideSessionId: string;
  harnessOverrideReason: string;
}

// P1 / R-HARN-5: a manual gate-bypass ("Repair") override. Distinct from HarnessOverride
// (skipRule/pause/etc.): this records an intentional bypass of the human-review gate, so it
// leaves a DURABLE, visible trace on the run — not just an ephemeral ledger line. Each op that
// bypasses normal approval (force-advance, gate clear/un-clear, deadlock recovery) appends one
// of these to state.harnessManuallyOverridden and emits a `repair_override` ledger event.
export type HarnessManualOverrideOp =
  | 'force-advance'
  | 'deadlock-recovery'
  | 'gate-clear'
  | 'gate-unclear';

export interface HarnessManualOverride {
  manualOverrideOp: HarnessManualOverrideOp;
  manualOverrideReason: string;
  manualOverrideTimestamp: string;
  manualOverrideFromPhase: HarnessPhase | null;
  manualOverrideToPhase: HarnessPhase | null;
  manualOverrideGate?: string | null;
  manualOverrideOperator: string;              // who ran it (session id or 'dashboard')
  manualOverrideCheckpointValid: boolean;      // was the checkpoint valid at bypass time?
}

export interface HarnessState {
  harnessStateVersion: number;        // Schema version (1=legacy, 2=work-folder)
  harnessProject: string;
  harnessProjectPath: string;
  harnessWorkFolder: string | null;   // Relative path to work folder (null=legacy)
  harnessBrief: string;               // Original brief, used for auto-rename
  harnessType: HarnessType;
  harnessMode: HarnessMode;
  harnessCurrentPhase: HarnessPhase;
  harnessPhaseHistory: HarnessPhaseEntry[];
  harnessGatesCleared: Record<string, boolean>;
  harnessReworkCycles: number;
  harnessOverrides: HarnessOverride[];
  // P1 / R-HARN-5: persistent trace of manual gate-bypasses (Repair control). Null/absent when
  // the run has never been manually overridden. The dashboard renders a badge from the most
  // recent entry and a per-run counter from the length; the metric tile aggregates across runs.
  harnessManuallyOverridden?: HarnessManualOverride[] | null;
  harnessPaused: boolean;
  harnessPendingSpawn?: {           // RISK-05: Set when advancePhase succeeds but spawnPhaseSession hasn't completed yet
    harnessPendingPhase: HarnessPhase;
    harnessPendingSetAt: string;
    harnessPendingAttempts: number;
  } | null;
  harnessCreatedAt: string;
  harnessUpdatedAt: string;
}

export interface CheckpointArtefact {
  checkpointArtefactPath: string;
  checkpointArtefactExists: boolean;
  checkpointArtefactHash: string | null;
}

export interface CheckpointData {
  checkpointPhase: HarnessPhase;
  checkpointCompletedAt: string;
  checkpointHarness: HarnessType;
  checkpointMode: HarnessMode;
  checkpointAgentFile: string;
  checkpointAgentFileReadConfirmed: boolean;
  checkpointRequiredArtefacts: Record<string, CheckpointArtefact>;
  checkpointNextAgent: string | null;
  checkpointUserConfirmed: boolean;
  checkpointDetail: Record<string, any>;
}

// Phase-specific rule types

export type RuleType =
  | 'mustReadBefore'
  | 'requireCheckpoint'
  | 'blockWrite'
  | 'blockBash'
  | 'requireArtefact';

export interface RuleMustReadBefore {
  ruleType: 'mustReadBefore';
  ruleFile: string;
  ruleBeforeTools: string[];
  ruleCondition?: 'airedale' | 'unconstrained';
}

export interface RuleRequireCheckpoint {
  ruleType: 'requireCheckpoint';
  ruleCheckpoint: string;
  ruleCondition?: 'allPass';
}

export interface RuleBlockWrite {
  ruleType: 'blockWrite';
  rulePattern: string;
  ruleExcept?: string;
  ruleReason: string;
}

export interface RuleBlockBash {
  ruleType: 'blockBash';
  rulePattern: string;
  ruleReason: string;
}

export interface RuleRequireArtefact {
  ruleType: 'requireArtefact';
  ruleFile: string;
  ruleReason: string;
}

export type HarnessRule =
  | RuleMustReadBefore
  | RuleRequireCheckpoint
  | RuleBlockWrite
  | RuleBlockBash
  | RuleRequireArtefact;

export interface RuleViolation {
  violationRule: string;
  violationReason: string;
  violationFix: string;
}

// Ledger event types (centralised reporting)

export type LedgerEventType =
  | 'harness_start'
  | 'phase_start'
  | 'phase_complete'
  | 'gate_pending'
  | 'gate_cleared'
  | 'violation'
  | 'override'
  | 'rework'
  | 'harness_complete'
  // P1 / CR-02: a manual gate-bypass via the Repair control. MUST be distinct from
  // `gate_cleared{approved}` (a real human approval) so bypasses are separately countable
  // and can never be mistaken for a genuine review.
  | 'repair_override'
  // P4 / R-HARN-3: emitted when a gate review surfaces features released as `deferred`
  // (unverified). Captures which features + their notes so the deferral leaves an audit trail.
  | 'gate_deferred_features';

export interface LedgerEvent {
  ledgerEventType: LedgerEventType;
  ledgerTimestamp: string;
  ledgerProjectPath: string;
  ledgerProjectName: string;
  ledgerWorkFolder?: string | null;   // Relative path to work folder for filtering
  ledgerHarness: HarnessType;
  ledgerMode: HarnessMode;
  ledgerPhase: HarnessPhase;
  ledgerSessionId: string | null;
  ledgerDetail: Record<string, any>;
}

// Harness-specific phase sequences

export const HARNESS_PHASE_SEQUENCES: Record<HarnessType, HarnessPhase[]> = {
  build: ['init', 'design', 'dev', 'test', 'release'],
  integration: ['init', 'research', 'dev', 'test', 'release'],
  research: ['init', 'research', 'write'],
  automation: ['init', 'research', 'dev', 'test', 'release'],
  admin: ['init', 'research', 'write'],
};

// Agent file mapping per phase

export const PHASE_AGENT_FILES: Record<HarnessPhase, string> = {
  init: 'agents/initialisation.md',
  design: 'agents/designer.md',
  research: 'agents/researcher.md',
  dev: 'agents/developer.md',
  test: 'agents/tester.md',
  write: 'agents/writer.md',
  release: 'agents/release-manager.md',
};

// Checkpoint file names per phase

export const PHASE_CHECKPOINT_FILES: Record<HarnessPhase, string> = {
  init: 'checkpoint-init.json',
  design: 'checkpoint-design.json',
  research: 'checkpoint-research.json',
  dev: 'checkpoint-dev.json',
  test: 'checkpoint-test.json',
  write: 'checkpoint-write.json',
  release: 'checkpoint-release.json',
};
