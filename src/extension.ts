/**
 * Artifact Manager for Antigravity  v1.0.1
 * ─────────────────────────────────────────
 * Wires together:
 *   ConfigManager        — owns .artifact/config.json per workspace
 *   StatusBarController  — status-bar (S) icon with change-count badge
 *   SettingsViewProvider — Activity Bar sidebar
 *   SyncEngine           — file sync pipeline with onChangeCountUpdate event
 *
 * New in v1.0.1:
 *   • Activity Bar badge shows real-time pending change count
 *   • antigravity.applyGitConfig — adds/removes .artifact from .gitignore
 *   • Default sync direction: Brain → Project
 */

import * as vscode from 'vscode';
import * as fs     from 'fs';
import * as path   from 'path';
import * as os     from 'os';
import * as cp     from 'child_process';

import { DEFAULT_CONFIG }       from './types';
import { ConfigManager }        from './configManager';
import { StatusBarController }  from './statusBarController';
import { SettingsViewProvider } from './settingsViewProvider';
import { SyncEngine }           from './syncEngine';
import { BrainFolderReader }    from './brainFolderReader';

// ── Activation ────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const configManager  = new ConfigManager(workspaceRoot ?? os.tmpdir());
    context.subscriptions.push(configManager);

    // Activity Bar sidebar — always available
    const settingsProvider = new SettingsViewProvider(context, configManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SettingsViewProvider.VIEW_ID,
            settingsProvider,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );

    // Commands always available (even without workspace)
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity.openConfig', () => {
            vscode.commands.executeCommand('workbench.view.extension.antigravity-sidebar');
        }),
        vscode.commands.registerCommand('antigravity.refreshConversations', () => {
            settingsProvider.reloadConversations();
        }),
        vscode.commands.registerCommand('antigravity.applyGitConfig', () => {
            if (workspaceRoot) applyGitConfig(configManager, workspaceRoot);
        }),
    );

    if (!workspaceRoot) return;

    const statusBar = new StatusBarController(context);

    if (!configManager.exists) {
        bootstrapFirstRun(workspaceRoot, configManager, context, statusBar, settingsProvider);
    } else {
        launchEngine(configManager, context, statusBar, settingsProvider);
    }
}

// ── First-run bootstrap ───────────────────────────────────────────────────

async function bootstrapFirstRun(
    workspaceRoot: string,
    configManager: ConfigManager,
    context: vscode.ExtensionContext,
    statusBar: StatusBarController,
    settingsProvider: SettingsViewProvider,
): Promise<void> {
    const defaultBrainPath = resolveDefaultBrainPath();

    if (!fs.existsSync(defaultBrainPath)) {
        const choice = await vscode.window.showWarningMessage(
            'Antigravity brain folder not detected. How would you like to continue?',
            'Create Brain Folder', 'Configure in Sidebar', 'Cancel',
        );
        if (!choice || choice === 'Cancel') {
            vscode.window.showInformationMessage('Antigravity: click the Activity Bar icon to configure.');
            return;
        }
        if (choice === 'Create Brain Folder') fs.mkdirSync(defaultBrainPath, { recursive: true });
        if (choice === 'Configure in Sidebar') {
            configManager.writeDefault({ antigravityBrainPath: defaultBrainPath });
            vscode.commands.executeCommand('antigravity.openConfig');
            return;
        }
    }

    configManager.writeDefault({ antigravityBrainPath: defaultBrainPath });
    vscode.window.showInformationMessage('Artifact Manager for Antigravity initialized.');
    applyGitConfig(configManager, workspaceRoot);
    launchEngine(configManager, context, statusBar, settingsProvider);
}

// ── Engine launcher ───────────────────────────────────────────────────────

function launchEngine(
    configManager: ConfigManager,
    context: vscode.ExtensionContext,
    statusBar: StatusBarController,
    settingsProvider: SettingsViewProvider,
): SyncEngine {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const engine = new SyncEngine(configManager.config, workspaceRoot);

    // Status bar state
    context.subscriptions.push(
        engine.onSyncStart(() => statusBar.setState('syncing')),
        engine.onSyncEnd(()   => statusBar.setState('synced')),
        engine.onSyncError(() => statusBar.setState('unsynced')),
    );

    // Activity Bar badge — update count in real time (Source Control style)
    context.subscriptions.push(
        engine.onChangeCountUpdate(count => {
            settingsProvider.setBadge(count);
        }),
    );

    // Live config reconfigure
    context.subscriptions.push(
        configManager.onDidChange(newConfig => {
            engine.reconfigure(newConfig, context);
            applyGitConfig(configManager, workspaceRoot);
        }),
    );

    // Warn if brain path missing
    const brainPath = engine.resolveBrainPath();
    if (brainPath && !fs.existsSync(brainPath)) {
        vscode.window.showWarningMessage(
            `Antigravity: brain path "${brainPath}" does not exist.`, 'Open Settings',
        ).then(sel => {
            if (sel === 'Open Settings') vscode.commands.executeCommand('antigravity.openConfig');
        });
    }

    engine.start(context);
    return engine;
}

// ── Git .gitignore management ─────────────────────────────────────────────

/**
 * Add or remove ".artifact" from .gitignore based on gitTrackArtifact setting.
 * Also runs `git add .artifact` or `git rm -r --cached .artifact` if inside a repo.
 */
export function applyGitConfig(configManager: ConfigManager, workspaceRoot: string): void {
    const cfg           = configManager.config;
    const artifactDir   = cfg.localArtifactFolder || '.artifact';
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    const track         = cfg.gitTrackArtifact;

    // ── .gitignore ────────────────────────────────────────────────────────
    let content = '';
    if (fs.existsSync(gitignorePath)) {
        content = fs.readFileSync(gitignorePath, 'utf-8');
    }

    const lines    = content.split('\n');
    const pattern  = artifactDir.replace(/^\./, '\\.'); // escape leading dot
    const hasEntry = lines.some(l => l.trim() === artifactDir || l.trim() === `/${artifactDir}`);

    if (!track && !hasEntry) {
        // Add to .gitignore
        const newContent = content.trimEnd() + (content ? '\n' : '') + `\n# Antigravity artifact folder\n${artifactDir}/\n`;
        fs.writeFileSync(gitignorePath, newContent, 'utf-8');
    } else if (track && hasEntry) {
        // Remove from .gitignore
        const filtered = lines
            .filter(l => l.trim() !== artifactDir && l.trim() !== `${artifactDir}/` && l.trim() !== `/${artifactDir}/`)
            .filter((l, i, arr) => !(l.trim() === '# Antigravity artifact folder' && arr[i + 1]?.trim().startsWith(artifactDir)))
            .join('\n');
        fs.writeFileSync(gitignorePath, filtered, 'utf-8');
    }

    // ── git staging (best-effort, don't fail if not a git repo) ──────────
    const isGitRepo = fs.existsSync(path.join(workspaceRoot, '.git'));
    if (!isGitRepo) return;

    try {
        if (track) {
            // Un-ignore: remove from git cache so changes are tracked
            cp.execSync(`git rm -r --cached "${artifactDir}" --ignore-unmatch`, {
                cwd: workspaceRoot, stdio: 'pipe',
            });
            cp.execSync(`git add "${artifactDir}"`, {
                cwd: workspaceRoot, stdio: 'pipe',
            });
        } else {
            // Ignore: remove from git tracking
            cp.execSync(`git rm -r --cached "${artifactDir}" --ignore-unmatch`, {
                cwd: workspaceRoot, stdio: 'pipe',
            });
        }
    } catch { /* git not available or not a repo — silently skip */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function resolveDefaultBrainPath(): string {
    return BrainFolderReader.defaultBrainRoot();
}

export function deactivate(): void {}
