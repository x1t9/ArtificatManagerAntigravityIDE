/**
 * SyncEngine  v1.0.1
 * ──────────
 * Core synchronisation pipeline. Handles all three sync strategies
 * (real-time, focus-out, time-based) and all three sync modes
 * (bidirectional, one-way-to-local, one-way-to-brain).
 *
 * New in v1.0.1:
 *   onChangeCountUpdate — fires whenever the count of pending changes
 *   is recalculated, so the Activity Bar badge can be updated in real time.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ArtifactConfig } from './types';
import { FileHashIndex } from './fileHashIndex';
import { ConflictResolver } from './conflictResolver';

export class SyncEngine {
    private config: ArtifactConfig;
    private readonly workspaceRoot: string;
    private index: FileHashIndex;
    private resolver: ConflictResolver;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private badgeTimer:    ReturnType<typeof setTimeout> | null = null;
    protected isSyncing = false;

    // ── Lifecycle events ──────────────────────────────────────────────────
    private readonly _onSyncStart          = new vscode.EventEmitter<void>();
    private readonly _onSyncEnd            = new vscode.EventEmitter<void>();
    private readonly _onSyncError          = new vscode.EventEmitter<Error>();
    /** Fires with the current pending-change count whenever it changes. */
    private readonly _onChangeCountUpdate  = new vscode.EventEmitter<number>();

    public readonly onSyncStart         = this._onSyncStart.event;
    public readonly onSyncEnd           = this._onSyncEnd.event;
    public readonly onSyncError         = this._onSyncError.event;
    public readonly onChangeCountUpdate = this._onChangeCountUpdate.event;

    constructor(config: ArtifactConfig, workspaceRoot?: string) {
        this.config        = config;
        this.workspaceRoot = workspaceRoot
            ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            ?? process.cwd();
        this.index    = new FileHashIndex();
        this.resolver = new ConflictResolver(this.index);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    public start(context: vscode.ExtensionContext): void {
        const localDir = this.resolveLocalDir();
        const brainDir = this.resolveBrainPath();

        this.index.snapshotDirectory(localDir, this.config.excludedExtensions);
        this.index.snapshotDirectory(brainDir, this.config.excludedExtensions);

        this.applyStrategy(context);
        this.scheduleBadgeRefresh();

        context.subscriptions.push(
            this._onSyncStart,
            this._onSyncEnd,
            this._onSyncError,
            this._onChangeCountUpdate,
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('antigravity.syncNow', () => this.executeSync()),
        );
    }

    public reconfigure(config: ArtifactConfig, context: vscode.ExtensionContext): void {
        this.config = config;
        this.index.clear();
        this.index.snapshotDirectory(this.resolveLocalDir(), config.excludedExtensions);
        this.index.snapshotDirectory(this.resolveBrainPath(), config.excludedExtensions);
        this.applyStrategy(context);
        this.refreshBadge();
    }

    // ── Badge / change count ──────────────────────────────────────────────

    /**
     * Count files that differ between brain and local using mtime comparison.
     * Fired immediately on start, then re-fired after every sync or watcher event.
     */
    public refreshBadge(): void {
        if (this.badgeTimer) clearTimeout(this.badgeTimer);
        this.badgeTimer = setTimeout(() => {
            const count = this.computeChangeCount();
            this._onChangeCountUpdate.fire(count);
        }, 300);
    }

    private computeChangeCount(): number {
        const brainDir = this.resolveBrainPath();
        const localDir = this.resolveLocalDir();
        if (!fs.existsSync(brainDir) || !fs.existsSync(localDir)) return 0;

        let count = 0;
        try {
            const brainFiles = this.collectFiles(brainDir);
            for (const bf of brainFiles) {
                if (this.isExcluded(bf)) continue;
                const rel = path.relative(brainDir, bf);
                const lf  = path.join(localDir, rel);
                if (!fs.existsSync(lf)) { count++; continue; }
                const bm = fs.statSync(bf).mtimeMs;
                const lm = fs.statSync(lf).mtimeMs;
                if (Math.abs(bm - lm) > 1000) count++;
            }
        } catch { /* ignore fs errors */ }
        return count;
    }

    private scheduleBadgeRefresh(): void {
        // Initial count after a short delay (let things settle)
        setTimeout(() => this.refreshBadge(), 1500);
    }

    // ── Sync guard + execution ────────────────────────────────────────────

    public executeSync(): void {
        if (this.isSyncing) return;
        const { linkedConversationId } = this.config;
        if (!linkedConversationId) return;

        this.isSyncing = true;
        this._onSyncStart.fire();

        try {
            const localDir = this.resolveLocalDir();
            const brainDir = this.resolveBrainPath();

            if (!brainDir || !fs.existsSync(brainDir)) {
                throw new Error(
                    `Brain path "${brainDir}" does not exist. ` +
                    `Open the Antigravity sidebar to select a conversation.`,
                );
            }

            switch (this.config.syncMode) {
                case 'bidirectional':    this.syncBidirectional(localDir, brainDir); break;
                case 'one-way-to-brain': this.syncOneWay(localDir, brainDir);        break;
                case 'one-way-to-local': this.syncOneWay(brainDir, localDir);        break;
            }

            this._onSyncEnd.fire();
        } catch (err) {
            const error = err as Error;
            this._onSyncError.fire(error);
            vscode.window.showErrorMessage(`Antigravity Sync error: ${error.message}`);
        } finally {
            this.isSyncing = false;
            // Refresh badge after sync so count drops to 0 (or reflects remaining diffs)
            this.refreshBadge();
        }
    }

    public getIndex(): FileHashIndex { return this.index; }

    // ── Strategy wiring ───────────────────────────────────────────────────

    private applyStrategy(context: vscode.ExtensionContext): void {
        switch (this.config.syncStrategy) {
            case 'real-time':  this.initRealTime(context);  break;
            case 'focus-out':  this.initFocusOut(context);  break;
            case 'time-based': this.initTimeBased(context); break;
        }
    }

    private initRealTime(context: vscode.ExtensionContext): void {
        const localDir = this.resolveLocalDir();
        const pattern  = new vscode.RelativePattern(localDir, '**/*');
        const watcher  = vscode.workspace.createFileSystemWatcher(pattern);

        const onEvent = () => {
            this.triggerDebouncedSync();
            this.refreshBadge();
        };
        watcher.onDidChange(onEvent);
        watcher.onDidCreate(onEvent);
        watcher.onDidDelete(onEvent);
        context.subscriptions.push(watcher);
    }

    private initFocusOut(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.window.onDidChangeWindowState((state: { focused: boolean }) => {
                if (!state.focused) this.executeSync();
            }),
        );
    }

    private initTimeBased(context: vscode.ExtensionContext): void {
        const intervalMs = (this.config.timeIntervalMinutes || 15) * 60 * 1000;
        const timer = setInterval(() => this.executeSync(), intervalMs);
        context.subscriptions.push({ dispose: () => clearInterval(timer) });
    }

    private triggerDebouncedSync(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(
            () => this.executeSync(),
            this.config.debounceTimeoutMs,
        );
    }

    // ── Sync implementations ──────────────────────────────────────────────

    public syncOneWay(srcDir: string, destDir: string): void {
        if (!fs.existsSync(srcDir)) return;
        fs.mkdirSync(destDir, { recursive: true });
        for (const srcFile of this.collectFiles(srcDir)) {
            if (this.isExcluded(srcFile)) continue;
            const relative = path.relative(srcDir, srcFile);
            const destFile = path.join(destDir, relative);
            this.atomicCopy(srcFile, destFile);
            this.index.snapshot(srcFile);
            this.index.snapshot(destFile);
        }
    }

    public syncBidirectional(localDir: string, brainDir: string): void {
        fs.mkdirSync(localDir, { recursive: true });
        fs.mkdirSync(brainDir, { recursive: true });
        for (const relative of this.unionRelativePaths(localDir, brainDir)) {
            if (this.isExcluded(relative)) continue;
            const localFile = path.join(localDir, relative);
            const brainFile = path.join(brainDir, relative);
            const { winner } = this.resolver.resolve(localFile, brainFile);
            if (winner === 'local') {
                this.atomicCopy(localFile, brainFile);
                this.index.snapshot(localFile);
                this.index.snapshot(brainFile);
            } else if (winner === 'brain') {
                this.atomicCopy(brainFile, localFile);
                this.index.snapshot(brainFile);
                this.index.snapshot(localFile);
            }
        }
    }

    // ── Atomic copy ───────────────────────────────────────────────────────

    public atomicCopy(src: string, dest: string): void {
        if (!fs.existsSync(src)) throw new Error(`atomicCopy: source not found: ${src}`);
        const destDir = path.dirname(dest);
        fs.mkdirSync(destDir, { recursive: true });
        const tmp = path.join(destDir, `.tmp_${Date.now()}_${path.basename(dest)}`);
        try {
            fs.copyFileSync(src, tmp);
            fs.renameSync(tmp, dest);
        } catch (err) {
            try { fs.unlinkSync(tmp); } catch { /* ignore */ }
            throw err;
        }
    }

    // ── Path helpers ──────────────────────────────────────────────────────

    public resolveLocalDir(): string {
        return path.join(this.workspaceRoot, this.config.localArtifactFolder);
    }

    public resolveBrainPath(): string {
        const raw = this.config.antigravityBrainPath;
        if (raw.startsWith('~')) return path.join(os.homedir(), raw.slice(1));
        return raw;
    }

    private collectFiles(dir: string): string[] {
        const results: string[] = [];
        const recurse = (current: string) => {
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) recurse(full);
                else if (entry.isFile()) results.push(full);
            }
        };
        recurse(dir);
        return results;
    }

    private unionRelativePaths(dirA: string, dirB: string): Set<string> {
        const set = new Set<string>();
        if (fs.existsSync(dirA)) this.collectFiles(dirA).forEach(f => set.add(path.relative(dirA, f)));
        if (fs.existsSync(dirB)) this.collectFiles(dirB).forEach(f => set.add(path.relative(dirB, f)));
        return set;
    }

    private isExcluded(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return (this.config.excludedExtensions ?? []).map(e => e.toLowerCase()).includes(ext);
    }
}
