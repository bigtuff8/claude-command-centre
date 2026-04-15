import { exec, spawn } from 'child_process';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { registerTerminal } from '../state/sessions';
import { findWindowByTitle } from './focus';

// B002: Resolve launcher path — try common locations
function getLauncherCommand(): string {
  const workspacePath = process.env.CLAUDE_WORKSPACE;
  if (workspacePath) {
    return `node "${join(workspacePath, 'launcher', 'dist', 'index.js')}"`;
  }
  return 'claude';
}

export function spawnSession(projectDir: string, name?: string, prompt?: string, viaLauncher?: boolean): void {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  let fullCmd: string;
  let cwd: string;

  if (viaLauncher) {
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
    // Write a temporary .bat file to avoid all quoting hell with nested cmd /c /k start.
    // The bat sets the window title and runs the command in the correct directory.
    const windowTitle = `CC: ${name || cwd.replace(/.*[\\/]/, '') || 'Session'}`;
    const batPath = join(tmpdir(), `cc-launch-${Date.now()}.bat`);
    const batContent = [
      '@echo off',
      `title ${windowTitle}`,
      `cd /d "${cwd}"`,
      fullCmd,
      `del "${batPath}"`,  // self-cleanup
    ].join('\r\n');

    writeFileSync(batPath, batContent, 'utf-8');
    console.log(`[Spawner] Wrote launch script: ${batPath}`);
    console.log(`[Spawner] Command: ${fullCmd}`);
    console.log(`[Spawner] CWD: ${cwd}`);

    exec(`start "CC-Launch" "${batPath}"`, {
      windowsHide: false,
    });

    // After the window opens, find it by its CC: title and register the PID
    setTimeout(() => {
      findWindowByTitle(windowTitle).then(pid => {
        if (pid) {
          registerTerminal(cwd, pid);
          console.log(`[Spawner] Registered terminal PID ${pid} for ${cwd}`);
        }
      });
    }, 2000);
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
