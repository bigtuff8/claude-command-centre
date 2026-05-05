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
} from './types';
import { isPreviousCheckpointValid } from './checkpoints';

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

// ---- Rule definitions per harness type and phase ----

function getPhaseRules(harnessType: HarnessType, phase: HarnessPhase, mode: string): HarnessRule[] {
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
      // Airedale: must read standards
      if (mode === 'airedale') {
        rules.push({
          ruleType: 'mustReadBefore',
          ruleFile: 'csharp-blazor-standards.md',
          ruleBeforeTools: ['Write', 'Edit'],
          ruleCondition: 'airedale',
        });
      }
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
 */
export function checkPhaseRules(
  state: HarnessState,
  toolName: string,
  toolInput: Record<string, any>,
  filesReadThisSession: Set<string>
): RuleViolation | null {
  // Harness paused — skip all enforcement
  if (state.harnessPaused) return null;

  const rules = getPhaseRules(state.harnessType, state.harnessCurrentPhase, state.harnessMode);

  for (const rule of rules) {
    const violation = evaluateRule(rule, state, toolName, toolInput, filesReadThisSession);
    if (violation) return violation;
  }

  return null;
}

/**
 * Evaluate a single rule against a tool call.
 */
function evaluateRule(
  rule: HarnessRule,
  state: HarnessState,
  toolName: string,
  toolInput: Record<string, any>,
  filesRead: Set<string>
): RuleViolation | null {
  switch (rule.ruleType) {
    case 'mustReadBefore': {
      // Only enforced for the specified tools
      if (!rule.ruleBeforeTools.includes(toolName)) return null;

      // Check if the required file has been read this session
      const hasRead = Array.from(filesRead).some((readPath) =>
        pathEndsWith(readPath, rule.ruleFile)
      );

      if (!hasRead) {
        return {
          violationRule: `mustReadBefore:${rule.ruleFile}`,
          violationReason: `Phase "${state.harnessCurrentPhase}" requires reading "${rule.ruleFile}" before using ${toolName}`,
          violationFix: `Read the file "${rule.ruleFile}" first. This is mandatory for the ${state.harnessCurrentPhase} phase.`,
        };
      }
      return null;
    }

    case 'requireCheckpoint': {
      // Only block non-Read tools
      if (['Read', 'Glob', 'Grep'].includes(toolName)) return null;

      const result = isPreviousCheckpointValid(state.harnessProjectPath, state);
      if (!result.valid) {
        return {
          violationRule: `requireCheckpoint:${rule.ruleCheckpoint}`,
          violationReason: `Phase "${state.harnessCurrentPhase}" requires a valid ${rule.ruleCheckpoint}. Errors: ${result.errors.join('; ')}`,
          violationFix: `Complete the previous phase and ensure ${rule.ruleCheckpoint} is valid.`,
        };
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
        const testReportPath = path.join(state.harnessProjectPath, 'test-report.md');
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

      const artefactPath = path.join(state.harnessProjectPath, rule.ruleFile);
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
