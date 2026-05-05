// Harness Enforcement Engine — Checkpoint Validation
// Validates checkpoint files written by Claude, with server-side artefact checks

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CheckpointData, HarnessPhase, HarnessState } from './types';

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
 * Read and parse a checkpoint file from the project's .harness/ directory.
 */
export function readCheckpoint(
  projectPath: string,
  phase: HarnessPhase
): CheckpointData | null {
  const checkpointFile = `checkpoint-${phase}.json`;
  const checkpointPath = path.join(projectPath, HARNESS_DIR, checkpointFile);

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
  projectPath: string,
  phase: HarnessPhase
): string[] {
  const errors: string[] = [];
  const checkpoint = readCheckpoint(projectPath, phase);

  if (!checkpoint) {
    errors.push(`Checkpoint file for phase "${phase}" does not exist`);
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

      const fullPath = path.isAbsolute(artefact.checkpointArtefactPath)
        ? artefact.checkpointArtefactPath
        : path.join(projectPath, artefact.checkpointArtefactPath);

      const exists = fs.existsSync(fullPath);

      if (artefact.checkpointArtefactExists && !exists) {
        errors.push(`Artefact "${name}": declared as existing but file not found at ${artefact.checkpointArtefactPath}`);
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
  const phaseErrors = validatePhaseSpecific(projectPath, phase, checkpoint);
  errors.push(...phaseErrors);

  return errors;
}

/**
 * Phase-specific validation rules.
 */
function validatePhaseSpecific(
  projectPath: string,
  phase: HarnessPhase,
  checkpoint: CheckpointData
): string[] {
  const errors: string[] = [];

  switch (phase) {
    case 'init': {
      // Feature list must exist and have features
      const featureListPath = path.join(projectPath, 'feature-list.json');
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
      if (!fs.existsSync(path.join(projectPath, 'progress.txt'))) {
        errors.push('Init checkpoint: progress.txt does not exist');
      }

      // PROJECT_STATUS.md must exist
      if (!fs.existsSync(path.join(projectPath, 'PROJECT_STATUS.md'))) {
        errors.push('Init checkpoint: PROJECT_STATUS.md does not exist');
      }
      break;
    }

    case 'design': {
      // Design spec must exist
      if (!fs.existsSync(path.join(projectPath, 'design-spec.md'))) {
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
      const featureListPath = path.join(projectPath, 'feature-list.json');
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
      break;
    }

    case 'test': {
      // test-report.md must exist
      if (!fs.existsSync(path.join(projectPath, 'test-report.md'))) {
        errors.push('Test checkpoint: test-report.md does not exist');
      }
      break;
    }

    case 'release': {
      // PROJECT_STATUS.md must be updated
      if (!fs.existsSync(path.join(projectPath, 'PROJECT_STATUS.md'))) {
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
  projectPath: string,
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
  const errors = validateCheckpoint(projectPath, previousPhase);
  return { valid: errors.length === 0, errors };
}
