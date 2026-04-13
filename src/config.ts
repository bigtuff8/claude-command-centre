import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types';

const DEFAULT_CONFIG: AppConfig = {
  host: 'localhost',
  port: 4111,
  permissionTimeoutSeconds: 60,
  notifications: {
    enabled: true,
    sound: true,
  },
  autoPassTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
  maxEventsPerSession: 200,
  maxTotalFeedEvents: 500,
  openBrowser: true,
};

let configPath: string;

function getConfigDir(): string {
  if (process.env.COMMAND_CENTRE_CONFIG) {
    return path.dirname(process.env.COMMAND_CENTRE_CONFIG);
  }
  // Use the project directory for portable config
  return path.resolve(__dirname, '..');
}

export function getConfigPath(): string {
  if (!configPath) {
    if (process.env.COMMAND_CENTRE_CONFIG) {
      configPath = process.env.COMMAND_CENTRE_CONFIG;
    } else {
      configPath = path.join(getConfigDir(), 'config.json');
    }
  }
  return configPath;
}

export function loadConfig(): AppConfig {
  const filePath = getConfigPath();

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const userConfig = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...userConfig, notifications: { ...DEFAULT_CONFIG.notifications, ...userConfig.notifications } };
    } catch {
      console.warn(`Warning: Could not parse ${filePath}, using defaults.`);
      return { ...DEFAULT_CONFIG };
    }
  }

  // Auto-create config with defaults on first run
  try {
    fs.writeFileSync(filePath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    console.log(`Created default config at ${filePath}`);
  } catch {
    console.warn(`Warning: Could not write default config to ${filePath}`);
  }

  return { ...DEFAULT_CONFIG };
}
