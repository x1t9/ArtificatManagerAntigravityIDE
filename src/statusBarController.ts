/**
 * StatusBarController  v1.0.3
 * ───────────────────
 * Status bar indicator REMOVED per v1.0.3.
 * The change count is now shown exclusively as a badge on the
 * Activity Bar icon (like Source Control), set via
 * SettingsViewProvider.setBadge(count).
 *
 * This stub is kept so call sites in extension.ts compile without
 * modification — all methods are no-ops.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as vscode from 'vscode';

export type SyncState = 'unsynced' | 'syncing' | 'synced';

export class StatusBarController {
    constructor(_context: vscode.ExtensionContext) {
        // No status bar item created.
    }
    public get state(): SyncState { return 'unsynced'; }
    public setState(_state: SyncState): void { /* no-op */ }
    public setChangeCount(_count: number): void { /* no-op */ }
    public dispose(): void { /* no-op */ }
}
