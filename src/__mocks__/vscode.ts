/**
 * Manual mock for the 'vscode' module.
 * Covers every API surface used by the extension and its tests.
 */

// ── EventEmitter ──────────────────────────────────────────────────────────

export class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];

    public fire(e: T): void {
        this.listeners.forEach(l => l(e));
    }

    public get event(): (listener: (e: T) => void) => { dispose(): void } {
        return (listener: (e: T) => void) => {
            this.listeners.push(listener);
            return {
                dispose: () => {
                    const i = this.listeners.indexOf(listener);
                    if (i >= 0) this.listeners.splice(i, 1);
                },
            };
        };
    }

    public dispose(): void { this.listeners = []; }
}

// ── Simple value types ────────────────────────────────────────────────────

export class ThemeColor {
    constructor(public readonly id: string) {}
}

export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum ViewColumn          { One  = 1, Two   = 2, Three = 3 }

export class RelativePattern {
    constructor(
        public readonly base: string | { uri: { fsPath: string } },
        public readonly pattern: string,
    ) {}
}

// ── Event sources shared across the mock ─────────────────────────────────

const _changeEmitter       = new EventEmitter<{ fsPath: string }>();
const _createEmitter       = new EventEmitter<{ fsPath: string }>();
const _deleteEmitter       = new EventEmitter<{ fsPath: string }>();
const _windowStateEmitter  = new EventEmitter<{ focused: boolean }>();

/** Test helpers — fire synthetic events */
export const _watchers = {
    fireChange: (fsPath: string) => _changeEmitter.fire({ fsPath }),
    fireCreate: (fsPath: string) => _createEmitter.fire({ fsPath }),
    fireDelete: (fsPath: string) => _deleteEmitter.fire({ fsPath }),
};
export const _windowState = {
    fireFocusChange: (focused: boolean) => _windowStateEmitter.fire({ focused }),
};

// ── Mock factories ────────────────────────────────────────────────────────

function makeMockStatusBarItem() {
    return {
        text:            '',
        tooltip:         '',
        backgroundColor: undefined as ThemeColor | undefined,
        color:           undefined as string | undefined,
        command:         undefined as string | undefined,
        name:            '',
        show:    jest.fn(),
        hide:    jest.fn(),
        dispose: jest.fn(),
    };
}

function makeMockWebviewPanel() {
    const disposeEmitter = new EventEmitter<void>();
    return {
        webview: {
            html: '',
            onDidReceiveMessage: new EventEmitter<unknown>().event,
        },
        reveal:        jest.fn(),
        dispose:       jest.fn(),
        onDidDispose:  disposeEmitter.event,
        _fireDispose:  () => disposeEmitter.fire(),
    };
}

function makeMockWebviewView() {
    const msgEmitter = new EventEmitter<unknown>();
    return {
        webview: {
            html:    '',
            options: {} as { enableScripts?: boolean },
            onDidReceiveMessage: msgEmitter.event,
            _postMessage: (msg: unknown) => msgEmitter.fire(msg),
        },
        onDidDispose: new EventEmitter<void>().event,
        onDidChangeVisibility: new EventEmitter<void>().event,
    };
}

// ── workspace ─────────────────────────────────────────────────────────────

export const workspace = {
    workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,

    createFileSystemWatcher: jest.fn(() => ({
        onDidChange: _changeEmitter.event,
        onDidCreate: _createEmitter.event,
        onDidDelete: _deleteEmitter.event,
        dispose:     jest.fn(),
    })),

    openTextDocument: jest.fn().mockResolvedValue({}),
};

// ── window ────────────────────────────────────────────────────────────────

export const window = {
    showInformationMessage: jest.fn().mockResolvedValue(undefined),
    showWarningMessage:     jest.fn().mockResolvedValue(undefined),
    showErrorMessage:       jest.fn().mockResolvedValue(undefined),
    setStatusBarMessage:    jest.fn(),
    showTextDocument:       jest.fn().mockResolvedValue(undefined),
    showOpenDialog:         jest.fn().mockResolvedValue(undefined),

    onDidChangeWindowState: _windowStateEmitter.event,

    createStatusBarItem: jest.fn(() => makeMockStatusBarItem()),
    createWebviewPanel:  jest.fn(() => makeMockWebviewPanel()),

    /** Used by SettingsViewProvider registration in extension.ts */
    registerWebviewViewProvider: jest.fn(() => ({ dispose: jest.fn() })),
};

// ── commands ──────────────────────────────────────────────────────────────

export const commands = {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
    executeCommand:  jest.fn().mockResolvedValue(undefined),
};

// ── Uri ───────────────────────────────────────────────────────────────────

export const Uri = {
    file: (p: string) => ({ fsPath: p, scheme: 'file' }),
};

// ── ExtensionContext factory ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockContext(): any {
    return {
        subscriptions:  [],
        extensionPath:  '/mock/extension',
        extensionUri:   Uri.file('/mock/extension'),
        globalState:    { get: jest.fn(), update: jest.fn() },
        workspaceState: { get: jest.fn(), update: jest.fn() },
    };
}
