import { exec } from 'child_process';
import { lookupTerminalPid } from '../state/sessions';

/** Encode a PowerShell script as Base64 for -EncodedCommand (avoids all quoting issues) */
function encodePsCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Walk the process tree upward from a known PID to find the ancestor
 * that has a visible window (MainWindowHandle != 0).
 * Returns the window-owning process's PID, or null.
 */
export function resolveTerminalWindowPid(startPid: number): Promise<number | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);

  return new Promise((resolve) => {
    const ps = `
$cur = ${startPid}
for ($i = 0; $i -lt 8; $i++) {
    $p = Get-Process -Id $cur -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0 -and $p.MainWindowTitle -ne '') {
        Write-Output "$cur|$($p.MainWindowTitle)"
        exit
    }
    $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $cur" -ErrorAction SilentlyContinue
    if (-not $wmi -or $wmi.ParentProcessId -eq 0 -or $wmi.ParentProcessId -eq $cur) { break }
    $cur = $wmi.ParentProcessId
}
Write-Output "not_found"
    `.trim();

    exec(`powershell -EncodedCommand ${encodePsCommand(ps)}`, { timeout: 5000 }, (err, stdout) => {
      const result = (stdout || '').trim();
      if (result === 'not_found' || !result) {
        resolve(null);
        return;
      }
      const [pidStr, ...titleParts] = result.split('|');
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {
        resolve(null);
      } else {
        const title = titleParts.join('|');
        console.log(`[Focus] Resolved PID ${startPid} → window PID ${pid} (${title})`);
        resolve(pid);
      }
    });
  });
}

/**
 * Find a window by a substring in its title. Used for dashboard-spawned sessions
 * where we set a known title like "CC: <name>".
 */
export function findWindowByTitle(titleSubstring: string): Promise<number | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);

  return new Promise((resolve) => {
    const ps = `Get-Process | Where-Object { $_.MainWindowTitle -like '*${titleSubstring}*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1 -ExpandProperty Id`;
    exec(`powershell -EncodedCommand ${encodePsCommand(ps)}`, { timeout: 3000 }, (err, stdout) => {
      const pid = parseInt((stdout || '').trim(), 10);
      resolve(isNaN(pid) ? null : pid);
    });
  });
}

/**
 * Bring a terminal window to the foreground on Windows.
 * Uses the stored terminalPid, or checks the registry, or gives up.
 */
export function focusTerminalWindow(pid: number | null, sessionName: string, projectPath?: string): boolean {
  if (process.platform !== 'win32') {
    console.log('[Focus] Not on Windows');
    return false;
  }

  // Try stored PID first
  if (pid) {
    focusByPid(pid, sessionName);
    return true;
  }

  // Try registry lookup
  if (projectPath) {
    const registeredPid = lookupTerminalPid(projectPath);
    if (registeredPid) {
      focusByPid(registeredPid, sessionName);
      return true;
    }
  }

  console.log(`[Focus] No terminal PID for ${sessionName}`);
  return false;
}

function focusByPid(pid: number, label: string): void {
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WF {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
"@
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($p -and $p.MainWindowHandle -ne 0) {
    [WF]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    [WF]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    if ([WF]::IsIconic($p.MainWindowHandle)) { [WF]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }
    [WF]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    [WF]::BringWindowToTop($p.MainWindowHandle) | Out-Null
    Write-Output "focused:$($p.Id):$($p.MainWindowTitle)"
} else { Write-Output "not_found:${pid}" }
  `.trim();

  exec(`powershell -EncodedCommand ${encodePsCommand(ps)}`, (_err, stdout) => {
    console.log(`[Focus] ${(stdout || '').trim()} (${label})`);
  });
}
