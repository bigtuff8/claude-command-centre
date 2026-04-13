import { exec } from 'child_process';
import * as path from 'path';

/**
 * Bring a terminal window to the foreground on Windows.
 * Uses a PowerShell script with Win32 API to force-set the foreground window.
 */
export function focusTerminalWindow(pid: number | null, sessionName: string): boolean {
  if (process.platform !== 'win32') {
    console.log('[Focus] Not on Windows — cannot focus terminal');
    return false;
  }

  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'focus-window.ps1');
  const title = 'Claude Code';

  exec(
    `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -Title "${title}"`,
    (err, stdout) => {
      const result = (stdout || '').trim();
      if (result.startsWith('focused:')) {
        console.log(`[Focus] Brought Claude Code window to front (PID ${result.split(':')[1]})`);
      } else {
        console.log('[Focus] Could not find Claude Code window');
      }
    }
  );

  return true;
}
