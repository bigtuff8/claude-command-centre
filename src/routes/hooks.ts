import { Router, Request, Response } from 'express';
import { HookPayload, FeedEventDTO, AppConfig } from '../types';
import { getOrCreateSession, addEvent, addFeedEvent, sessionToDTO } from '../state/sessions';
import { markDirty } from '../state/persistence';
import { createPermissionRequest, isAutoPassTool } from '../services/permission';
import { notifyPermissionRequest, notifySessionComplete } from '../services/notifications';
import { loadHarnessState, getNextPhase, advancePhase, clearGate, setPendingSpawn, clearPendingSpawn } from '../harness/state';
import { checkPhaseRules } from '../harness/rules';
import { appendLedgerEvent } from '../harness/ledger';
import { validateCheckpoint } from '../harness/checkpoints';
import { trackToolCall, trackCheckpointValidation } from '../harness/ledger';
import { HarnessPhase, PHASE_CHECKPOINT_FILES } from '../harness/types';
import { isSteerCoGate, isAutoGate, invokeSteerCoReview, invokeGateAudit, spawnPhaseSession, generateGateReviewHtml } from '../harness/orchestrator';
// Terminal PID is now resolved via the registry (populated by the launcher's
// POST to /api/register-terminal). The getOrCreateSession() call auto-applies
// the registry lookup, so no additional discovery logic is needed here.

let broadcastFn: (event: string, data: any) => void;
let appConfig: AppConfig;

// RW-07: Per-project phase-transition deduplication guard.
// Prevents concurrent checkpoint writes from double-advancing the phase.
const transitionInProgress: Set<string> = new Set();

export function getHooksConfig(): AppConfig {
  return appConfig;
}

export function setAutoApproveAll(value: boolean): void {
  appConfig.autoApproveAll = value;
}

export function createHooksRouter(broadcast: (event: string, data: any) => void, config: AppConfig): Router {
  broadcastFn = broadcast;
  appConfig = config;
  const router = Router();

  router.post('/session-start', handleSessionStart);
  router.post('/session-end', handleSessionEnd);
  router.post('/pre-tool-use', handlePreToolUse);
  router.post('/post-tool-use', handlePostToolUse);

  return router;
}

function handleSessionStart(req: Request, res: Response): void {
  const payload: HookPayload = req.body;
  console.log('[SessionStart] Payload keys:', Object.keys(payload).join(', '));
  const session = getOrCreateSession(payload.session_id, payload.cwd, payload.permission_mode);

  // Capture transcript path — from payload or derive from session_id
  if (payload.transcript_path) {
    session.transcriptPath = payload.transcript_path;
  } else if (payload.session_id && payload.cwd) {
    session.transcriptPath = deriveTranscriptPath(payload.session_id, payload.cwd);
  }

  const event = {
    timestamp: new Date(),
    sessionId: session.id,
    eventName: 'SessionStart',
  };
  addEvent(session, event);

  const feedEvent: FeedEventDTO = {
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    sessionName: session.name,
    eventName: 'SessionStart',
    detail: 'Session started',
  };
  addFeedEvent(feedEvent);

  broadcastFn('session-added', sessionToDTO(session));
  broadcastFn('feed-event', feedEvent);

  // CT-4: Clear pendingSpawn if any session starts for a project with a pending spawn.
  // This covers manual session launches that bypass the orchestrator's spawn flow.
  if (payload.cwd) {
    const hState = loadHarnessState(payload.cwd);
    if (hState && hState.harnessPendingSpawn) {
      const pendingPhase = hState.harnessPendingSpawn.harnessPendingPhase;
      console.log(`[SessionStart] Clearing pendingSpawn for ${payload.cwd} (session connected for ${pendingPhase} phase)`);
      clearPendingSpawn(hState);
      broadcastFn('pending-spawn-resolved', { projectPath: payload.cwd, phase: pendingPhase, manual: true });
    }
  }

  if (session.terminalPid) {
    console.log(`[SessionStart] ${session.name} (${session.id.substring(0, 8)}) → terminal PID ${session.terminalPid}`);
  } else {
    console.log(`[SessionStart] ${session.name} (${session.id.substring(0, 8)}) — no terminal PID yet`);
  }
  res.json({});
}

function handleSessionEnd(req: Request, res: Response): void {
  const payload: HookPayload = req.body;
  const session = getOrCreateSession(payload.session_id, payload.cwd);

  session.status = 'completed';
  if (session.pendingPermission) {
    clearTimeout(session.pendingPermission.timeout);
    session.pendingPermission.resolve({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    });
    session.pendingPermission = null;
  }

  const event = {
    timestamp: new Date(),
    sessionId: session.id,
    eventName: 'SessionEnd',
  };
  addEvent(session, event);

  const feedEvent: FeedEventDTO = {
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    sessionName: session.name,
    eventName: 'SessionEnd',
    detail: 'Session completed',
  };
  addFeedEvent(feedEvent);

  broadcastFn('session-updated', sessionToDTO(session));
  broadcastFn('feed-event', feedEvent);
  notifySessionComplete(session.name);

  // Write .rename-pending marker for work-folder-scoped sessions (DD2, DR-02)
  const endSessionWorkFolder = session.workFolderPath || null;
  if (endSessionWorkFolder) {
    const endState = loadHarnessState(session.project, endSessionWorkFolder);
    if (endState && endState.harnessWorkFolder) {
      const fs = require('fs');
      const path = require('path');
      const workFolderAbsolute = path.join(endState.harnessProjectPath, endState.harnessWorkFolder);
      const renamePendingPath = path.join(workFolderAbsolute, '.rename-pending');
      if (!fs.existsSync(renamePendingPath)) {
        try {
          // Generate target name from brief and harness type
          const verbMap: Record<string, string> = {
            build: 'Build', integration: 'Integrate', research: 'Research',
            automation: 'Automate', admin: 'Admin'
          };
          const verb = verbMap[endState.harnessType] || 'Work';
          const date = endState.harnessCreatedAt?.split('T')[0] || new Date().toISOString().split('T')[0];
          let slug = (endState.harnessBrief || '').replace(/[^a-zA-Z0-9 ]/g, '').trim()
            .split(' ').slice(0, 6).join(' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase());
          if (!slug) slug = endState.harnessProject;
          const targetName = `${date} - ${verb} ${slug}`;

          fs.writeFileSync(renamePendingPath, JSON.stringify({
            targetName,
            createdAt: new Date().toISOString(),
            reason: 'session-end',
          }, null, 2), 'utf-8');
          console.log(`[SessionEnd] Wrote .rename-pending: ${targetName}`);
        } catch (err) {
          console.log(`[SessionEnd] Could not write .rename-pending: ${err}`);
        }
      }
    }
  }

  console.log(`[SessionEnd] ${session.name}`);
  res.json({});
}

async function handlePreToolUse(req: Request, res: Response): Promise<void> {
  const payload: HookPayload = req.body;
  const session = getOrCreateSession(payload.session_id, payload.cwd, payload.permission_mode);
  const toolName = payload.tool_name || 'Unknown';
  const toolInput = payload.tool_input || {};
  const toolUseId = payload.tool_use_id || '';

  // Record the event regardless
  const event = {
    timestamp: new Date(),
    sessionId: session.id,
    eventName: 'PreToolUse',
    toolName,
    toolInput,
    toolUseId,
  };
  addEvent(session, event);

  const feedEvent: FeedEventDTO = {
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    sessionName: session.name,
    eventName: 'PreToolUse',
    toolName,
    detail: getToolDetail(toolName, toolInput),
  };
  addFeedEvent(feedEvent);
  broadcastFn('feed-event', feedEvent);

  // Capture transcript path — from payload or derive
  if (!session.transcriptPath) {
    if (payload.transcript_path) {
      session.transcriptPath = payload.transcript_path;
    } else if (payload.session_id && payload.cwd) {
      session.transcriptPath = deriveTranscriptPath(payload.session_id, payload.cwd);
    }
  }

  // Auto-pass tools: always allow with explicit permission decision.
  // Returning {} (no decision) causes Claude Code to fall back to its own
  // permission system, which may still prompt the user for tools like
  // WebSearch/WebFetch. An explicit 'allow' overrides that.
  if (isAutoPassTool(toolName, session.permissionMode)) {
    // Track file reads for harness mustReadBefore enforcement
    if (toolName === 'Read' && toolInput.file_path) {
      session.filesReadThisSession.add(String(toolInput.file_path));
    }
    broadcastFn('session-updated', sessionToDTO(session));
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Auto-pass tool — always allowed',
      },
    });
    return;
  }

  // --- Harness enforcement (runs BEFORE auto-approve) ---
  // F009: Skip harness enforcement entirely if no harness is active for this project.
  // DR-03/DR-20: Resolve work folder from session metadata for multi-work-folder support.
  const sessionWorkFolder = session.workFolderPath || null;
  const harnessState = loadHarnessState(session.project, sessionWorkFolder);
  if (harnessState) {
    session.harnessPhase = harnessState.harnessCurrentPhase;
    // F006: Sync session workFolderPath from on-disk state if stale/missing
    if (!session.workFolderPath && harnessState.harnessWorkFolder) {
      session.workFolderPath = harnessState.harnessWorkFolder;
      markDirty();
    }
    const { getArtefactBasePath } = require('../harness/state');
    const artefactBase = getArtefactBasePath(harnessState);
    const violation = checkPhaseRules(harnessState, toolName, toolInput, session.filesReadThisSession, artefactBase);
    if (violation) {
      console.log(`[Harness] DENIED: ${session.name} → ${toolName}: ${violation.violationReason}`);

      appendLedgerEvent({
        ledgerEventType: 'violation',
        ledgerTimestamp: new Date().toISOString(),
        ledgerProjectPath: harnessState.harnessProjectPath,
        ledgerProjectName: harnessState.harnessProject,
        ledgerWorkFolder: harnessState.harnessWorkFolder,
        ledgerHarness: harnessState.harnessType,
        ledgerMode: harnessState.harnessMode,
        ledgerPhase: harnessState.harnessCurrentPhase,
        ledgerSessionId: session.id,
        ledgerDetail: {
          rule: violation.violationRule,
          toolBlocked: toolName,
          targetFile: toolInput.file_path || toolInput.command || '',
        },
      });

      const violationFeed: FeedEventDTO = {
        timestamp: new Date().toISOString(),
        sessionId: session.id,
        sessionName: session.name,
        eventName: 'HarnessViolation',
        toolName,
        detail: `[HARNESS] ${violation.violationReason}`,
      };
      addFeedEvent(violationFeed);
      broadcastFn('feed-event', violationFeed);
      broadcastFn('harness-violation', {
        sessionId: session.id,
        phase: harnessState.harnessCurrentPhase,
        violation: violation.violationReason,
        fix: violation.violationFix,
        rule: violation.violationRule,
      });

      res.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `[HARNESS] ${violation.violationReason}. Required: ${violation.violationFix}`,
        },
      });
      return;
    }
  }

  // B012/B017: Auto-approve permissions (session-level overrides global)
  const sessionAutoApprove = session.autoApprove;
  const shouldAutoApprove = sessionAutoApprove === true || (sessionAutoApprove === null && (appConfig.autoApproveAll || appConfig.autoApproveTools.includes(toolName)));
  if (shouldAutoApprove) {
    const detail = getToolDetail(toolName, toolInput);
    const humanDetail = getHumanReadableApproval(toolName, toolInput);
    console.log(`[Permission] Auto-approved: ${session.name} → ${toolName}(${detail})`);
    broadcastFn('session-updated', sessionToDTO(session));
    const feedEvt: FeedEventDTO = {
      timestamp: new Date().toISOString(),
      sessionId: session.id,
      sessionName: session.name,
      eventName: 'PermissionAutoApproved',
      toolName,
      detail: humanDetail,
    };
    addFeedEvent(feedEvt);
    broadcastFn('feed-event', feedEvt);
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Auto-approved via Command Centre',
      },
    });
    return;
  }

  // B006: Auto-decline permissions when session is on hold
  if (session.status === 'held') {
    console.log(`[Permission] Auto-declined (session on hold): ${session.name} → ${toolName}`);
    res.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Session paused via Command Centre dashboard',
      },
    });
    return;
  }

  // Hold the request and wait for dashboard response
  console.log(`[Permission] ${session.name} requesting: ${toolName}(${getToolDetail(toolName, toolInput)})`);

  notifyPermissionRequest(session.name, toolName, toolInput);

  // IMPORTANT: createPermissionRequest must be called BEFORE broadcasting session-updated,
  // because it sets session.pendingPermission and session.status = 'waiting'.
  // If we broadcast session-updated first, the DTO has pendingPermission: null,
  // which clobbers the client-side state set by the permission-requested event.
  const permissionPromise = createPermissionRequest(session, toolName, toolInput, toolUseId);

  // Now session.pendingPermission is set — safe to broadcast
  broadcastFn('permission-requested', {
    sessionId: session.id,
    sessionName: session.name,
    toolName,
    toolInput,
    toolUseId,
  });
  broadcastFn('session-updated', sessionToDTO(session));

  const response = await permissionPromise;
  broadcastFn('session-updated', sessionToDTO(session));
  res.json(response);
}

function handlePostToolUse(req: Request, res: Response): void {
  const payload: HookPayload = req.body;
  const session = getOrCreateSession(payload.session_id, payload.cwd);
  const toolName = payload.tool_name || 'Unknown';
  const toolInput = payload.tool_input || {};

  if (!session.transcriptPath) {
    if (payload.transcript_path) {
      session.transcriptPath = payload.transcript_path;
    } else if (payload.session_id && payload.cwd) {
      session.transcriptPath = deriveTranscriptPath(payload.session_id, payload.cwd);
    }
  }

  session.toolCount++;
  session.lastActivity = new Date();
  trackToolCall();

  // Track modified files
  if (['Edit', 'Write'].includes(toolName) && toolInput.file_path) {
    session.filesModified.add(String(toolInput.file_path));
  }

  // Track read files for harness mustReadBefore enforcement
  if (toolName === 'Read' && toolInput.file_path) {
    session.filesReadThisSession.add(String(toolInput.file_path));
  }

  const event = {
    timestamp: new Date(),
    sessionId: session.id,
    eventName: 'PostToolUse',
    toolName,
    toolInput,
    toolUseId: payload.tool_use_id,
  };
  addEvent(session, event);

  const feedEvent: FeedEventDTO = {
    timestamp: new Date().toISOString(),
    sessionId: session.id,
    sessionName: session.name,
    eventName: 'PostToolUse',
    toolName,
    detail: getToolDetail(toolName, toolInput),
  };
  addFeedEvent(feedEvent);

  broadcastFn('session-updated', sessionToDTO(session));
  broadcastFn('feed-event', feedEvent);

  // F005: Detect checkpoint writes — trigger gate workflow
  if (toolName === 'Write' && toolInput.file_path) {
    const filePath = String(toolInput.file_path);
    const checkpointMatch = filePath.match(/\.harness[/\\]checkpoint-(\w+)\.json$/);
    if (checkpointMatch) {
      const phase = checkpointMatch[1] as HarnessPhase;
      const postSessionWorkFolder = session.workFolderPath || null;
      const harnessState = loadHarnessState(session.project, postSessionWorkFolder);
      if (harnessState) {
        const errors = validateCheckpoint(harnessState, phase);
        const isValid = errors.length === 0;

        console.log(`[Harness] Checkpoint detected: ${phase} (valid: ${isValid})`);
        trackCheckpointValidation(isValid);

        appendLedgerEvent({
          ledgerEventType: 'gate_pending',
          ledgerTimestamp: new Date().toISOString(),
          ledgerProjectPath: harnessState.harnessProjectPath,
          ledgerProjectName: harnessState.harnessProject,
          ledgerWorkFolder: harnessState.harnessWorkFolder,
          ledgerHarness: harnessState.harnessType,
          ledgerMode: harnessState.harnessMode,
          ledgerPhase: phase,
          ledgerSessionId: session.id,
          ledgerDetail: { valid: isValid, errors },
        });

        broadcastFn('checkpoint-detected', {
          sessionId: session.id,
          projectPath: session.project,
          phase,
          valid: isValid,
          errors,
        });

        const checkpointFeed: FeedEventDTO = {
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          sessionName: session.name,
          eventName: isValid ? 'CheckpointValid' : 'CheckpointInvalid',
          toolName: 'Write',
          detail: isValid
            ? `[HARNESS] Checkpoint for ${phase} phase validated — gate pending`
            : `[HARNESS] Checkpoint for ${phase} phase has errors: ${errors.join('; ')}`,
        };
        addFeedEvent(checkpointFeed);
        broadcastFn('feed-event', checkpointFeed);

        // Determine gate type for this transition
        const nextPhase = getNextPhase(harnessState);

        if (isValid && nextPhase) {
          const autoGate = isAutoGate(phase, nextPhase);
          const steercoGate = isSteerCoGate(phase, nextPhase);

          if (!autoGate) {
            // MANUAL GATE — run audit agent + optional SteerCo, then generate HTML review
            const generateHtml = (steercoReview: string | null, auditReport: string | null) => {
              // Combine SteerCo review and audit report for the gate HTML
              let combinedSteerco = steercoReview || '';
              if (auditReport) {
                combinedSteerco = (combinedSteerco ? combinedSteerco + '\n\n---\n\n' : '') +
                  '## Independent Gate Audit\n\n' + auditReport;
              }

              const reviewFile = generateGateReviewHtml(
                harnessState, phase, nextPhase,
                combinedSteerco || null
              );
              if (reviewFile) {
                broadcastFn('gate-review-generated', {
                  sessionId: session.id,
                  projectPath: session.project,
                  phase,
                  nextPhase,
                  reviewFile,
                  hasAudit: !!auditReport,
                  hasSteerCo: !!steercoReview,
                });
                const gateFeed: FeedEventDTO = {
                  timestamp: new Date().toISOString(),
                  sessionId: session.id,
                  sessionName: session.name,
                  eventName: 'GateReviewGenerated',
                  detail: `[HARNESS] Gate review HTML opened for ${phase}→${nextPhase}` +
                    (auditReport ? ' (with audit)' : '') +
                    (steercoReview ? ' (with SteerCo)' : '') +
                    '. Awaiting approval.',
                };
                addFeedEvent(gateFeed);
                broadcastFn('feed-event', gateFeed);
              }
            };

            // Run audit agent and optionally SteerCo in parallel
            const auditPromise = invokeGateAudit(harnessState, phase).catch(() => null);
            const steercoPromise = steercoGate
              ? invokeSteerCoReview(harnessState, phase).then((review) => {
                  if (review) {
                    broadcastFn('steerco-review', {
                      sessionId: session.id,
                      projectPath: session.project,
                      phase,
                      review,
                    });
                  }
                  return review;
                }).catch(() => null)
              : Promise.resolve(null);

            Promise.all([steercoPromise, auditPromise]).then(([steercoReview, auditReport]) => {
              generateHtml(steercoReview, auditReport);
            });
          }
        }

        // F004: Auto-gate handling — if this transition is auto-approved,
        // advance the state and spawn the next phase session immediately.
        // RW-07: Deduplication guard prevents concurrent checkpoint writes from double-advancing.
        const transitionKey = `${session.project}:${phase}→${nextPhase}`;
        if (isValid && nextPhase && isAutoGate(phase, nextPhase) && !transitionInProgress.has(transitionKey)) {
          transitionInProgress.add(transitionKey);
          console.log(`[Harness] Auto-gate: ${phase}→${nextPhase} (auto-approved)`);

          const gateName = `auto:${phase}→${nextPhase}`;
          clearGate(harnessState, gateName, session.id);
          const advanceResult = advancePhase(harnessState, session.id);

          if (!advanceResult.state) {
            console.log(`[Harness] Auto-gate advance failed: ${advanceResult.error}`);
            broadcastFn('harness-advance-failed', {
              projectPath: session.project,
              phase: phase,
              error: advanceResult.error,
            });
          } else {
            const advanced = advanceResult.state;
            broadcastFn('harness-phase-transition', {
              projectPath: session.project,
              nextPhase,
              autoGate: true,
            });

            const autoFeed: FeedEventDTO = {
              timestamp: new Date().toISOString(),
              sessionId: session.id,
              sessionName: session.name,
              eventName: 'AutoGateCleared',
              detail: `[HARNESS] Auto-gate ${phase}→${nextPhase} cleared — advancing to ${nextPhase}`,
            };
            addFeedEvent(autoFeed);
            broadcastFn('feed-event', autoFeed);

            // RISK-05: Set pendingSpawn BEFORE attempting spawn.
            // If spawn fails, this flag stays set so reconciliation can detect it.
            setPendingSpawn(advanced, nextPhase);

            // Spawn the next phase session
            spawnPhaseSession(advanced, nextPhase).then((result) => {
              if (result.success) {
                clearPendingSpawn(advanced); // RISK-05: Spawn succeeded — clear flag
                console.log(`[Harness] Next phase session spawned: ${nextPhase} (PID ${result.pid})`);
              } else {
                // RISK-05: pendingSpawn remains set — dashboard will show stale spawn warning
                console.log(`[Harness] Failed to spawn ${nextPhase} session: ${result.error}`);
                broadcastFn('phase-session-failed', {
                  projectPath: session.project,
                  phase: nextPhase,
                  error: result.error,
                  pendingSpawn: true, // RISK-05: Signal to dashboard
                });
              }
            }).catch((err) => {
              console.error(`[Harness] Session spawn error: ${err}`);
            }).finally(() => {
              transitionInProgress.delete(transitionKey);
            });
          }
        }
      }
    }
  }

  res.json({});
}

function deriveTranscriptPath(sessionId: string, cwd: string): string | null {
  const fs = require('fs');
  const path = require('path');
  const home = process.env.HOME || process.env.USERPROFILE || '';

  // Claude Code stores transcripts at: ~/.claude/projects/{encoded-cwd}/{session-id}.jsonl
  // The encoded cwd replaces path separators and colons with dashes
  const encoded = cwd.replace(/[:\\\/]/g, '-').replace(/^-+/, '');
  const transcriptPath = path.join(home, '.claude', 'projects', encoded, sessionId + '.jsonl');

  if (fs.existsSync(transcriptPath)) {
    return transcriptPath;
  }

  // Try finding the file by scanning project directories
  const projectsDir = path.join(home, '.claude', 'projects');
  if (fs.existsSync(projectsDir)) {
    const dirs = fs.readdirSync(projectsDir);
    for (const dir of dirs) {
      const candidate = path.join(projectsDir, dir, sessionId + '.jsonl');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function getToolDetail(toolName: string, toolInput: Record<string, any>): string {
  if (toolName === 'Bash' && toolInput.command) {
    return String(toolInput.command).substring(0, 120);
  }
  if (toolName === 'Edit' && toolInput.file_path) {
    return String(toolInput.file_path).split(/[/\\]/).pop() || String(toolInput.file_path);
  }
  if (toolName === 'Write' && toolInput.file_path) {
    return String(toolInput.file_path).split(/[/\\]/).pop() || String(toolInput.file_path);
  }
  if (toolName === 'Read' && toolInput.file_path) {
    return String(toolInput.file_path).split(/[/\\]/).pop() || String(toolInput.file_path);
  }
  if (toolName === 'Glob' && toolInput.pattern) {
    return String(toolInput.pattern);
  }
  if (toolName === 'Grep' && toolInput.pattern) {
    return `"${String(toolInput.pattern).substring(0, 60)}"`;
  }
  return JSON.stringify(toolInput).substring(0, 80);
}

function getHumanReadableApproval(toolName: string, toolInput: Record<string, any>): string {
  const fileName = toolInput.file_path ? String(toolInput.file_path).split(/[/\\]/).pop() : null;
  switch (toolName) {
    case 'Bash': {
      const cmd = String(toolInput.command || '').substring(0, 80);
      return `Approved running command: ${cmd}`;
    }
    case 'Edit':
      return `Approved editing ${fileName || 'a file'}`;
    case 'Write':
      return `Approved writing to ${fileName || 'a file'}`;
    case 'Read':
      return `Approved reading ${fileName || 'a file'}`;
    case 'Glob':
      return `Approved file search: ${toolInput.pattern || ''}`;
    case 'Grep':
      return `Approved content search: "${String(toolInput.pattern || '').substring(0, 60)}"`;
    case 'Agent':
      return `Approved launching a sub-agent`;
    case 'WebSearch':
      return `Approved web search`;
    case 'WebFetch':
      return `Approved fetching a web page`;
    case 'Skill':
      return `Approved running skill: ${toolInput.skill || 'unknown'}`;
    default:
      return `Approved ${toolName}: ${getToolDetail(toolName, toolInput)}`;
  }
}
