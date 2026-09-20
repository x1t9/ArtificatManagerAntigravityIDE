/**
 * BrainFolderReader
 * ─────────────────
 * Scans the Antigravity brain root for UUID conversation folders and
 * resolves a human-readable title for each one.
 *
 * ── Storage layout (confirmed on Windows, Antigravity IDE 2.5.5) ───────
 *
 *   <brainRoot>/<UUID>/
 *       task.md                                ← IDE title (# Heading)
 *       .system_generated/logs/transcript.jsonl  ← CLI first user prompt
 *
 * ── Title resolution per folder (first match wins) ─────────────────────
 *
 *   1. task.md   — first non-empty line, strip "# " heading prefix.
 *   2. transcript.jsonl  — first USER_EXPLICIT turn → text between
 *      <USER_REQUEST>…</USER_REQUEST> tags, max 80 chars.
 *   3. UUID short-form fallback: "82e36bb8…3437"
 *
 * ── Cross-platform brain root detection ────────────────────────────────
 *
 *   Windows:
 *     %USERPROFILE%\.gemini\antigravity-ide\brain   ← IDE primary (confirmed)
 *     %USERPROFILE%\.gemini\antigravity\brain       ← CLI / legacy
 *     %APPDATA%\Google\antigravity\brain            ← APPDATA variant
 *
 *   macOS:
 *     ~/Library/Application Support/antigravity-ide/brain  ← IDE
 *     ~/.gemini/antigravity-ide/brain                      ← fallback
 *     ~/.gemini/antigravity/brain                          ← CLI
 *
 *   Linux:
 *     ~/.config/antigravity-ide/brain    ← XDG_CONFIG standard
 *     ~/.gemini/antigravity-ide/brain    ← home-dir variant
 *     ~/.gemini/antigravity/brain        ← CLI
 *
 * ── FULL_BRAIN_ID sentinel ─────────────────────────────────────────────
 *
 *   "__FULL_BRAIN__" means "sync the entire brain root rather than a
 *   specific conversation folder".
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { ConversationEntry } from './types';

/** Sentinel used for the "sync full brain root" option in the UI. */
export const FULL_BRAIN_ID = '__FULL_BRAIN__';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BrainFolderReader {

    // ── Default brain root (cross-platform) ──────────────────────────────

    public static defaultBrainRoot(): string {
        const home = os.homedir();
        const candidates = BrainFolderReader.buildCandidates(home);

        for (const c of candidates) {
            if (fs.existsSync(c)) return c;
        }
        return candidates[0]; // best guess even if it doesn't exist yet
    }

    /** All candidate brain root paths ordered by preference for the current OS. */
    private static buildCandidates(home: string): string[] {
        switch (process.platform) {

            case 'win32': {
                const appdata = process.env['APPDATA'] ?? '';
                return [
                    path.join(home,    '.gemini', 'antigravity-ide', 'brain'),  // IDE primary
                    path.join(home,    '.gemini', 'antigravity',     'brain'),  // CLI / legacy
                    ...(appdata ? [path.join(appdata, 'Google', 'antigravity', 'brain')] : []),
                ];
            }

            case 'darwin': {
                const lib = path.join(home, 'Library', 'Application Support');
                return [
                    path.join(lib,  'antigravity-ide', 'brain'),    // IDE primary on macOS
                    path.join(home, '.gemini', 'antigravity-ide', 'brain'),
                    path.join(home, '.gemini', 'antigravity',     'brain'),
                ];
            }

            default: {
                // Linux / other POSIX
                const xdg = process.env['XDG_CONFIG_HOME'] ?? path.join(home, '.config');
                return [
                    path.join(xdg,  'antigravity-ide', 'brain'),    // XDG standard
                    path.join(home, '.gemini', 'antigravity-ide', 'brain'),
                    path.join(home, '.gemini', 'antigravity',     'brain'),
                ];
            }
        }
    }

    /** All candidate roots for a given home dir (exposed for scanning all). */
    public static allCandidates(): string[] {
        return BrainFolderReader.buildCandidates(os.homedir());
    }

    // ── Scan brain root ───────────────────────────────────────────────────

    public static async readConversations(brainRoot: string): Promise<ConversationEntry[]> {
        if (!fs.existsSync(brainRoot)) return [];

        let uuidFolders: string[] = [];
        try {
            uuidFolders = fs
                .readdirSync(brainRoot, { withFileTypes: true })
                .filter(e => e.isDirectory() && UUID_RE.test(e.name))
                .map(e => e.name);
        } catch {
            return [];
        }

        if (uuidFolders.length === 0) return [];

        const entries: ConversationEntry[] = uuidFolders.map(id => {
            const folderPath = path.join(brainRoot, id);
            const { title, createdAt } = BrainFolderReader.resolveTitle(folderPath);
            return { id, title, folderPath, createdAt };
        });

        // Named entries first, then alphabetical
        entries.sort((a, b) => {
            const aHas = !a.title.includes('…');
            const bHas = !b.title.includes('…');
            if (aHas !== bHas) return aHas ? -1 : 1;
            return a.title.localeCompare(b.title);
        });

        return entries;
    }

    /** Count changed files between brainRoot and localDir (used for badge). */
    public static countChanges(brainRoot: string, localDir: string): number {
        if (!fs.existsSync(brainRoot) || !fs.existsSync(localDir)) return 0;
        let count = 0;
        try {
            const brainFiles = BrainFolderReader.walkFiles(brainRoot);
            for (const rel of brainFiles) {
                const brainFile = path.join(brainRoot, rel);
                const localFile = path.join(localDir,  rel);
                if (!fs.existsSync(localFile)) { count++; continue; }
                const bs = fs.statSync(brainFile).mtimeMs;
                const ls = fs.statSync(localFile).mtimeMs;
                if (Math.abs(bs - ls) > 1000) count++;
            }
        } catch { /* ignore */ }
        return count;
    }

    private static walkFiles(dir: string, rel = ''): string[] {
        const results: string[] = [];
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) results.push(...BrainFolderReader.walkFiles(path.join(dir, e.name), r));
            else results.push(r);
        }
        return results;
    }

    // ── Per-folder title resolution ───────────────────────────────────────

    public static resolveTitle(folderPath: string): { title: string; createdAt?: string } {

        // 1. task.md (Antigravity IDE)
        const taskMd = path.join(folderPath, 'task.md');
        if (fs.existsSync(taskMd)) {
            try {
                const title = BrainFolderReader.readTaskMd(taskMd);
                if (title) {
                    const stat = fs.statSync(taskMd);
                    const createdAt = (stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime)
                        .toISOString().slice(0, 10);
                    return { title, createdAt };
                }
            } catch { /* fall through */ }
        }

        // 2. transcript.jsonl (Antigravity CLI / 2.0)
        const transcript = path.join(folderPath, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(transcript)) {
            try {
                const title = BrainFolderReader.readTranscript(transcript);
                if (title) {
                    const stat = fs.statSync(transcript);
                    const createdAt = (stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime)
                        .toISOString().slice(0, 10);
                    return { title, createdAt };
                }
            } catch { /* fall through */ }
        }

        // 3. UUID short-form fallback
        return { title: BrainFolderReader.shortId(path.basename(folderPath)) };
    }

    // ── task.md parser ────────────────────────────────────────────────────

    private static readTaskMd(p: string): string | null {
        const buf  = Buffer.alloc(512);
        const fd   = fs.openSync(p, 'r');
        const read = fs.readSync(fd, buf, 0, 512, 0);
        fs.closeSync(fd);

        for (const raw of buf.slice(0, read).toString('utf-8').split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            if (line.startsWith('## ')) return line.slice(3).trim() || null;
            if (line.startsWith('# '))  return line.slice(2).trim() || null;
            if (line.startsWith('#'))   return line.slice(1).trim() || null;
            // Task list item: "- [x] Description"
            const cleaned = line
                .replace(/^[-*]\s*\[.?\]\s*/, '')
                .replace(/^[-*]\s+/, '')
                .trim();
            return cleaned.slice(0, 100) || null;
        }
        return null;
    }

    // ── transcript.jsonl parser ───────────────────────────────────────────

    private static readTranscript(p: string): string | null {
        const buf  = Buffer.alloc(8192);
        const fd   = fs.openSync(p, 'r');
        const read = fs.readSync(fd, buf, 0, 8192, 0);
        fs.closeSync(fd);

        for (const rawLine of buf.slice(0, read).toString('utf-8').split('\n')) {
            const line = rawLine.trim();
            if (!line) continue;
            let obj: Record<string, unknown>;
            try { obj = JSON.parse(line); } catch { continue; }

            if (obj['source'] !== 'USER_EXPLICIT') continue;
            const rawContent = String(obj['content'] ?? '').trim();
            if (!rawContent) continue;

            const tagMatch = rawContent.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
            if (tagMatch?.[1]) {
                const t = tagMatch[1].split('\n')[0].trim().slice(0, 80);
                if (t.length > 2) return t;
            }
            const firstLine = rawContent.split('\n').find(l => l.trim() && !l.trim().startsWith('<'));
            if (firstLine) return firstLine.trim().slice(0, 80);
        }
        return null;
    }

    private static shortId(uuid: string): string {
        return `${uuid.slice(0, 8)}…${uuid.slice(-4)}`;
    }
}
