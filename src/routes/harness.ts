// Harness Enforcement Engine — REST API Routes
// Dashboard endpoints for harness status, phase control, and overrides

import * as path from 'path';
import { Router, Request, Response } from 'express';
import {
  loadHarnessState,
  saveHarnessState,
  createHarnessState,
  advancePhase,
  regressPhase,
  initiateRework,
  recordOverride,
  setHarnessPaused,
  clearGate,
} from '../harness/state';
import { validateCheckpoint } from '../harness/checkpoints';
import { getRequiredReads } from '../harness/rules';
import { appendLedgerEvent, readLedgerEvents, readProjectsSnapshot, readProjectEventLog, getMetrics, computeSuccessCriteria, trackGateValidationError, trackSpawnResult } from '../harness/ledger';
import { escapeCmdArg } from '../services/session-spawn';
import { HarnessType, HarnessMode, HarnessPhase, HarnessState, HARNESS_PHASE_SEQUENCES } from '../harness/types';
import { isPhaseTransitionReady, executePhaseTransition, buildPhasePrompt, getHarnessSummary, spawnPhaseSession } from '../harness/orchestrator';
import { registerWorkFolder } from '../state/sessions';

/**
 * Extract workFolder from request query params or body.
 * Dashboard API calls should include ?workFolder=xxx for work-folder-scoped harnesses.
 */
function extractWorkFolder(req: Request): string | null {
  return (req.query.workFolder as string) || req.body?.workFolder || null;
}

let broadcastFn: (event: string, data: any) => void;

export function createHarnessRouter(broadcast: (event: string, data: any) => void): Router {
  broadcastFn = broadcast;
  const router = Router();

  router.get('/status/:projectPath(*)', handleGetStatus);
  router.post('/create', handleCreate);
  router.post('/advance', handleAdvance);
  router.post('/rework', handleRework);
  router.post('/regress', handleRegress);
  router.post('/override', handleOverride);
  router.post('/pause', handlePause);
  router.post('/gate/clear', handleClearGate);
  router.get('/ledger', handleGetLedger);
  router.get('/projects', handleGetProjects);
  router.get('/validate/:projectPath(*)', handleValidate);
  router.get('/summary/:projectPath(*)', handleGetSummary);
  router.get('/transition-ready/:projectPath(*)', handleTransitionReady);
  router.post('/transition', handleTransition);
  router.get('/phase-prompt/:projectPath(*)', handleGetPhasePrompt);
  router.post('/gate/feedback', handleGateFeedback);
  router.post('/sessions/spawn', handleSpawnSession);
  router.get('/metrics', handleGetMetrics);
  router.get('/success-criteria', handleGetSuccessCriteria);
  router.get('/project-events/:projectPath(*)', handleGetProjectEvents);

  return router;
}

function handleGetStatus(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.json({ active: false });
    return;
  }

  const requiredReads = getRequiredReads(
    state.harnessType,
    state.harnessCurrentPhase,
    state.harnessMode
  );

  const sequence = HARNESS_PHASE_SEQUENCES[state.harnessType] || [];

  res.json({
    active: true,
    state,
    requiredReads,
    phaseSequence: sequence,
  });
}

function handleCreate(req: Request, res: Response): void {
  const { projectPath, projectName, harnessType, mode, workFolder, brief } = req.body;

  if (!projectPath || !projectName || !harnessType || !mode) {
    res.status(400).json({ error: 'projectPath, projectName, harnessType, and mode are required' });
    return;
  }

  if (!HARNESS_PHASE_SEQUENCES[harnessType as HarnessType]) {
    res.status(400).json({ error: `Invalid harness type: ${harnessType}` });
    return;
  }

  const state = createHarnessState(
    projectPath,
    projectName,
    harnessType as HarnessType,
    mode as HarnessMode,
    workFolder || null,
    brief || ''
  );

  // Register work folder so session auto-resolution can find it
  if (workFolder) {
    registerWorkFolder(projectPath, workFolder);
  }

  broadcastFn('harness-created', { projectPath, harnessType, mode, workFolder });
  res.json({ ok: true, state });
}

function handleAdvance(req: Request, res: Response): void {
  const { projectPath, sessionId } = req.body;
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const result = advancePhase(state, sessionId || null);
  if (!result.state) {
    res.status(400).json({ error: result.error || 'Cannot advance phase' });
    return;
  }

  broadcastFn('harness-phase-advanced', {
    projectPath,
    previousPhase: result.state.harnessPhaseHistory[result.state.harnessPhaseHistory.length - 2]?.harnessPhase,
    currentPhase: result.state.harnessCurrentPhase,
  });

  res.json({ ok: true, state: result.state });
}

function handleRework(req: Request, res: Response): void {
  const { projectPath, sessionId } = req.body;
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const updated = initiateRework(state, sessionId || null);
  if (!updated) {
    res.status(400).json({
      error: state.harnessCurrentPhase !== 'test'
        ? 'Rework can only be initiated from the test phase'
        : 'Maximum rework cycles (2) reached — escalate to user',
    });
    return;
  }

  broadcastFn('harness-rework', {
    projectPath,
    reworkCycle: updated.harnessReworkCycles,
  });

  res.json({ ok: true, state: updated });
}

/** RW-06: General backward phase movement for rework cycles. */
function handleRegress(req: Request, res: Response): void {
  const { projectPath, targetPhase, reason, sessionId } = req.body;

  if (!targetPhase || typeof targetPhase !== 'string') {
    res.status(400).json({ error: 'targetPhase is required (string)' });
    return;
  }

  if (!reason || typeof reason !== 'string') {
    res.status(400).json({ error: 'reason is required — explain why regression is needed' });
    return;
  }

  const state = loadHarnessState(projectPath, extractWorkFolder(req));
  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const result = regressPhase(state, targetPhase, sessionId || null, reason);
  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  broadcastFn('harness-phase-regressed', {
    projectPath,
    previousPhase: state.harnessCurrentPhase,
    targetPhase,
    reason,
  });

  res.json({ ok: true, state: result.state });
}

function handleOverride(req: Request, res: Response): void {
  const { projectPath, overrideType, rule, phase, sessionId, reason } = req.body;
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  if (!overrideType || !reason) {
    res.status(400).json({ error: 'overrideType and reason are required' });
    return;
  }

  if (overrideType === 'pauseHarness') {
    setHarnessPaused(state, true);
  } else if (overrideType === 'abortHarness') {
    setHarnessPaused(state, true);
    // Mark as complete
    const currentEntry = state.harnessPhaseHistory.find(
      (e) => !e.harnessPhaseCompletedAt
    );
    if (currentEntry) {
      currentEntry.harnessPhaseCompletedAt = new Date().toISOString();
    }
    saveHarnessState(state);
  }

  recordOverride(state, {
    harnessOverrideType: overrideType,
    harnessOverrideRule: rule || undefined,
    harnessOverridePhase: phase || undefined,
    harnessOverrideTimestamp: new Date().toISOString(),
    harnessOverrideSessionId: sessionId || 'dashboard',
    harnessOverrideReason: reason,
  });

  broadcastFn('harness-override', {
    projectPath,
    overrideType,
    reason,
  });

  res.json({ ok: true, state });
}

function handlePause(req: Request, res: Response): void {
  const { projectPath, paused } = req.body;
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  setHarnessPaused(state, paused);

  broadcastFn('harness-paused', { projectPath, paused });
  res.json({ ok: true, state });
}

function handleClearGate(req: Request, res: Response): void {
  const { projectPath, gateName, sessionId } = req.body;

  if (!gateName || typeof gateName !== 'string') {
    trackGateValidationError();
    res.status(400).json({
      error: 'gateName is required (string). Valid values: designGate, preDeployment, or auto:{from}→{to}',
      received: { gateName, gate: req.body.gate },
      hint: req.body.gate ? 'Did you mean "gateName" instead of "gate"?' : undefined,
    });
    return;
  }

  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  clearGate(state, gateName, sessionId || null);

  broadcastFn('harness-gate-cleared', { projectPath, gateName });
  res.json({ ok: true, state });
}

function handleGetLedger(_req: Request, res: Response): void {
  const events = readLedgerEvents();
  res.json(events);
}

function handleGetProjects(_req: Request, res: Response): void {
  const snapshot = readProjectsSnapshot();
  res.json(snapshot);
}

function handleValidate(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const phase = req.query.phase as string;

  if (!phase) {
    res.status(400).json({ error: 'phase query parameter required' });
    return;
  }

  const state = loadHarnessState(projectPath, extractWorkFolder(req));
  if (!state) {
    res.status(404).json({ error: 'No harness state found for project' });
    return;
  }

  const errors = validateCheckpoint(state, phase as HarnessPhase);
  res.json({
    valid: errors.length === 0,
    errors,
  });
}

function handleGetSummary(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  res.json(getHarnessSummary(state));
}

function handleTransitionReady(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const readiness = isPhaseTransitionReady(state);
  res.json(readiness);
}

function handleTransition(req: Request, res: Response): void {
  const { projectPath, sessionId } = req.body;
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const result = executePhaseTransition(state, sessionId || null);

  if (!result.success) {
    res.status(400).json({ ok: false, errors: result.errors });
    return;
  }

  broadcastFn('harness-phase-transition', {
    projectPath,
    nextPhase: result.nextPhase,
    promptLength: result.prompt?.length || 0,
  });

  res.json({
    ok: true,
    nextPhase: result.nextPhase,
    prompt: result.prompt,
  });
}

function handleGetPhasePrompt(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const phase = req.query.phase as string;
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  if (!phase) {
    res.status(400).json({ error: 'phase query parameter required' });
    return;
  }

  const prompt = buildPhasePrompt(state, phase as HarnessPhase);
  res.json({ phase, prompt });
}

// F004: Rate limit tracking for session spawns
const spawnTimestamps: Map<string, number> = new Map();

/** F004: Spawn a new session for a harness phase via API. */
async function handleSpawnSession(req: Request, res: Response): Promise<void> {
  const { projectPath, workFolder, phase, initialMessage } = req.body;

  if (!projectPath) {
    res.status(400).json({ error: 'projectPath is required' });
    return;
  }

  // Rate limit: 1 spawn per project per 30 seconds
  const key = projectPath;
  const lastSpawn = spawnTimestamps.get(key) || 0;
  const elapsed = Date.now() - lastSpawn;
  if (elapsed < 30000) {
    res.status(429).json({
      error: `Rate limited. Wait ${Math.ceil((30000 - elapsed) / 1000)}s before spawning another session for this project.`,
    });
    return;
  }

  const state = loadHarnessState(projectPath, workFolder || extractWorkFolder(req));
  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const targetPhase = phase || state.harnessCurrentPhase;

  // RW-03: Set rate limit timestamp before spawn (prevents spam on failure too)
  spawnTimestamps.set(key, Date.now());

  const result = await spawnPhaseSession(state, targetPhase);

  if (!result.success) {
    // RW-01: Spawn failed after retries — provide fallback copy/paste command
    trackSpawnResult(false);
    const fallbackPrompt = buildPhasePrompt(state, targetPhase);

    res.status(500).json({
      error: `Session spawn failed: ${result.error}`,
      fallback: {
        instruction: 'Open a new terminal, cd to the project, and run:',
        command: `claude --append-system-prompt ${escapeCmdArg(fallbackPrompt.substring(0, 2000))} ${escapeCmdArg(initialMessage || 'Continue from the approved design spec.')}`,
        projectPath,
        phase: targetPhase,
      },
    });
    return;
  }

  trackSpawnResult(true);

  appendLedgerEvent({
    ledgerEventType: 'session_spawn' as any,
    ledgerTimestamp: new Date().toISOString(),
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerWorkFolder: state.harnessWorkFolder,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: targetPhase,
    ledgerSessionId: null,
    ledgerDetail: { pid: result.pid, command: result.command, degraded: result.degraded, source: 'api' },
  });

  broadcastFn('session-spawned', {
    projectPath,
    phase: targetPhase,
    pid: result.pid,
  });

  // RW-02: Include command and degraded in response per design spec
  res.json({
    ok: true,
    pid: result.pid,
    command: result.command,
    degraded: result.degraded,
  });
}

/** F013: Get current enforcement metrics. */
function handleGetMetrics(_req: Request, res: Response): void {
  res.json(getMetrics());
}

/** F014: Get computed success criteria. */
function handleGetSuccessCriteria(_req: Request, res: Response): void {
  res.json(computeSuccessCriteria());
}

/** Wave 3: Get per-project event log (cross-machine source of truth). */
function handleGetProjectEvents(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const events = readProjectEventLog(projectPath);
  res.json(events);
}

/**
 * F006: Receive gate feedback from interactive HTML review documents.
 * The review HTML POSTs structured JSON here on submit.
 * On all-approved, triggers phase transition and session launch.
 */
function handleGateFeedback(req: Request, res: Response): void {
  const feedback = req.body;

  if (!feedback || !feedback.sections) {
    res.status(400).json({ error: 'Invalid feedback: sections required' });
    return;
  }

  // Find the project's harness state — prefer explicit projectPath + workFolder
  let projectPath: string | null = feedback.projectPath || null;
  const workFolder: string | null = feedback.workFolder || null;
  let state: HarnessState | null = null;

  if (projectPath) {
    state = loadHarnessState(projectPath, workFolder);
  }

  if (!state && feedback.project) {
    const projectName = feedback.project;
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const candidates = [
      path.join(home, 'OneDrive - Airedale Catering Equipment', 'Projects', 'Work', projectName),
      path.join(home, 'OneDrive - Airedale Catering Equipment', 'Projects', projectName),
      path.join(home, 'OneDrive', 'Projects', 'Personal', projectName),
      path.join(home, 'Projects', projectName),
      path.join(home, 'OneDrive - Airedale Catering Equipment', 'Projects', 'Work', 'Claude Agents', projectName),
    ];

    for (const candidate of candidates) {
      state = loadHarnessState(candidate, workFolder);
      if (state) {
        projectPath = candidate;
        break;
      }
    }
  }

  const projectLabel = feedback.project || projectPath || 'unknown';

  if (!state || !projectPath) {
    res.status(404).json({ error: `No harness found for project: ${projectLabel}` });
    return;
  }

  // Tally decisions
  const sections = feedback.sections as Record<string, { decision: string; comment?: string }>;
  const decisions = Object.values(sections);
  const approved = decisions.filter((d) => d.decision === 'approve').length;
  const amended = decisions.filter((d) => d.decision === 'amend').length;
  const rejected = decisions.filter((d) => d.decision === 'reject').length;
  const total = decisions.length;
  const allApproved = approved === total && total > 0;

  console.log(`[Gate] Feedback for ${projectLabel}: ${approved}/${total} approved, ${amended} amended, ${rejected} rejected`);

  // Log the gate event
  const gateName = feedback.reviewType === 'design-gate' ? 'designGate' : 'preDeployment';

  appendLedgerEvent({
    ledgerEventType: allApproved ? 'gate_cleared' : 'gate_pending',
    ledgerTimestamp: new Date().toISOString(),
    ledgerProjectPath: state.harnessProjectPath,
    ledgerProjectName: state.harnessProject,
    ledgerWorkFolder: state.harnessWorkFolder,
    ledgerHarness: state.harnessType,
    ledgerMode: state.harnessMode,
    ledgerPhase: state.harnessCurrentPhase,
    ledgerSessionId: null,
    ledgerDetail: {
      gateType: gateName,
      decision: allApproved ? 'approved' : 'needs-work',
      approved,
      amended,
      rejected,
      total,
      amendments: Object.entries(sections)
        .filter(([, v]) => v.decision === 'amend' && v.comment)
        .map(([k, v]) => ({ section: k, comment: v.comment })),
    },
  });

  if (allApproved) {
    // Clear the gate and attempt phase transition
    clearGate(state, gateName, null);

    broadcastFn('gate-approved', {
      projectPath,
      gateName,
      approved,
      total,
    });

    // Try to advance to next phase and spawn session
    const result = executePhaseTransition(state, null);
    if (result.success && result.nextPhase) {
      broadcastFn('harness-phase-transition', {
        projectPath,
        nextPhase: result.nextPhase,
        promptLength: result.prompt?.length || 0,
      });

      // F004: Spawn the next phase session after manual gate approval
      const freshState = loadHarnessState(projectPath!, workFolder);
      if (freshState) {
        spawnPhaseSession(freshState, result.nextPhase).then((spawnResult) => {
          if (spawnResult.success) {
            console.log(`[Gate] Spawned ${result.nextPhase} session (PID ${spawnResult.pid})`);
          } else {
            console.error(`[Gate] FAILED to spawn ${result.nextPhase}: ${spawnResult.error}`);
            broadcastFn('phase-session-failed', {
              projectPath,
              phase: result.nextPhase,
              error: spawnResult.error,
            });
          }
        }).catch((err) => {
          console.error(`[Gate] Session spawn error after approval: ${err}`);
          broadcastFn('phase-session-failed', {
            projectPath,
            phase: result.nextPhase,
            error: String(err),
          });
        });
      }
    }

    res.json({
      ok: true,
      decision: 'approved',
      advanced: result.success,
      nextPhase: result.nextPhase || null,
    });
  } else {
    broadcastFn('gate-feedback', {
      projectPath,
      gateName,
      decision: 'needs-work',
      approved,
      amended,
      rejected,
      total,
    });

    res.json({
      ok: true,
      decision: 'needs-work',
      approved,
      amended,
      rejected,
      total,
    });
  }
}
