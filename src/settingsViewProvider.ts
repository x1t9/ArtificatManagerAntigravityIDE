/**
 * SettingsViewProvider  v1.0.1
 * ────────────────────
 * Activity Bar sidebar webview.
 *
 * Sections:
 *   1. Brain Root — path + Browse + Auto-detect
 *   2. Sync Target — 3-tier conversation dropdown
 *   3. Sync Method — direction + trigger
 *   4. Timing — debounce + interval
 *   5. Exclusions — extension chip tags
 *   6. Git — checkbox to track/ignore .artifact in git
 *   7. About — author, version, GitHub link
 */

import * as vscode from 'vscode';
import * as path   from 'path';
import { ConfigManager }        from './configManager';
import { BrainFolderReader, FULL_BRAIN_ID } from './brainFolderReader';
import { ArtifactConfig, ConversationEntry, SyncMode, SyncStrategy } from './types';

const EXT_VERSION = '1.0.3';
const AUTHOR      = 'x1t9';
const GITHUB_URL  = 'https://github.com/x1t9/ArtificatManagerAntigravityIDE';

export class SettingsViewProvider implements vscode.WebviewViewProvider {

    public static readonly VIEW_ID = 'antigravity.settingsView';

    private view?: vscode.WebviewView;
    private conversations: ConversationEntry[] = [];
    private loadingConversations = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly configManager: ConfigManager,
    ) {
        configManager.onDidChange(() => this.render());
    }

    // ── WebviewViewProvider ───────────────────────────────────────────────

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _ctx: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void | Thenable<void> {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        webviewView.webview.onDidReceiveMessage(
            (msg: { command: string; payload?: Record<string, unknown> }) =>
                this.handleMessage(msg),
            undefined,
            this.context.subscriptions,
        );

        this.render();
        this.loadConversations().then(() => this.render());
    }

    public refresh(): void { if (this.view) this.render(); }

    public async reloadConversations(): Promise<void> {
        await this.loadConversations();
        this.render();
    }

    /**
     * Update the Activity Bar badge — the number circle shown on the icon,
     * exactly like the Source Control badge.
     * count = 0 clears the badge.
     */
    public setBadge(count: number): void {
        if (!this.view) return;
        if (count > 0) {
            this.view.badge = {
                value:   count,
                tooltip: `${count} artifact file${count === 1 ? '' : 's'} pending sync`,
            };
        } else {
            this.view.badge = undefined;
        }
    }

    // ── Message handling ──────────────────────────────────────────────────

    private handleMessage(msg: {
        command: string;
        payload?: Record<string, unknown>;
    }): void {
        switch (msg.command) {

            case 'save': {
                const p = { ...(msg.payload ?? {}) } as Partial<ArtifactConfig>;

                if (Array.isArray(p.excludedExtensions)) {
                    p.excludedExtensions = (p.excludedExtensions as string[])
                        .map(e => String(e).trim()).filter(Boolean)
                        .map(e => e.startsWith('.') ? e : `.${e}`);
                }

                // Derive antigravityBrainPath from conversation selection
                if (p.linkedConversationId === FULL_BRAIN_ID) {
                    p.antigravityBrainPath = this.deriveBrainRoot();
                } else if (p.linkedConversationId) {
                    const match = this.conversations.find(c => c.id === p.linkedConversationId);
                    if (match) p.antigravityBrainPath = match.folderPath;
                } else {
                    p.antigravityBrainPath = this.deriveBrainRoot();
                }

                this.configManager.save(p);
                vscode.commands.executeCommand('antigravity.applyGitConfig');
                vscode.window.showInformationMessage('Antigravity: settings saved.');
                break;
            }

            case 'syncNow':
                vscode.commands.executeCommand('antigravity.syncNow');
                break;

            case 'refreshConversations':
                this.reloadConversations();
                break;

            case 'browseBrainRoot':
                vscode.window.showOpenDialog({
                    canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
                    title: 'Select Antigravity Brain Root Folder',
                    defaultUri: msg.payload?.['brainRoot']
                        ? vscode.Uri.file(String(msg.payload['brainRoot'])) : undefined,
                }).then(uris => {
                    if (!uris?.length) return;
                    const root = uris[0].fsPath;
                    this.configManager.save({ antigravityBrainPath: root });
                    this.loadConversations(root).then(() => this.render());
                });
                break;

            case 'autoDetectBrain': {
                const root = BrainFolderReader.defaultBrainRoot();
                this.configManager.save({ antigravityBrainPath: root });
                this.loadConversations(root).then(() => this.render());
                break;
            }

            case 'openGitHub':
                vscode.env.openExternal(vscode.Uri.parse(GITHUB_URL));
                break;
        }
    }

    // ── Conversation loading ──────────────────────────────────────────────

    private async loadConversations(explicitRoot?: string): Promise<void> {
        this.loadingConversations = true;
        const root = explicitRoot ?? this.deriveBrainRoot();
        try { this.conversations = await BrainFolderReader.readConversations(root); }
        catch { this.conversations = []; }
        this.loadingConversations = false;
    }

    private deriveBrainRoot(): string {
        const stored = this.configManager.config.antigravityBrainPath;
        if (!stored) return BrainFolderReader.defaultBrainRoot();
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (UUID_RE.test(path.basename(stored))) return path.dirname(stored);
        return stored;
    }

    // ── Render ────────────────────────────────────────────────────────────

    private render(): void {
        if (!this.view) return;
        this.view.webview.html = this.buildHtml(
            this.configManager.config,
            this.conversations,
            this.loadingConversations,
        );
    }

    // ── HTML ──────────────────────────────────────────────────────────────

    private buildHtml(cfg: ArtifactConfig, convos: ConversationEntry[], loading: boolean): string {

        const MODES: Array<{ v: SyncMode; l: string; hint: string }> = [
            { v: 'one-way-to-local', l: 'Brain → Project (default)', hint: 'Pull artifacts from the brain into your workspace.' },
            { v: 'one-way-to-brain', l: 'Project → Brain',           hint: 'Push local workspace files to the brain only.' },
            { v: 'bidirectional',    l: 'Bidirectional',             hint: 'Merge both sides — newest file wins on conflict.' },
        ];
        const STRATEGIES: Array<{ v: SyncStrategy; l: string; hint: string }> = [
            { v: 'real-time',  l: 'Real-time (file watcher)', hint: 'Sync on every save, debounced.' },
            { v: 'focus-out',  l: 'On window focus-out',       hint: 'Sync when you switch away from VS Code.' },
            { v: 'time-based', l: 'Time interval',             hint: 'Sync on a fixed background timer.' },
        ];

        const modeOpts = MODES.map(m =>
            `<option value="${m.v}"${cfg.syncMode === m.v ? ' selected' : ''}>${m.l}</option>`).join('');
        const stratOpts = STRATEGIES.map(s =>
            `<option value="${s.v}"${cfg.syncStrategy === s.v ? ' selected' : ''}>${s.l}</option>`).join('');

        // Conversation dropdown (3 tiers)
        let convOpts: string;
        if (loading) {
            convOpts = '<option disabled value="" selected>Loading conversations…</option>';
        } else {
            const isNone = !cfg.linkedConversationId;
            const isFull = cfg.linkedConversationId === FULL_BRAIN_ID;
            convOpts  = `<option value=""${isNone ? ' selected' : ''}>— No selection (sync disabled) —</option>\n`;
            convOpts += `<option value="${FULL_BRAIN_ID}"${isFull ? ' selected' : ''}>🗂 Sync Full Brain Root</option>\n`;
            if (convos.length > 0) {
                convOpts += `<option disabled>─── Conversations ───────────────</option>\n`;
                convOpts += convos.map(c => {
                    const sel  = cfg.linkedConversationId === c.id ? ' selected' : '';
                    const lbl  = c.title.length > 46 ? c.title.slice(0, 43) + '…' : c.title;
                    const date = c.createdAt ? ` · ${String(c.createdAt).slice(0, 10)}` : '';
                    const tip  = this.esc(`${c.title}${date}\n${c.id}`);
                    return `<option value="${this.esc(c.id)}"${sel} title="${tip}">💬 ${this.esc(lbl)}${this.esc(date)}</option>`;
                }).join('\n');
            } else {
                convOpts += `<option disabled>  (no conversations found)</option>`;
            }
        }

        // Badge + linked status
        const linkedConvo = convos.find(c => c.id === cfg.linkedConversationId);
        let badgeClass: string, badgeText: string;
        if (!cfg.linkedConversationId) {
            badgeClass = 'badge-off';  badgeText = '⊘ Sync disabled — select a target';
        } else if (cfg.linkedConversationId === FULL_BRAIN_ID) {
            badgeClass = 'badge-full'; badgeText = '🗂 Full brain root will be synced';
        } else if (linkedConvo) {
            badgeClass = 'badge-ok';   badgeText = `🔗 Linked: ${this.esc(linkedConvo.title)}`;
        } else {
            badgeClass = 'badge-ok';   badgeText = `🔗 Linked: ${cfg.linkedConversationId.slice(0, 8)}…`;
        }

        const chips = (cfg.excludedExtensions ?? []).map(ext =>
            `<span class="chip" data-ext="${this.esc(ext)}">${this.esc(ext)}<button type="button" class="chip-x" title="Remove">×</button></span>`
        ).join('');

        const brainRoot  = this.deriveBrainRoot();
        const modeHint   = MODES.find(m => m.v === cfg.syncMode)?.hint ?? '';
        const stratHint  = STRATEGIES.find(s => s.v === cfg.syncStrategy)?.hint ?? '';
        const gitChecked = cfg.gitTrackArtifact ? ' checked' : '';

        return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{
  --bg:    var(--vscode-sideBar-background,#1e1e1e);
  --fg:    var(--vscode-sideBar-foreground,#ccc);
  --bd:    var(--vscode-widget-border,#454545);
  --in:    var(--vscode-input-background,#2d2d2d);
  --infg:  var(--vscode-input-foreground,#ddd);
  --btn:   var(--vscode-button-background,#0e639c);
  --btnfg: var(--vscode-button-foreground,#fff);
  --btnhv: var(--vscode-button-hoverBackground,#1177bb);
  --btn2:  var(--vscode-button-secondaryBackground,#3a3d41);
  --bt2fg: var(--vscode-button-secondaryForeground,#ccc);
  --ac:    var(--vscode-focusBorder,#007fd4);
  --dim:   var(--vscode-descriptionForeground,#888);
  --bdg:   var(--vscode-badge-background,#4d4d4d);
  --bdgfg: var(--vscode-badge-foreground,#fff);
  --ok:    #2e7d32; --full:#1565c0; --off:#7a3f3f;
  --lnk:   var(--vscode-textLink-foreground,#4ec9b0);
  --r:3px;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family,'Segoe UI',sans-serif);font-size:var(--vscode-font-size,12px);background:var(--bg);color:var(--fg);padding-bottom:40px}
.sec{padding:10px 12px 4px;border-top:1px solid var(--bd);margin-top:4px}
.sec:first-child{border-top:none;margin-top:0}
.sec-hd{font-size:.76em;text-transform:uppercase;letter-spacing:.09em;color:var(--dim);margin-bottom:9px;display:flex;align-items:center;gap:5px}
.fld{margin-bottom:9px}
label{display:block;font-size:.87em;font-weight:600;margin-bottom:3px}
.hint{font-size:.79em;color:var(--dim);margin-top:2px;line-height:1.45}
select,input[type=text],input[type=number]{width:100%;padding:4px 7px;background:var(--in);color:var(--infg);border:1px solid var(--bd);border-radius:var(--r);font:inherit;outline:none}
select:focus,input:focus{border-color:var(--ac)}
.path-row{display:flex;gap:4px}
.path-row input{flex:1;min-width:0;font-size:.83em}
.ibtn{padding:3px 8px;background:var(--btn2);color:var(--bt2fg);border:1px solid var(--bd);border-radius:var(--r);font:inherit;cursor:pointer;white-space:nowrap;font-size:.82em}
.ibtn:hover{opacity:.82}
.badge{display:block;padding:4px 10px;border-radius:var(--r);font-size:.8em;margin-top:5px;line-height:1.4;border:1px solid transparent}
.badge-ok  {background:var(--ok);  color:#fff;border-color:#1b5e20}
.badge-full{background:var(--full);color:#fff;border-color:#0d47a1}
.badge-off {background:var(--off); color:#ffcdd2;border-color:#4e342e;font-style:italic}
.chips{display:flex;flex-wrap:wrap;gap:4px;min-height:8px;margin-bottom:5px}
.chip{display:inline-flex;align-items:center;gap:3px;background:var(--bdg);color:var(--bdgfg);padding:2px 7px;border-radius:10px;font-size:.82em}
.chip-x{background:none;border:none;color:inherit;cursor:pointer;font-size:1.05em;opacity:.7;padding:0 1px;line-height:1}
.chip-x:hover{opacity:1}
.chip-add{display:flex;gap:4px}
.chip-add input{flex:1;font-size:.84em}
/* Git toggle */
.toggle-row{display:flex;align-items:flex-start;gap:8px;margin-bottom:4px}
.toggle-row input[type=checkbox]{width:14px;height:14px;margin-top:2px;accent-color:var(--ac);flex-shrink:0;cursor:pointer}
.toggle-label{font-size:.87em;line-height:1.4;cursor:pointer}
/* About */
.about-body{font-size:.82em;line-height:1.6;color:var(--dim)}
.about-body a{color:var(--lnk);text-decoration:none;cursor:pointer}
.about-body a:hover{text-decoration:underline}
.about-row{display:flex;justify-content:space-between;align-items:center;margin-top:6px}
.version-tag{font-size:.75em;background:var(--bdg);color:var(--bdgfg);padding:1px 6px;border-radius:8px}
/* Actions */
.actions{display:flex;gap:6px;flex-wrap:wrap;padding:12px 12px 0}
.btn-primary{padding:5px 16px;background:var(--btn);color:var(--btnfg);border:none;border-radius:var(--r);font:inherit;cursor:pointer;font-weight:600}
.btn-primary:hover{background:var(--btnhv)}
.btn-secondary{padding:5px 12px;background:var(--btn2);color:var(--bt2fg);border:1px solid var(--bd);border-radius:var(--r);font:inherit;cursor:pointer}
.btn-secondary:hover{opacity:.82}
.status{font-size:.8em;color:var(--dim);padding:5px 12px;min-height:18px}
</style>
</head>
<body>
<form id="frm" autocomplete="off">

<!-- ═══ 1. BRAIN ROOT ═══════════════════════════════════════════════════ -->
<div class="sec">
  <div class="sec-hd"><svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h12v2H2zm0 4h12v2H2zm0 4h8v2H2z"/></svg>Brain Root</div>
  <div class="fld">
    <label for="brainRoot">Antigravity Brain Folder</label>
    <div class="path-row">
      <input type="text" id="brainRoot" value="${this.esc(brainRoot)}" placeholder="~/.gemini/antigravity-ide/brain" readonly />
      <button type="button" class="ibtn" id="browseBtn" title="Browse…">📁</button>
      <button type="button" class="ibtn" id="autoBtn"   title="Auto-detect">⚡</button>
    </div>
    <p class="hint">Root folder containing UUID conversation sub-folders.</p>
  </div>
</div>

<!-- ═══ 2. SYNC TARGET ══════════════════════════════════════════════════ -->
<div class="sec">
  <div class="sec-hd"><svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3a5 5 0 0 1 4.9 4H13a3 3 0 0 1 0 6h-1v-2h1a1 1 0 0 0 0-2H9.9A5 5 0 1 1 6 3zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>Sync Target</div>
  <div class="fld">
    <label for="convSel">Antigravity Conversation</label>
    <select id="convSel" name="linkedConversationId">${convOpts}</select>
    <div class="badge ${badgeClass}" id="statusBadge">${badgeText}</div>
    <p class="hint"><strong>No selection</strong> — sync disabled.<br><strong>Full Brain Root</strong> — syncs every conversation.<br><strong>A conversation</strong> — syncs only that artifact folder.</p>
  </div>
</div>

<!-- ═══ 3. SYNC METHOD ══════════════════════════════════════════════════ -->
<div class="sec">
  <div class="sec-hd"><svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2.5l-11 11M4 2H2v2h2V2zM12 12h2v2h-2v-2z"/></svg>Sync Method</div>
  <div class="fld">
    <label for="syncMode">Sync Direction</label>
    <select id="syncMode" name="syncMode">${modeOpts}</select>
    <p class="hint" id="modeHint">${this.esc(modeHint)}</p>
  </div>
  <div class="fld">
    <label for="syncStrat">Trigger Strategy</label>
    <select id="syncStrat" name="syncStrategy">${stratOpts}</select>
    <p class="hint" id="stratHint">${this.esc(stratHint)}</p>
  </div>
</div>

<!-- ═══ 4. TIMING ═══════════════════════════════════════════════════════ -->
<div class="sec">
  <div class="sec-hd"><svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.5 7.2h-3v-1h2V4h1v4.2z"/></svg>Timing</div>
  <div class="fld">
    <label for="debounce">Debounce (ms)</label>
    <input type="number" id="debounce" name="debounceTimeoutMs" min="100" max="30000" step="100" value="${cfg.debounceTimeoutMs}"/>
    <p class="hint">Wait after last file change before real-time sync fires.</p>
  </div>
  <div class="fld">
    <label for="interval">Interval (minutes)</label>
    <input type="number" id="interval" name="timeIntervalMinutes" min="1" max="1440" step="1" value="${cfg.timeIntervalMinutes}"/>
    <p class="hint">Used only with <em>Time interval</em> strategy.</p>
  </div>
</div>

<!-- ═══ 5. EXCLUSIONS ══════════════════════════════════════════════════ -->
<div class="sec">
  <div class="sec-hd"><svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 15h14L8 1zm-.7 5.5h1.4v4H7.3v-4zm0 5h1.4v1.5H7.3V11.5z"/></svg>Exclusions</div>
  <div class="fld">
    <label>Excluded File Extensions</label>
    <div class="chips" id="chipRow">${chips}</div>
    <div class="chip-add">
      <input type="text" id="extIn" placeholder=".tmp" maxlength="20"/>
      <button type="button" class="ibtn" id="addExtBtn">+ Add</button>
    </div>
    <p class="hint">Files with these extensions are never synced.</p>
  </div>
</div>

<!-- ═══ 6. GIT INTEGRATION ═════════════════════════════════════════════ -->
<div class="sec">
  <div class="sec-hd"><svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M15.7 7.3l-7-7a1 1 0 0 0-1.4 0l-7 7a1 1 0 0 0 0 1.4l7 7a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4zM9 12H7v-2h2v2zm0-4H7V4h2v4z"/></svg>Git Integration</div>
  <div class="fld">
    <div class="toggle-row">
      <input type="checkbox" id="gitTrack" name="gitTrackArtifact"${gitChecked}/>
      <label class="toggle-label" for="gitTrack">
        <strong>Add .artifact to git</strong><br>
        <span style="font-weight:400;font-size:.9em">When checked, the <code>.artifact</code> folder is committed to source control. When unchecked, it is added to <code>.gitignore</code>.</span>
      </label>
    </div>
  </div>
</div>

<!-- ═══ 7. ABOUT ════════════════════════════════════════════════════════ -->
<div class="sec">
  <div class="sec-hd"><svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3h1.5v1.5h-1.5V4zm0 3h1.5v5h-1.5V7z"/></svg>About</div>
  <div class="fld">
    <div class="about-body">
      <strong>Artifact Manager for Antigravity</strong><br>
      Bidirectional sync between VS Code workspaces and the Google Antigravity IDE brain folder.<br><br>
      <strong>Key features:</strong>
      <ul style="margin:4px 0 4px 14px;padding:0">
        <li>Activity Bar icon with real-time pending-change badge</li>
        <li>Conversation browser — reads titles from <code>task.md</code> &amp; <code>transcript.jsonl</code></li>
        <li>Brain → Project, Project → Brain, or Bidirectional sync</li>
        <li>Real-time file watcher, focus-out, or time-interval strategies</li>
        <li>Per-conversation artifact isolation</li>
        <li>Git integration toggle for <code>.artifact</code> folder</li>
        <li>Cross-platform: Windows · macOS · Linux</li>
      </ul>
      <div class="about-row">
        <span>Author: <strong>${AUTHOR}</strong> &nbsp;·&nbsp; MIT License</span>
        <span class="version-tag">v${EXT_VERSION}</span>
      </div>
      <div style="margin-top:6px">
        <a id="ghLink" href="#">⎈ GitHub Repository</a>
      </div>
    </div>
  </div>
</div>

</form>

<div class="actions">
  <button class="btn-primary"   id="saveBtn" type="button">Save Settings</button>
  <button class="btn-secondary" id="syncBtn" type="button">⟳ Sync Now</button>
</div>
<p class="status" id="status"></p>

<script>
const vsc = acquireVsCodeApi();
const FULL_BRAIN = '${FULL_BRAIN_ID}';

/* ── live hints ── */
const MODE_HINTS={
  'one-way-to-local':'Pull artifacts from the brain into your workspace.',
  'one-way-to-brain':'Push local workspace files to the brain only.',
  'bidirectional':   'Merge both sides — newest file wins on conflict.',
};
const STRAT_HINTS={
  'real-time': 'Sync on every save, debounced.',
  'focus-out': 'Sync when you switch away from VS Code.',
  'time-based':'Sync on a fixed background timer.',
};
document.getElementById('syncMode') .addEventListener('change',e=>{document.getElementById('modeHint').textContent=MODE_HINTS[e.target.value]||'';});
document.getElementById('syncStrat').addEventListener('change',e=>{document.getElementById('stratHint').textContent=STRAT_HINTS[e.target.value]||'';});

/* ── conversation badge ── */
document.getElementById('convSel').addEventListener('change',e=>{
  const badge=document.getElementById('statusBadge');
  const val=e.target.value;
  const lbl=e.target.options[e.target.selectedIndex].text;
  if(!val){badge.textContent='⊘ Sync disabled — select a target';badge.className='badge badge-off';}
  else if(val===FULL_BRAIN){badge.textContent='🗂 Full brain root will be synced';badge.className='badge badge-full';}
  else{badge.textContent='🔗 Linked: '+lbl.replace(/^💬 /,'').replace(/ · [\d-]+$/,'');badge.className='badge badge-ok';}
});

/* ── chips ── */
const chipRow=document.getElementById('chipRow');
const extIn=document.getElementById('extIn');
function addChip(raw){
  let ext=raw.trim();if(!ext)return;if(!ext.startsWith('.'))ext='.'+ext;
  if([...chipRow.querySelectorAll('.chip')].some(c=>c.dataset.ext===ext))return;
  const s=document.createElement('span');s.className='chip';s.dataset.ext=ext;
  s.innerHTML=esc(ext)+'<button type="button" class="chip-x" title="Remove">×</button>';
  s.querySelector('.chip-x').addEventListener('click',()=>s.remove());
  chipRow.appendChild(s);
}
document.getElementById('addExtBtn').addEventListener('click',()=>{addChip(extIn.value);extIn.value='';extIn.focus();});
extIn.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addChip(extIn.value);extIn.value='';}});
chipRow.addEventListener('click',e=>{const b=e.target.closest('.chip-x');if(b)b.closest('.chip').remove();});

/* ── browse / auto-detect ── */
document.getElementById('browseBtn').addEventListener('click',()=>{vsc.postMessage({command:'browseBrainRoot',payload:{brainRoot:document.getElementById('brainRoot').value}});});
document.getElementById('autoBtn')  .addEventListener('click',()=>{vsc.postMessage({command:'autoDetectBrain'});flash('Detecting brain folder…');});

/* ── GitHub link ── */
document.getElementById('ghLink').addEventListener('click',e=>{e.preventDefault();vsc.postMessage({command:'openGitHub'});});

/* ── save ── */
document.getElementById('saveBtn').addEventListener('click',()=>{
  const fd=new FormData(document.getElementById('frm'));
  const exts=[...chipRow.querySelectorAll('.chip')].map(c=>c.dataset.ext).filter(Boolean);
  vsc.postMessage({command:'save',payload:{
    syncMode:            fd.get('syncMode')||'one-way-to-local',
    syncStrategy:        fd.get('syncStrategy')||'real-time',
    debounceTimeoutMs:   Number(fd.get('debounceTimeoutMs'))||1000,
    timeIntervalMinutes: Number(fd.get('timeIntervalMinutes'))||15,
    linkedConversationId:fd.get('linkedConversationId')||'',
    gitTrackArtifact:    document.getElementById('gitTrack').checked,
    excludedExtensions:  exts,
  }});
  flash('✓ Saved');
});

/* ── sync now ── */
document.getElementById('syncBtn').addEventListener('click',()=>{
  if(!document.getElementById('convSel').value){flash('⊘ Select a sync target first');return;}
  vsc.postMessage({command:'syncNow'});flash('Sync triggered…');
});

/* ── helpers ── */
function flash(msg){const el=document.getElementById('status');el.textContent=msg;setTimeout(()=>{if(el.textContent===msg)el.textContent='';},3000);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
</script>
</body>
</html>`;
    }

    private esc(v: string): string {
        return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
}
