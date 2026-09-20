/**
 * Integration tests — FileHashIndex
 *
 * Covers:
 *  - snapshot() on existing / missing files
 *  - hasChanged() detection via mtime and content hash
 *  - snapshotDirectory() recursion and extension exclusion
 *  - evict() and clear()
 *  - size and keys()
 */

import * as fs from 'fs';
import * as path from 'path';
import { FileHashIndex } from '../fileHashIndex';
import {
    makeTempDir,
    writeFile,
    writeFileWithMtime,
    getMtime,
} from './helpers';

describe('FileHashIndex', () => {
    let tmpDir: ReturnType<typeof makeTempDir>;
    let index: FileHashIndex;

    beforeEach(() => {
        tmpDir = makeTempDir('fhi');
        index = new FileHashIndex();
    });

    afterEach(() => tmpDir.cleanup());

    // ── snapshot() ─────────────────────────────────────────────────────

    describe('snapshot()', () => {
        it('returns a record with correct mtime for an existing file', () => {
            const file = path.join(tmpDir.root, 'hello.ts');
            writeFile(file, 'const x = 1;');
            const record = index.snapshot(file);
            expect(record).not.toBeNull();
            expect(record!.absolutePath).toBe(file);
            expect(record!.mtimeMs).toBe(getMtime(file));
            expect(record!.contentHash).toHaveLength(8);
        });

        it('returns null for a non-existent file', () => {
            const result = index.snapshot(path.join(tmpDir.root, 'ghost.ts'));
            expect(result).toBeNull();
        });

        it('updates an existing entry on re-snapshot', () => {
            const file = path.join(tmpDir.root, 'update.ts');
            writeFileWithMtime(file, 'v1', Date.now() - 5000);
            const r1 = index.snapshot(file);

            writeFile(file, 'v2');
            const r2 = index.snapshot(file);

            expect(r2!.mtimeMs).toBeGreaterThan(r1!.mtimeMs);
            expect(r2!.contentHash).not.toBe(r1!.contentHash);
        });

        it('stores a non-empty hash even for an empty file', () => {
            const file = path.join(tmpDir.root, 'empty.ts');
            writeFile(file, '');
            const record = index.snapshot(file);
            expect(record).not.toBeNull();
            expect(record!.contentHash).toHaveLength(8);
        });
    });

    // ── hasChanged() ───────────────────────────────────────────────────

    describe('hasChanged()', () => {
        it('returns true for a file that was never snapshotted', () => {
            const file = path.join(tmpDir.root, 'new.ts');
            writeFile(file, 'brand new');
            expect(index.hasChanged(file)).toBe(true);
        });

        it('returns false immediately after snapshot', () => {
            const file = path.join(tmpDir.root, 'stable.ts');
            writeFile(file, 'stable content');
            index.snapshot(file);
            expect(index.hasChanged(file)).toBe(false);
        });

        it('returns true when the file content changes but mtime is the same', () => {
            const file = path.join(tmpDir.root, 'sneaky.ts');
            const fixedMtime = Date.now() - 10_000;
            writeFileWithMtime(file, 'original', fixedMtime);
            index.snapshot(file);

            // Overwrite content without bumping mtime
            fs.writeFileSync(file, 'tampered');
            const t = new Date(fixedMtime);
            fs.utimesSync(file, t, t);

            expect(index.hasChanged(file)).toBe(true);
        });

        it('returns true when mtime advances after snapshot', () => {
            const file = path.join(tmpDir.root, 'mtime.ts');
            writeFileWithMtime(file, 'v1', Date.now() - 5000);
            index.snapshot(file);

            // Re-write with a newer mtime
            writeFile(file, 'v2');
            expect(index.hasChanged(file)).toBe(true);
        });

        it('returns true when file is deleted after snapshot', () => {
            const file = path.join(tmpDir.root, 'deleted.ts');
            writeFile(file, 'data');
            index.snapshot(file);
            fs.unlinkSync(file);
            expect(index.hasChanged(file)).toBe(true);
        });
    });

    // ── snapshotDirectory() ────────────────────────────────────────────

    describe('snapshotDirectory()', () => {
        it('indexes all files in a flat directory', () => {
            writeFile(path.join(tmpDir.root, 'a.ts'), 'a');
            writeFile(path.join(tmpDir.root, 'b.ts'), 'b');
            writeFile(path.join(tmpDir.root, 'c.ts'), 'c');

            index.snapshotDirectory(tmpDir.root);
            expect(index.size).toBe(3);
        });

        it('recurses into subdirectories', () => {
            writeFile(path.join(tmpDir.root, 'sub', 'deep.ts'), 'deep');
            writeFile(path.join(tmpDir.root, 'root.ts'), 'root');

            index.snapshotDirectory(tmpDir.root);
            expect(index.size).toBe(2);
        });

        it('skips files with excluded extensions', () => {
            writeFile(path.join(tmpDir.root, 'keep.ts'), 'keep');
            writeFile(path.join(tmpDir.root, 'skip.tmp'), 'skip');
            writeFile(path.join(tmpDir.root, 'also-skip.log'), 'skip');

            index.snapshotDirectory(tmpDir.root, ['.tmp', '.log']);
            expect(index.size).toBe(1);
            expect(index.get(path.join(tmpDir.root, 'keep.ts'))).toBeDefined();
        });

        it('handles extension exclusion case-insensitively', () => {
            writeFile(path.join(tmpDir.root, 'file.TMP'), 'upper');
            index.snapshotDirectory(tmpDir.root, ['.tmp']);
            expect(index.size).toBe(0);
        });

        it('is a no-op for a non-existent directory', () => {
            expect(() =>
                index.snapshotDirectory(path.join(tmpDir.root, 'nonexistent')),
            ).not.toThrow();
            expect(index.size).toBe(0);
        });
    });

    // ── evict() & clear() ──────────────────────────────────────────────

    describe('evict() and clear()', () => {
        it('removes a specific entry with evict()', () => {
            const file = path.join(tmpDir.root, 'evict-me.ts');
            writeFile(file, 'data');
            index.snapshot(file);
            expect(index.get(file)).toBeDefined();

            index.evict(file);
            expect(index.get(file)).toBeUndefined();
            expect(index.size).toBe(0);
        });

        it('clear() removes all entries', () => {
            writeFile(path.join(tmpDir.root, 'a.ts'), 'a');
            writeFile(path.join(tmpDir.root, 'b.ts'), 'b');
            index.snapshotDirectory(tmpDir.root);
            expect(index.size).toBe(2);

            index.clear();
            expect(index.size).toBe(0);
        });

        it('hasChanged() returns true for an evicted file that still exists', () => {
            const file = path.join(tmpDir.root, 'evicted.ts');
            writeFile(file, 'still here');
            index.snapshot(file);
            index.evict(file);
            expect(index.hasChanged(file)).toBe(true);
        });
    });

    // ── keys() ─────────────────────────────────────────────────────────

    describe('keys()', () => {
        it('yields all tracked paths', () => {
            const f1 = path.join(tmpDir.root, 'one.ts');
            const f2 = path.join(tmpDir.root, 'two.ts');
            writeFile(f1, '1');
            writeFile(f2, '2');
            index.snapshot(f1);
            index.snapshot(f2);

            const keys = [...index.keys()];
            expect(keys).toHaveLength(2);
            expect(keys).toContain(f1);
            expect(keys).toContain(f2);
        });
    });
});
