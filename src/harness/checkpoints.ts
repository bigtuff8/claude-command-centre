// Harness Enforcement Engine — Checkpoint Validation
// Validates checkpoint files written by Claude, with server-side artefact checks

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CheckpointData, HarnessPhase, HarnessState } from './types';
import { resolveProjectPath, getArtefactBasePath } from './state';

const HARNESS_DIR = '.harness';

/**
 * Compute SHA-256 hash of a file.
 */
function hashFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * P1 / IM-01 (TOCTOU): Compute the SHA-256 hash of a phase's checkpoint file on disk.
 * The gate review is stamped with this; the approve POST echoes it back and the handler
 * rejects if it no longer matches (the checkpoint changed under the reviewer → re-review).
 * Returns null if the checkpoint file does not exist.
 */
export function computeCheckpointHash(state: HarnessState, phase: HarnessPhase): string | null {
  const artefactBase = getArtefactBasePath(state);
  const checkpointPath = path.join(artefactBase, HARNESS_DIR, `checkpoint-${phase}.json`);
  return hashFile(checkpointPath);
}

/**
 * Read and parse a checkpoint file from the project's .harness/ directory.
 */
export function readCheckpoint(
  state: HarnessState,
  phase: HarnessPhase
): CheckpointData | null {
  const artefactBase = getArtefactBasePath(state);
  const checkpointFile = `checkpoint-${phase}.json`;
  const checkpointPath = path.join(artefactBase, HARNESS_DIR, checkpointFile);

  try {
    if (!fs.existsSync(checkpointPath)) return null;
    const raw = fs.readFileSync(checkpointPath, 'utf-8');
    return JSON.parse(raw) as CheckpointData;
  } catch (err) {
    console.log(`[Harness] Could not read checkpoint ${checkpointFile}: ${err}`);
    return null;
  }
}

/**
 * Validate a checkpoint file against its declared artefacts.
 * Returns an array of validation errors (empty = valid).
 */
export function validateCheckpoint(
  state: HarnessState,
  phase: HarnessPhase
): string[] {
  const artefactBase = getArtefactBasePath(state);
  const errors: string[] = [];
  const checkpoint = readCheckpoint(state, phase);

  if (!checkpoint) {
    errors.push(
      `Checkpoint file for phase "${phase}" does not exist. `
      + `Write checkpoint-${phase}.json to ${path.join(getArtefactBasePath(state), HARNESS_DIR)}/ before advancing.`
    );
    return errors;
  }

  // Schema validation — required fields
  if (!checkpoint.checkpointPhase) {
    errors.push('Missing required field: checkpointPhase');
  } else if (checkpoint.checkpointPhase !== phase) {
    errors.push(`Phase mismatch: checkpoint says "${checkpoint.checkpointPhase}" but expected "${phase}"`);
  }

  if (!checkpoint.checkpointCompletedAt) {
    errors.push('Missing required field: checkpointCompletedAt');
  }

  if (!checkpoint.checkpointHarness) {
    errors.push('Missing required field: checkpointHarness');
  }

  if (!checkpoint.checkpointAgentFile) {
    errors.push('Missing required field: checkpointAgentFile');
  }

  if (!checkpoint.checkpointAgentFileReadConfirmed) {
    errors.push('Agent file was not confirmed as read (checkpointAgentFileReadConfirmed must be true)');
  }

  // Artefact verification — check that declared files exist on disk
  if (checkpoint.checkpointRequiredArtefacts) {
    for (const [name, artefact] of Object.entries(checkpoint.checkpointRequiredArtefacts)) {
      if (!artefact.checkpointArtefactPath) {
        errors.push(`Artefact "${name}": missing path`);
        continue;
      }

      // F001: Resolve cross-machine path mismatches for absolute artefact paths
      const rawPath = path.isAbsolute(artefact.checkpointArtefactPath)
        ? resolveProjectPath(artefact.checkpointArtefactPath)
        : path.join(artefactBase, artefact.checkpointArtefactPath);
      const fullPath = rawPath;

      const exists = fs.existsSync(fullPath);

      if (artefact.checkpointArtefactExists && !exists) {
        errors.push(
          `Artefact "${name}": declared as existing but not found at ${fullPath}. `
          + `Check: does the file exist? Is the path relative to the work folder (${artefactBase})?`
        );
      }

      // Hash verification — if checkpoint declares a hash, verify it
      if (artefact.checkpointArtefactHash && exists) {
        const actualHash = hashFile(fullPath);
        if (actualHash && actualHash !== artefact.checkpointArtefactHash) {
          errors.push(
            `Artefact "${name}": hash mismatch. Declared: ${artefact.checkpointArtefactHash}, Actual: ${actualHash}`
          );
        }
      }
    }
  }

  // Phase-specific validation
  const phaseErrors = validatePhaseSpecific(state, phase, checkpoint);
  errors.push(...phaseErrors);

  return errors;
}

/**
 * Phase-specific validation rules.
 */
function validatePhaseSpecific(
  state: HarnessState,
  phase: HarnessPhase,
  checkpoint: CheckpointData
): string[] {
  const artefactBase = getArtefactBasePath(state);
  // DR-23: PROJECT_STATUS.md and DATA_DICTIONARY.md live at project root, not artefact base
  const projectRoot = state.harnessProjectPath;
  const errors: string[] = [];

  switch (phase) {
    case 'init': {
      // Feature list must exist and have features
      const featureListPath = path.join(artefactBase, 'feature-list.json');
      if (!fs.existsSync(featureListPath)) {
        errors.push('Init checkpoint: feature-list.json does not exist');
      } else {
        try {
          const fl = JSON.parse(fs.readFileSync(featureListPath, 'utf-8'));
          if (!fl.features || !Array.isArray(fl.features) || fl.features.length === 0) {
            errors.push('Init checkpoint: feature-list.json has no features');
          }
        } catch {
          errors.push('Init checkpoint: feature-list.json is not valid JSON');
        }
      }

      // progress.txt must exist
      if (!fs.existsSync(path.join(artefactBase, 'progress.txt'))) {
        errors.push('Init checkpoint: progress.txt does not exist');
      }

      // DR-23: PROJECT_STATUS.md lives at project root
      if (!fs.existsSync(path.join(projectRoot, 'PROJECT_STATUS.md'))) {
        errors.push('Init checkpoint: PROJECT_STATUS.md does not exist');
      }
      break;
    }

    case 'design': {
      // Design spec must exist
      if (!fs.existsSync(path.join(artefactBase, 'design-spec.md'))) {
        errors.push('Design checkpoint: design-spec.md does not exist');
      }

      // User must have confirmed (design gate)
      if (!checkpoint.checkpointUserConfirmed) {
        errors.push('Design checkpoint: Design Gate not cleared (checkpointUserConfirmed must be true)');
      }
      break;
    }

    case 'dev': {
      // Feature list must exist with passes data
      const featureListPath = path.join(artefactBase, 'feature-list.json');
      if (fs.existsSync(featureListPath)) {
        try {
          const fl = JSON.parse(fs.readFileSync(featureListPath, 'utf-8'));
          const criticalFeatures = (fl.features || []).filter(
            (f: any) => f.priority === 'critical'
          );
          const failingCritical = criticalFeatures.filter((f: any) => !f.passes);
          if (failingCritical.length > 0) {
            errors.push(
              `Dev checkpoint: ${failingCritical.length} critical feature(s) not passing: ${failingCritical.map((f: any) => f.id).join(', ')}`
            );
          }
        } catch {
          // Feature list parse error handled elsewhere
        }
      }

      // Code audit must exist and contain mandatory checks
      const codeAuditPath = path.join(artefactBase, 'code-audit.md');
      if (!fs.existsSync(codeAuditPath)) {
        errors.push('Dev checkpoint: code-audit.md does not exist. Run the mandatory code audit.');
      } else {
        const auditContent = fs.readFileSync(codeAuditPath, 'utf-8');
        // Tolerant matching: each mandatory audit topic is satisfied by ANY of its
        // accepted phrasings (case-insensitive regex), not a single exact string.
        // Avoids brittle rejection of semantically-identical wording — e.g.
        // "Secrets / credentials" vs "Secrets or credentials" (the exact bug that
        // silently invalidated a dev checkpoint and stalled a dev→test handoff).
        const requiredChecks: { label: string; pattern: RegExp }[] = [
          { label: 'Functions defined but never called', pattern: /defined but never called|never called|unused (function|code|export|method)/i },
          { label: 'Dead code', pattern: /dead code|unused (function|code|export|method)|unreachable/i },
          { label: 'Secrets or credentials', pattern: /secret|credential|api[\s_-]?key|hardcoded token|password/i },
        ];
        for (const check of requiredChecks) {
          if (!check.pattern.test(auditContent)) {
            errors.push(`Dev checkpoint: code-audit.md missing mandatory check: "${check.label}"`);
          }
        }
      }
      break;
    }

    case 'test': {
      // test-report.md must exist
      if (!fs.existsSync(path.join(artefactBase, 'test-report.md'))) {
        errors.push('Test checkpoint: test-report.md does not exist');
      }

      // verification-report.md must exist and trace feature verification steps
      const verifyPath = path.join(artefactBase, 'verification-report.md');
      if (!fs.existsSync(verifyPath)) {
        errors.push('Test checkpoint: verification-report.md does not exist. Tester must trace every verification step from feature-list.json.');
      } else {
        const verifyContent = fs.readFileSync(verifyPath, 'utf-8');
        // Cross-reference: every feature ID in feature-list.json must appear
        // in the verification report
        const featureListPath = path.join(artefactBase, 'feature-list.json');
        if (fs.existsSync(featureListPath)) {
          try {
            const fl = JSON.parse(fs.readFileSync(featureListPath, 'utf-8'));
            const features = fl.features || [];
            for (const feature of features) {
              if (feature.id && !verifyContent.includes(feature.id)) {
                errors.push(`Test checkpoint: verification-report.md does not reference feature ${feature.id}. Every feature must be explicitly verified.`);
              }
            }
          } catch {
            // Feature list parse error handled elsewhere
          }
        }
      }
      break;
    }

    case 'release': {
      // PROJECT_STATUS.md must be updated
      // DR-23: PROJECT_STATUS.md lives at project root
      if (!fs.existsSync(path.join(projectRoot, 'PROJECT_STATUS.md'))) {
        errors.push('Release checkpoint: PROJECT_STATUS.md does not exist');
      }
      break;
    }
  }

  return errors;
}

/**
 * Check if the previous phase's checkpoint is valid.
 * Used by requireCheckpoint rules.
 */
export function isPreviousCheckpointValid(
  state: HarnessState
): { valid: boolean; errors: string[] } {
  const sequence = require('./types').HARNESS_PHASE_SEQUENCES[state.harnessType];
  if (!sequence) return { valid: false, errors: ['Unknown harness type'] };

  const currentIndex = sequence.indexOf(state.harnessCurrentPhase);
  if (currentIndex <= 0) {
    // Init phase or unknown — no previous checkpoint needed
    return { valid: true, errors: [] };
  }

  const previousPhase = sequence[currentIndex - 1] as HarnessPhase;
  const errors = validateCheckpoint(state, previousPhase);
  return { valid: errors.length === 0, errors };
}
