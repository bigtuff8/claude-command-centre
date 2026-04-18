import * as fs from 'fs';
import { PortfolioRisk } from './types';

const LOG_PREFIX = '[Portfolio]';

/**
 * Parse a PROJECT_STATUS.md file into structured data.
 * Never throws — returns nulls and empty arrays on any error.
 */
export function parseProjectStatus(filePath: string): {
  name: string | null;
  status: string | null;
  lastActive: string | null;
  quickContext: string | null;
  currentState: string | null;
  nextSteps: string | null;
  sessionLog: Array<{ date: string; summary: string }>;
  gateType: string | null;
  gateDate: string | null;
} {
  const empty = {
    name: null as string | null,
    status: null as string | null,
    lastActive: null as string | null,
    quickContext: null as string | null,
    currentState: null as string | null,
    nextSteps: null as string | null,
    sessionLog: [] as Array<{ date: string; summary: string }>,
    gateType: null as string | null,
    gateDate: null as string | null,
  };

  let content: string;
  try {
    if (!fs.existsSync(filePath)) {
      return empty;
    }
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`${LOG_PREFIX} Could not read ${filePath}:`, err);
    return empty;
  }

  try {
    const result = { ...empty };
    const lines = content.split(/\r?\n/);

    // Parse the H1 title as project name
    const h1Match = content.match(/^#\s+(.+)/m);
    if (h1Match) {
      result.name = h1Match[1].trim();
    }

    // Parse frontmatter-style bold fields: **Key:** Value
    result.status = extractBoldField(content, 'Status');
    result.lastActive = extractBoldField(content, 'Last Active');
    result.quickContext = extractBoldField(content, 'Quick Context');

    // Parse sections by ## headers
    const sections = parseSections(lines);

    result.currentState = sections['current state'] || null;
    result.nextSteps = sections['next steps'] || null;

    // Parse session log table
    const sessionLogText = sections['session log'];
    if (sessionLogText) {
      result.sessionLog = parseSessionLogTable(sessionLogText);
    }

    // Gate detection — scan current state and next steps for gate keywords
    const gateText = [result.currentState, result.nextSteps]
      .filter(Boolean)
      .join('\n');
    const gateInfo = detectGate(gateText);
    result.gateType = gateInfo.type;
    result.gateDate = gateInfo.date;

    return result;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error parsing ${filePath}:`, err);
    return empty;
  }
}

/**
 * Extract a value from a bold field pattern like **Status:** Active
 */
function extractBoldField(content: string, fieldName: string): string | null {
  // Match **FieldName:** followed by the value (rest of line)
  const pattern = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i');
  const match = content.match(pattern);
  if (match) {
    return match[1].trim();
  }
  return null;
}

/**
 * Split markdown content into sections keyed by lowercase ## header name.
 * Section value is the text content between headers (excluding the header line itself).
 */
function parseSections(lines: string[]): Record<string, string> {
  const sections: Record<string, string> = {};
  let currentSection: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      // Save previous section
      if (currentSection !== null) {
        sections[currentSection] = currentLines.join('\n').trim();
      }
      currentSection = headerMatch[1].trim().toLowerCase();
      currentLines = [];
    } else if (currentSection !== null) {
      currentLines.push(line);
    }
  }

  // Save last section
  if (currentSection !== null) {
    sections[currentSection] = currentLines.join('\n').trim();
  }

  return sections;
}

/**
 * Parse a markdown table from the Session Log section.
 * Expects rows like: | 2026-04-15 | Did some work |
 */
function parseSessionLogTable(text: string): Array<{ date: string; summary: string }> {
  const entries: Array<{ date: string; summary: string }> = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    // Skip non-table lines, header separators, and header rows
    if (!line.trim().startsWith('|')) continue;
    if (line.includes('---')) continue;

    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cells.length < 2) continue;

    // Skip the header row (heuristic: if first cell looks like "Date" or "date")
    if (/^date$/i.test(cells[0])) continue;

    entries.push({
      date: cells[0],
      summary: cells.slice(1).join(' | '),
    });
  }

  return entries;
}

/**
 * Detect governance gate references in text.
 * Returns the gate type and an associated date if found.
 */
function detectGate(text: string): { type: string | null; date: string | null } {
  if (!text) return { type: null, date: null };

  const lowerText = text.toLowerCase();

  // Ordered by specificity — match the most specific gate type first
  const gatePatterns: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /pre-deployment\s+gate/i, type: 'Pre-deployment Gate' },
    { pattern: /deployment\s+gate/i, type: 'Deployment Gate' },
    { pattern: /design\s+gate/i, type: 'Design Gate' },
    { pattern: /design\s+approval/i, type: 'Design Gate' },
    { pattern: /pre-deployment/i, type: 'Pre-deployment Gate' },
    { pattern: /waiting\s+for\s+approval/i, type: 'Approval Gate' },
    { pattern: /steerco\s+review/i, type: 'SteerCo Review' },
    { pattern: /gate\s+review/i, type: 'Gate Review' },
    { pattern: /\bgate\b/i, type: 'Gate Review' },
  ];

  let gateType: string | null = null;
  for (const { pattern, type } of gatePatterns) {
    if (pattern.test(text)) {
      gateType = type;
      break;
    }
  }

  if (!gateType) return { type: null, date: null };

  // Try to find a date near the gate mention
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  const gateDate = dateMatch ? dateMatch[1] : null;

  return { type: gateType, date: gateDate };
}

/**
 * Parse a risk-register.md file into PortfolioRisk objects.
 * Never throws — returns empty array on any error.
 */
export function parseRiskRegister(filePath: string): PortfolioRisk[] {
  let content: string;
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.warn(`${LOG_PREFIX} Could not read risk register ${filePath}:`, err);
    return [];
  }

  try {
    const risks: PortfolioRisk[] = [];
    const lines = content.split(/\r?\n/);

    // Track which section we're in based on ## headers
    let currentSection: 'open' | 'accepted' | 'mitigated' | null = null;

    for (const line of lines) {
      // Detect section headers
      const headerMatch = line.match(/^##\s+(.+)/i);
      if (headerMatch) {
        const header = headerMatch[1].trim().toLowerCase();
        if (header.includes('open')) {
          currentSection = 'open';
        } else if (header.includes('accepted')) {
          currentSection = 'accepted';
        } else if (header.includes('mitigated')) {
          currentSection = 'mitigated';
        } else {
          currentSection = null;
        }
        continue;
      }

      // Skip non-table lines, separators, and header rows
      if (!line.trim().startsWith('|')) continue;
      if (line.includes('---')) continue;

      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length < 3) continue;

      // Skip header rows (heuristic: if first cell is "ID" or similar)
      if (/^id$/i.test(cells[0])) continue;

      const risk = parseRiskRow(cells, currentSection);
      if (risk) {
        risks.push(risk);
      }
    }

    return risks;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error parsing risk register ${filePath}:`, err);
    return [];
  }
}

/**
 * Parse a single table row into a PortfolioRisk based on the section it belongs to.
 */
function parseRiskRow(cells: string[], section: 'open' | 'accepted' | 'mitigated' | null): PortfolioRisk | null {
  if (!section) return null;

  const safeGet = (index: number): string | null => {
    if (index >= cells.length) return null;
    const val = cells[index].trim();
    return val.length > 0 ? val : null;
  };

  try {
    if (section === 'open') {
      // Columns: ID | Date Raised | Project | Perspective | Description | Severity | Status | Notes
      return {
        riskId: safeGet(0) || `unknown-${Date.now()}`,
        riskDateRaised: safeGet(1) || '',
        riskProject: safeGet(2) || '',
        riskPerspective: safeGet(3) || '',
        riskDescription: safeGet(4) || '',
        riskSeverity: safeGet(5) || '',
        riskStatus: safeGet(6) || 'Open',
        riskMitigation: safeGet(7) || null,
        riskAcceptedBy: null,
        riskDateResolved: null,
      };
    }

    if (section === 'accepted') {
      // Columns: ID | Date Raised | Project | Perspective | Description | Accepted By | Rationale | Date Accepted
      return {
        riskId: safeGet(0) || `unknown-${Date.now()}`,
        riskDateRaised: safeGet(1) || '',
        riskProject: safeGet(2) || '',
        riskPerspective: safeGet(3) || '',
        riskDescription: safeGet(4) || '',
        riskSeverity: '',
        riskStatus: 'Accepted',
        riskMitigation: safeGet(6) || null,  // Rationale as mitigation
        riskAcceptedBy: safeGet(5) || null,
        riskDateResolved: safeGet(7) || null,
      };
    }

    if (section === 'mitigated') {
      // Columns: ID | Date Raised | Project | Perspective | Description | Mitigation | Date Mitigated
      return {
        riskId: safeGet(0) || `unknown-${Date.now()}`,
        riskDateRaised: safeGet(1) || '',
        riskProject: safeGet(2) || '',
        riskPerspective: safeGet(3) || '',
        riskDescription: safeGet(4) || '',
        riskSeverity: '',
        riskStatus: 'Mitigated',
        riskMitigation: safeGet(5) || null,
        riskAcceptedBy: null,
        riskDateResolved: safeGet(6) || null,
      };
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error parsing risk row:`, err);
  }

  return null;
}

/**
 * Parse a feature-list.json or portfolio-feature-list.json file.
 * Returns done/total counts, or null if the file can't be read or parsed.
 */
export function parseFeatureList(filePath: string): { done: number; total: number } | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Expect an array of features, each with a `passes` boolean
    if (!Array.isArray(data)) {
      console.warn(`${LOG_PREFIX} Feature list at ${filePath} is not an array`);
      return null;
    }

    const total = data.length;
    const done = data.filter((feature: any) => feature.passes === true).length;

    return { done, total };
  } catch (err) {
    console.warn(`${LOG_PREFIX} Could not parse feature list ${filePath}:`, err);
    return null;
  }
}
