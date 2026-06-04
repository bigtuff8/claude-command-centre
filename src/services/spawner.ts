// Session Spawner — delegates to shared session-spawn utility
// Retained as a thin wrapper for backward compatibility with existing callers.

import { spawnHappySession, SpawnOptions } from './session-spawn';
import { join } from 'path';
import { existsSync } from 'fs';
import { loadConfig } from '../config';

// B002: Resolve launcher path (retained for "Open Launcher" button)
export function getLauncherCommand(): string {
  const config = loadConfig();

  if (config.launcherPath) {
    return `node "${config.launcherPath}"`;
  }

  const workspacePath = process.env.CLAUDE_WORKSPACE;
  if (workspacePath) {
    const envPath = join(workspacePath, 'launcher', 'dist', 'index.js');
    if (existsSync(envPath)) {
      return `node "${envPath}"`;
    }
  }

  const npmGlobalPath = join(process.env.APPDATA || '', 'npm', 'node_modules', 'claude-launcher', 'dist', 'index.js');
  if (existsSync(npmGlobalPath)) {
    return `node "${npmGlobalPath}"`;
  }

  console.warn('[Spawner] Could not find launcher — falling back to claude CLI');
  return 'claude';
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
