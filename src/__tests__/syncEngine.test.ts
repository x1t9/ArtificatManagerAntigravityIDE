/**
 * Integration tests — SyncEngine
 *
 * Covers:
 *  - atomicCopy: success, missing source, intermediate temp cleanup
 *  - syncOneWay: flat copy, recursive, excluded extensions, missing source no-op
 *  - syncBidirectional: local-only, brain-only, both unchanged, true conflict,
 *    multi-file mixed, excluded extensions in bidir mode
 *  - syncMode routing: one-way-to-brain, one-way-to-local, bidirectional
 *  - executeSync: isSyncing guard prevents re-entrant calls
 *  - Strategy initialisation: real-time, focus-out, time-based wiring
 *  - debounce: rapid successive triggers collapse into one sync
 *  - resolveLocalDir / resolveBrainPath: ~ expansion
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SyncEngine } from '../syncEngine';
import { createMockContext, workspace, _watchers, _windowState } from '../__mocks__/vscode';
import {
    makeTempDir,
    writeFile,
    writeFileWithMtime,
    readFile,
    fileExists,
    makeConfig,
} from './helpers';

describe('SyncEngine', () => {
    let tmpDir: ReturnType<typeof makeTempDir>;

    beforeEach(() => {
        tmpDir = makeTempDir('se');
        jest.useFakeTimers();
    });

    afterEach(() => {
        tmpDir.cleanup();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    // ── atomicCopy ─────────────────────────────────────────────────────

    describe('atomicCopy()', () => {
        it('copies file content to a new destination', () => {
            const src = path.join(tmpDir.root, 'src.ts');
            const dest = path.join(tmpDir.root, 'dest', 'output.ts');
            writeFile(src, 'hello world');

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: tmpDir.root }));
            engine.atomicCopy(src, dest);

            expect(readFile(dest)).toBe('hello world');
        });

        it('overwrites an existing destination atomically', () => {
            const src = path.join(tmpDir.root, 'src.ts');
            const dest = path.join(tmpDir.root, 'dest.ts');
            writeFile(src, 'new content');
            writeFile(dest, 'old content');

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: tmpDir.root }));
            engine.atomicCopy(src, dest);

            expect(readFile(dest)).toBe('new content');
        });

        it('throws when source does not exist', () => {
            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: tmpDir.root }));
            expect(() =>
                engine.atomicCopy(
                    path.join(tmpDir.root, 'ghost.ts'),
                    path.join(tmpDir.root, 'out.ts'),
                ),
            ).toThrow(/source not found/i);
        });

        it('leaves no .tmp file behind after a successful copy', () => {
            const src = path.join(tmpDir.root, 'src.ts');
            const dest = path.join(tmpDir.root, 'dest.ts');
            writeFile(src, 'clean');

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: tmpDir.root }));
            engine.atomicCopy(src, dest);

            const tmpFiles = fs.readdirSync(tmpDir.root).filter(f => f.startsWith('.tmp_'));
            expect(tmpFiles).toHaveLength(0);
        });
    });

    // ── syncOneWay ─────────────────────────────────────────────────────

    describe('syncOneWay()', () => {
        it('copies a single file from src to dest', () => {
            const src = path.join(tmpDir.root, 'local');
            const dest = path.join(tmpDir.root, 'brain');
            writeFile(path.join(src, 'notes.md'), '# Notes');

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: dest }));
            engine.syncOneWay(src, dest);

            expect(readFile(path.join(dest, 'notes.md'))).toBe('# Notes');
        });

        it('copies recursively preserving directory structure', () => {
            const src = path.join(tmpDir.root, 'local');
            const dest = path.join(tmpDir.root, 'brain');
            writeFile(path.join(src, 'a', 'b', 'deep.ts'), 'deep');
            writeFile(path.join(src, 'root.ts'), 'root');

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: dest }));
            engine.syncOneWay(src, dest);

            expect(fileExists(path.join(dest, 'a', 'b', 'deep.ts'))).toBe(true);
            expect(fileExists(path.join(dest, 'root.ts'))).toBe(true);
        });

        it('skips files with excluded extensions', () => {
            const src = path.join(tmpDir.root, 'local');
            const dest = path.join(tmpDir.root, 'brain');
            writeFile(path.join(src, 'keep.ts'), 'keep');
            writeFile(path.join(src, 'skip.tmp'), 'skip');
            writeFile(path.join(src, 'also.log'), 'also skip');

            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: dest,
                    excludedExtensions: ['.tmp', '.log'],
                }),
            );
            engine.syncOneWay(src, dest);

            expect(fileExists(path.join(dest, 'keep.ts'))).toBe(true);
            expect(fileExists(path.join(dest, 'skip.tmp'))).toBe(false);
            expect(fileExists(path.join(dest, 'also.log'))).toBe(false);
        });

        it('is a no-op when source directory does not exist', () => {
            const engine = new SyncEngine(
                makeConfig({ antigravityBrainPath: path.join(tmpDir.root, 'brain') }),
            );
            expect(() =>
                engine.syncOneWay(
                    path.join(tmpDir.root, 'nonexistent'),
                    path.join(tmpDir.root, 'dest'),
                ),
            ).not.toThrow();
            expect(fileExists(path.join(tmpDir.root, 'dest'))).toBe(false);
        });
    });

    // ── syncBidirectional ──────────────────────────────────────────────

    describe('syncBidirectional()', () => {
        it('copies a local-only file to brain', () => {
            const local = path.join(tmpDir.root, 'local');
            const brain = path.join(tmpDir.root, 'brain');
            writeFile(path.join(local, 'notes.ts'), 'local only');

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: brain }));
            engine.syncBidirectional(local, brain);

            expect(readFile(path.join(brain, 'notes.ts'))).toBe('local only');
        });

        it('copies a brain-only file to local', () => {
            const local = path.join(tmpDir.root, 'local');
            const brain = path.join(tmpDir.root, 'brain');
            writeFile(path.join(brain, 'remote.ts'), 'brain only');

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: brain }));
            engine.syncBidirectional(local, brain);

            expect(readFile(path.join(local, 'remote.ts'))).toBe('brain only');
        });

        it('does not copy when both files are unchanged since snapshot', () => {
            const local = path.join(tmpDir.root, 'local');
            const brain = path.join(tmpDir.root, 'brain');
            const BASE = Date.now() - 10_000;

            writeFileWithMtime(path.join(local, 'shared.ts'), 'same', BASE);
            writeFileWithMtime(path.join(brain, 'shared.ts'), 'same', BASE);

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: brain }));
            // Seed index so both are known
            engine.getIndex().snapshot(path.join(local, 'shared.ts'));
            engine.getIndex().snapshot(path.join(brain, 'shared.ts'));

            // Spy on atomicCopy to confirm it's never called
            const copySpy = jest.spyOn(engine, 'atomicCopy');
            engine.syncBidirectional(local, brain);

            expect(copySpy).not.toHaveBeenCalled();
        });

        it('copies local winner to brain during true conflict (local newer)', () => {
            const local = path.join(tmpDir.root, 'local');
            const brain = path.join(tmpDir.root, 'brain');
            const BASE = Date.now() - 20_000;

            writeFileWithMtime(path.join(local, 'conflict.ts'), 'base', BASE);
            writeFileWithMtime(path.join(brain, 'conflict.ts'), 'base', BASE);

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: brain }));
            engine.getIndex().snapshot(path.join(local, 'conflict.ts'));
            engine.getIndex().snapshot(path.join(brain, 'conflict.ts'));

            // Local is newer
            writeFileWithMtime(path.join(brain, 'conflict.ts'), 'brain edit', Date.now() - 5000);
            writeFileWithMtime(path.join(local, 'conflict.ts'), 'local edit', Date.now() - 100);

            engine.syncBidirectional(local, brain);

            expect(readFile(path.join(brain, 'conflict.ts'))).toBe('local edit');
        });

        it('copies brain winner to local during true conflict (brain newer)', () => {
            const local = path.join(tmpDir.root, 'local');
            const brain = path.join(tmpDir.root, 'brain');
            const BASE = Date.now() - 20_000;

            writeFileWithMtime(path.join(local, 'conflict.ts'), 'base', BASE);
            writeFileWithMtime(path.join(brain, 'conflict.ts'), 'base', BASE);

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: brain }));
            engine.getIndex().snapshot(path.join(local, 'conflict.ts'));
            engine.getIndex().snapshot(path.join(brain, 'conflict.ts'));

            // Brain is newer
            writeFileWithMtime(path.join(local, 'conflict.ts'), 'local edit', Date.now() - 5000);
            writeFileWithMtime(path.join(brain, 'conflict.ts'), 'brain edit', Date.now() - 100);

            engine.syncBidirectional(local, brain);

            expect(readFile(path.join(local, 'conflict.ts'))).toBe('brain edit');
        });

        it('handles multi-file mixed state in a single pass', () => {
            const local = path.join(tmpDir.root, 'local');
            const brain = path.join(tmpDir.root, 'brain');
            const BASE = Date.now() - 30_000;

            // File A: only in local → should copy to brain
            writeFile(path.join(local, 'a.ts'), 'A local');

            // File B: only in brain → should copy to local
            writeFile(path.join(brain, 'b.ts'), 'B brain');

            // File C: both unchanged → no copy
            writeFileWithMtime(path.join(local, 'c.ts'), 'C base', BASE);
            writeFileWithMtime(path.join(brain, 'c.ts'), 'C base', BASE);

            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: brain }));
            engine.getIndex().snapshot(path.join(local, 'c.ts'));
            engine.getIndex().snapshot(path.join(brain, 'c.ts'));

            engine.syncBidirectional(local, brain);

            expect(readFile(path.join(brain, 'a.ts'))).toBe('A local');
            expect(readFile(path.join(local, 'b.ts'))).toBe('B brain');
            // C should be untouched on both sides (content still 'C base')
            expect(readFile(path.join(local, 'c.ts'))).toBe('C base');
            expect(readFile(path.join(brain, 'c.ts'))).toBe('C base');
        });

        it('skips excluded extensions in bidirectional mode', () => {
            const local = path.join(tmpDir.root, 'local');
            const brain = path.join(tmpDir.root, 'brain');
            writeFile(path.join(local, 'keep.ts'), 'keep');
            writeFile(path.join(local, 'ignore.tmp'), 'ignore');

            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: brain,
                    excludedExtensions: ['.tmp'],
                }),
            );
            engine.syncBidirectional(local, brain);

            expect(fileExists(path.join(brain, 'keep.ts'))).toBe(true);
            expect(fileExists(path.join(brain, 'ignore.tmp'))).toBe(false);
        });
    });

    // ── syncMode routing via executeSync ───────────────────────────────

    describe('executeSync() syncMode routing', () => {
        it('routes one-way-to-brain correctly', () => {
            const local = path.join(tmpDir.root, 'local');
            const brain = path.join(tmpDir.root, 'brain');
            writeFile(path.join(local, 'file.ts'), 'local content');
            fs.mkdirSync(brain, { recursive: true });

            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath:  brain,
                    localArtifactFolder:   'local',
                    syncMode:              'one-way-to-brain',
                    linkedConversationId:  '__FULL_BRAIN__',  // satisfy no-selection guard
                }),
                tmpDir.root,
            );
            engine.executeSync();

            expect(readFile(path.join(brain, 'file.ts'))).toBe('local content');
        });

        it('routes one-way-to-local correctly', () => {
            const local = path.join(tmpDir.root, 'local');
            const brain = path.join(tmpDir.root, 'brain');
            writeFile(path.join(brain, 'file.ts'), 'brain content');

            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath:  brain,
                    localArtifactFolder:   'local',
                    syncMode:              'one-way-to-local',
                    linkedConversationId:  '__FULL_BRAIN__',  // satisfy no-selection guard
                }),
                tmpDir.root,
            );
            engine.executeSync();

            expect(readFile(path.join(local, 'file.ts'))).toBe('brain content');
        });

        it('does not allow re-entrant syncs (isSyncing guard)', () => {
            const brain = path.join(tmpDir.root, 'brain');
            fs.mkdirSync(brain, { recursive: true });

            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath:  brain,
                    syncMode:              'bidirectional',
                    linkedConversationId:  '__FULL_BRAIN__',  // satisfy no-selection guard
                }),
                tmpDir.root,
            );

            // Intercept syncBidirectional to simulate a re-entrant executeSync call
            // that arrives while isSyncing is still true (before the finally block).
            let reentrancyBlocked = false;
            const origBidi = engine.syncBidirectional.bind(engine);
            engine.syncBidirectional = (localDir: string, brainDir: string) => {
                // isSyncing is true here — a second executeSync must be a no-op
                engine.executeSync();   // re-entrant call; guard should swallow it
                // If guard worked, isSyncing is still true (not reset mid-flight)
                reentrancyBlocked = (engine as any).isSyncing === true;
                origBidi(localDir, brainDir);
            };

            engine.executeSync();

            expect(reentrancyBlocked).toBe(true);
        });
    });

    // ── Strategy: real-time watcher ────────────────────────────────────

    describe('Strategy: real-time', () => {
        it('createFileSystemWatcher is called with the artifact glob pattern', () => {
            const ctx = createMockContext();
            const brain = path.join(tmpDir.root, 'brain');
            fs.mkdirSync(brain, { recursive: true });
            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: brain,
                    localArtifactFolder: '.artifact',
                    syncStrategy: 'real-time',
                }),
                tmpDir.root,
            );
            engine.start(ctx);

            const { createFileSystemWatcher } = require('../__mocks__/vscode').workspace;
            // Engine now passes a RelativePattern object — check base contains .artifact
            expect(createFileSystemWatcher).toHaveBeenCalledWith(
                expect.objectContaining({
                    base: expect.stringContaining('.artifact'),
                    pattern: '**/*',
                }),
            );
        });

        it('debounces rapid file change events', () => {
            const ctx = createMockContext();
            const brain = path.join(tmpDir.root, 'brain');
            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: brain,
                    syncStrategy: 'real-time',
                    debounceTimeoutMs: 200,
                }),
            );
            const syncSpy = jest.spyOn(engine, 'executeSync');
            engine.start(ctx);

            // Fire 5 rapid change events
            _watchers.fireChange('/workspace/.artifact/a.ts');
            _watchers.fireChange('/workspace/.artifact/b.ts');
            _watchers.fireChange('/workspace/.artifact/c.ts');
            _watchers.fireChange('/workspace/.artifact/d.ts');
            _watchers.fireChange('/workspace/.artifact/e.ts');

            // Before debounce timeout — should not have synced yet
            jest.advanceTimersByTime(100);
            expect(syncSpy).not.toHaveBeenCalled();

            // After debounce window — exactly one sync
            jest.advanceTimersByTime(200);
            expect(syncSpy).toHaveBeenCalledTimes(1);
        });

        it('resets debounce timer on each new change event', () => {
            const ctx = createMockContext();
            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: path.join(tmpDir.root, 'brain'),
                    syncStrategy: 'real-time',
                    debounceTimeoutMs: 300,
                }),
            );
            const syncSpy = jest.spyOn(engine, 'executeSync');
            engine.start(ctx);

            _watchers.fireChange('/workspace/.artifact/a.ts');
            jest.advanceTimersByTime(200);               // 200ms in — not yet
            _watchers.fireChange('/workspace/.artifact/b.ts'); // reset timer
            jest.advanceTimersByTime(200);               // 200ms more — still inside new window
            expect(syncSpy).not.toHaveBeenCalled();

            jest.advanceTimersByTime(200);               // now 300ms past last event
            expect(syncSpy).toHaveBeenCalledTimes(1);
        });

        it('fires sync on onDidCreate events too', () => {
            const ctx = createMockContext();
            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: path.join(tmpDir.root, 'brain'),
                    syncStrategy: 'real-time',
                    debounceTimeoutMs: 50,
                }),
            );
            const syncSpy = jest.spyOn(engine, 'executeSync');
            engine.start(ctx);

            _watchers.fireCreate('/workspace/.artifact/new.ts');
            jest.advanceTimersByTime(100);

            expect(syncSpy).toHaveBeenCalledTimes(1);
        });
    });

    // ── Strategy: focus-out ────────────────────────────────────────────

    describe('Strategy: focus-out', () => {
        it('triggers executeSync when window loses focus', () => {
            const ctx = createMockContext();
            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: path.join(tmpDir.root, 'brain'),
                    syncStrategy: 'focus-out',
                }),
            );
            const syncSpy = jest.spyOn(engine, 'executeSync');
            engine.start(ctx);

            _windowState.fireFocusChange(false);       // window loses focus
            expect(syncSpy).toHaveBeenCalledTimes(1);
        });

        it('does NOT trigger executeSync when window gains focus', () => {
            const ctx = createMockContext();
            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: path.join(tmpDir.root, 'brain'),
                    syncStrategy: 'focus-out',
                }),
            );
            const syncSpy = jest.spyOn(engine, 'executeSync');
            engine.start(ctx);

            _windowState.fireFocusChange(true);        // window gains focus — no sync
            expect(syncSpy).not.toHaveBeenCalled();
        });

        it('fires sync on each focus-loss event', () => {
            const ctx = createMockContext();
            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: path.join(tmpDir.root, 'brain'),
                    syncStrategy: 'focus-out',
                }),
            );
            const syncSpy = jest.spyOn(engine, 'executeSync');
            engine.start(ctx);

            _windowState.fireFocusChange(false);
            _windowState.fireFocusChange(true);
            _windowState.fireFocusChange(false);

            expect(syncSpy).toHaveBeenCalledTimes(2);
        });
    });

    // ── Strategy: time-based ───────────────────────────────────────────

    describe('Strategy: time-based', () => {
        it('fires executeSync at the configured interval', () => {
            const ctx = createMockContext();
            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: path.join(tmpDir.root, 'brain'),
                    syncStrategy: 'time-based',
                    timeIntervalMinutes: 1,
                }),
            );
            const syncSpy = jest.spyOn(engine, 'executeSync');
            engine.start(ctx);

            // Advance 1 interval
            jest.advanceTimersByTime(60_000);
            expect(syncSpy).toHaveBeenCalledTimes(1);

            // Advance 2 more intervals
            jest.advanceTimersByTime(120_000);
            expect(syncSpy).toHaveBeenCalledTimes(3);
        });

        it('disposes the timer when context subscription is disposed', () => {
            const ctx = createMockContext();
            const engine = new SyncEngine(
                makeConfig({
                    antigravityBrainPath: path.join(tmpDir.root, 'brain'),
                    syncStrategy: 'time-based',
                    timeIntervalMinutes: 1,
                }),
            );
            const syncSpy = jest.spyOn(engine, 'executeSync');
            engine.start(ctx);

            // Dispose all subscriptions (simulates extension deactivation)
            ctx.subscriptions.forEach((s: { dispose(): void }) => s.dispose());

            // Timer should be cleared — no more calls
            jest.advanceTimersByTime(300_000);
            expect(syncSpy).not.toHaveBeenCalled();
        });
    });

    // ── Path resolution ────────────────────────────────────────────────

    describe('resolveBrainPath()', () => {
        it('expands leading ~ to the OS home directory', () => {
            const engine = new SyncEngine(
                makeConfig({ antigravityBrainPath: '~/.gemini/antigravity/brain' }),
            );
            const resolved = engine.resolveBrainPath();
            expect(resolved).toBe(
                path.join(os.homedir(), '.gemini', 'antigravity', 'brain'),
            );
            expect(resolved).not.toContain('~');
        });

        it('returns an absolute path unchanged', () => {
            const abs = '/absolute/path/to/brain';
            const engine = new SyncEngine(makeConfig({ antigravityBrainPath: abs }));
            expect(engine.resolveBrainPath()).toBe(abs);
        });
    });
});
