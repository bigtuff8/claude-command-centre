// Harness Enforcement Engine — REST API Routes
// Dashboard endpoints for harness status, phase control, and overrides

import { Router, Request, Response } from 'express';
import {
  loadHarnessState,
  saveHarnessState,
  createHarnessState,
  advancePhase,
  initiateRework,
  recordOverride,
  setHarnessPaused,
  clearGate,
} from '../harness/state';
import { validateCheckpoint } from '../harness/checkpoints';
import { getRequiredReads } from '../harness/rules';
import { readLedgerEvents, readProjectsSnapshot } from '../harness/ledger';
import { HarnessType, HarnessMode, HarnessPhase, HARNESS_PHASE_SEQUENCES } from '../harness/types';
import { isPhaseTransitionReady, executePhaseTransition, buildPhasePrompt, getHarnessSummary } from '../harness/orchestrator';

let broadcastFn: (event: string, data: any) => void;

export function createHarnessRouter(broadcast: (event: string, data: any) => void): Router {
  broadcastFn = broadcast;
  const router = Router();

  router.get('/status/:projectPath(*)', handleGetStatus);
  router.post('/create', handleCreate);
  router.post('/advance', handleAdvance);
  router.post('/rework', handleRework);
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

  return router;
}

function handleGetStatus(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const state = loadHarnessState(projectPath);

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
  const { projectPath, projectName, harnessType, mode } = req.body;

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
    mode as HarnessMode
  );

  broadcastFn('harness-created', { projectPath, harnessType, mode });
  res.json({ ok: true, state });
}

function handleAdvance(req: Request, res: Response): void {
  const { projectPath, sessionId } = req.body;
  const state = loadHarnessState(projectPath);

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const updated = advancePhase(state, sessionId || null);
  if (!updated) {
    res.status(400).json({ error: 'Cannot advance — already at final phase or invalid state' });
    return;
  }

  broadcastFn('harness-phase-advanced', {
    projectPath,
    previousPhase: state.harnessPhaseHistory[state.harnessPhaseHistory.length - 2]?.harnessPhase,
    currentPhase: updated.harnessCurrentPhase,
  });

  res.json({ ok: true, state: updated });
}

function handleRework(req: Request, res: Response): void {
  const { projectPath, sessionId } = req.body;
  const state = loadHarnessState(projectPath);

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

function handleOverride(req: Request, res: Response): void {
  const { projectPath, overrideType, rule, phase, sessionId, reason } = req.body;
  const state = loadHarnessState(projectPath);

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
  const state = loadHarnessState(projectPath);

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
  const state = loadHarnessState(projectPath);

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

  const errors = validateCheckpoint(projectPath, phase as HarnessPhase);
  res.json({
    valid: errors.length === 0,
    errors,
  });
}

function handleGetSummary(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const state = loadHarnessState(projectPath);

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  res.json(getHarnessSummary(state));
}

function handleTransitionReady(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const state = loadHarnessState(projectPath);

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const readiness = isPhaseTransitionReady(state);
  res.json(readiness);
}

function handleTransition(req: Request, res: Response): void {
  const { projectPath, sessionId } = req.body;
  const state = loadHarnessState(projectPath);

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
  const state = loadHarnessState(projectPath);

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
