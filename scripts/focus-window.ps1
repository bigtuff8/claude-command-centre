param([string]$Title = "Claude Code")

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public const byte VK_MENU = 0x12;
    public const uint KEYEVENTF_KEYUP = 0x0002;
}

[StructLayout(LayoutKind.Sequential)]
public struct INPUT {
    public uint type;
    public INPUTUNION u;
}

[StructLayout(LayoutKind.Explicit)]
public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT ki;
}

[StructLayout(LayoutKind.Sequential)]
public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
}
"@

$proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*$Title*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
    $hwnd = $proc.MainWindowHandle

    # Simulate Alt key press+release to release the foreground lock
    # This tricks Windows into allowing SetForegroundWindow from a background process
    [WinFocus]::keybd_event([WinFocus]::VK_MENU, 0, 0, [UIntPtr]::Zero)
    [WinFocus]::keybd_event([WinFocus]::VK_MENU, 0, [WinFocus]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)

    # Restore if minimised
    if ([WinFocus]::IsIconic($hwnd)) {
        [WinFocus]::ShowWindow($hwnd, 9) | Out-Null
    }

    # Now set foreground — should succeed after the Alt key trick
    [WinFocus]::SetForegroundWindow($hwnd) | Out-Null
    [WinFocus]::BringWindowToTop($hwnd) | Out-Null

    Write-Output "focused:$($proc.Id)"
} else {
    Write-Output "not_found"
}
