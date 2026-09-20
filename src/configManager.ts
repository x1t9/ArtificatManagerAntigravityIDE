/**
 * ConfigManager
 * ─────────────
 * Owns the .artifact/config.json file for a specific workspace root.
 * Provides typed read/write access and fires a change event whenever
 * the config is saved — allowing the engine and status bar to react.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ArtifactConfig, DEFAULT_CONFIG } from './types';

export class ConfigManager {
    private readonly configDir: string;
    private readonly configFile: string;
    private _config: ArtifactConfig;

    /** Fires whenever the config is written via save(). */
    private readonly _onDidChange = new vscode.EventEmitter<ArtifactConfig>();
    public readonly onDidChange = this._onDidChange.event;

    constructor(workspaceRoot: string) {
        this.configDir  = path.join(workspaceRoot, '.artifact');
        this.configFile = path.join(this.configDir, 'config.json');
        this._config    = this.load();
    }

    // ── Public API ────────────────────────────────────────────────────────

    /** Current in-memory config snapshot. */
    public get config(): ArtifactConfig {
        return { ...this._config };
    }

    /** Path to the config.json file. */
    public get filePath(): string {
        return this.configFile;
    }

    /** True when the config file already exists on disk. */
    public get exists(): boolean {
        return fs.existsSync(this.configFile);
    }

    /**
     * Merge `partial` into the current config, write to disk, and fire
     * `onDidChange`. Throws if the write fails.
     */
    public save(partial: Partial<ArtifactConfig>): void {
        this._config = { ...this._config, ...partial };
        fs.mkdirSync(this.configDir, { recursive: true });
        fs.writeFileSync(this.configFile, JSON.stringify(this._config, null, 2), 'utf-8');
        this._onDidChange.fire(this.config);
    }

    /**
     * Write a fresh default config to disk (first-run).
     * Merges any provided overrides on top of DEFAULT_CONFIG.
     */
    public writeDefault(overrides: Partial<ArtifactConfig> = {}): void {
        this.save({ ...DEFAULT_CONFIG, ...overrides });
    }

    /**
     * Re-read config.json from disk and refresh the in-memory snapshot.
     * Use this if the file may have been edited externally.
     */
    public reload(): ArtifactConfig {
        this._config = this.load();
        return this.config;
    }

    public dispose(): void {
        this._onDidChange.dispose();
    }

    // ── Private ───────────────────────────────────────────────────────────

    private load(): ArtifactConfig {
        if (!fs.existsSync(this.configFile)) {
            return { ...DEFAULT_CONFIG };
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
            return { ...DEFAULT_CONFIG, ...(raw as Partial<ArtifactConfig>) };
        } catch {
            return { ...DEFAULT_CONFIG };
        }
    }
}
