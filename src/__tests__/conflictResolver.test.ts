/**
 * Integration tests — ConflictResolver
 *
 * Covers every cell in the resolution matrix:
 *   - neither file exists
 *   - only local exists
 *   - only brain exists
 *   - both unchanged (no-op)
 *   - only local changed
 *   - only brain changed
 *   - true conflict: local newer
 *   - true conflict: brain newer
 *   - true conflict: exact mtime tie → local wins
 *   - true conflict: both changed, brain mtime much older (local still wins)
 */

import * as path from 'path';
import { FileHashIndex } from '../fileHashIndex';
import { ConflictResolver } from '../conflictResolver';
import {
    makeTempDir,
    writeFile,
    writeFileWithMtime,
} from './helpers';

describe('ConflictResolver', () => {
    let tmpDir: ReturnType<typeof makeTempDir>;
    let index: FileHashIndex;
    let resolver: ConflictResolver;

    beforeEach(() => {
        tmpDir = makeTempDir('cr');
        index = new FileHashIndex();
        resolver = new ConflictResolver(index);
    });

    afterEach(() => tmpDir.cleanup());

    // ── Existence-only cases ───────────────────────────────────────────

    it('returns winner=none when neither file exists', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('none');
        expect(result.reason).toMatch(/Neither file exists/i);
    });

    it('returns winner=brain when file only exists in brain', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        writeFile(brain, 'brain only');

        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('brain');
        expect(result.reason).toMatch(/only exists in the brain/i);
    });

    it('returns winner=local when file only exists locally', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        writeFile(local, 'local only');

        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('local');
        expect(result.reason).toMatch(/only exists locally/i);
    });

    // ── Both exist, index comparisons ──────────────────────────────────

    it('returns winner=none when both files match their snapshot', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        writeFile(local, 'same');
        writeFile(brain, 'same');
        // Snapshot both — neither has changed since
        index.snapshot(local);
        index.snapshot(brain);

        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('none');
        expect(result.reason).toMatch(/match their last snapshot/i);
    });

    it('returns winner=local when only local changed', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        const BASE = Date.now() - 20_000;

        writeFileWithMtime(local, 'original', BASE);
        writeFileWithMtime(brain, 'original', BASE);
        index.snapshot(local);
        index.snapshot(brain);

        // Mutate only local
        writeFile(local, 'updated locally');

        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('local');
        expect(result.reason).toMatch(/only local file changed/i);
    });

    it('returns winner=brain when only brain changed', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        const BASE = Date.now() - 20_000;

        writeFileWithMtime(local, 'original', BASE);
        writeFileWithMtime(brain, 'original', BASE);
        index.snapshot(local);
        index.snapshot(brain);

        // Mutate only brain
        writeFile(brain, 'updated in brain');

        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('brain');
        expect(result.reason).toMatch(/only brain file changed/i);
    });

    // ── True conflicts ─────────────────────────────────────────────────

    it('returns winner=local when both changed and local is newer', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        const BASE = Date.now() - 30_000;

        writeFileWithMtime(local, 'base', BASE);
        writeFileWithMtime(brain, 'base', BASE);
        index.snapshot(local);
        index.snapshot(brain);

        const brainTime = Date.now() - 10_000;
        const localTime = Date.now() - 1_000;          // local is newest

        writeFileWithMtime(brain, 'brain edit', brainTime);
        writeFileWithMtime(local, 'local edit', localTime);

        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('local');
        expect(result.reason).toMatch(/local is newer/i);
    });

    it('returns winner=brain when both changed and brain is newer', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        const BASE = Date.now() - 30_000;

        writeFileWithMtime(local, 'base', BASE);
        writeFileWithMtime(brain, 'base', BASE);
        index.snapshot(local);
        index.snapshot(brain);

        const localTime = Date.now() - 10_000;
        const brainTime = Date.now() - 1_000;          // brain is newest

        writeFileWithMtime(local, 'local edit', localTime);
        writeFileWithMtime(brain, 'brain edit', brainTime);

        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('brain');
        expect(result.reason).toMatch(/brain is newer/i);
    });

    it('returns winner=local on exact mtime tie (tie-break rule)', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        const BASE = Date.now() - 20_000;

        writeFileWithMtime(local, 'base', BASE);
        writeFileWithMtime(brain, 'base', BASE);
        index.snapshot(local);
        index.snapshot(brain);

        // Both written at the exact same mtime
        const TIE = Date.now();
        writeFileWithMtime(local, 'local edit', TIE);
        writeFileWithMtime(brain, 'brain edit', TIE);

        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('local');
        expect(result.reason).toMatch(/equal/i);
    });

    it('returns winner=local even when brain mtime is much older in a true conflict', () => {
        const local = path.join(tmpDir.root, 'local', 'file.ts');
        const brain = path.join(tmpDir.root, 'brain', 'file.ts');
        const BASE = Date.now() - 60_000;

        writeFileWithMtime(local, 'base', BASE);
        writeFileWithMtime(brain, 'base', BASE);
        index.snapshot(local);
        index.snapshot(brain);

        // Brain changed but set to a time far in the past; local is clearly newer
        writeFileWithMtime(brain, 'stale brain edit', Date.now() - 50_000);
        writeFileWithMtime(local, 'fresh local edit', Date.now() - 100);

        const result = resolver.resolve(local, brain);
        expect(result.winner).toBe('local');
    });

    // ── Edge: files with identical content but different mtimes ────────

    it('treats identical-content files as changed if mtime differs from snapshot', () => {
        const local = path.join(tmpDir.root, 'local', 'same.ts');
        const brain = path.join(tmpDir.root, 'brain', 'same.ts');
        const BASE = Date.now() - 10_000;

        writeFileWithMtime(local, 'identical content', BASE);
        writeFileWithMtime(brain, 'identical content', BASE);
        index.snapshot(local);
        index.snapshot(brain);

        // Touch local — mtime advances but content is unchanged
        writeFile(local, 'identical content');

        // hasChanged should catch the mtime change
        expect(index.hasChanged(local)).toBe(true);

        const result = resolver.resolve(local, brain);
        // local changed (mtime bumped), brain did not → local wins
        expect(result.winner).toBe('local');
    });
});
