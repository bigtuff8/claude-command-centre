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
 * Also updates the computed projects snapshot.
 */
export function appendLedgerEvent(event: LedgerEvent): void {
  if (!ledgerPath) {
    console.log('[Harness] Ledger not initialised — event dropped');
    return;
  }

  try {
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(ledgerPath, line, 'utf-8');
  } catch (err) {
    console.log(`[Harness] Could not write to ledger: ${err}`);
  }

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
  snapshotLastActivity: string;
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
        snapshotLastActivity: event.ledgerTimestamp,
      };
      projects.set(key, snap);
    }

    snap.snapshotLastActivity = event.ledgerTimestamp;

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
