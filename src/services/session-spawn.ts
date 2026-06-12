// Shared Session Spawn Utility
// All session spawn paths (launcher, orchestrator, dashboard) route through here.
// Prefers Happy Coder CLI for session visibility, falls back to claude CLI.

import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

export interface SpawnOptions {
  projectPath: string;
  displayName: string;
  systemPrompt?: string;
  initialMessage?: string;
  workFolderPath?: string;
  harnessContext?: {
    type: string;
    phase: string;
    mode: string;
  };
}

export interface SpawnResult {
  pid: number;
  displayName: string;
  spawnedAt: string;
  command: 'happy' | 'claude';
  degraded: boolean;
}

/**
 * Resolve whether to use 'happy' or 'claude' CLI.
 * Checks if happy is on PATH and the server is reachable.
 */
async function resolveCommand(): Promise<{ command: string; isHappy: boolean }> {
  try {
    // Check if happy CLI is available
    const which = spawn(process.platform === 'win32' ? 'where' : 'which', ['happy'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const found = await new Promise<boolean>((resolve) => {
      which.on('close', (code) => resolve(code === 0));
      which.on('error', () => resolve(false));
    });

    if (!found) return { command: 'claude', isHappy: false };

    // Quick health check on the server (100ms timeout)
    const http = require('http');
    const healthy = await new Promise<boolean>((resolve) => {
      const req = http.get('http://localhost:3005/health', { timeout: 100 }, (res: any) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });

    return healthy
      ? { command: 'happy', isHappy: true }
      : { command: 'claude', isHappy: false };
  } catch {
    return { command: 'claude', isHappy: false };
  }
}

/**
 * Escape a command argument for cmd.exe (F015 pattern).
 */
export function escapeCmdArg(arg: string): string {
  // cmd.exe uses doubled-quotes inside double-quoted strings, not backslash-quote.
  // Also escape % to prevent environment variable expansion.
  // Aligned with launcher.ts:203-204.
  return '"' + arg.replace(/"/g, '""').replace(/%/g, '%%') + '"';
}

/**
 * Spawn a session via Happy Coder or Claude CLI.
 * Uses F015 pattern on Windows for safe argument passing.
 */
export async function spawnHappySession(
  options: SpawnOptions,
  broadcast?: (event: string, data: any) => void
): Promise<SpawnResult> {
  const { command, isHappy } = await resolveCommand();
  const degraded = !isHappy;

  // Build arguments
  const args: string[] = [];

  if (isHappy && options.displayName) {
    args.push('--display-name', options.displayName);
  }

  if (options.systemPrompt) {
    const promptContent = options.systemPrompt.replace(/\r?\n/g, ' ');
    args.push('--append-system-prompt', promptContent);
  }

  if (options.initialMessage) {
    args.push(options.initialMessage);
  }

  // Spawn with platform-specific handling
  let child: ChildProcess;
  const cwd = options.projectPath;

  if (process.platform === 'win32') {
    // F015: Windows spawn pattern
    const fullCmd = [command, ...args.map(a => escapeCmdArg(a))].join(' ');
    child = spawn(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', fullCmd], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      windowsVerbatimArguments: true,
    } as any);
  } else {
    child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
    });
  }

  child.unref();
  const pid = child.pid || 0;
  const spawnedAt = new Date().toISOString();

  // DR-12: Emit degradation event if fell back to claude
  if (degraded && broadcast) {
    broadcast('session-spawn-degraded', {
      displayName: options.displayName,
      command,
      reason: 'Happy CLI unavailable, fell back to claude',
      spawnedAt,
    });
  }

  console.log(`[SessionSpawn] ${options.displayName} via ${command} (PID ${pid}, degraded: ${degraded})`);

  return { pid, displayName: options.displayName, spawnedAt, command: isHappy ? 'happy' : 'claude', degraded };
}
