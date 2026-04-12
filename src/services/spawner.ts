import { spawn } from 'child_process';

export function spawnSession(projectDir: string, name?: string, prompt?: string): void {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  let claudeCmd = 'claude';
  const args: string[] = [];
  if (name) { args.push('--name', name); }
  if (prompt) { args.push(prompt); }

  const fullCmd = [claudeCmd, ...args].join(' ');

  if (isWindows) {
    // Open in a new Windows Terminal window
    spawn('cmd', ['/c', 'start', 'wt', '-d', projectDir, 'cmd', '/k', fullCmd], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else if (isMac) {
    // macOS: open in Terminal.app
    const script = `tell application "Terminal" to do script "cd '${projectDir}' && ${fullCmd}"`;
    spawn('osascript', ['-e', script], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    // Linux: try common terminal emulators
    spawn('x-terminal-emulator', ['-e', `bash -c 'cd "${projectDir}" && ${fullCmd}'`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
}
