/**
 * Shared test helpers: temp-directory management, file fixtures, and
 * a factory for building ArtifactConfig objects with sensible defaults.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ArtifactConfig } from '../types';

// ── Temp directory ────────────────────────────────────────────────────────

export function makeTempDir(label = 'artifact-test'): { root: string; cleanup: () => void } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
    return {
        root,
        cleanup: () => {
            if (fs.existsSync(root)) {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    };
}

// ── File fixture helpers ──────────────────────────────────────────────────

export function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
}

export function writeFileWithMtime(filePath: string, content: string, mtimeMs: number): void {
    writeFile(filePath, content);
    const t = new Date(mtimeMs);
    fs.utimesSync(filePath, t, t);
}

export function readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

export function fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
}

export function getMtime(filePath: string): number {
    return fs.statSync(filePath).mtimeMs;
}

// ── Config factory ────────────────────────────────────────────────────────

export function makeConfig(overrides: Partial<ArtifactConfig> = {}): ArtifactConfig {
    return {
        antigravityBrainPath: '/tmp/brain',
        localArtifactFolder:  '.artifact',
        syncMode:             'bidirectional',
        syncStrategy:         'real-time',
        debounceTimeoutMs:    50,    // small so debounce tests are fast
        timeIntervalMinutes:  999,   // effectively disabled unless overridden
        excludedExtensions:   ['.tmp', '.log'],
        linkedConversationId: '',    // required by updated ArtifactConfig
        gitTrackArtifact:     false, // new in v1.0.1
        ...overrides,
    };
}
