# Artifact Manager for Antigravity

**Version 1.0.2** · Author: [x1t9](https://github.com/x1t9) · License: MIT

Bidirectional sync between VS Code workspaces and the Google Antigravity IDE brain folder, with an Activity Bar sidebar for real-time configuration and monitoring.

---

## Features

| Feature | Description |
|---|---|
| **Activity Bar icon** | Dedicated sidebar icon — click to open settings at any time |
| **Real-time change badge** | Number of pending changes shown on the Activity Bar icon, just like Source Control |
| **Conversation browser** | Reads titles from `task.md` (IDE) or `transcript.jsonl` (CLI) — no UUIDs in the dropdown |
| **Three sync directions** | Brain → Project *(default)*, Project → Brain, or Bidirectional |
| **Three trigger strategies** | Real-time file watcher, focus-out, or time-interval |
| **Conversation isolation** | Link a workspace to one specific conversation — only that artifact folder syncs |
| **Status bar icon** | Red (unsynced) · Orange spinning (syncing) · Green (synced) |
| **Git integration** | Checkbox to add/remove `.artifact` from `.gitignore` and git tracking |
| **Cross-platform** | Windows · macOS · Linux with automatic brain root detection |

---

## Brain Root Detection

The extension automatically detects the Antigravity brain folder:

| Platform | Primary path |
|---|---|
| **Windows** | `%USERPROFILE%\.gemini\antigravity-ide\brain` |
| **macOS** | `~/Library/Application Support/antigravity-ide/brain` |
| **Linux** | `$XDG_CONFIG_HOME/antigravity-ide/brain` or `~/.gemini/antigravity-ide/brain` |

Legacy CLI paths (`~/.gemini/antigravity/brain`) are also checked as fallbacks.

---

## Quick Start

1. Install the `.vsix` file:
   ```
   code --install-extension artifact-manager-for-antigravity-1.0.1.vsix
   ```
2. Click the **Antigravity** icon in the Activity Bar.
3. The brain root is auto-detected. Hit **⚡** to confirm or **📁** to browse manually.
4. Pick a conversation from the dropdown — the conversation name is read directly from `task.md`.
5. Choose sync direction (default: **Brain → Project**) and hit **Save Settings**.
6. The extension syncs automatically; the Activity Bar badge shows pending changes.

---

## Conversation Dropdown

- **No selection** — sync is fully disabled.
- **🗂 Sync Full Brain Root** — syncs all conversation folders.
- **💬 \<Conversation title\>** — syncs only that conversation's artifact folder.

Title resolution: `task.md` first line → `transcript.jsonl` first user prompt → UUID short-form fallback.

---

## Git Integration

Check **Add .artifact to git** to commit the `.artifact` folder to your repository.  
Leave unchecked (default) to add `.artifact/` to `.gitignore` and remove it from git tracking automatically.

---

## Configuration Schema (`.artifact/config.json`)

```json
{
  "antigravityBrainPath": "C:\\Users\\USER\\.gemini\\antigravity-ide\\brain",
  "localArtifactFolder": ".artifact",
  "syncMode": "one-way-to-local",
  "syncStrategy": "real-time",
  "debounceTimeoutMs": 1000,
  "timeIntervalMinutes": 15,
  "excludedExtensions": [".tmp", ".log"],
  "linkedConversationId": "82e36bb8-70f4-4cee-9010-888e5d93a437",
  "gitTrackArtifact": false
}
```

| Field | Type | Description |
|---|---|---|
| `syncMode` | string | `one-way-to-local` · `one-way-to-brain` · `bidirectional` |
| `syncStrategy` | string | `real-time` · `focus-out` · `time-based` |
| `linkedConversationId` | string | UUID of linked conversation or `__FULL_BRAIN__` |
| `gitTrackArtifact` | boolean | Track `.artifact` in git (default `false`) |

---

## Building from Source

```bash
git clone https://github.com/x1t9/ArtificatManagerAntigravityIDE
cd ArtificatManagerAntigravityIDE
npm install
npm run compile
npm test
npm run package
```

---

## Repository

**GitHub:** [github.com/x1t9/ArtificatManagerAntigravityIDE](https://github.com/x1t9/ArtificatManagerAntigravityIDE)

Issues and pull requests are welcome.

---

## License

MIT © 2026 [x1t9](https://github.com/x1t9)
