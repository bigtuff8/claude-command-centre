param(
    [string]$Title = "Claude Code",
    [string]$ProjectHint = "",
    [string]$SessionName = ""
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);

    public const byte VK_MENU = 0x12;
    public const uint KEYEVENTF_KEYUP = 0x0002;
}
"@

function Focus-Window($hwnd, $label) {
    [WinFocus]::keybd_event([WinFocus]::VK_MENU, 0, 0, [UIntPtr]::Zero)
    [WinFocus]::keybd_event([WinFocus]::VK_MENU, 0, [WinFocus]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)

    if ([WinFocus]::IsIconic($hwnd)) {
        [WinFocus]::ShowWindow($hwnd, 9) | Out-Null
    }

    [WinFocus]::SetForegroundWindow($hwnd) | Out-Null
    [WinFocus]::BringWindowToTop($hwnd) | Out-Null

    Write-Output "focused:$label"
}

# Gather all visible windows that could be Claude Code terminals
$allWindows = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne ''
}

# Match candidates: PowerShell/cmd windows (where Claude Code sessions run) or CC:-prefixed
# Claude Code sets unpredictable window titles, so we can't filter by title content alone.
# Instead, match by process type and exclude known non-CLI apps.
$candidates = $allWindows | Where-Object {
    ($_.ProcessName -in 'powershell', 'pwsh', 'cmd', 'WindowsTerminal') -or
    $_.MainWindowTitle -like "CC:*"
}

if (-not $candidates -or $candidates.Count -eq 0) {
    Write-Output "not_found"
    exit
}

# If only one candidate, just focus it
if (@($candidates).Count -eq 1) {
    $c = @($candidates)[0]
    Focus-Window $c.MainWindowHandle "$($c.Id):$($c.MainWindowTitle)"
    exit
}

# Multiple candidates — try to disambiguate

# Priority 1: Match "CC: <SessionName>" (dashboard-launched sessions)
if ($SessionName -ne "") {
    $match = $candidates | Where-Object { $_.MainWindowTitle -like "CC: $SessionName*" } | Select-Object -First 1
    if ($match) {
        Focus-Window $match.MainWindowHandle "$($match.Id):$($match.MainWindowTitle)"
        exit
    }
}

# Priority 2: Match window title against last folder of project path
# e.g. project "C:\...\Zendesk Integration\iot-support-dashboard" tries "iot-support-dashboard"
if ($ProjectHint -ne "") {
    $lastFolder = ($ProjectHint -replace '[\\/]+$', '') -replace '.*[\\/]', ''
    if ($lastFolder -ne "") {
        $match = $candidates | Where-Object { $_.MainWindowTitle -like "*$lastFolder*" } | Select-Object -First 1
        if ($match) {
            Focus-Window $match.MainWindowHandle "$($match.Id):$($match.MainWindowTitle)"
            exit
        }
    }

    # Priority 3: Try parent folder name too
    # e.g. "C:\...\Zendesk Integration\iot-support-dashboard" tries "Zendesk Integration"
    $parentPath = ($ProjectHint -replace '[\\/]+$', '') -replace '[\\/][^\\/]+$', ''
    $parentFolder = $parentPath -replace '.*[\\/]', ''
    if ($parentFolder -ne "" -and $parentFolder -ne $lastFolder) {
        $match = $candidates | Where-Object { $_.MainWindowTitle -like "*$parentFolder*" } | Select-Object -First 1
        if ($match) {
            Focus-Window $match.MainWindowHandle "$($match.Id):$($match.MainWindowTitle)"
            exit
        }
    }
}

# Priority 4: Match session name directly against window titles
if ($SessionName -ne "") {
    $match = $candidates | Where-Object { $_.MainWindowTitle -like "*$SessionName*" } | Select-Object -First 1
    if ($match) {
        Focus-Window $match.MainWindowHandle "$($match.Id):$($match.MainWindowTitle)"
        exit
    }
}

# Fallback: first candidate
$first = @($candidates)[0]
Focus-Window $first.MainWindowHandle "$($first.Id):$($first.MainWindowTitle)"
