import { spawn } from 'child_process';
import { join } from 'path';

// B002: Resolve launcher path — try common locations
function getLauncherCommand(): string {
  // The launcher is a TypeScript project that compiles to dist/index.js
  // Try workspace-relative path first (matches launcher config)
  const workspacePath = process.env.CLAUDE_WORKSPACE;
  if (workspacePath) {
    return `node "${join(workspacePath, 'launcher', 'dist', 'index.js')}"`;
  }
  // Fallback: assume launcher is on PATH as 'claude-launcher' or just spawn raw claude
  return 'claude';
}

export function spawnSession(projectDir: string, name?: string, prompt?: string, viaLauncher?: boolean): void {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  let fullCmd: string;
  let cwd: string;

  if (viaLauncher) {
    // B002: Open launcher in a new terminal
    fullCmd = getLauncherCommand();
    cwd = projectDir || process.cwd();
  } else {
    let claudeCmd = 'claude';
    const args: string[] = [];
    if (name) { args.push('--name', name); }
    if (prompt) { args.push(prompt); }
    fullCmd = [claudeCmd, ...args].join(' ');
    cwd = projectDir;
  }

  if (isWindows) {
    spawn('cmd', ['/c', 'start', '""', '/d', cwd, 'cmd', '/k', fullCmd], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else if (isMac) {
    const script = `tell application "Terminal" to do script "cd '${cwd}' && ${fullCmd}"`;
    spawn('osascript', ['-e', script], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    spawn('x-terminal-emulator', ['-e', `bash -c 'cd "${cwd}" && ${fullCmd}'`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
}
