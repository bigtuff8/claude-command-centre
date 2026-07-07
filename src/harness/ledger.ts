// Harness Enforcement Engine — Centralised Event Ledger
// Append-only JSONL file for portfolio reporting

import * as fs from 'fs';
import * as path from 'path';
import { LedgerEvent } from './types';

let ledgerPath: string | null = null;
let projectsSnapshotPath: string | null = null;

/**
 * Initialise the ledger with a data directory path.
 * Called once at Command Centre startup.
 */
export function initLedger(dataDir: string): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  ledgerPath = path.join(dataDir, 'harness-ledger.jsonl');
  projectsSnapshotPath = path.join(dataDir, 'harness-projects.json');
  console.log(`[Harness] Ledger initialised at ${ledgerPath}`);
}

/**
 * Append an event to the ledger file.
 * Wave 3: Dual-write — events go to both the central ledger (Command Centre/data/)
 * AND the per-project event log (.harness/harness-events.jsonl in OneDrive).
 * The per-project log is the cross-machine source of truth; the central ledger
 * is kept as a local aggregation cache (30-day rollback archive).
 */
export function appendLedgerEvent(event: LedgerEvent): void {
  const line = JSON.stringify(event) + '\n';

  // 1. Central ledger (local to this machine)
  if (ledgerPath) {
    try {
      fs.appendFileSync(ledgerPath, line, 'utf-8');
    } catch (err) {
      console.log(`[Harness] Could not write to central ledger: ${err}`);
    }
  }

  // 2. Per-project event log (synced via OneDrive)
  if (event.ledgerProjectPath) {
    try {
      const projectEventsDir = path.join(event.ledgerProjectPath, '.harness');
      if (!fs.existsSync(projectEventsDir)) {
        fs.mkdirSync(projectEventsDir, { recursive: true });
      }
      const projectLogPath = path.join(projectEventsDir, 'harness-events.jsonl');
      fs.appendFileSync(projectLogPath, line, 'utf-8');
    } catch (err) {
      console.log(`[Harness] Could not write to project event log: ${err}`);
    }
  }

  // Update metrics counters
  trackMetric(event);

  // Rebuild snapshot after each write
  rebuildProjectsSnapshot();
}

/**
 * Read all ledger events.
 */
export function readLedgerEvents(): LedgerEvent[] {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return [];

  try {
    const raw = fs.readFileSync(ledgerPath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line) as LedgerEvent);
  } catch (err) {
    console.log(`[Harness] Could not read ledger: ${err}`);
    return [];
  }
}

/**
 * Computed snapshot of current harness state per project.
 * Rebuilt from the ledger on each write.
 * The portfolio module reads this instead of scanning project dirs.
 */
export interface HarnessProjectSnapshot {
  snapshotProjectPath: string;
  snapshotProjectName: string;
  snapshotHarness: string;
  snapshotMode: string;
  snapshotCurrentPhase: string;
  snapshotPhaseStartedAt: string | null;
  snapshotIsComplete: boolean;
  snapshotGatesPending: string[];
  snapshotGatesCleared: string[];
  snapshotReworkCycles: number;
  snapshotViolationCount: number;
  snapshotOverrideCount: number;
  snapshotIsPaused: boolean;
  snapshotLastActivity: string;
  // P1: the run's work folder (last seen on an event). Lets the dashboard target the correct
  // run for gate-status / gate-sections / feedback. Null for legacy root-level harnesses.
  snapshotWorkFolder: string | null;
  // P1 / R-HARN-5: persistent manual-override trace, read from live state. The badge uses the
  // most-recent entry; the count drives the per-run indicator + feeds the metric tile.
  snapshotManualOverrideCount: number;
  snapshotManualOverride: {
    op: string;
    reason: string;
    at: string;
    fromPhase: string | null;
    toPhase: string | null;
    gate: string | null;
  } | null;
}

function rebuildProjectsSnapshot(): void {
  if (!projectsSnapshotPath) return;

  const events = readLedgerEvents();
  const projects = new Map<string, HarnessProjectSnapshot>();

  for (const event of events) {
    const key = event.ledgerProjectPath;
    let snap = projects.get(key);

    if (!snap) {
      snap = {
        snapshotProjectPath: event.ledgerProjectPath,
        snapshotProjectName: event.ledgerProjectName,
        snapshotHarness: event.ledgerHarness,
        snapshotMode: event.ledgerMode,
        snapshotCurrentPhase: event.ledgerPhase,
        snapshotPhaseStartedAt: event.ledgerTimestamp,
        snapshotIsComplete: false,
        snapshotGatesPending: [],
        snapshotGatesCleared: [],
        snapshotReworkCycles: 0,
        snapshotViolationCount: 0,
        snapshotOverrideCount: 0,
        snapshotIsPaused: false,
        snapshotLastActivity: event.ledgerTimestamp,
        snapshotWorkFolder: event.ledgerWorkFolder ?? null,
        snapshotManualOverrideCount: 0,
        snapshotManualOverride: null,
      };
      projects.set(key, snap);
    }

    snap.snapshotLastActivity = event.ledgerTimestamp;
    // Track the most-recently-seen work folder for this project path (P1 targeting).
    if (event.ledgerWorkFolder !== undefined && event.ledgerWorkFolder !== null) {
      snap.snapshotWorkFolder = event.ledgerWorkFolder;
    }

    switch (event.ledgerEventType) {
      case 'phase_start':
        snap.snapshotCurrentPhase = event.ledgerPhase;
        snap.snapshotPhaseStartedAt = event.ledgerTimestamp;
        break;
      case 'phase_complete':
        break;
      case 'gate_pending':
        if (event.ledgerDetail.gateType) {
          snap.snapshotGatesPending.push(event.ledgerDetail.gateType);
        }
        break;
      case 'gate_cleared':
        if (event.ledgerDetail.gateType) {
          snap.snapshotGatesPending = snap.snapshotGatesPending.filter(
            (g) => g !== event.ledgerDetail.gateType
          );
          snap.snapshotGatesCleared.push(event.ledgerDetail.gateType);
        }
        break;
      case 'violation':
        snap.snapshotViolationCount++;
        break;
      case 'override':
        snap.snapshotOverrideCount++;
        break;
      case 'rework':
        snap.snapshotReworkCycles = event.ledgerDetail.reworkCycle || snap.snapshotReworkCycles + 1;
        break;
      case 'harness_complete':
        snap.snapshotIsComplete = true;
        break;
    }
  }

  // Enrich snapshot with live state from disk (pause + P1 manual-override trace).
  // Work-folder aware: state for a work-folder run lives at {project}/{workFolder}/.harness/,
  // not the project root — read there so pause + override markers surface for those runs too.
  for (const snap of projects.values()) {
    try {
      const base = snap.snapshotWorkFolder
        ? path.join(snap.snapshotProjectPath, snap.snapshotWorkFolder)
        : snap.snapshotProjectPath;
      let statePath = path.join(base, '.harness', 'harness-state.json');
      // Fall back to the project root if the work-folder state isn't present (legacy layout).
      if (!fs.existsSync(statePath)) {
        statePath = path.join(snap.snapshotProjectPath, '.harness', 'harness-state.json');
      }
      if (fs.existsSync(statePath)) {
        const liveState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        snap.snapshotIsPaused = liveState.harnessPaused === true;
        snap.snapshotCurrentPhase = liveState.harnessCurrentPhase || snap.snapshotCurrentPhase;

        // P1 / R-HARN-5: surface the persistent manual-override trace.
        const overrides = Array.isArray(liveState.harnessManuallyOverridden) ? liveState.harnessManuallyOverridden : [];
        snap.snapshotManualOverrideCount = overrides.length;
        if (overrides.length > 0) {
          const latest = overrides[overrides.length - 1];
          snap.snapshotManualOverride = {
            op: latest.manualOverrideOp,
            reason: latest.manualOverrideReason,
            at: latest.manualOverrideTimestamp,
            fromPhase: latest.manualOverrideFromPhase ?? null,
            toPhase: latest.manualOverrideToPhase ?? null,
            gate: latest.manualOverrideGate ?? null,
          };
        }
      }
    } catch { /* best effort */ }
  }

  try {
    const snapshot = Array.from(projects.values());
    fs.writeFileSync(projectsSnapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  } catch (err) {
    console.log(`[Harness] Could not write projects snapshot: ${err}`);
  }
}

/**
 * Read the current projects snapshot (for portfolio integration).
 */
export function readProjectsSnapshot(): HarnessProjectSnapshot[] {
  if (!projectsSnapshotPath || !fs.existsSync(projectsSnapshotPath)) return [];

  try {
    const raw = fs.readFileSync(projectsSnapshotPath, 'utf-8');
    return JSON.parse(raw) as HarnessProjectSnapshot[];
  } catch {
    return [];
  }
}

/**
 * Wave 3: Read events from a per-project event log.
 * Used for cross-machine portfolio aggregation — each project's
 * .harness/harness-events.jsonl is the source of truth, synced via OneDrive.
 */
export function readProjectEventLog(projectPath: string): LedgerEvent[] {
  const logPath = path.join(projectPath, '.harness', 'harness-events.jsonl');
  if (!fs.existsSync(logPath)) return [];

  try {
    const raw = fs.readFileSync(logPath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line) as LedgerEvent);
  } catch (err) {
    console.log(`[Harness] Could not read project event log at ${logPath}: ${err}`);
    return [];
  }
}

// ---- F013/F014: Metrics tracking ----

interface HarnessMetrics {
  metricsStartedAt: string;
  metricsTotalToolCalls: number;
  metricsViolations: number;
  metricsGatesCleared: number;
  metricsGatesPending: number;
  metricsSessionsLaunched: number;
  metricsCheckpointsValidated: number;
  metricsCheckpointsFailed: number;
  metricsOverrides: number;
  metricsReworkCycles: number;
  metricsPhaseCompletions: number;
  metricsHarnessesCompleted: number;
  // F014: per-gate turnaround tracking
  metricsGateTurnaroundMs: number[];
  // F013 (Integrity Fixes): KPI counters
  metricsCheckpointDeadlocks: number;
  metricsSpawnSuccess: number;
  metricsSpawnFailure: number;
  metricsGateValidationErrors: number;
  metricsEnforcementExemptions: number;
  // P1 / R-HARN-5: manual gate-bypasses via the Repair control (distinct from generic overrides).
  metricsRepairOverrides: number;
  // P4 / R-HARN-3: gate reviews that surfaced deferred (unverified) features.
  metricsDeferredGates: number;
}

const metrics: HarnessMetrics = {
  metricsStartedAt: new Date().toISOString(),
  metricsTotalToolCalls: 0,
  metricsViolations: 0,
  metricsGatesCleared: 0,
  metricsGatesPending: 0,
  metricsSessionsLaunched: 0,
  metricsCheckpointsValidated: 0,
  metricsCheckpointsFailed: 0,
  metricsOverrides: 0,
  metricsReworkCycles: 0,
  metricsPhaseCompletions: 0,
  metricsHarnessesCompleted: 0,
  metricsGateTurnaroundMs: [],
  metricsCheckpointDeadlocks: 0,
  metricsSpawnSuccess: 0,
  metricsSpawnFailure: 0,
  metricsGateValidationErrors: 0,
  metricsEnforcementExemptions: 0,
  metricsRepairOverrides: 0,
  metricsDeferredGates: 0,
};

function trackMetric(event: LedgerEvent): void {
  switch (event.ledgerEventType) {
    case 'violation':
      metrics.metricsViolations++;
      break;
    case 'gate_cleared':
      metrics.metricsGatesCleared++;
      break;
    case 'gate_pending':
      metrics.metricsGatesPending++;
      break;
    case 'override':
      metrics.metricsOverrides++;
      break;
    case 'rework':
      metrics.metricsReworkCycles++;
      break;
    case 'phase_complete':
      metrics.metricsPhaseCompletions++;
      break;
    case 'harness_complete':
      metrics.metricsHarnessesCompleted++;
      break;
    case 'phase_start':
      if (event.ledgerDetail?.spawned) {
        metrics.metricsSessionsLaunched++;
      }
      break;
    case 'repair_override':
      metrics.metricsRepairOverrides++;
      break;
    case 'gate_deferred_features':
      metrics.metricsDeferredGates++;
      break;
  }
}

/**
 * F013: Increment the tool call counter (called from hooks.ts on every PostToolUse).
 */
export function trackToolCall(): void {
  metrics.metricsTotalToolCalls++;
}

/**
 * F013: Track checkpoint validation result.
 */
export function trackCheckpointValidation(valid: boolean): void {
  if (valid) {
    metrics.metricsCheckpointsValidated++;
  } else {
    metrics.metricsCheckpointsFailed++;
  }
}

/** F013 (Integrity Fixes): Track checkpoint deadlock prevention. */
export function trackDeadlockPrevented(): void {
  metrics.metricsCheckpointDeadlocks++;
}

/** F013 (Integrity Fixes): Track session spawn result. */
export function trackSpawnResult(success: boolean): void {
  if (success) {
    metrics.metricsSpawnSuccess++;
  } else {
    metrics.metricsSpawnFailure++;
  }
}

/** F013 (Integrity Fixes): Track gate validation error caught. */
export function trackGateValidationError(): void {
  metrics.metricsGateValidationErrors++;
}

/** F013 (Integrity Fixes): Track enforcement exemption for out-of-project files (F007). */
export function trackEnforcementExemption(): void {
  metrics.metricsEnforcementExemptions++;
}

/**
 * F013: Get current enforcement metrics.
 */
export function getMetrics(): HarnessMetrics & { metricsUptimeSeconds: number; metricsAvgGateTurnaroundMs: number | null } {
  const uptimeMs = Date.now() - new Date(metrics.metricsStartedAt).getTime();
  const avgGate = metrics.metricsGateTurnaroundMs.length > 0
    ? metrics.metricsGateTurnaroundMs.reduce((a, b) => a + b, 0) / metrics.metricsGateTurnaroundMs.length
    : null;

  return {
    ...metrics,
    metricsUptimeSeconds: Math.round(uptimeMs / 1000),
    metricsAvgGateTurnaroundMs: avgGate,
  };
}

/**
 * F014: Compute success criteria from event data.
 * Returns metrics that map to the targets in the design doc.
 */
export function computeSuccessCriteria(): {
  phaseComplianceRate: number | null;
  gateApprovalTurnaroundMs: number | null;
  sessionHandoffSuccessRate: number | null;
  manualCheckpointEdits: number;
  violationsPerSession: number | null;
} {
  const events = readLedgerEvents();
  if (events.length === 0) return {
    phaseComplianceRate: null,
    gateApprovalTurnaroundMs: null,
    sessionHandoffSuccessRate: null,
    manualCheckpointEdits: 0,
    violationsPerSession: null,
  };

  // Phase compliance: phases that followed correct sequence without override
  const phaseStarts = events.filter(e => e.ledgerEventType === 'phase_start').length;
  const overrides = events.filter(e => e.ledgerEventType === 'override').length;
  const phaseComplianceRate = phaseStarts > 0 ? ((phaseStarts - overrides) / phaseStarts) * 100 : null;

  // Gate turnaround: time between gate_pending and gate_cleared for same project+gate
  const pendingTimes = new Map<string, number>();
  const turnarounds: number[] = [];
  for (const event of events) {
    const key = `${event.ledgerProjectPath}:${event.ledgerDetail?.gateType || ''}`;
    if (event.ledgerEventType === 'gate_pending') {
      pendingTimes.set(key, new Date(event.ledgerTimestamp).getTime());
    } else if (event.ledgerEventType === 'gate_cleared') {
      const pending = pendingTimes.get(key);
      if (pending) {
        turnarounds.push(new Date(event.ledgerTimestamp).getTime() - pending);
        pendingTimes.delete(key);
      }
    }
  }
  const avgTurnaround = turnarounds.length > 0
    ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length
    : null;

  // Session handoff: phase_start events with spawned=true that aren't followed by immediate errors
  const spawned = events.filter(e => e.ledgerEventType === 'phase_start' && e.ledgerDetail?.spawned);
  const spawnedCount = spawned.length;
  // For now, assume all spawned sessions succeeded (failure tracking would need phase_session_failed events)
  const handoffRate = spawnedCount > 0 ? 100 : null;

  // Violations per unique session
  const sessions = new Set(events.filter(e => e.ledgerSessionId).map(e => e.ledgerSessionId));
  const violations = events.filter(e => e.ledgerEventType === 'violation').length;
  const violationsPerSession = sessions.size > 0 ? violations / sessions.size : null;

  return {
    phaseComplianceRate: phaseComplianceRate !== null ? Math.round(phaseComplianceRate * 10) / 10 : null,
    gateApprovalTurnaroundMs: avgTurnaround !== null ? Math.round(avgTurnaround) : null,
    sessionHandoffSuccessRate: handoffRate,
    manualCheckpointEdits: 0, // Would need filesystem watcher to detect
    violationsPerSession: violationsPerSession !== null ? Math.round(violationsPerSession * 100) / 100 : null,
  };
}
