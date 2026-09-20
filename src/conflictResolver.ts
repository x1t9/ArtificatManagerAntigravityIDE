/**
 * ConflictResolver
 * ────────────────
 * Determines which copy of a file wins when both the local artifact folder
 * and the Antigravity brain folder have been modified since the last sync.
 *
 * Resolution matrix
 * ─────────────────
 *  | local changed | brain changed | outcome          |
 *  |───────────────|───────────────|──────────────────|
 *  |      yes      |      no       | local wins       |
 *  |      no       |      yes      | brain wins       |
 *  |      yes      |      yes      | newer mtime wins |
 *  |      no       |      no       | no-op (none)     |
 *
 * Tie-breaking: when both mtimes are equal to the millisecond, local wins
 * under the assumption that a local editor write is the "primary" intent.
 */

import * as fs from 'fs';
import { FileHashIndex } from './fileHashIndex';
import { ConflictResolution } from './types';

export class ConflictResolver {
    private index: FileHashIndex;

    constructor(index: FileHashIndex) {
        this.index = index;
    }

    /**
     * Resolve which side wins for a given file pair.
     *
     * @param localPath  Absolute path to the file in the local artifact folder.
     * @param brainPath  Absolute path to the corresponding file in the brain folder.
     */
    public resolve(localPath: string, brainPath: string): ConflictResolution {
        const localExists = fs.existsSync(localPath);
        const brainExists = fs.existsSync(brainPath);

        // ── Existence-only cases ────────────────────────────────────────
        if (!localExists && !brainExists) {
            return { winner: 'none', reason: 'Neither file exists on disk.' };
        }

        if (!localExists && brainExists) {
            return { winner: 'brain', reason: 'File only exists in the brain; copy to local.' };
        }

        if (localExists && !brainExists) {
            return { winner: 'local', reason: 'File only exists locally; copy to brain.' };
        }

        // Both exist — compare against index snapshots
        const localChanged = this.index.hasChanged(localPath);
        const brainChanged = this.index.hasChanged(brainPath);

        if (!localChanged && !brainChanged) {
            return { winner: 'none', reason: 'Both files match their last snapshot; no sync needed.' };
        }

        if (localChanged && !brainChanged) {
            return { winner: 'local', reason: 'Only local file changed since last sync.' };
        }

        if (!localChanged && brainChanged) {
            return { winner: 'brain', reason: 'Only brain file changed since last sync.' };
        }

        // ── True conflict: both sides changed ───────────────────────────
        return this.resolveTrueConflict(localPath, brainPath);
    }

    /**
     * Resolve when both sides are genuinely dirty by comparing mtimes.
     * The newer file wins; local wins on an exact tie.
     */
    private resolveTrueConflict(localPath: string, brainPath: string): ConflictResolution {
        let localMtime = 0;
        let brainMtime = 0;

        try {
            localMtime = fs.statSync(localPath).mtimeMs;
        } catch { /* leave 0 */ }

        try {
            brainMtime = fs.statSync(brainPath).mtimeMs;
        } catch { /* leave 0 */ }

        if (localMtime > brainMtime) {
            return {
                winner: 'local',
                reason: `True conflict: local is newer (local=${localMtime} > brain=${brainMtime}).`,
            };
        }

        if (brainMtime > localMtime) {
            return {
                winner: 'brain',
                reason: `True conflict: brain is newer (brain=${brainMtime} > local=${localMtime}).`,
            };
        }

        // Exact mtime tie → local wins as primary
        return {
            winner: 'local',
            reason: `True conflict: mtimes are equal (${localMtime}); defaulting to local as primary.`,
        };
    }
}
