// Harness Enforcement Engine — REST API Routes
// Dashboard endpoints for harness status, phase control, and overrides

import * as path from 'path';
import * as fs from 'fs';
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
  forceClearGate,
  unclearGate,
  forceAdvancePhase,
  setPendingSpawn,
  clearPendingSpawn,
  checkPendingSpawn,
  getArtefactBasePath,
  getNextPhase,
} from '../harness/state';
import { validateCheckpoint, computeCheckpointHash } from '../harness/checkpoints';
import { getRequiredReads } from '../harness/rules';
import { appendLedgerEvent, readLedgerEvents, readProjectsSnapshot, readProjectEventLog, getMetrics, computeSuccessCriteria, trackGateValidationError, trackSpawnResult } from '../harness/ledger';
import { escapeCmdArg } from '../services/session-spawn';
import { HarnessType, HarnessMode, HarnessPhase, HarnessState, HarnessManualOverrideOp, HARNESS_PHASE_SEQUENCES } from '../harness/types';
import { isPhaseTransitionReady, executePhaseTransition, buildPhasePrompt, getHarnessSummary, spawnPhaseSession, isAutoGate, writePhasePrompt, buildGateSectionsData, findLatestGateReviewFile } from '../harness/orchestrator';
import { registerWorkFolder, getAllSessions } from '../state/sessions';

/**
 * Extract workFolder from request query params or body.
 * Dashboard API calls should include ?workFolder=xxx for work-folder-scoped harnesses.
 */
function extractWorkFolder(req: Request): string | null {
  return (req.query.workFolder as string) || req.body?.workFolder || null;
}

/**
 * P1 / IM-04: Resolve the gate name(s) that are actually meaningful for a run's current position.
 * A manual gate exists at the current phase only if the current→next transition is a manual gate.
 * The name mirrors what handleGateFeedback uses: design→* → 'designGate', otherwise 'preDeployment'.
 * Returns [] when there is no manual gate at the current phase (constrains Repair gate ops).
 */
function getExpectedGateNames(state: HarnessState): string[] {
  const next = getNextPhase(state);
  if (!next) return [];
  if (isAutoGate(state.harnessCurrentPhase, next)) return [];
  return state.harnessCurrentPhase === 'design' ? ['designGate'] : ['preDeployment'];
}

/**
 * P1 / IM-05: Detect a live CC-tracked session attached to this harness run.
 * Force-advancing under a working session can orphan it, so bypass ops warn/refuse first.
 */
function findLiveAttachedSession(projectPath: string, workFolder: string | null): { id: string; name: string } | null {
  const live = getAllSessions().find((s) =>
    (s.status === 'active' || s.status === 'waiting' || s.status === 'held') &&
    s.project === projectPath &&
    ((workFolder || null) === (s.workFolderPath || null))
  );
  return live ? { id: live.id, name: live.name } : null;
}

let broadcastFn: (event: string, data: any) => void;

/**
 * P1 / R-HARN-4/6: Guard governance-MUTATING endpoints. Two protections:
 *  1. Loopback-only — the socket's remote address must be a loopback address. If the CC is ever
 *     bound to a non-loopback interface (host=0.0.0.0), a remote client cannot mutate governance
 *     state. Hard refusal, not advisory.
 *  2. Same-origin (CSRF / DNS-rebinding) — the Host header hostname must be localhost/127.0.0.1,
 *     and any Origin header must resolve to the same. `Origin: null` / absent is allowed so the
 *     emergency file:// review doc and server-internal callers still work.
 */
function requireLoopback(req: Request, res: Response, next: () => void): void {
  const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const remote = (req.socket && req.socket.remoteAddress) || '';
  if (!LOOPBACK.has(remote)) {
    res.status(403).json({ error: 'Governance endpoints are loopback-only (127.0.0.1). Refused for a non-loopback client.' });
    return;
  }

  const hostnameOf = (v: string): string => {
    let h = (v || '').trim();
    if (!h) return '';
    // Strip scheme
    h = h.replace(/^[a-z]+:\/\//i, '');
    // Strip path
    h = h.split('/')[0];
    // Strip port (but keep IPv6 in brackets intact enough for the localhost check)
    if (h.startsWith('[')) return h; // IPv6 literal — treated below
    return h.split(':')[0].toLowerCase();
  };
  const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

  const hostHeader = hostnameOf(req.headers.host || '');
  if (hostHeader && !ALLOWED_HOSTS.has(hostHeader)) {
    res.status(403).json({ error: `Refused: Host header "${req.headers.host}" is not a loopback host (DNS-rebinding guard).` });
    return;
  }

  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    const originHost = hostnameOf(origin);
    if (!ALLOWED_HOSTS.has(originHost)) {
      res.status(403).json({ error: `Refused: cross-origin request from "${origin}" (CSRF guard).` });
      return;
    }
  }

  next();
}

export function createHarnessRouter(broadcast: (event: string, data: any) => void): Router {
  broadcastFn = broadcast;
  const router = Router();

  router.get('/status/:projectPath(*)', handleGetStatus);
  router.post('/create', requireLoopback, handleCreate);
  router.post('/advance', requireLoopback, handleAdvance);
  router.post('/rework', requireLoopback, handleRework);
  router.post('/regress', requireLoopback, handleRegress);
  router.post('/override', requireLoopback, handleOverride);
  router.post('/pause', requireLoopback, handlePause);
  router.post('/gate/clear', requireLoopback, handleClearGate);
  router.get('/ledger', handleGetLedger);
  router.get('/projects', handleGetProjects);
  router.get('/validate/:projectPath(*)', handleValidate);
  router.get('/summary/:projectPath(*)', handleGetSummary);
  router.get('/transition-ready/:projectPath(*)', handleTransitionReady);
  router.post('/transition', requireLoopback, handleTransition);
  router.get('/phase-prompt/:projectPath(*)', handleGetPhasePrompt);
  router.post('/gate/feedback', requireLoopback, handleGateFeedback);
  router.post('/sessions/spawn', requireLoopback, handleSpawnSession);
  router.get('/metrics', handleGetMetrics);
  router.get('/success-criteria', handleGetSuccessCriteria);
  router.get('/project-events/:projectPath(*)', handleGetProjectEvents);
  // RISK-05 CT-2: Recovery endpoints for stale pendingSpawn
  router.post('/retry-spawn', requireLoopback, handleRetrySpawn);
  router.post('/clear-pending-spawn', requireLoopback, handleClearPendingSpawn);

  // P1 — gate surfacing (read-only) + Repair control (governance-mutating, loopback-guarded)
  router.get('/gate-status/:projectPath(*)', handleGateStatus);
  router.get('/gate-sections/:projectPath(*)', handleGateSections);
  router.post('/repair/regenerate-prompt', requireLoopback, handleRepairRegeneratePrompt);
  router.post('/repair/force-advance', requireLoopback, handleRepairForceAdvance);
  router.post('/repair/gate', requireLoopback, handleRepairGate);

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

  // P3: regenerate .harness/phase-prompt.md for the new phase. Previously the prompt was
  // written ONLY by session-spawn.ts on spawn, so a bare advance (this route, incl. the
  // Repair force-advance) left phase-prompt.md showing the OLD phase — a continuing/spawned
  // session could then read the wrong brief. Keep prompt ↔ state in sync at the advance site.
  try {
    const newPhase = result.state.harnessCurrentPhase;
    const promptDir = path.join(getArtefactBasePath(result.state), '.harness');
    fs.mkdirSync(promptDir, { recursive: true });
    fs.writeFileSync(path.join(promptDir, 'phase-prompt.md'), buildPhasePrompt(result.state, newPhase), 'utf-8');
  } catch { /* non-fatal — spawn will still write the prompt on the normal path */ }

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

  const summary = getHarnessSummary(state);

  // RISK-05: Check for stale pendingSpawn and include in response
  const pendingPhase = checkPendingSpawn(state);
  if (pendingPhase) {
    broadcastFn('pending-spawn-detected', {
      projectPath: state.harnessProjectPath,
      phase: pendingPhase,
      setAt: state.harnessPendingSpawn?.harnessPendingSetAt,
      attempts: state.harnessPendingSpawn?.harnessPendingAttempts,
    });
  }

  res.json({
    ...summary,
    pendingSpawn: pendingPhase ? {
      phase: pendingPhase,
      setAt: state.harnessPendingSpawn?.harnessPendingSetAt,
      attempts: state.harnessPendingSpawn?.harnessPendingAttempts,
    } : null,
  });
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

// P1 / IM-02: Double-submit dedup for manual-gate approvals. A manual gate had NO guard, so two
// rapid submits could both pass the all-approved branch (state hasn't advanced yet), double-
// advancing and double-spawning. Keyed by run + the phase being approved; cleared when the
// spawn settles.
const gateAdvanceInProgress: Set<string> = new Set();

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

  // IM-01 (TOCTOU): if the review was stamped with a checkpoint hash, verify the checkpoint on
  // disk hasn't changed under the reviewer. The in-app modal always sends this; the legacy
  // file:// review doc does not, so absence is tolerated (backward compat) but logged.
  if (feedback.checkpointHash) {
    const currentHash = computeCheckpointHash(state, state.harnessCurrentPhase);
    if (currentHash && currentHash !== feedback.checkpointHash) {
      res.status(409).json({
        error: 'Checkpoint changed since this review was generated — re-review required.',
        reReview: true,
        expected: feedback.checkpointHash,
        actual: currentHash,
      });
      return;
    }
  } else {
    console.log(`[Gate] Feedback for ${projectLabel} has no checkpointHash (legacy review doc) — TOCTOU check skipped.`);
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
    // IM-02: guard against a double-submit racing the phase advance.
    const dedupeKey = `${state.harnessProjectPath}|${state.harnessWorkFolder || ''}|${state.harnessCurrentPhase}`;
    if (gateAdvanceInProgress.has(dedupeKey)) {
      console.log(`[Gate] Duplicate approval for ${dedupeKey} ignored (advance already in progress).`);
      res.json({ ok: true, decision: 'approved', duplicate: true, advanced: false });
      return;
    }
    gateAdvanceInProgress.add(dedupeKey);

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
    if (!result.success) {
      // Advance failed (e.g. checkpoint invalid) — release the guard so it can be retried.
      gateAdvanceInProgress.delete(dedupeKey);
    }
    if (result.success && result.nextPhase) {
      broadcastFn('harness-phase-transition', {
        projectPath,
        nextPhase: result.nextPhase,
        promptLength: result.prompt?.length || 0,
      });

      // F004: Spawn the next phase session after manual gate approval
      // RISK-05: Set pendingSpawn before attempting spawn
      const freshState = loadHarnessState(projectPath!, workFolder);
      if (freshState) {
        setPendingSpawn(freshState, result.nextPhase);

        spawnPhaseSession(freshState, result.nextPhase).then((spawnResult) => {
          if (spawnResult.success) {
            clearPendingSpawn(freshState); // RISK-05: Spawn succeeded
            console.log(`[Gate] Spawned ${result.nextPhase} session (PID ${spawnResult.pid})`);
          } else {
            // RISK-05: pendingSpawn remains set — reconciliation will catch it
            console.error(`[Gate] FAILED to spawn ${result.nextPhase}: ${spawnResult.error}`);
            broadcastFn('phase-session-failed', {
              projectPath,
              phase: result.nextPhase,
              error: spawnResult.error,
              pendingSpawn: true,
            });
          }
        }).catch((err) => {
          console.error(`[Gate] Session spawn error after approval: ${err}`);
          broadcastFn('phase-session-failed', {
            projectPath,
            phase: result.nextPhase,
            error: String(err),
            pendingSpawn: true,
          });
        }).finally(() => {
          gateAdvanceInProgress.delete(dedupeKey); // IM-02: release the dedup guard
        });
      } else {
        gateAdvanceInProgress.delete(dedupeKey);
      }
    } else {
      // Advanced but with no next phase (final phase) — nothing to spawn; release the guard.
      gateAdvanceInProgress.delete(dedupeKey);
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

// RISK-05 CT-2: Retry a stale pending spawn
async function handleRetrySpawn(req: Request, res: Response): Promise<void> {
  const { projectPath } = req.body;
  const workFolder = extractWorkFolder(req);
  const state = loadHarnessState(projectPath, workFolder);

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  if (!state.harnessPendingSpawn) {
    res.status(400).json({ error: 'No pending spawn to retry' });
    return;
  }

  const phase = state.harnessPendingSpawn.harnessPendingPhase;
  setPendingSpawn(state, phase); // Update timestamp and increment attempts

  try {
    const result = await spawnPhaseSession(state, phase);
    if (result.success) {
      clearPendingSpawn(state);
      broadcastFn('pending-spawn-resolved', { projectPath, phase, pid: result.pid });
      res.json({ ok: true, phase, pid: result.pid });
    } else {
      broadcastFn('phase-session-failed', { projectPath, phase, error: result.error, pendingSpawn: true });
      res.status(500).json({ error: `Retry failed: ${result.error}`, pendingSpawn: true });
    }
  } catch (err) {
    res.status(500).json({ error: `Retry error: ${err}` });
  }
}

// RISK-05 CT-2: Manually clear a stale pendingSpawn flag
function handleClearPendingSpawn(req: Request, res: Response): void {
  const { projectPath } = req.body;
  const workFolder = extractWorkFolder(req);
  const state = loadHarnessState(projectPath, workFolder);

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  if (!state.harnessPendingSpawn) {
    res.json({ ok: true, message: 'No pending spawn to clear' });
    return;
  }

  const phase = state.harnessPendingSpawn.harnessPendingPhase;
  clearPendingSpawn(state);
  broadcastFn('pending-spawn-resolved', { projectPath, phase, manual: true });
  res.json({ ok: true, cleared: phase });
}

// ================= P1 — Gate surfacing + Repair control =================

/**
 * P1 / IM-01: Read-only gate status for a run. GATE_CONFIG is server-only, so the dashboard
 * cannot derive "is this a manual gate / is the checkpoint valid / is there a review yet"
 * without this. Drives the amber gate banner (States A/B/C) on the harness card.
 */
function handleGateStatus(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.json({ active: false });
    return;
  }

  const currentPhase = state.harnessCurrentPhase;
  const nextPhase = getNextPhase(state);
  const isManualGate = nextPhase ? !isAutoGate(currentPhase, nextPhase) : false;
  const checkpointValid = validateCheckpoint(state, currentPhase).length === 0;
  const reviewFilePath = findLatestGateReviewFile(state, currentPhase);
  const expectedGates = getExpectedGateNames(state);
  const gateCleared = expectedGates.some((g) => state.harnessGatesCleared[g] === true);
  const overrides = Array.isArray(state.harnessManuallyOverridden) ? state.harnessManuallyOverridden : [];
  const latestOverride = overrides.length > 0 ? overrides[overrides.length - 1] : null;
  const liveSession = findLiveAttachedSession(state.harnessProjectPath, state.harnessWorkFolder);

  res.json({
    active: true,
    projectPath: state.harnessProjectPath,
    workFolder: state.harnessWorkFolder,
    project: state.harnessProject,
    phase: currentPhase,
    nextPhase,
    isManualGate,
    checkpointValid,
    reviewFilePath,
    hasReview: !!reviewFilePath,
    expectedGates,
    gateCleared,
    checkpointHash: computeCheckpointHash(state, currentPhase),
    manuallyOverridden: latestOverride,
    manualOverrideCount: overrides.length,
    liveSessionAttached: liveSession,
  });
}

/**
 * P1 / CR-03: Same-origin structured gate data for the embedded Review & Approve modal.
 * Returns plain-text sections + the checkpoint hash (TOCTOU stamp) so the dashboard renders
 * the review in-app and POSTs the real section IDs to /api/gate/feedback.
 */
function handleGateSections(req: Request, res: Response): void {
  const projectPath = decodeURIComponent(req.params.projectPath);
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const currentPhase = state.harnessCurrentPhase;
  const nextPhase = getNextPhase(state);
  if (!nextPhase) {
    res.status(400).json({ error: 'No next phase — the run is at its final phase, so there is no gate to review.' });
    return;
  }

  const { sections, reviewType } = buildGateSectionsData(state, currentPhase, nextPhase);

  res.json({
    project: state.harnessProject,
    projectPath: state.harnessProjectPath,
    workFolder: state.harnessWorkFolder,
    phase: currentPhase,
    nextPhase,
    reviewType,
    checkpointValid: validateCheckpoint(state, currentPhase).length === 0,
    checkpointHash: computeCheckpointHash(state, currentPhase),
    sections,
  });
}

/**
 * P1 (safe Repair op): Regenerate .harness/phase-prompt.md from current state. No bypass, no
 * reason required — fixes a stale prompt. One-click in the Repair panel.
 */
function handleRepairRegeneratePrompt(req: Request, res: Response): void {
  const { projectPath, phase } = req.body;
  const state = loadHarnessState(projectPath, extractWorkFolder(req));

  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  const targetPhase = (phase as HarnessPhase) || state.harnessCurrentPhase;
  const written = writePhasePrompt(state, targetPhase);
  if (!written) {
    res.status(500).json({ error: 'Failed to write phase-prompt.md' });
    return;
  }

  broadcastFn('harness-prompt-regenerated', { projectPath: state.harnessProjectPath, phase: targetPhase });
  res.json({ ok: true, phase: targetPhase, path: written });
}

/**
 * P1 / CR-01: Guarded force-advance / deadlock recovery (the SAME bypass path).
 * Explicitly skips checkpoint validation, ALWAYS rewrites phase-prompt.md, emits a distinct
 * `repair_override` ledger event, stamps the persistent override marker, and 400s on a missing
 * reason. Refuses if a live CC session is attached unless { force: true }.
 */
function handleRepairForceAdvance(req: Request, res: Response): void {
  const { projectPath, reason, toPhase, sessionId, force } = req.body;
  const op: HarnessManualOverrideOp = req.body.op === 'deadlock-recovery' ? 'deadlock-recovery' : 'force-advance';

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    res.status(400).json({ error: 'reason is required for a gate bypass (force-advance / deadlock recovery).' });
    return;
  }

  const workFolder = extractWorkFolder(req);
  // IM-05: reload state immediately before mutating (loadHarnessState reads fresh from disk).
  const state = loadHarnessState(projectPath, workFolder);
  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  // IM-05: refuse to force-advance out from under a live attached session unless forced.
  const liveSession = findLiveAttachedSession(state.harnessProjectPath, state.harnessWorkFolder);
  if (liveSession && !force) {
    res.status(409).json({
      error: `A live session ("${liveSession.name}") is attached to this run. Force-advancing may orphan it. Stop that session first, or resubmit with force:true.`,
      liveSessionAttached: liveSession,
    });
    return;
  }

  const result = forceAdvancePhase(state, sessionId || 'dashboard', reason.trim(), toPhase as HarnessPhase | undefined, op);
  if (!result.state) {
    res.status(400).json({ error: result.error });
    return;
  }

  // CR-01: a recovered run MUST leave a fresh phase-prompt for its next session.
  writePhasePrompt(result.state, result.toPhase);

  broadcastFn('harness-repair-override', {
    projectPath: state.harnessProjectPath,
    op,
    fromPhase: result.fromPhase,
    toPhase: result.toPhase,
    reason: reason.trim(),
    checkpointValid: result.checkpointValid,
  });

  res.json({
    ok: true,
    op,
    fromPhase: result.fromPhase,
    toPhase: result.toPhase,
    checkpointValidAtOverride: result.checkpointValid,
    forced: !!force,
    state: result.state,
  });
}

/**
 * P1 / CR-02 + IM-04: Force-clear or un-clear a gate via Repair (a bypass, not an approval).
 * Emits `repair_override` (never `gate_cleared{approved}`), stamps the override marker, requires
 * a reason, and constrains gateName to the run's actual gate(s).
 */
function handleRepairGate(req: Request, res: Response): void {
  const { projectPath, gateName, reason, sessionId, force } = req.body;
  const action = req.body.action;

  if (action !== 'clear' && action !== 'unclear') {
    res.status(400).json({ error: "action is required and must be 'clear' or 'unclear'." });
    return;
  }
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    res.status(400).json({ error: 'reason is required for a manual gate override.' });
    return;
  }
  if (!gateName || typeof gateName !== 'string') {
    res.status(400).json({ error: 'gateName is required (string).' });
    return;
  }

  const workFolder = extractWorkFolder(req);
  const state = loadHarnessState(projectPath, workFolder);
  if (!state) {
    res.status(404).json({ error: 'No harness active for this project' });
    return;
  }

  // IM-04: constrain to the run's real gate(s). For 'clear', the gate must be the current
  // pending gate. For 'unclear', it must be one that is actually cleared right now.
  const expected = getExpectedGateNames(state);
  if (action === 'clear' && !expected.includes(gateName)) {
    res.status(400).json({
      error: `Gate "${gateName}" is not a pending gate for this run's current phase (${state.harnessCurrentPhase}).`,
      expectedGates: expected,
    });
    return;
  }
  if (action === 'unclear' && state.harnessGatesCleared[gateName] !== true) {
    res.status(400).json({ error: `Gate "${gateName}" is not currently cleared, so it cannot be un-cleared.` });
    return;
  }

  // IM-05: warn/refuse under a live attached session unless forced.
  const liveSession = findLiveAttachedSession(state.harnessProjectPath, state.harnessWorkFolder);
  if (liveSession && !force) {
    res.status(409).json({
      error: `A live session ("${liveSession.name}") is attached to this run. Resubmit with force:true to override anyway.`,
      liveSessionAttached: liveSession,
    });
    return;
  }

  if (action === 'clear') {
    forceClearGate(state, gateName, sessionId || 'dashboard', reason.trim());
  } else {
    unclearGate(state, gateName, sessionId || 'dashboard', reason.trim());
  }

  broadcastFn('harness-repair-override', {
    projectPath: state.harnessProjectPath,
    op: action === 'clear' ? 'gate-clear' : 'gate-unclear',
    gate: gateName,
    reason: reason.trim(),
  });

  res.json({ ok: true, action, gateName, state });
}
