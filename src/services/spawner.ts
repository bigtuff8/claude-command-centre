// Session Spawner — delegates to shared session-spawn utility
// Retained as a thin wrapper for backward compatibility with existing callers.

import { spawnHappySession, SpawnOptions } from './session-spawn';
import { spawn, exec } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { loadConfig } from '../config';

// B002: Resolve launcher path for "Open Launcher" button
function resolveLauncherPath(): string | null {
  const config = loadConfig();

  if (config.launcherPath) {
    if (existsSync(config.launcherPath)) return config.launcherPath;
  }

  const workspacePath = process.env.CLAUDE_WORKSPACE;
  if (workspacePath) {
    const envPath = join(workspacePath, 'launcher', 'dist', 'index.js');
    if (existsSync(envPath)) return envPath;
  }

  const npmGlobalPath = join(process.env.APPDATA || '', 'npm', 'node_modules', 'claude-launcher', 'dist', 'index.js');
  if (existsSync(npmGlobalPath)) return npmGlobalPath;

  return null;
}

/**
 * Spawn the launcher TUI in a new terminal window.
 * This gives the user the full project selection / harness flow.
 */
export function spawnLauncher(): void {
  const launcherPath = resolveLauncherPath();
  if (!launcherPath) {
    throw new Error('Launcher not found — check launcherPath in config or CLAUDE_WORKSPACE env var');
  }

  console.log(`[Spawner] Opening launcher in new terminal: ${launcherPath}`);

  if (process.platform === 'win32') {
    // Use exec + start to open a new console window for the interactive TUI.
    // start "" "title" opens a new window; the launcher needs its own console for inquirer prompts.
    const cmd = `start "Launcher" node "${launcherPath}"`;
    exec(cmd, (err) => {
      if (err) console.error(`[Spawner] Failed to open launcher: ${err.message}`);
    });
  } else {
    spawn('sh', ['-c', `node "${launcherPath}"`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
}

/**
 * Spawn a session via the shared utility (Happy Coder aware).
 * Replaces the old exec('start ...') approach that destabilised CC.
 */
export async function spawnSession(
  projectDir: string,
  name?: string,
  prompt?: string,
  broadcast?: (event: string, data: any) => void
): Promise<void> {
  const options: SpawnOptions = {
    projectPath: projectDir || process.cwd(),
    displayName: name || projectDir.replace(/.*[\\/]/, '') || 'Session',
    initialMessage: prompt,
  };

  await spawnHappySession(options, broadcast);
}
