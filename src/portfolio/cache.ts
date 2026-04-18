import * as fs from 'fs';
import * as path from 'path';
import { PortfolioState, PortfolioConfig, PortfolioProject, PortfolioRisk, PortfolioActivity, PortfolioAudit } from './types';
import { scanProjectDirectories, getGitCommits } from './scanner';
import { parseRiskRegister } from './markdown-parser';

let cachedState: PortfolioState = {
  portfolioProjects: [],
  portfolioRisks: [],
  portfolioActivity: [],
  portfolioAudit: [],
  portfolioLastSyncTime: null,
  portfolioSyncErrors: [],
  portfolioHealthScore: 100,
};

let portfolioConfig: PortfolioConfig | null = null;
let broadcastFn: ((event: string, data: any) => void) | null = null;
let refreshInterval: NodeJS.Timeout | null = null;

export function initPortfolioCache(config: PortfolioConfig, broadcast: (event: string, data: any) => void): void {
  portfolioConfig = config;
  broadcastFn = broadcast;

  console.log('[Portfolio] Initialising portfolio cache');
  console.log(`[Portfolio] Project roots: ${config.portfolioProjectRoots.join(', ')}`);
  console.log(`[Portfolio] Refresh interval: ${config.portfolioRefreshIntervalMs}ms`);

  // Run initial sync immediately
  refreshPortfolioCache();

  // Set up periodic refresh
  const intervalMs = config.portfolioRefreshIntervalMs || 60000;
  refreshInterval = setInterval(() => {
    try {
      refreshPortfolioCache();
    } catch (err: any) {
      console.log(`[Portfolio] Periodic refresh failed: ${err.message}`);
    }
  }, intervalMs);
}

export function getPortfolioState(): PortfolioState {
  return cachedState;
}

export function refreshPortfolioCache(): PortfolioState {
  if (!portfolioConfig) {
    console.log('[Portfolio] Cannot refresh — cache not initialised');
    return cachedState;
  }

  const syncErrors: string[] = [];
  const startTime = Date.now();

  console.log('[Portfolio] Starting portfolio sync...');

  // Scan project directories
  let projects: PortfolioProject[] = [];
  try {
    projects = scanProjectDirectories(portfolioConfig.portfolioProjectRoots, portfolioConfig);
  } catch (err: any) {
    const msg = `Failed to scan project directories: ${err.message}`;
    console.log(`[Portfolio] ${msg}`);
    syncErrors.push(msg);
  }

  // Parse risk register
  let risks: PortfolioRisk[] = [];
  try {
    risks = loadRisks(portfolioConfig);
  } catch (err: any) {
    const msg = `Failed to parse risk register: ${err.message}`;
    console.log(`[Portfolio] ${msg}`);
    syncErrors.push(msg);
  }

  // Build activity feed from git commits and session logs
  let activity: PortfolioActivity[] = [];
  try {
    activity = buildActivityFeed(projects, portfolioConfig);
  } catch (err: any) {
    const msg = `Failed to build activity feed: ${err.message}`;
    console.log(`[Portfolio] ${msg}`);
    syncErrors.push(msg);
  }

  // Build audit data
  let audit: PortfolioAudit[] = [];
  try {
    audit = buildAuditData(projects);
  } catch (err: any) {
    const msg = `Failed to build audit data: ${err.message}`;
    console.log(`[Portfolio] ${msg}`);
    syncErrors.push(msg);
  }

  // Calculate health score
  const healthScore = calculateHealthScore(projects, risks);

  cachedState = {
    portfolioProjects: projects,
    portfolioRisks: risks,
    portfolioActivity: activity,
    portfolioAudit: audit,
    portfolioLastSyncTime: new Date().toISOString(),
    portfolioSyncErrors: syncErrors,
    portfolioHealthScore: healthScore,
  };

  const elapsed = Date.now() - startTime;
  console.log(`[Portfolio] Sync complete in ${elapsed}ms — ${projects.length} projects, ${risks.length} risks, ${activity.length} activities, health: ${healthScore}`);

  if (broadcastFn) {
    broadcastFn('portfolio:update', cachedState);
  }

  return cachedState;
}

export function stopPortfolioCache(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('[Portfolio] Cache refresh stopped');
  }
}

function loadRisks(config: PortfolioConfig): PortfolioRisk[] {
  // Look for risk register at known paths relative to project roots
  for (const root of config.portfolioProjectRoots) {
    const riskPath = path.join(root, 'Claude Agents', 'steerco', 'risk-register.md');
    if (fs.existsSync(riskPath)) {
      console.log(`[Portfolio] Found risk register at: ${riskPath}`);
      const content = fs.readFileSync(riskPath, 'utf-8');
      return parseRiskRegister(content);
    }
  }

  console.log('[Portfolio] No risk register found');
  return [];
}

function buildActivityFeed(projects: PortfolioProject[], config: PortfolioConfig): PortfolioActivity[] {
  const activities: PortfolioActivity[] = [];

  for (const project of projects) {
    // Add git commits as activity entries
    if (project.portfolioProjectHasGit) {
      try {
        const commits = getGitCommits(project.portfolioProjectPath, config.portfolioMaxCommitsPerRepo);
        for (const commit of commits) {
          activities.push({
            activityTimestamp: commit.commitDate,
            activityProject: project.portfolioProjectName,
            activityType: 'commit',
            activityDescription: commit.commitMessage,
            activityMeta: { hash: commit.commitHash, author: commit.commitAuthor },
          });
        }
      } catch (err: any) {
        // Non-fatal — skip this project's commits
        console.log(`[Portfolio] Could not get commits for ${project.portfolioProjectName}: ${err.message}`);
      }
    }

    // Add session log entries as activity entries
    for (const entry of project.portfolioProjectSessionLogEntries) {
      activities.push({
        activityTimestamp: entry.sessionLogDate,
        activityProject: project.portfolioProjectName,
        activityType: 'session',
        activityDescription: entry.sessionLogSummary,
        activityMeta: {},
      });
    }
  }

  // Sort by timestamp descending
  activities.sort((a, b) => {
    const dateA = new Date(a.activityTimestamp).getTime();
    const dateB = new Date(b.activityTimestamp).getTime();
    return dateB - dateA;
  });

  // Cap at 200 entries
  return activities.slice(0, 200);
}

function buildAuditData(projects: PortfolioProject[]): PortfolioAudit[] {
  return projects.map((project) => {
    // Data dictionary freshness
    let auditDataDictionaryFreshness: 'current' | 'stale' | 'missing' = 'missing';
    if (project.portfolioProjectHasDataDictionary && project.portfolioProjectDataDictionaryUpdated) {
      const ddDate = new Date(project.portfolioProjectDataDictionaryUpdated);
      const daysSinceUpdate = (Date.now() - ddDate.getTime()) / (1000 * 60 * 60 * 24);
      auditDataDictionaryFreshness = daysSinceUpdate <= 30 ? 'current' : 'stale';
    }

    // Status file freshness
    let auditStatusFileFreshness: 'fresh' | 'stale' | 'very-stale' | 'missing' = 'missing';
    if (project.portfolioProjectLastActive) {
      const lastActive = new Date(project.portfolioProjectLastActive);
      const daysSince = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince <= 14) {
        auditStatusFileFreshness = 'fresh';
      } else if (daysSince <= 30) {
        auditStatusFileFreshness = 'stale';
      } else {
        auditStatusFileFreshness = 'very-stale';
      }
    }

    return {
      auditProjectName: project.portfolioProjectName,
      auditProjectPath: project.portfolioProjectPath,
      auditHasDataDictionary: project.portfolioProjectHasDataDictionary,
      auditDataDictionaryUpdated: project.portfolioProjectDataDictionaryUpdated,
      auditDataDictionaryFreshness,
      auditHasStatusFile: project.portfolioProjectLastActive !== null,
      auditStatusFileFreshness,
      auditHasFeatureList: project.portfolioProjectHasFeatureList,
      auditFeaturesDone: project.portfolioProjectFeaturesDone,
      auditFeaturesTotal: project.portfolioProjectFeaturesTotal,
    };
  });
}

function calculateHealthScore(projects: PortfolioProject[], risks: PortfolioRisk[]): number {
  let score = 100;

  for (const project of projects) {
    // -5 per project missing DATA_DICTIONARY.md
    if (!project.portfolioProjectHasDataDictionary) {
      score -= 5;
    }

    // -3 per project with stale (>30d) status file
    if (project.portfolioProjectDaysSinceActive !== null && project.portfolioProjectDaysSinceActive > 30) {
      score -= 3;
    }

    // -8 per project missing PROJECT_STATUS.md entirely
    if (project.portfolioProjectLastActive === null && project.portfolioProjectCurrentState === null) {
      score -= 8;
    }
  }

  for (const risk of risks) {
    if (risk.riskStatus === 'Open') {
      if (risk.riskSeverity === 'High' || risk.riskSeverity === 'Critical') {
        // -4 per open high/critical risk
        score -= 4;
      } else if (risk.riskSeverity === 'Medium') {
        // -2 per open medium risk
        score -= 2;
      }
    }
  }

  // Floor at 0, cap at 100
  score = Math.max(0, Math.min(100, score));

  return Math.round(score);
}
