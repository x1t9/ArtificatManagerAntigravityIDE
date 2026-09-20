/**
 * FileHashIndex
 * ─────────────
 * In-memory registry tracking last-known mtime and a cheap content hash for
 * every file participating in sync. Used by the conflict resolver and the
 * bidirectional engine to detect which side changed since the last snapshot.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { FileRecord } from './types';

export class FileHashIndex {
    /** Map from absolute file path → last snapshot record. */
    private index: Map<string, FileRecord> = new Map();

    // ── Public API ────────────────────────────────────────────────────────

    /**
     * Snapshot a single file into the index.
     * Returns the created/updated record, or null if the file cannot be read.
     */
    public snapshot(absolutePath: string): FileRecord | null {
        try {
            const stat = fs.statSync(absolutePath);
            const hash = this.hashFile(absolutePath);
            const record: FileRecord = {
                absolutePath,
                mtimeMs: stat.mtimeMs,
                contentHash: hash,
            };
            this.index.set(absolutePath, record);
            return record;
        } catch {
            return null;
        }
    }

    /**
     * Recursively snapshot all files under a directory.
     * Populates (or refreshes) the index for every file found.
     */
    public snapshotDirectory(dir: string, excludedExtensions: string[] = []): void {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                this.snapshotDirectory(fullPath, excludedExtensions);
            } else if (entry.isFile()) {
                if (!this.isExcluded(entry.name, excludedExtensions)) {
                    this.snapshot(fullPath);
                }
            }
        }
    }

    /**
     * Retrieve the stored record for a path, or undefined if not yet indexed.
     */
    public get(absolutePath: string): FileRecord | undefined {
        return this.index.get(absolutePath);
    }

    /**
     * Returns true when the file on disk differs from its last snapshot
     * (or was never snapshotted).
     */
    public hasChanged(absolutePath: string): boolean {
        const record = this.index.get(absolutePath);
        if (!record) return true;
        try {
            const stat = fs.statSync(absolutePath);
            if (stat.mtimeMs !== record.mtimeMs) return true;
            // mtime collision guard: verify hash when mtime is identical
            return this.hashFile(absolutePath) !== record.contentHash;
        } catch {
            // File deleted or inaccessible — treat as changed
            return true;
        }
    }

    /**
     * Remove a path from the index (e.g. after a confirmed delete).
     */
    public evict(absolutePath: string): void {
        this.index.delete(absolutePath);
    }

    /**
     * Clear the entire index. Useful between test cases.
     */
    public clear(): void {
        this.index.clear();
    }

    /**
     * Return all currently tracked paths.
     */
    public keys(): IterableIterator<string> {
        return this.index.keys();
    }

    /** Number of entries currently indexed. */
    public get size(): number {
        return this.index.size;
    }

    // ── Private helpers ───────────────────────────────────────────────────

    /**
     * Compute a lightweight SHA-256 (first 8 hex chars) of the file content.
     * Cheap enough for files up to a few MB; the engine only calls this on
     * mtime collisions, so it rarely runs on large files.
     */
    private hashFile(absolutePath: string): string {
        try {
            const content = fs.readFileSync(absolutePath);
            return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
        } catch {
            return '';
        }
    }

    private isExcluded(fileName: string, excluded: string[]): boolean {
        const ext = path.extname(fileName).toLowerCase();
        return excluded.map(e => e.toLowerCase()).includes(ext);
    }
}
