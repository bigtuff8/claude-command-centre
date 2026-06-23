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
  | 'harness_complete';

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
