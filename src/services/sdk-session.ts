import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { TranscriptMessageDTO } from '../types';
import { createSdkSession, getSession, sessionToDTO, addFeedEvent } from '../state/sessions';

type BroadcastFn = (event: string, data: any) => void;

const activeProcesses = new Map<string, ChildProcess>();
let broadcastFn: BroadcastFn;

export function initSdkSessionService(broadcast: BroadcastFn): void {
  broadcastFn = broadcast;
}

export function launchSdkSession(
  projectDir: string,
  name: string | undefined,
  prompt: string,
  permissionMode: string,
): string {
  const sessionId = randomUUID();
  const sessionName = name || projectDir.replace(/[\\/]/g, '/').split('/').filter(Boolean).pop() || 'Session';

  const session = createSdkSession(sessionId, projectDir, sessionName, permissionMode);

  broadcastFn('session-added', sessionToDTO(session));
  broadcastFn('feed-event', {
    timestamp: new Date().toISOString(),
    sessionId,
    sessionName,
    eventName: 'SessionStart',
    detail: 'Dashboard session started',
  });
  addFeedEvent({
    timestamp: new Date().toISOString(),
    sessionId,
    sessionName,
    eventName: 'SessionStart',
    detail: 'Dashboard session started',
  });

  // Emit the user message to transcript
  broadcastFn('session-output', {
    sessionId,
    message: { type: 'user', text: prompt, timestamp: new Date().toISOString() },
  });

  runClaudeProcess(sessionId, projectDir, prompt, permissionMode, true);

  return sessionId;
}

export function sendMessage(sessionId: string, text: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;
  if (session.sessionType !== 'sdk-managed') return false;
  if (activeProcesses.has(sessionId)) return false;

  session.lastActivity = new Date();

  // Emit the user message to transcript
  broadcastFn('session-output', {
    sessionId,
    message: { type: 'user', text, timestamp: new Date().toISOString() },
  });

  runClaudeProcess(sessionId, session.project, text, session.permissionMode, false);
  return true;
}

export function isProcessing(sessionId: string): boolean {
  return activeProcesses.has(sessionId);
}

export function killSession(sessionId: string): void {
  const proc = activeProcesses.get(sessionId);
  if (proc) {
    proc.kill();
    activeProcesses.delete(sessionId);
  }
}

export function killAllSessions(): void {
  for (const [id, proc] of activeProcesses) {
    proc.kill();
    activeProcesses.delete(id);
  }
}

function resolveCwd(cwd: string): string {
  // If already absolute, use as-is
  if (path.isAbsolute(cwd)) return cwd;
  // Try resolving relative to common project roots
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    path.resolve(cwd),
    path.join(home, 'OneDrive - Airedale Catering Equipment', 'Projects', cwd),
    path.join(home, 'OneDrive', 'Projects', cwd),
    path.join(home, 'Projects', cwd),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fall back to resolve from server cwd
  return path.resolve(cwd);
}

function runClaudeProcess(
  sessionId: string,
  cwd: string,
  prompt: string,
  permissionMode: string,
  isFirst: boolean,
): void {
  const resolvedCwd = resolveCwd(cwd);
  console.log(`[SDK-Session] cwd resolved: ${resolvedCwd}`);

  if (!fs.existsSync(resolvedCwd)) {
    console.error(`[SDK-Session] Directory not found: ${resolvedCwd}`);
    const session = getSession(sessionId);
    if (session) {
      session.status = 'errored';
      broadcastFn('session-updated', sessionToDTO(session));
      broadcastFn('session-output', {
        sessionId,
        message: {
          type: 'system',
          text: `Error: Directory not found — ${resolvedCwd}`,
          timestamp: new Date().toISOString(),
        } as TranscriptMessageDTO,
      });
    }
    return;
  }

  const args = [
    '-p', prompt,
    '--output-format', 'stream-json',
    '--verbose',
  ];

  if (isFirst) {
    args.push('--session-id', sessionId);
  } else {
    args.push('--resume', sessionId);
  }

  if (permissionMode && permissionMode !== 'default') {
    args.push('--permission-mode', permissionMode);
  }

  // Claude CLI hangs when spawned directly from Node.js because stdin
  // stays open. Pipe through bash with echo to close stdin properly.
  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const claudeCmd = `claude -p '${escapedPrompt}' --output-format stream-json --verbose`;
  const resumeFlag = isFirst ? `--session-id ${sessionId}` : `--resume ${sessionId}`;
  const permFlag = (permissionMode && permissionMode !== 'default') ? `--permission-mode ${permissionMode}` : '';
  const fullCmd = `echo "" | ${claudeCmd} ${resumeFlag} ${permFlag}`;

  console.log(`[SDK-Session] Spawning in ${resolvedCwd}: claude -p "${prompt.substring(0, 40)}..."`);

  const proc = spawn('bash', ['-c', fullCmd], {
    cwd: resolvedCwd,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  activeProcesses.set(sessionId, proc);

  broadcastFn('session-thinking', { sessionId, thinking: true });

  let stdoutBuffer = '';
  let assistantTextBuffer = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    // Keep the last partial line in the buffer
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        handleStreamEvent(sessionId, event, assistantTextBuffer);

        // Track assistant text for accumulation
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              assistantTextBuffer = block.text;
            }
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    }
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      console.log(`[SDK-Session] ${sessionId.substring(0, 8)} stderr: ${text.substring(0, 200)}`);
    }
  });

  proc.on('close', (code) => {
    activeProcesses.delete(sessionId);
    broadcastFn('session-thinking', { sessionId, thinking: false });

    const session = getSession(sessionId);
    if (session) {
      session.lastActivity = new Date();
      // Don't mark as completed on normal exit — user might send follow-up
      // Only mark errored on non-zero exit
      if (code !== 0 && code !== null) {
        console.log(`[SDK-Session] ${session.name} process exited with code ${code}`);
      }
      broadcastFn('session-updated', sessionToDTO(session));
    }
  });

  proc.on('error', (err) => {
    activeProcesses.delete(sessionId);
    broadcastFn('session-thinking', { sessionId, thinking: false });
    console.error(`[SDK-Session] Process error: ${err.message}`);

    const session = getSession(sessionId);
    if (session) {
      session.status = 'errored';
      broadcastFn('session-updated', sessionToDTO(session));
    }
  });
}

function handleStreamEvent(sessionId: string, event: any, _assistantBuffer: string): void {
  const session = getSession(sessionId);
  if (!session) return;

  session.lastActivity = new Date();

  if (event.type === 'system' && event.subtype === 'init') {
    // Session initialized — update transcript path if available
    console.log(`[SDK-Session] ${session.name} initialized (model: ${event.model || 'unknown'})`);
    broadcastFn('session-output', {
      sessionId,
      message: {
        type: 'system',
        text: `Session started (${event.model || 'Claude'})`,
        timestamp: new Date().toISOString(),
      } as TranscriptMessageDTO,
    });
    return;
  }

  if (event.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        broadcastFn('session-output', {
          sessionId,
          message: {
            type: 'assistant',
            text: block.text,
            timestamp: new Date().toISOString(),
          } as TranscriptMessageDTO,
        });
      }
      if (block.type === 'tool_use') {
        session.toolCount++;
        const detail = getToolDetail(block.name, block.input || {});
        broadcastFn('session-output', {
          sessionId,
          message: {
            type: 'tool_use',
            text: detail,
            toolName: block.name,
            toolId: block.id,
            timestamp: new Date().toISOString(),
          } as TranscriptMessageDTO,
        });

        // Track modified files
        if (['Edit', 'Write'].includes(block.name) && block.input?.file_path) {
          session.filesModified.add(String(block.input.file_path));
        }

        addFeedEvent({
          timestamp: new Date().toISOString(),
          sessionId,
          sessionName: session.name,
          eventName: 'ToolUse',
          toolName: block.name,
          detail,
        });
        broadcastFn('feed-event', {
          timestamp: new Date().toISOString(),
          sessionId,
          sessionName: session.name,
          eventName: 'ToolUse',
          toolName: block.name,
          detail,
        });
      }
    }
    broadcastFn('session-updated', sessionToDTO(session));
    return;
  }

  if (event.type === 'result') {
    broadcastFn('session-thinking', { sessionId, thinking: false });
    if (event.is_error) {
      broadcastFn('session-output', {
        sessionId,
        message: {
          type: 'system',
          text: `Error: ${event.result || 'Unknown error'}`,
          timestamp: new Date().toISOString(),
        } as TranscriptMessageDTO,
      });
    }

    // B010: Capture accurate usage from CLI result event
    if (event.total_cost_usd != null) {
      session.usage.totalCostUSD += event.total_cost_usd;
    }
    if (event.usage) {
      session.usage.inputTokens += event.usage.input_tokens || 0;
      session.usage.outputTokens += event.usage.output_tokens || 0;
      session.usage.cacheReadTokens += event.usage.cache_read_input_tokens || 0;
      session.usage.cacheCreationTokens += event.usage.cache_creation_input_tokens || 0;
    }
    if (event.modelUsage) {
      session.usage.model = Object.keys(event.modelUsage)[0] || null;
    }
    session.usage.lastUpdated = new Date();
    console.log(`[SDK-Session] ${session.name} cost: $${session.usage.totalCostUSD.toFixed(4)} (${session.usage.inputTokens + session.usage.outputTokens} tokens)`);
    broadcastFn('session-usage', { sessionId, usage: session.usage });
    return;
  }
}

function getToolDetail(toolName: string, toolInput: Record<string, any>): string {
  if (toolName === 'Bash' && toolInput.command) {
    return String(toolInput.command).substring(0, 120);
  }
  if (toolInput.file_path) {
    return String(toolInput.file_path).split(/[/\\]/).pop() || String(toolInput.file_path);
  }
  if (toolInput.pattern) {
    return String(toolInput.pattern).substring(0, 60);
  }
  return JSON.stringify(toolInput).substring(0, 80);
}
