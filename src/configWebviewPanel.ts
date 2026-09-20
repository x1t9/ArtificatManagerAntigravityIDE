/**
 * ConfigWebviewPanel
 * ──────────────────
 * Opens an interactive webview panel that lets the user edit every field of
 * ArtifactConfig via dropdowns, text inputs, and tag-style chips for
 * excludedExtensions. Changes are written back via ConfigManager.save().
 */

import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { ArtifactConfig, SyncMode, SyncStrategy } from './types';

export class ConfigWebviewPanel {
    private static readonly VIEW_TYPE = 'antigravity.config';
    private static instance: ConfigWebviewPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly configManager: ConfigManager;
    private disposables: vscode.Disposable[] = [];

    // ── Factory ───────────────────────────────────────────────────────────

    /** Open or reveal the config panel (singleton per workspace). */
    public static show(
        context: vscode.ExtensionContext,
        configManager: ConfigManager,
    ): ConfigWebviewPanel {
        if (ConfigWebviewPanel.instance) {
            ConfigWebviewPanel.instance.panel.reveal(vscode.ViewColumn.One);
            return ConfigWebviewPanel.instance;
        }

        const panel = vscode.window.createWebviewPanel(
            ConfigWebviewPanel.VIEW_TYPE,
            'Antigravity: Sync Configuration',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        ConfigWebviewPanel.instance = new ConfigWebviewPanel(panel, configManager);
        return ConfigWebviewPanel.instance;
    }

    // ── Constructor ───────────────────────────────────────────────────────

    private constructor(panel: vscode.WebviewPanel, configManager: ConfigManager) {
        this.panel         = panel;
        this.configManager = configManager;

        this.render();

        // Re-render if config changes externally (e.g. engine restart)
        this.disposables.push(
            configManager.onDidChange(() => this.render()),
        );

        // Handle messages from the webview
        this.disposables.push(
            panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg)),
        );

        // Clean up on close
        panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    // ── Message handler ───────────────────────────────────────────────────

    private handleMessage(msg: { command: string; payload?: Partial<ArtifactConfig> }): void {
        switch (msg.command) {
            case 'save':
                if (msg.payload) {
                    // Normalise excludedExtensions: ensure each starts with '.'
                    if (Array.isArray(msg.payload.excludedExtensions)) {
                        msg.payload.excludedExtensions = msg.payload.excludedExtensions
                            .map((e: string) => e.trim())
                            .filter(Boolean)
                            .map((e: string) => (e.startsWith('.') ? e : `.${e}`));
                    }
                    this.configManager.save(msg.payload);
                    vscode.window.showInformationMessage(
                        'Antigravity config saved. Changes take effect on next sync.',
                    );
                }
                break;

            case 'syncNow':
                vscode.commands.executeCommand('antigravity.syncNow');
                break;
        }
    }

    // ── Render ────────────────────────────────────────────────────────────

    private render(): void {
        this.panel.webview.html = this.buildHtml(this.configManager.config);
    }

    private buildHtml(cfg: ArtifactConfig): string {
        const syncModes: SyncMode[]       = ['bidirectional', 'one-way-to-local', 'one-way-to-brain'];
        const syncStrategies: SyncStrategy[] = ['real-time', 'focus-out', 'time-based'];

        const modeOptions = syncModes
            .map(m => `<option value="${m}" ${cfg.syncMode === m ? 'selected' : ''}>${this.label(m)}</option>`)
            .join('\n');

        const strategyOptions = syncStrategies
            .map(s => `<option value="${s}" ${cfg.syncStrategy === s ? 'selected' : ''}>${this.label(s)}</option>`)
            .join('\n');

        const extensionChips = (cfg.excludedExtensions ?? [])
            .map(ext => `<span class="chip" data-ext="${this.esc(ext)}">${this.esc(ext)} <button type="button" class="chip-remove" data-ext="${this.esc(ext)}">×</button></span>`)
            .join('');

        return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Antigravity Sync Configuration</title>
<style>
  :root {
    --bg:         var(--vscode-editor-background);
    --fg:         var(--vscode-editor-foreground);
    --border:     var(--vscode-input-border, #555);
    --input-bg:   var(--vscode-input-background);
    --input-fg:   var(--vscode-input-foreground);
    --accent:     var(--vscode-button-background, #0078d4);
    --accent-fg:  var(--vscode-button-foreground, #fff);
    --hover:      var(--vscode-button-hoverBackground, #005fa3);
    --chip-bg:    var(--vscode-badge-background, #333);
    --chip-fg:    var(--vscode-badge-foreground, #fff);
    --radius:     4px;
    --section-gap: 28px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size:   var(--vscode-font-size, 13px);
    background:  var(--bg);
    color:       var(--fg);
    margin: 0;
    padding: 24px 32px 48px;
    max-width: 680px;
  }
  h1 { font-size: 1.3em; margin: 0 0 6px; }
  .subtitle { opacity: .65; margin: 0 0 var(--section-gap); font-size: .92em; }
  section { margin-bottom: var(--section-gap); }
  h2 { font-size: 1em; text-transform: uppercase; letter-spacing: .07em;
       opacity: .55; margin: 0 0 14px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .field { margin-bottom: 16px; }
  label { display: block; margin-bottom: 5px; font-weight: 600; font-size: .92em; }
  .hint { font-size: .85em; opacity: .6; margin-top: 3px; }
  select, input[type="text"], input[type="number"] {
    width: 100%; padding: 6px 9px;
    background: var(--input-bg); color: var(--input-fg);
    border: 1px solid var(--border); border-radius: var(--radius);
    font: inherit; outline: none;
  }
  select:focus, input:focus { border-color: var(--accent); }

  /* Chips */
  .chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--chip-bg); color: var(--chip-fg);
    padding: 3px 8px; border-radius: 12px; font-size: .85em;
  }
  .chip-remove {
    background: none; border: none; color: inherit; cursor: pointer;
    font-size: 1em; padding: 0; line-height: 1;
    opacity: .7;
  }
  .chip-remove:hover { opacity: 1; }
  .chip-add-row { display: flex; gap: 8px; }
  .chip-add-row input { flex: 1; }

  /* Buttons */
  .btn-row { display: flex; gap: 10px; margin-top: 8px; }
  button.primary, button.secondary {
    padding: 7px 18px; border: none; border-radius: var(--radius);
    font: inherit; cursor: pointer;
  }
  button.primary   { background: var(--accent); color: var(--accent-fg); }
  button.primary:hover   { background: var(--hover); }
  button.secondary { background: var(--vscode-button-secondaryBackground, #3a3d41);
                     color: var(--vscode-button-secondaryForeground, #ccc); }
  button.secondary:hover { opacity: .85; }

  .status-msg { font-size: .88em; opacity: .65; margin-top: 10px; height: 1.4em; }
</style>
</head>
<body>
<h1>$(sync) Antigravity Sync Configuration</h1>
<p class="subtitle">Settings are stored in <code>.artifact/config.json</code> in your workspace root.</p>

<form id="form">

  <section>
    <h2>Brain Target</h2>

    <div class="field">
      <label for="brainPath">Antigravity Brain Path</label>
      <input type="text" id="brainPath" name="antigravityBrainPath"
             value="${this.esc(cfg.antigravityBrainPath)}"
             placeholder="~/.gemini/antigravity/brain" />
      <p class="hint">Absolute path (or ~ for home dir) to the Antigravity brain folder.</p>
    </div>

    <div class="field">
      <label for="localFolder">Local Artifact Folder</label>
      <input type="text" id="localFolder" name="localArtifactFolder"
             value="${this.esc(cfg.localArtifactFolder)}" placeholder=".artifact" />
      <p class="hint">Folder name relative to workspace root that holds local artifacts.</p>
    </div>
  </section>

  <section>
    <h2>Sync Behaviour</h2>

    <div class="field">
      <label for="syncMode">Sync Mode</label>
      <select id="syncMode" name="syncMode">
        ${modeOptions}
      </select>
      <p class="hint">
        <strong>Bidirectional</strong> — merge both sides (newest wins on conflict).<br>
        <strong>One-way → Local</strong> — brain always overwrites local.<br>
        <strong>One-way → Brain</strong> — local always overwrites brain.
      </p>
    </div>

    <div class="field">
      <label for="syncStrategy">Sync Strategy</label>
      <select id="syncStrategy" name="syncStrategy">
        ${strategyOptions}
      </select>
      <p class="hint">
        <strong>Real-time</strong> — watches for file changes (debounced).<br>
        <strong>Focus-out</strong> — syncs when you switch away from VS Code.<br>
        <strong>Time-based</strong> — syncs on a fixed interval.
      </p>
    </div>
  </section>

  <section>
    <h2>Timing</h2>

    <div class="field">
      <label for="debounce">Debounce Timeout (ms)</label>
      <input type="number" id="debounce" name="debounceTimeoutMs" min="100" max="30000" step="100"
             value="${cfg.debounceTimeoutMs}" />
      <p class="hint">How long to wait after the last file change before triggering a real-time sync.</p>
    </div>

    <div class="field">
      <label for="interval">Sync Interval (minutes)</label>
      <input type="number" id="interval" name="timeIntervalMinutes" min="1" max="1440" step="1"
             value="${cfg.timeIntervalMinutes}" />
      <p class="hint">Used only when strategy is <strong>Time-based</strong>.</p>
    </div>
  </section>

  <section>
    <h2>Exclusions</h2>

    <div class="field">
      <label>Excluded Extensions</label>
      <div class="chip-row" id="chipRow">${extensionChips}</div>
      <div class="chip-add-row">
        <input type="text" id="extInput" placeholder=".tmp" maxlength="20" />
        <button type="button" class="secondary" id="addExtBtn">Add</button>
      </div>
      <p class="hint">Files with these extensions are skipped during sync.</p>
    </div>
  </section>

  <div class="btn-row">
    <button type="submit" class="primary">Save Configuration</button>
    <button type="button" class="secondary" id="syncNowBtn">$(sync~spin) Sync Now</button>
  </div>
  <p class="status-msg" id="statusMsg"></p>

</form>

<script>
  const vscode = acquireVsCodeApi();

  // ── Chip management ──────────────────────────────────────────────────
  const chipRow  = document.getElementById('chipRow');
  const extInput = document.getElementById('extInput');

  function addChip(ext) {
    ext = ext.trim();
    if (!ext) return;
    if (!ext.startsWith('.')) ext = '.' + ext;
    // Deduplicate
    if ([...chipRow.querySelectorAll('.chip')].some(c => c.dataset.ext === ext)) return;

    const span = document.createElement('span');
    span.className = 'chip';
    span.dataset.ext = ext;
    span.innerHTML = \`\${escHtml(ext)} <button type="button" class="chip-remove" data-ext="\${escHtml(ext)}">×</button>\`;
    span.querySelector('.chip-remove').addEventListener('click', () => span.remove());
    chipRow.appendChild(span);
  }

  document.getElementById('addExtBtn').addEventListener('click', () => {
    addChip(extInput.value);
    extInput.value = '';
    extInput.focus();
  });

  extInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addChip(extInput.value); extInput.value = ''; }
  });

  // Delegate chip removal (for server-rendered chips)
  chipRow.addEventListener('click', e => {
    const btn = e.target.closest('.chip-remove');
    if (btn) btn.closest('.chip').remove();
  });

  // ── Form submit ──────────────────────────────────────────────────────
  document.getElementById('form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);

    const excludedExtensions = [...chipRow.querySelectorAll('.chip')]
      .map(c => c.dataset.ext)
      .filter(Boolean);

    const payload = {
      antigravityBrainPath:  fd.get('antigravityBrainPath')  || '',
      localArtifactFolder:   fd.get('localArtifactFolder')   || '.artifact',
      syncMode:              fd.get('syncMode'),
      syncStrategy:          fd.get('syncStrategy'),
      debounceTimeoutMs:     Number(fd.get('debounceTimeoutMs'))  || 1000,
      timeIntervalMinutes:   Number(fd.get('timeIntervalMinutes')) || 15,
      excludedExtensions,
    };

    vscode.postMessage({ command: 'save', payload });

    const msg = document.getElementById('statusMsg');
    msg.textContent = '✓ Saved';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  });

  // ── Sync now button ──────────────────────────────────────────────────
  document.getElementById('syncNowBtn').addEventListener('click', () => {
    vscode.postMessage({ command: 'syncNow' });
    const msg = document.getElementById('statusMsg');
    msg.textContent = 'Sync triggered…';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  });

  // ── Helpers ──────────────────────────────────────────────────────────
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
</script>
</body>
</html>`;
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /** Escape a value for safe use in HTML attribute or text. */
    private esc(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Convert a camelCase/hyphenated key into a readable label. */
    private label(s: string): string {
        return s
            .replace(/-/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    public dispose(): void {
        ConfigWebviewPanel.instance = undefined;
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
