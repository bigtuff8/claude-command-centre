import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { PortfolioProject, PortfolioCommit, PortfolioConfig } from './types';
import { parseProjectStatus, parseFeatureList } from './markdown-parser';

const LOG_PREFIX = '[Portfolio]';

/**
 * Scan configured root directories and build a list of portfolio projects.
 * Never throws — individual project failures are caught and logged.
 */
export function scanProjectDirectories(roots: string[], config: PortfolioConfig): PortfolioProject[] {
  const projects: PortfolioProject[] = [];

  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) {
        console.warn(`${LOG_PREFIX} Root directory does not exist: ${root}`);
        continue;
      }

      const scope = determineScope(root, roots);
      const entries = listDirectories(root);

      for (const entry of entries) {
        const dirPath = path.join(root, entry);

        // Check if this directory itself is a project
        const project = tryBuildProject(dirPath, entry, scope, config);
        if (project) {
          projects.push(project);
        }

        // Check for nested projects (2 levels deep max)
        try {
          const subEntries = listDirectories(dirPath);
          for (const subEntry of subEntries) {
            const subDirPath = path.join(dirPath, subEntry);
            const statusPath = path.join(subDirPath, 'PROJECT_STATUS.md');

            if (fs.existsSync(statusPath)) {
              const nestedProject = tryBuildProject(subDirPath, subEntry, scope, config);
              if (nestedProject) {
                projects.push(nestedProject);
              }
            }
          }
        } catch {
          // Nested scan failed — skip silently
        }
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Error scanning root ${root}:`, err);
    }
  }

  // Sort: gate items first, then by lastActive descending
  projects.sort((a, b) => {
    // Gate items first
    if (a.portfolioProjectGateType && !b.portfolioProjectGateType) return -1;
    if (!a.portfolioProjectGateType && b.portfolioProjectGateType) return 1;

    // Then by lastActive descending (most recent first), nulls last
    if (a.portfolioProjectLastActive && b.portfolioProjectLastActive) {
      return b.portfolioProjectLastActive.localeCompare(a.portfolioProjectLastActive);
    }
    if (a.portfolioProjectLastActive && !b.portfolioProjectLastActive) return -1;
    if (!a.portfolioProjectLastActive && b.portfolioProjectLastActive) return 1;

    return 0;
  });

  return projects;
}

/**
 * List immediate subdirectories of a directory (not recursive).
 */
function listDirectories(dirPath: string): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Determine project scope based on which root the path falls under.
 * Defaults to 'work' if ambiguous.
 */
function determineScope(rootPath: string, allRoots: string[]): 'work' | 'personal' {
  const normalised = rootPath.toLowerCase().replace(/\\/g, '/');
  if (normalised.includes('/personal')) return 'personal';
  return 'work';
}

/**
 * Attempt to build a PortfolioProject from a directory.
 * Returns null if the directory doesn't look like a project (no PROJECT_STATUS.md and no .git).
 */
function tryBuildProject(
  dirPath: string,
  folderName: string,
  scope: 'work' | 'personal',
  config: PortfolioConfig
): PortfolioProject | null {
  try {
    const statusPath = path.join(dirPath, 'PROJECT_STATUS.md');
    const gitPath = path.join(dirPath, '.git');
    const hasStatusFile = fs.existsSync(statusPath);
    const hasGit = fs.existsSync(gitPath);

    // Skip directories that don't look like projects
    if (!hasStatusFile && !hasGit) {
      return null;
    }

    // Parse PROJECT_STATUS.md
    const statusData = hasStatusFile
      ? parseProjectStatus(statusPath)
      : {
          name: null,
          status: null,
          lastActive: null,
          quickContext: null,
          currentState: null,
          nextSteps: null,
          sessionLog: [],
          gateType: null,
          gateDate: null,
        };

    // Check for feature list files
    const featureListPath = path.join(dirPath, 'feature-list.json');
    const portfolioFeatureListPath = path.join(dirPath, 'portfolio-feature-list.json');
    let featureData: { done: number; total: number } | null = null;
    if (fs.existsSync(featureListPath)) {
      featureData = parseFeatureList(featureListPath);
    } else if (fs.existsSync(portfolioFeatureListPath)) {
      featureData = parseFeatureList(portfolioFeatureListPath);
    }

    // Check for DATA_DICTIONARY.md
    const dataDictPath = path.join(dirPath, 'DATA_DICTIONARY.md');
    const hasDataDictionary = fs.existsSync(dataDictPath);
    let dataDictionaryUpdated: string | null = null;
    if (hasDataDictionary) {
      try {
        const stat = fs.statSync(dataDictPath);
        dataDictionaryUpdated = stat.mtime.toISOString();
      } catch {
        // Could not stat file
      }
    }

    // Check for review HTML files
    let hasReviewHtml = false;
    let reviewHtmlPath: string | null = null;
    const reviewCandidates = [
      path.join(dirPath, 'review.html'),
      path.join(dirPath, 'prototype', 'index.html'),
    ];
    for (const candidate of reviewCandidates) {
      if (fs.existsSync(candidate)) {
        hasReviewHtml = true;
        reviewHtmlPath = candidate;
        break;
      }
    }

    // Calculate staleness
    const lastActive = statusData.lastActive;
    const daysSinceActive = calculateDaysSinceActive(lastActive);
    const staleness = calculateStaleness(daysSinceActive, config.portfolioStalenessThresholds);

    // Slugify the folder name for the ID
    const projectId = slugify(folderName);

    return {
      portfolioProjectId: projectId,
      portfolioProjectName: statusData.name || folderName,
      portfolioProjectPath: dirPath,
      portfolioProjectScope: scope,
      portfolioProjectStatus: statusData.status || 'Unknown',
      portfolioProjectLastActive: lastActive,
      portfolioProjectQuickContext: statusData.quickContext,
      portfolioProjectCurrentState: statusData.currentState,
      portfolioProjectNextSteps: statusData.nextSteps,
      portfolioProjectHasGit: hasGit,
      portfolioProjectHasFeatureList: featureData !== null,
      portfolioProjectHasDataDictionary: hasDataDictionary,
      portfolioProjectHasReviewHtml: hasReviewHtml,
      portfolioProjectDaysSinceActive: daysSinceActive,
      portfolioProjectStaleness: staleness,
      portfolioProjectFeaturesDone: featureData?.done ?? null,
      portfolioProjectFeaturesTotal: featureData?.total ?? null,
      portfolioProjectGateType: statusData.gateType,
      portfolioProjectGateDate: statusData.gateDate,
      portfolioProjectReviewHtmlPath: reviewHtmlPath,
      portfolioProjectDataDictionaryUpdated: dataDictionaryUpdated,
      portfolioProjectSessionLogEntries: statusData.sessionLog.map((entry) => ({
        sessionLogDate: entry.date,
        sessionLogSummary: entry.summary,
      })),
      portfolioProjectRecentCommits: [],  // Populated separately via getGitCommits
      portfolioProjectRiskCount: 0,       // Populated separately from risk register
    };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error building project from ${dirPath}:`, err);
    return null;
  }
}

/**
 * Calculate the number of days since the last active date.
 * Returns null if the date can't be parsed.
 */
function calculateDaysSinceActive(lastActive: string | null): number | null {
  if (!lastActive) return null;

  try {
    // Try ISO date first (YYYY-MM-DD or YYYY-MM-DD HH:MM)
    let date = new Date(lastActive);

    // If that failed, try informal date parsing
    if (isNaN(date.getTime())) {
      // Handle "April 2026" style dates — use first of the month
      const monthYearMatch = lastActive.match(
        /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$/i
      );
      if (monthYearMatch) {
        date = new Date(`${monthYearMatch[1]} 1, ${monthYearMatch[2]}`);
      }
    }

    if (isNaN(date.getTime())) return null;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Calculate staleness category based on days since last activity.
 */
function calculateStaleness(
  days: number | null,
  thresholds: PortfolioConfig['portfolioStalenessThresholds']
): 'fresh' | 'aging' | 'stale' | 'very-stale' | null {
  if (days === null) return null;
  if (days <= thresholds.freshDays) return 'fresh';
  if (days <= thresholds.agingDays) return 'aging';
  if (days <= thresholds.staleDays) return 'stale';
  return 'very-stale';
}

/**
 * Convert a folder name to a URL-safe slug.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Get recent git commits for a project directory.
 * Never throws — returns empty array on any error.
 */
export function getGitCommits(projectPath: string, maxCommits: number): PortfolioCommit[] {
  try {
    const gitPath = path.join(projectPath, '.git');
    if (!fs.existsSync(gitPath)) {
      return [];
    }

    const output = execSync(
      `git -C "${projectPath}" log --oneline --format="%H|%s|%ai|%an" -${maxCommits}`,
      {
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    const commits: PortfolioCommit[] = [];
    const lines = output.trim().split(/\r?\n/);

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split('|');
      if (parts.length < 4) continue;

      commits.push({
        commitHash: parts[0].substring(0, 7),
        commitMessage: parts[1],
        commitDate: parts[2],
        commitAuthor: parts.slice(3).join('|'),  // Author name might contain |
      });
    }

    return commits;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Could not get git commits for ${projectPath}:`, err);
    return [];
  }
}
