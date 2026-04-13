import { AppConfig } from '../types';
import { exec } from 'child_process';

let config: AppConfig;
let notifier: any;
let dashboardUrl: string;

export function initNotifications(appConfig: AppConfig): void {
  config = appConfig;
  dashboardUrl = `http://localhost:${config.port}`;
  if (config.notifications.enabled) {
    try {
      notifier = require('node-notifier');
    } catch {
      console.warn('node-notifier not available — desktop notifications disabled.');
    }
  }
}

function openDashboard(): void {
  exec(`start "" "${dashboardUrl}"`, { windowsHide: true });
}

export function notifyPermissionRequest(sessionName: string, toolName: string, toolInput: Record<string, any>): void {
  if (!notifier || !config.notifications.enabled) return;

  const inputSummary = getInputSummary(toolName, toolInput);

  notifier.notify({
    title: `${sessionName} needs permission`,
    message: `${toolName}: ${inputSummary}`,
    sound: config.notifications.sound,
    wait: true,
    appID: 'Command Centre',
  }, (_err: any, response: string) => {
    if (response === 'activate') openDashboard();
  });
}

export function notifySessionComplete(sessionName: string): void {
  if (!notifier || !config.notifications.enabled) return;

  notifier.notify({
    title: 'Session completed',
    message: sessionName,
    sound: false,
    wait: true,
    appID: 'Command Centre',
  }, (_err: any, response: string) => {
    if (response === 'activate') openDashboard();
  });
}

export function notifyError(sessionName: string, detail: string): void {
  if (!notifier || !config.notifications.enabled) return;

  notifier.notify({
    title: `${sessionName} error`,
    message: detail,
    sound: config.notifications.sound,
    wait: true,
    appID: 'Command Centre',
  }, (_err: any, response: string) => {
    if (response === 'activate') openDashboard();
  });
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
