import * as fs from 'fs';
import * as path from 'path';
import { Session, SessionUsage, HookEvent, FeedEventDTO } from '../types';
import { getAllSessions, getSessionsMap, restoreSession, restoreFeedEvents, getFeedEvents } from './sessions';

const STATE_VERSION = 1;
const SAVE_INTERVAL_MS = 30000;

let dataDir: string;
let statePath: string;
let dirty = false;
let saveInterval: NodeJS.Timeout | null = null;

export function markDirty(): void {
  dirty = true;
}

export function initPersistence(projectRoot: string): void {
  dataDir = path.join(projectRoot, 'data');
  statePath = path.join(dataDir, 'state.json');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Start auto-save interval
  saveInterval = setInterval(() => {
    if (dirty) {
      saveState();
      dirty = false;
    }
  }, SAVE_INTERVAL_MS);
}

export function loadState(): number {
  if (!statePath || !fs.existsSync(statePath)) {
    console.log('[Persistence] No state file found — starting fresh');
    return 0;
  }

  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);

    if (state.version !== STATE_VERSION) {
      console.warn(`[Persistence] Unknown state version ${state.version} — starting fresh`);
      return 0;
    }

    let restoredCount = 0;

    // Restore sessions
    if (Array.isArray(state.sessions)) {
      for (const s of state.sessions) {
        // Normalise status — active/waiting sessions are dead after restart
        if (s.status === 'active' || s.status === 'waiting') {
          s.status = 'completed';
        }

        const session: Session = {
          id: s.id,
          name: s.name,
          project: s.project,
          status: s.status,
          sessionType: s.sessionType || 'hook-monitored',
          permissionMode: s.permissionMode || 'default',
          startedAt: new Date(s.startedAt),
          lastActivity: new Date(s.lastActivity),
          toolCount: s.toolCount || 0,
          filesModified: new Set(s.filesModified || []),
          events: (s.events || []).map((e: any) => ({
            ...e,
            timestamp: new Date(e.timestamp),
          })),
          pendingPermission: null,
          transcriptPath: s.transcriptPath || null,
          terminalPid: null, // stale after restart
          usage: s.usage || { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalCostUSD: 0, model: null, lastUpdated: null },
          autoApprove: s.autoApprove ?? null,
        };

        // Convert usage.lastUpdated string back to Date
        if (session.usage.lastUpdated && typeof session.usage.lastUpdated === 'string') {
          session.usage.lastUpdated = new Date(session.usage.lastUpdated);
        }

        restoreSession(session);
        restoredCount++;
      }
    }

    // Restore feed events
    if (Array.isArray(state.feedEvents)) {
      restoreFeedEvents(state.feedEvents);
    }

    console.log(`[Persistence] Restored ${restoredCount} sessions, ${(state.feedEvents || []).length} feed events`);
    return restoredCount;
  } catch (err: any) {
    console.warn(`[Persistence] Failed to load state: ${err.message}`);
    return 0;
  }
}

export function saveState(): void {
  if (!statePath) return;

  const sessions = getAllSessions();
  const feedEvts = getFeedEvents();

  const serialisableSessions = sessions.map(s => ({
    id: s.id,
    name: s.name,
    project: s.project,
    status: s.status,
    sessionType: s.sessionType,
    permissionMode: s.permissionMode,
    startedAt: s.startedAt.toISOString(),
    lastActivity: s.lastActivity.toISOString(),
    toolCount: s.toolCount,
    filesModified: Array.from(s.filesModified),
    events: s.events.slice(-50).map(e => ({
      ...e,
      timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : e.timestamp,
    })),
    transcriptPath: s.transcriptPath,
    usage: {
      ...s.usage,
      lastUpdated: s.usage.lastUpdated instanceof Date ? s.usage.lastUpdated.toISOString() : s.usage.lastUpdated,
    },
    autoApprove: s.autoApprove,
  }));

  const state = {
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    sessions: serialisableSessions,
    feedEvents: feedEvts.slice(0, 200), // Cap at 200 for file size
  };

  try {
    const tmpPath = statePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);
  } catch (err: any) {
    console.warn(`[Persistence] Failed to save state: ${err.message}`);
  }
}

export function stopPersistence(): void {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
  // Final save
  saveState();
}
