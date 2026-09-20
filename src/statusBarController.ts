/**
 * StatusBarController  v1.0.1
 * ───────────────────
 * Owns the persistent "(S)" sync icon in the VS Code status bar.
 *
 * State machine:
 *   unsynced  → red    $(sync)        tooltip includes pending count
 *   syncing   → orange $(sync~spin)   tooltip: "Antigravity: Syncing…"
 *   synced    → green  $(sync)        tooltip: "Antigravity: Synced"
 *
 * Badge: shows the number of pending changes next to the icon text,
 * exactly like the Source Control activity bar badge.
 *
 * Clicking triggers 'antigravity.syncNow'.
 */

import * as vscode from 'vscode';

export type SyncState = 'unsynced' | 'syncing' | 'synced';

const COLORS: Record<SyncState, vscode.ThemeColor> = {
    unsynced: new vscode.ThemeColor('statusBarItem.errorBackground'),
    syncing:  new vscode.ThemeColor('statusBarItem.warningBackground'),
    synced:   new vscode.ThemeColor('statusBarItem.prominentBackground'),
};

const ICONS: Record<SyncState, string> = {
    unsynced: '$(sync)',
    syncing:  '$(sync~spin)',
    synced:   '$(sync)',
};

export class StatusBarController {
    private readonly item: vscode.StatusBarItem;
    private _state: SyncState  = 'unsynced';
    private _changeCount       = 0;

    constructor(context: vscode.ExtensionContext) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'antigravity.syncNow';
        this.item.name    = 'Antigravity Sync';
        this.render();
        this.item.show();
        context.subscriptions.push(this.item);
    }

    public get state(): SyncState { return this._state; }

    public setState(state: SyncState): void {
        this._state = state;
        this.render();
    }

    /** Update the pending-change count shown in the status bar item. */
    public setChangeCount(count: number): void {
        this._changeCount = count;
        this.render();
    }

    public dispose(): void { this.item.dispose(); }

    private render(): void {
        const icon    = ICONS[this._state];
        const count   = this._changeCount;
        const countTx = count > 0 ? ` ${count}` : '';

        this.item.text            = `${icon} S${countTx}`;
        this.item.backgroundColor = COLORS[this._state];
        this.item.color           = undefined;

        switch (this._state) {
            case 'syncing':
                this.item.tooltip = 'Antigravity: Syncing…';
                break;
            case 'synced':
                this.item.tooltip = count > 0
                    ? `Antigravity: Synced — ${count} file(s) differ — click to sync`
                    : 'Antigravity: Fully synced';
                break;
            default:
                this.item.tooltip = count > 0
                    ? `Antigravity: ${count} file(s) pending — click to sync`
                    : 'Antigravity: Not synced — click to sync';
        }
    }
}
