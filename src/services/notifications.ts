import { AppConfig } from '../types';
import { exec } from 'child_process';

let config: AppConfig;
let dashboardUrl: string;

export function initNotifications(appConfig: AppConfig): void {
  config = appConfig;
  dashboardUrl = `http://localhost:${config.port}`;
}

/**
 * B011: PowerShell-based Windows toast notifications.
 * Uses native Windows.UI.Notifications API via PowerShell.
 * Click opens the dashboard URL in the default browser (handled by Windows, not a callback).
 * Works from Action Centre even hours after the toast was shown.
 */
function showToast(title: string, message: string, sound: boolean): void {
  if (!config.notifications.enabled) return;
  if (process.platform !== 'win32') return;

  const safeTitle = escapeXml(title);
  const safeMessage = escapeXml(message);
  const silent = sound ? 'false' : 'true';

  const toastXml = `<toast launch="${dashboardUrl}" activationType="protocol"><visual><binding template="ToastGeneric"><text>${safeTitle}</text><text>${safeMessage}</text></binding></visual><audio silent="${silent}" /></toast>`;

  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
$xml.LoadXml('${toastXml.replace(/'/g, "''")}')
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Command Centre').Show($toast)
`;

  exec(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`, { windowsHide: true }, (err) => {
    if (err) console.warn(`[Notification] Toast failed: ${err.message.substring(0, 100)}`);
  });
}

export function notifyPermissionRequest(sessionName: string, toolName: string, toolInput: Record<string, any>): void {
  const inputSummary = getInputSummary(toolName, toolInput);
  showToast(`${sessionName} needs permission`, `${toolName}: ${inputSummary}`, config.notifications.sound);
}

export function notifySessionComplete(sessionName: string): void {
  showToast('Session completed', sessionName, false);
}

export function notifyError(sessionName: string, detail: string): void {
  showToast(`${sessionName} error`, detail, config.notifications.sound);
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function getInputSummary(toolName: string, toolInput: Record<string, any>): string {
  if (toolName === 'Bash' && toolInput.command) {
    return String(toolInput.command).substring(0, 100);
  }
  if (toolInput.file_path) {
    return String(toolInput.file_path).substring(0, 100);
  }
  if (toolInput.pattern) {
    return String(toolInput.pattern).substring(0, 100);
  }
  return JSON.stringify(toolInput).substring(0, 100);
}
