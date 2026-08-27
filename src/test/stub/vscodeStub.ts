/**
 * A minimal stand-in for the `vscode` module.
 *
 * The full suite is meant to run inside a real Extension Development Host via
 * `npm test` (@vscode/test-cli). This shim exists so the same test files can
 * also run as plain Node unit tests (`npm run test:unit`) on machines or CI
 * runners that cannot download a VS Code build. It implements only the API
 * surface the extension and @vscode/prompt-tsx actually touch - if a test needs
 * something richer, it belongs in the integration run instead.
 */

export class Position {
    constructor(public readonly line: number, public readonly character: number) {}

    isBefore(other: Position): boolean {
        return this.line < other.line || (this.line === other.line && this.character < other.character);
    }

    isAfter(other: Position): boolean {
        return other.isBefore(this);
    }
}

export class Range {
    readonly start: Position;
    readonly end: Position;

    constructor(start: Position, end: Position);
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
        if (typeof a === 'number') {
            this.start = new Position(a, b as number);
            this.end = new Position(c as number, d as number);
        } else {
            this.start = a;
            this.end = b as Position;
        }
    }

    get isEmpty(): boolean {
        return this.start.line === this.end.line && this.start.character === this.end.character;
    }
}

export class Uri {
    private constructor(private readonly value: string) {}

    static parse(value: string): Uri {
        return new Uri(value);
    }

    static file(path: string): Uri {
        return new Uri(`file://${path}`);
    }

    static joinPath(base: Uri, ...segments: string[]): Uri {
        const trimmed = base.value.replace(/\/+$/, '');
        return new Uri([trimmed, ...segments].join('/'));
    }

    get fsPath(): string {
        return this.value.replace(/^file:\/\//, '');
    }

    toString(): string {
        return this.value;
    }
}

export class FileSystemError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
    }

    static FileNotFound(path?: string): FileSystemError {
        return new FileSystemError(`File not found: ${path ?? ''}`, 'FileNotFound');
    }
}

/** In-memory file system backing `workspace.fs` for the Node test run. */
const files = new Map<string, Uint8Array>();
const directories = new Set<string>();
const workspaceFolders: Array<{ uri: Uri; name: string; index: number }> = [];

/** Test helper: registers a workspace folder and clears any previous state. */
export function __setWorkspaceFolder(uri: Uri, name = 'workspace'): void {
    workspaceFolders.length = 0;
    workspaceFolders.push({ uri, name, index: 0 });
}

/** Test helper: empties the in-memory file system. */
export function __resetFileSystem(): void {
    files.clear();
    directories.clear();
}

/** Test helper: reads a file written through `workspace.fs`. */
export function __readFile(uri: Uri): string | undefined {
    const bytes = files.get(uri.toString());
    return bytes ? new TextDecoder().decode(bytes) : undefined;
}

export class MarkdownString {
    value = '';

    constructor(value?: string, public supportThemeIcons = false) {
        if (value) this.value = value;
    }

    appendMarkdown(text: string): MarkdownString {
        this.value += text;
        return this;
    }
}

export enum OverviewRulerLane {
    Left = 1,
    Center = 2,
    Right = 4,
    Full = 7,
}

export class LanguageModelTextPart {
    constructor(public value: string) {}
}

export class LanguageModelChatMessage {
    private constructor(
        public role: number,
        public content: LanguageModelTextPart[],
        public name?: string
    ) {}

    static User(content: string, name?: string): LanguageModelChatMessage {
        return new LanguageModelChatMessage(1, [new LanguageModelTextPart(content)], name);
    }

    static Assistant(content: string, name?: string): LanguageModelChatMessage {
        return new LanguageModelChatMessage(2, [new LanguageModelTextPart(content)], name);
    }
}

class StubTextLine {
    constructor(public readonly text: string) {}
}

let untitledCounter = 0;

class StubTextDocument {
    readonly uri: Uri;
    readonly isUntitled: boolean;
    private readonly lines: string[];

    constructor(content: string, public readonly languageId: string, uri?: Uri) {
        untitledCounter += 1;
        this.uri = uri ?? Uri.parse(`untitled:Untitled-${untitledCounter}`);
        this.isUntitled = uri === undefined;
        this.lines = content.split(/\r?\n/);
    }

    get lineCount(): number {
        return this.lines.length;
    }

    lineAt(line: number): StubTextLine {
        if (line < 0 || line >= this.lines.length) {
            throw new Error(`Illegal line number: ${line}`);
        }
        return new StubTextLine(this.lines[line]);
    }

    getText(range?: Range): string {
        if (!range) return this.lines.join('\n');

        const startLine = Math.max(0, range.start.line);
        const endLine = Math.min(this.lines.length - 1, range.end.line);
        if (startLine > endLine) return '';

        // Trim the tail first: on a single-line range both edits hit slice[0],
        // and clipping the end before the start keeps the offsets valid.
        const slice = this.lines.slice(startLine, endLine + 1);
        slice[slice.length - 1] = slice[slice.length - 1].slice(0, range.end.character);
        slice[0] = slice[0].slice(range.start.character);
        return slice.join('\n');
    }
}

export const workspace = {
    get workspaceFolders() {
        return workspaceFolders.length > 0 ? workspaceFolders : undefined;
    },

    async openTextDocument(options: { content: string; language?: string; uri?: Uri }) {
        return new StubTextDocument(options.content, options.language ?? 'plaintext', options.uri);
    },

    getWorkspaceFolder(uri: Uri) {
        return workspaceFolders.find(folder => uri.toString().startsWith(folder.uri.toString()));
    },

    asRelativePath(target: Uri | string, includeWorkspaceFolder = true): string {
        const value = typeof target === 'string' ? target : target.toString();
        const folder = workspaceFolders.find(f => value.startsWith(f.uri.toString()));
        if (!folder) return typeof target === 'string' ? target : target.fsPath;

        const relative = value.slice(folder.uri.toString().length).replace(/^\/+/, '');
        return includeWorkspaceFolder ? `${folder.name}/${relative}` : relative;
    },

    fs: {
        async readFile(uri: Uri): Promise<Uint8Array> {
            const bytes = files.get(uri.toString());
            if (!bytes) throw FileSystemError.FileNotFound(uri.toString());
            return bytes;
        },
        async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
            files.set(uri.toString(), content);
        },
        async createDirectory(uri: Uri): Promise<void> {
            directories.add(uri.toString());
        },
    },

    createFileSystemWatcher(_glob: string) {
        return {
            onDidChange() { return { dispose() { /* no-op */ } }; },
            onDidCreate() { return { dispose() { /* no-op */ } }; },
            onDidDelete() { return { dispose() { /* no-op */ } }; },
            dispose() { /* no-op */ },
        };
    },
};

export const window = {
    visibleTextEditors: [] as unknown[],

    createTextEditorDecorationType(_options: unknown) {
        return { dispose() { /* no-op */ } };
    },
    createOutputChannel(_name: string) {
        return {
            appendLine(_line: string) { /* no-op */ },
            show(_preserveFocus?: boolean) { /* no-op */ },
            dispose() { /* no-op */ },
        };
    },
    // Return a thenable, as the real API does: callers chain off the result to
    // handle the action button.
    showInformationMessage(_message: string, ..._items: string[]) {
        return Promise.resolve(undefined);
    },
    showWarningMessage(_message: string, ..._items: string[]) {
        return Promise.resolve(undefined);
    },
    showErrorMessage(_message: string, ..._items: string[]) {
        return Promise.resolve(undefined);
    },
    setStatusBarMessage(_message: string, _timeout?: number) {
        return { dispose() { /* no-op */ } };
    },
};

export const lm = {
    async selectChatModels(_selector: unknown) {
        return [];
    },
};

export const commands = {
    registerTextEditorCommand(_id: string, _handler: unknown) {
        return { dispose() { /* no-op */ } };
    },
};

export enum ProgressLocation {
    SourceControl = 1,
    Window = 10,
    Notification = 15,
}