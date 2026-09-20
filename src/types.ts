/**
 * Shared type definitions for Artifact Manager for Antigravity.
 * v1.0.1
 */

export type SyncMode     = 'bidirectional' | 'one-way-to-local' | 'one-way-to-brain';
export type SyncStrategy = 'real-time' | 'focus-out' | 'time-based';

export interface ArtifactConfig {
    /** Absolute path to the Antigravity brain directory (or UUID conversation sub-folder). */
    antigravityBrainPath: string;
    /** Name of the local artifact folder relative to workspace root. */
    localArtifactFolder: string;
    /** Direction of sync operations. Default: one-way-to-local (brain → project). */
    syncMode: SyncMode;
    /** Trigger strategy for sync cycles. */
    syncStrategy: SyncStrategy;
    /** Debounce window for real-time watcher events (ms). */
    debounceTimeoutMs: number;
    /** Polling interval for time-based strategy (minutes). */
    timeIntervalMinutes: number;
    /** File extensions to exclude from sync (e.g. [".tmp", ".log"]). */
    excludedExtensions: string[];
    /**
     * UUID of the Antigravity conversation this workspace is linked to.
     * Set to FULL_BRAIN_ID to sync the whole brain root.
     * Empty = sync disabled.
     */
    linkedConversationId: string;
    /**
     * When true, the .artifact folder is tracked in the workspace git repository.
     * When false, .artifact is added to .gitignore.
     */
    gitTrackArtifact: boolean;
}

/** A snapshot entry stored in the hash index. */
export interface FileRecord {
    absolutePath: string;
    mtimeMs:      number;
    contentHash:  string;
}

/** Result returned by the conflict resolver for a single file pair. */
export interface ConflictResolution {
    winner: 'local' | 'brain' | 'none';
    reason: string;
}

/** A conversation / artifact discovered inside the brain folder. */
export interface ConversationEntry {
    /** UUID sub-folder name. */
    id:         string;
    /** Human-readable title from task.md, transcript.jsonl, or short UUID fallback. */
    title:      string;
    /** Absolute path to the conversation sub-folder. */
    folderPath: string;
    /** ISO creation timestamp, if available. */
    createdAt?: string;
}

export const DEFAULT_CONFIG: ArtifactConfig = {
    antigravityBrainPath: '',
    localArtifactFolder:  '.artifact',
    syncMode:             'one-way-to-local',   // Brain → Project by default
    syncStrategy:         'real-time',
    debounceTimeoutMs:    1000,
    timeIntervalMinutes:  15,
    excludedExtensions:   ['.tmp', '.log'],
    linkedConversationId: '',
    gitTrackArtifact:     false,                // .artifact excluded from git by default
};
