// Portfolio data types — all prefixed to avoid collision with existing types

export interface PortfolioProject {
  portfolioProjectId: string;          // slugified folder name
  portfolioProjectName: string;        // parsed from PROJECT_STATUS.md or folder name
  portfolioProjectPath: string;        // absolute filesystem path
  portfolioProjectScope: 'work' | 'personal';
  portfolioProjectStatus: string;      // "Active", "Planning", "Blocked", "Paused", "Archived", "Complete"
  portfolioProjectLastActive: string | null;  // ISO date string
  portfolioProjectQuickContext: string | null;
  portfolioProjectCurrentState: string | null;
  portfolioProjectNextSteps: string | null;
  portfolioProjectHasGit: boolean;
  portfolioProjectHasFeatureList: boolean;
  portfolioProjectHasDataDictionary: boolean;
  portfolioProjectHasReviewHtml: boolean;
  portfolioProjectDaysSinceActive: number | null;
  portfolioProjectStaleness: 'fresh' | 'aging' | 'stale' | 'very-stale' | null;
  portfolioProjectFeaturesDone: number | null;
  portfolioProjectFeaturesTotal: number | null;
  portfolioProjectGateType: string | null;        // "Design Gate", "Pre-deployment Gate", etc.
  portfolioProjectGateDate: string | null;         // ISO date
  portfolioProjectReviewHtmlPath: string | null;
  portfolioProjectDataDictionaryUpdated: string | null;  // ISO date from file mtime
  portfolioProjectSessionLogEntries: PortfolioSessionLogEntry[];
  portfolioProjectRecentCommits: PortfolioCommit[];
  portfolioProjectRiskCount: number;
}

export interface PortfolioSessionLogEntry {
  sessionLogDate: string;
  sessionLogSummary: string;
}

export interface PortfolioCommit {
  commitHash: string;
  commitMessage: string;
  commitDate: string;
  commitAuthor: string;
}

export interface PortfolioRisk {
  riskId: string;
  riskDateRaised: string;
  riskProject: string;
  riskPerspective: string;   // "Finance", "Compliance", "Security", "Technical", "Transition", "Product"
  riskDescription: string;
  riskSeverity: string;       // "Critical", "High", "Medium", "Low"
  riskStatus: string;         // "Open", "Accepted", "Mitigated"
  riskMitigation: string | null;
  riskAcceptedBy: string | null;
  riskDateResolved: string | null;
}

export interface PortfolioActivity {
  activityTimestamp: string;   // ISO date
  activityProject: string;
  activityType: 'commit' | 'session' | 'status_change';
  activityDescription: string;
  activityMeta: Record<string, any>;  // hash for commits, duration/tokens for sessions
}

export interface PortfolioAudit {
  auditProjectName: string;
  auditProjectPath: string;
  auditHasDataDictionary: boolean;
  auditDataDictionaryUpdated: string | null;
  auditDataDictionaryFreshness: 'current' | 'stale' | 'missing';
  auditHasStatusFile: boolean;
  auditStatusFileFreshness: 'fresh' | 'stale' | 'very-stale' | 'missing';
  auditHasFeatureList: boolean;
  auditFeaturesDone: number | null;
  auditFeaturesTotal: number | null;
}

export interface PortfolioConfig {
  portfolioProjectRoots: string[];
  portfolioRefreshIntervalMs: number;
  portfolioStalenessThresholds: {
    freshDays: number;    // default 7
    agingDays: number;    // default 14
    staleDays: number;    // default 21
  };
  portfolioMaxCommitsPerRepo: number;  // default 10
}

export interface PortfolioState {
  portfolioProjects: PortfolioProject[];
  portfolioRisks: PortfolioRisk[];
  portfolioActivity: PortfolioActivity[];
  portfolioAudit: PortfolioAudit[];
  portfolioLastSyncTime: string | null;
  portfolioSyncErrors: string[];
  portfolioHealthScore: number;
}
