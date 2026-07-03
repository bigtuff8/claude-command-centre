// Harness Enforcement Engine — Rule Engine
// Phase-specific enforcement rules evaluated on every PreToolUse hook

import * as fs from 'fs';
import * as path from 'path';
import {
  HarnessState,
  HarnessRule,
  HarnessPhase,
  HarnessType,
  RuleViolation,
  PHASE_AGENT_FILES,
  HARNESS_PHASE_SEQUENCES,
} from './types';
import { isPreviousCheckpointValid } from './checkpoints';
import { getArtefactBasePath } from './state';
import { trackEnforcementExemption } from './ledger';

/**
 * Normalise a file path to a suffix for matching.
 * Strips drive letters and converts to forward slashes, then takes
 * the last segments to handle absolute vs relative path variance.
 */
function normalisePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:/, '')
    .toLowerCase();
}

/**
 * Check if a normalised path ends with a given suffix.
 */
function pathEndsWith(fullPath: string, suffix: string): boolean {
  const normFull = normalisePath(fullPath);
  const normSuffix = normalisePath(suffix);
  return normFull.endsWith(normSuffix);
}

/**
 * Check if a file path matches a glob-like pattern.
 * Supports simple patterns: "src/**", "prototype/**", "**\/*.Test*\/**"
 */
function pathMatchesPattern(filePath: string, pattern: string): boolean {
  const normPath = normalisePath(filePath);
  const normPattern = normalisePath(pattern);

  // Handle "src/**" style — match anything under src/
  if (normPattern.endsWith('/**')) {
    const prefix = normPattern.slice(0, -3);
    return normPath.includes('/' + prefix + '/') || normPath.includes(prefix + '/');
  }

  // Handle exact suffix match
  return normPath.includes(normPattern);
}

/**
 * Check if a bash command matches a pattern string.
 */
function bashCommandMatches(command: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(command);
  } catch {
    return command.toLowerCase().includes(pattern.toLowerCase());
  }
}

// ---- GAP-02: Tech-stack detection for conditional standards enforcement ----

/**
 * Check if a project directory contains files with a given extension.
 * Shallow scan of src/ and project root — avoids deep recursion.
 */
function projectHasFileType(projectPath: string, extension: string): boolean {
  const dirsToCheck = [projectPath, path.join(projectPath, 'src')];
  for (const dir of dirsToCheck) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir);
      if (entries.some(e => e.endsWith(extension))) return true;
    } catch { /* skip unreadable dirs */ }
  }
  return false;
}

/**
 * Check if a project uses Cosmos DB by looking for common indicators:
 * - .csproj referencing Microsoft.Azure.Cosmos
 * - appsettings*.json referencing "Cosmos"
 */
function projectHasCosmosUsage(projectPath: string): boolean {
  const srcDir = path.join(projectPath, 'src');
  const dirsToCheck = [projectPath, srcDir];
  for (const dir of dirsToCheck) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (entry.endsWith('.csproj') || entry.startsWith('appsettings')) {
          const content = fs.readFileSync(path.join(dir, entry), 'utf-8');
          if (content.includes('Cosmos') || content.includes('cosmos')) return true;
        }
      }
    } catch { /* skip */ }
  }
  return false;
}

// ---- Rule definitions per harness type and phase ----

function getPhaseRules(harnessType: HarnessType, phase: HarnessPhase, mode: string, projectPath?: string, projectRoot?: string): HarnessRule[] {
  const agentFile = PHASE_AGENT_FILES[phase] || '';
  const rules: HarnessRule[] = [];

  // Universal: must read agent prompt before any writes
  if (agentFile) {
    rules.push({
      ruleType: 'mustReadBefore',
      ruleFile: agentFile,
      ruleBeforeTools: ['Write', 'Edit', 'Bash'],
    });
  }

  // MISSED-01: Must read the formatted phase prompt (written by session-spawn.ts).
  // The --append-system-prompt is flattened for cmd.exe compatibility; this file
  // preserves the structured enforcement notices with headers and bullet points.
  if (projectPath) {
    const phasePromptPath = path.join(projectPath, '.harness', 'phase-prompt.md');
    if (fs.existsSync(phasePromptPath)) {
      rules.push({
        ruleType: 'mustReadBefore',
        ruleFile: 'phase-prompt.md',
        ruleBeforeTools: ['Write', 'Edit', 'Bash'],
      });
    }
  }

  // F008: Must read handoff brief from previous phase (only if the file exists)
  const sequence = HARNESS_PHASE_SEQUENCES[harnessType] || [];
  const phaseIndex = sequence.indexOf(phase);
  if (phaseIndex > 0 && projectPath) {
    const previousPhase = sequence[phaseIndex - 1];
    const handoffFile = `handoff-${previousPhase}.md`;
    // DR-01: Use artefact base path (work folder aware) for handoff location
    const handoffPath = path.join(projectPath, '.harness', handoffFile);
    if (fs.existsSync(handoffPath)) {
      rules.push({
        ruleType: 'mustReadBefore',
        ruleFile: handoffFile,
        ruleBeforeTools: ['Write', 'Edit', 'Bash'],
      });
    }
  }

  // RW-05: Global rule — block direct writes to harness-state.json in ALL phases.
  // The CC manages phase state. Agents must write checkpoints instead.
  rules.push({
    ruleType: 'blockWrite',
    rulePattern: '.harness/harness-state.json',
    ruleReason: 'NEVER write harness-state.json directly. The Command Centre manages phase state. Write your checkpoint file instead — the CC will advance the phase automatically.',
  });

  switch (phase) {
    case 'init':
      // Cannot write code during init
      rules.push({
        ruleType: 'blockWrite',
        rulePattern: 'src/**',
        ruleReason: 'Init phase: no code writing allowed. Initialisation creates artefacts only.',
      });
      // Cannot commit during init
      rules.push({
        ruleType: 'blockBash',
        rulePattern: 'git commit',
        ruleReason: 'Init phase: no commits until dev phase.',
      });
      break;

    case 'design':
      // Must have init checkpoint
      rules.push({
        ruleType: 'requireCheckpoint',
        ruleCheckpoint: 'checkpoint-init.json',
      });
      // Cannot write production code
      rules.push({
        ruleType: 'blockWrite',
        rulePattern: 'src/**',
        ruleExcept: 'prototype/',
        ruleReason: 'Design phase: only prototype files allowed, not production code.',
      });
      break;

    case 'research':
      // Must have init checkpoint
      rules.push({
        ruleType: 'requireCheckpoint',
        ruleCheckpoint: 'checkpoint-init.json',
      });
      break;

    case 'dev':
      // Must have previous phase checkpoint (design for build, research for integration/automation)
      if (harnessType === 'build') {
        rules.push({
          ruleType: 'requireCheckpoint',
          ruleCheckpoint: 'checkpoint-design.json',
        });
        // Must read design spec
        rules.push({
          ruleType: 'mustReadBefore',
          ruleFile: 'design-spec.md',
          ruleBeforeTools: ['Write', 'Edit'],
        });
      } else {
        rules.push({
          ruleType: 'requireCheckpoint',
          ruleCheckpoint: 'checkpoint-research.json',
        });
      }
      // Must read feature list before writing code
      rules.push({
        ruleType: 'mustReadBefore',
        ruleFile: 'feature-list.json',
        ruleBeforeTools: ['Write', 'Edit'],
      });
      // Must read progress file
      rules.push({
        ruleType: 'mustReadBefore',
        ruleFile: 'progress.txt',
        ruleBeforeTools: ['Write', 'Edit'],
      });
      // GAP-02: Airedale mode — enforce reading relevant standards before code writes.
      // csharp-blazor and security always apply. SQL and Cosmos are conditional on
      // project content (detected by file extension presence).
      if (mode === 'airedale') {
        rules.push({
          ruleType: 'mustReadBefore',
          ruleFile: 'csharp-blazor-standards.md',
          ruleBeforeTools: ['Write', 'Edit'],
          ruleCondition: 'airedale',
        });
        rules.push({
          ruleType: 'mustReadBefore',
          ruleFile: 'security-standards.md',
          ruleBeforeTools: ['Write', 'Edit'],
          ruleCondition: 'airedale',
        });
        // Conditional: SQL standards if project has .sql files
        // CT-1: Use projectRoot (actual source directory), not projectPath (artefact base)
        const sourceRoot = projectRoot || projectPath;
        if (sourceRoot && projectHasFileType(sourceRoot, '.sql')) {
          rules.push({
            ruleType: 'mustReadBefore',
            ruleFile: 'sql-standards.md',
            ruleBeforeTools: ['Write', 'Edit'],
          });
        }
        // Conditional: Cosmos DB standards if project references Cosmos
        if (sourceRoot && projectHasCosmosUsage(sourceRoot)) {
          rules.push({
            ruleType: 'mustReadBefore',
            ruleFile: 'cosmosdb-standards.md',
            ruleBeforeTools: ['Write', 'Edit'],
          });
        }
      }
      // Code audit must be written before dev checkpoint.
      // Enforces the Work/CLAUDE.md completion workflow: functions defined
      // but never called, missing error handling, dead code, etc.
      rules.push({
        ruleType: 'requireArtefact',
        ruleFile: 'code-audit.md',
        ruleReason: 'Dev phase: code-audit.md must be written before creating the checkpoint. Run the mandatory code audit per Work/CLAUDE.md completion workflow.',
      });
      break;

    case 'test':
      // Must have dev checkpoint
      rules.push({
        ruleType: 'requireCheckpoint',
        ruleCheckpoint: 'checkpoint-dev.json',
      });
      // Must read testing standards
      rules.push({
        ruleType: 'mustReadBefore',
        ruleFile: 'testing-standards.md',
        ruleBeforeTools: ['Write', 'Edit'],
      });
      // Must read feature list
      rules.push({
        ruleType: 'mustReadBefore',
        ruleFile: 'feature-list.json',
        ruleBeforeTools: ['Write', 'Edit'],
      });
      // Tester cannot modify production code
      rules.push({
        ruleType: 'blockWrite',
        rulePattern: 'src/**',
        ruleExcept: '.Test',
        ruleReason: 'Test phase: tester does not modify production code. Send fixes back to Developer.',
      });
      // test-report.md must exist before checkpoint
      rules.push({
        ruleType: 'requireArtefact',
        ruleFile: 'test-report.md',
        ruleReason: 'Test phase: test-report.md must be written before creating the checkpoint.',
      });
      // Verification report: tester must trace every feature's verification
      // steps from feature-list.json against the actual implementation.
      // This catches the "built but not wired" gap — functions exist but
      // aren't called, endpoints exist but aren't connected, etc.
      rules.push({
        ruleType: 'requireArtefact',
        ruleFile: 'verification-report.md',
        ruleReason: 'Test phase: verification-report.md must be written before creating the checkpoint. Walk through EVERY verification step in feature-list.json and confirm each passes against the actual code/running system.',
      });
      break;

    case 'write':
      // Must have research checkpoint
      rules.push({
        ruleType: 'requireCheckpoint',
        ruleCheckpoint: 'checkpoint-research.json',
      });
      break;

    case 'release':
      // Must have test checkpoint with all pass
      rules.push({
        ruleType: 'requireCheckpoint',
        ruleCheckpoint: 'checkpoint-test.json',
        ruleCondition: 'allPass',
      });
      // Must read release manager prompt
      rules.push({
        ruleType: 'mustReadBefore',
        ruleFile: 'agents/release-manager.md',
        ruleBeforeTools: ['Bash'],
      });
      // Block git push if test-report has failures
      rules.push({
        ruleType: 'blockBash',
        rulePattern: 'git push',
        ruleReason: 'Release phase: cannot push until test-report.md shows all PASS.',
      });
      break;
  }

  return rules;
}

/**
 * Check all phase rules against a tool call.
 * Returns a violation if any rule is broken, or null if all pass.
 * @param artefactBase - Optional artefact base path (work folder aware).
 *   If not provided, derived from state via getArtefactBasePath().
 */
export function checkPhaseRules(
  state: HarnessState,
  toolName: string,
  toolInput: Record<string, any>,
  filesReadThisSession: Set<string>,
  artefactBase?: string
): RuleViolation | null {
  // Harness paused — skip all enforcement
  if (state.harnessPaused) return null;

  const base = artefactBase || getArtefactBasePath(state);

  // DR-06: Block writing artefact files to project root when a work folder is active.
  // This catches the most common agent error: writing to CWD instead of the work folder.
  if (state.harnessWorkFolder && (toolName === 'Write' || toolName === 'Edit')) {
    const targetFile = toolInput.file_path ? String(toolInput.file_path) : '';
    if (targetFile) {
      const PROTECTED_ARTEFACTS = [
        'feature-list.json', 'progress.txt', 'design-spec.md', 'design-research.md',
        'code-audit.md', 'test-report.md', 'verification-report.md', 'release-notes.md',
      ];
      const normTarget = normalisePath(targetFile);
      const normProjectRoot = normalisePath(state.harnessProjectPath);
      for (const artefact of PROTECTED_ARTEFACTS) {
        const projectRootArtefact = normProjectRoot + '/' + artefact;
        if (normTarget.endsWith(projectRootArtefact) || normTarget === projectRootArtefact) {
          // Check it's at project root, not in the work folder
          const normBase = normalisePath(base);
          if (!normTarget.includes(normBase + '/' + artefact)) {
            return {
              violationRule: `blockWrite:project-root-artefact`,
              violationReason: `Work folder is active. "${artefact}" must be written to ${state.harnessWorkFolder}/${artefact}, not the project root.`,
              violationFix: `Write to "${state.harnessWorkFolder}/${artefact}" instead of "${artefact}".`,
            };
          }
        }
      }
    }
  }

  // CT-1: Pass both artefact base (for file checks) and project root (for tech-stack detection)
  const rules = getPhaseRules(state.harnessType, state.harnessCurrentPhase, state.harnessMode, base, state.harnessProjectPath);

  for (const rule of rules) {
    const violation = evaluateRule(rule, state, toolName, toolInput, filesReadThisSession, base);
    if (violation) return violation;
  }

  return null;
}

/**
 * Evaluate a single rule against a tool call.
 * @param artefactBase - The artefact base path (work folder aware)
 */
function evaluateRule(
  rule: HarnessRule,
  state: HarnessState,
  toolName: string,
  toolInput: Record<string, any>,
  filesRead: Set<string>,
  artefactBase?: string
): RuleViolation | null {
  const base = artefactBase || getArtefactBasePath(state);
  switch (rule.ruleType) {
    case 'mustReadBefore': {
      // Only enforced for the specified tools
      if (!rule.ruleBeforeTools.includes(toolName)) return null;

      // F007: Skip mustReadBefore for files outside the project directory.
      // Memory files, docs in other folders, etc. don't need standards enforcement.
      // requireCheckpoint and blockWrite rules are NOT affected by this exemption.
      if ((toolName === 'Write' || toolName === 'Edit') && toolInput.file_path) {
        const targetFile = normalisePath(String(toolInput.file_path));
        const projectRoot = normalisePath(state.harnessProjectPath) + '/';
        if (!targetFile.startsWith(projectRoot)) {
          trackEnforcementExemption();
          return null; // File outside project — exempt from mustReadBefore
        }
      }

      // Check if the required file has been read this session
      const hasRead = Array.from(filesRead).some((readPath) =>
        pathEndsWith(readPath, rule.ruleFile)
      );

      if (!hasRead) {
        // CT-6: Include path hint for standards files so agents know where to find them
        const STANDARDS_PATH_HINT: Record<string, string> = {
          'csharp-blazor-standards.md': '.claude-docs/csharp-blazor-standards.md',
          'security-standards.md': '.claude-docs/security-standards.md',
          'sql-standards.md': '.claude-docs/sql-standards.md',
          'cosmosdb-standards.md': '.claude-docs/cosmosdb-standards.md',
          'testing-standards.md': '.claude-docs/testing-standards.md',
          'zendesk-integration.md': '.claude-docs/zendesk-integration.md',
          'md-standards.md': '.claude-docs/md-standards.md',
        };
        const pathHint = STANDARDS_PATH_HINT[rule.ruleFile];
        const fixMsg = pathHint
          ? `Read "${pathHint}" first (look in the .claude-docs/ directory under the Projects root). This is mandatory for the ${state.harnessCurrentPhase} phase.`
          : `Read the file "${rule.ruleFile}" first. This is mandatory for the ${state.harnessCurrentPhase} phase.`;

        return {
          violationRule: `mustReadBefore:${rule.ruleFile}`,
          violationReason: `Phase "${state.harnessCurrentPhase}" requires reading "${rule.ruleFile}" before using ${toolName}`,
          violationFix: fixMsg,
        };
      }
      return null;
    }

    case 'requireCheckpoint': {
      // Only block non-Read tools
      if (['Read', 'Glob', 'Grep'].includes(toolName)) return null;

      const result = isPreviousCheckpointValid(state);
      if (!result.valid) {
        // Deadlock-prevention: if a phase is entered with an invalid prior checkpoint
        // (e.g. after a manual state edit, or an invalid checkpoint that never advanced),
        // blocking EVERY mutating tool also blocks the edits needed to REPAIR the
        // checkpoint — an unrecoverable lockout. Allow Write/Edit targeting the work
        // folder / .harness so the agent can fix the invalid artefacts (code-audit.md,
        // feature-list.json, the checkpoint itself). Production code (src/**) remains
        // blocked by its own blockWrite rule.
        if ((toolName === 'Write' || toolName === 'Edit') && toolInput.file_path) {
          const target = normalisePath(String(toolInput.file_path));
          const baseNorm = normalisePath(base);
          if (target === baseNorm || target.startsWith(baseNorm + '/') || target.includes('/.harness/')) {
            return null; // recovery write within the work folder — allow
          }
        }
        return {
          violationRule: `requireCheckpoint:${rule.ruleCheckpoint}`,
          violationReason: `Phase "${state.harnessCurrentPhase}" requires a valid ${rule.ruleCheckpoint}. Errors: ${result.errors.join('; ')}`,
          violationFix: `Complete the previous phase and ensure ${rule.ruleCheckpoint} is valid.`,
        };
      }

      // G022: Evaluate allPass condition — release phase requires all features passing
      if (rule.ruleCondition === 'allPass') {
        const featureListPath = path.join(base, 'feature-list.json');
        try {
          if (fs.existsSync(featureListPath)) {
            const fl = JSON.parse(fs.readFileSync(featureListPath, 'utf-8'));
            const failing = (fl.features || []).filter((f: any) => !f.passes);
            if (failing.length > 0) {
              return {
                violationRule: `requireCheckpoint:allPass`,
                violationReason: `Release phase requires all features passing. ${failing.length} feature(s) still failing: ${failing.map((f: any) => f.id).join(', ')}`,
                violationFix: 'Update feature-list.json — all features must have passes: true before release.',
              };
            }
          }
        } catch { /* feature list parse error — let it through, checkpoint validation will catch it */ }
      }

      return null;
    }

    case 'blockWrite': {
      if (toolName !== 'Write' && toolName !== 'Edit') return null;

      const targetFile = toolInput.file_path || '';
      if (!pathMatchesPattern(targetFile, rule.rulePattern)) return null;

      // Check exception
      if (rule.ruleExcept && pathMatchesPattern(targetFile, rule.ruleExcept)) {
        return null;
      }

      return {
        violationRule: `blockWrite:${rule.rulePattern}`,
        violationReason: rule.ruleReason,
        violationFix: `This file cannot be written during the "${state.harnessCurrentPhase}" phase.`,
      };
    }

    case 'blockBash': {
      if (toolName !== 'Bash') return null;

      const command = toolInput.command || '';
      if (!bashCommandMatches(command, rule.rulePattern)) return null;

      // For git push in release, also check test-report.md
      if (rule.rulePattern === 'git push') {
        const testReportPath = path.join(base, 'test-report.md');
        try {
          if (fs.existsSync(testReportPath)) {
            const content = fs.readFileSync(testReportPath, 'utf-8');
            if (!content.includes('FAIL') && content.includes('PASS')) {
              // Test report is clean — allow the push
              return null;
            }
          }
        } catch {
          // Can't read test report — block
        }
      }

      return {
        violationRule: `blockBash:${rule.rulePattern}`,
        violationReason: rule.ruleReason,
        violationFix: `This command is blocked during the "${state.harnessCurrentPhase}" phase.`,
      };
    }

    case 'requireArtefact': {
      // Only check when writing checkpoint files
      if (toolName !== 'Write') return null;
      const targetFile = toolInput.file_path || '';
      if (!pathMatchesPattern(targetFile, '.harness/checkpoint-')) return null;

      const artefactPath = path.join(base, rule.ruleFile);
      if (!fs.existsSync(artefactPath)) {
        return {
          violationRule: `requireArtefact:${rule.ruleFile}`,
          violationReason: rule.ruleReason,
          violationFix: `Create "${rule.ruleFile}" before writing the checkpoint file.`,
        };
      }
      return null;
    }
  }

  return null;
}

/**
 * Get the list of required reads for a phase (for dashboard display).
 */
export function getRequiredReads(
  harnessType: HarnessType,
  phase: HarnessPhase,
  mode: string
): string[] {
  const rules = getPhaseRules(harnessType, phase, mode);
  return rules
    .filter((r): r is Extract<HarnessRule, { ruleType: 'mustReadBefore' }> =>
      r.ruleType === 'mustReadBefore'
    )
    .map((r) => r.ruleFile);
}
