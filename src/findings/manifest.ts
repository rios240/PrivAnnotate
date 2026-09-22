import * as vscode from 'vscode';
import { CategoryName, isCategoryName } from '../pdc/categories';
import {
    Confidence,
    FindingStatus,
    isConfidence,
    isFindingStatus,
    isStringArray,
    LineRange,
    PrivacyFinding,
} from '../pdc/schema';

export const MANIFEST_DIR = '.privaudit';
export const MANIFEST_FILE = 'findings.json';
export const MANIFEST_VERSION = 1;

/** A finding as persisted: no runtime id, no path (the file entry carries it). */
export interface StoredFinding {
    fingerprint: string;
    category: CategoryName;
    lineRange: LineRange;
    excerpt: string;
    evidence: string;
    confidence: Confidence;
    reasoning?: string[];
    crossReferences?: CategoryName[];
    status: FindingStatus;
    firstSeen: string;
    lastSeen: string;
    decidedAt?: string;
    resolvedAt?: string;
}

export interface ManifestFileEntry {
    lastAnalyzedAt: string;
    findings: StoredFinding[];
}

export interface Manifest {
    version: number;
    /** Keyed by workspace-folder-relative path, POSIX separators. */
    files: Record<string, ManifestFileEntry>;
}

export function emptyManifest(): Manifest {
    return { version: MANIFEST_VERSION, files: {} };
}

export function toStoredFinding(finding: PrivacyFinding): StoredFinding {
    return {
        fingerprint: finding.fingerprint,
        category: finding.category,
        lineRange: finding.lineRange,
        excerpt: finding.excerpt,
        evidence: finding.evidence,
        confidence: finding.confidence,
        reasoning: finding.reasoning,
        crossReferences: finding.crossReferences,
        status: finding.status,
        firstSeen: finding.firstSeen,
        lastSeen: finding.lastSeen,
        decidedAt: finding.decidedAt,
        resolvedAt: finding.resolvedAt,
    };
}

/**
 * The manifest is a plain file a user may hand-edit or merge; validate rather
 * than trust it, and drop only the entries that are actually malformed.
 */
export function isStoredFinding(value: unknown): value is StoredFinding {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;

    if (typeof v.fingerprint !== 'string' || v.fingerprint.length === 0) return false;
    if (!isCategoryName(v.category)) return false;
    if (typeof v.excerpt !== 'string') return false;
    if (typeof v.evidence !== 'string') return false;
    if (!isConfidence(v.confidence)) return false;
    if (!isFindingStatus(v.status)) return false;
    if (typeof v.firstSeen !== 'string' || typeof v.lastSeen !== 'string') return false;

    if (typeof v.lineRange !== 'object' || v.lineRange === null) return false;
    const range = v.lineRange as Record<string, unknown>;
    if (typeof range.start !== 'number' || typeof range.end !== 'number') return false;

    if (v.decidedAt !== undefined && typeof v.decidedAt !== 'string') return false;
    if (v.resolvedAt !== undefined && typeof v.resolvedAt !== 'string') return false;
    if (v.reasoning !== undefined && !isStringArray(v.reasoning)) return false;
    if (v.crossReferences !== undefined && !isStringArray(v.crossReferences)) return false;

    return true;
}

export function parseManifest(raw: string): Manifest {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('manifest root is not an object');
    }

    const root = parsed as Record<string, unknown>;
    if (root.version !== MANIFEST_VERSION) {
        throw new Error(`unsupported manifest version: ${String(root.version)}`);
    }
    if (typeof root.files !== 'object' || root.files === null) {
        throw new Error('manifest has no "files" object');
    }

    const files: Record<string, ManifestFileEntry> = {};
    for (const [path, value] of Object.entries(root.files as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null) continue;
        const entry = value as Record<string, unknown>;
        const findings = Array.isArray(entry.findings)
            ? entry.findings.filter(isStoredFinding)
            : [];

        files[path] = {
            lastAnalyzedAt:
                typeof entry.lastAnalyzedAt === 'string' ? entry.lastAnalyzedAt : '',
            findings,
        };
    }

    return { version: MANIFEST_VERSION, files };
}

export function serializeManifest(manifest: Manifest): string {
    // Sort keys so the file diffs cleanly when it is committed alongside code.
    const files: Record<string, ManifestFileEntry> = {};
    for (const path of Object.keys(manifest.files).sort()) {
        const entry = manifest.files[path];
        files[path] = {
            lastAnalyzedAt: entry.lastAnalyzedAt,
            findings: [...entry.findings].sort(
                (a, b) => a.lineRange.start - b.lineRange.start || a.fingerprint.localeCompare(b.fingerprint)
            ),
        };
    }

    return JSON.stringify({ version: MANIFEST_VERSION, files }, null, 2) + '\n';
}

/**
 * Identifies a document within a manifest: which workspace folder owns it and
 * its path relative to that folder. Untitled and out-of-workspace documents
 * have no stable key and are not persisted.
 */
export interface ManifestLocation {
    folder: vscode.Uri;
    path: string;
}

export function locate(document: vscode.TextDocument): ManifestLocation | undefined {
    if (document.isUntitled) return undefined;

    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return undefined;

    const relative = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, '/');
    return { folder: folder.uri, path: relative };
}

export function manifestUri(folder: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(folder, MANIFEST_DIR, MANIFEST_FILE);
}

/**
 * Reads and writes one manifest per workspace folder, caching the parsed form.
 *
 * Writes are serialized per folder: analysis finishes eight categories at once
 * and accept/reject clicks can land while a save is in flight, so overlapping
 * read-modify-write cycles would otherwise lose decisions.
 */
export class ManifestStore {
    private readonly cache = new Map<string, Manifest>();
    private readonly writeQueues = new Map<string, Promise<void>>();

    async load(folder: vscode.Uri): Promise<Manifest> {
        const key = folder.toString();
        const cached = this.cache.get(key);
        if (cached) return cached;

        let manifest = emptyManifest();
        try {
            const bytes = await vscode.workspace.fs.readFile(manifestUri(folder));
            manifest = parseManifest(new TextDecoder().decode(bytes));
        } catch (error) {
            if (!isFileNotFound(error)) {
                console.error('priv-audit: could not read manifest; starting empty.', error);
            }
        }

        this.cache.set(key, manifest);
        return manifest;
    }

    /** Applies `mutate` to the folder's manifest and persists the result. */
    update(folder: vscode.Uri, mutate: (manifest: Manifest) => void): Promise<void> {
        return this.enqueue(folder, async () => {
            const manifest = await this.load(folder);
            mutate(manifest);
            await this.write(folder, manifest);
        });
    }

    /**
     * Deletes the folder's manifest, wiping every finding and decision in it.
     * Queued like any write, so a decision still in flight cannot resurrect the
     * old file after the reset lands.
     */
    reset(folder: vscode.Uri): Promise<void> {
        return this.enqueue(folder, async () => {
            try {
                await vscode.workspace.fs.delete(manifestUri(folder));
            } catch (error) {
                if (!isFileNotFound(error)) throw error;
            }
            this.cache.set(folder.toString(), emptyManifest());
        });
    }

    /** Runs `task` after every write already queued for the folder. */
    private enqueue(folder: vscode.Uri, task: () => Promise<void>): Promise<void> {
        const key = folder.toString();
        const run = (this.writeQueues.get(key) ?? Promise.resolve()).then(task);

        // Keep the chain alive even if one link rejects, so later writes still run.
        this.writeQueues.set(key, run.catch(() => undefined));
        return run;
    }

    private async write(folder: vscode.Uri, manifest: Manifest): Promise<void> {
        const target = manifestUri(folder);
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, MANIFEST_DIR));
        await vscode.workspace.fs.writeFile(
            target,
            new TextEncoder().encode(serializeManifest(manifest))
        );
        this.cache.set(folder.toString(), manifest);
    }

    /** Drops cached state so the next load re-reads from disk. */
    invalidate(folder?: vscode.Uri): void {
        if (folder) {
            this.cache.delete(folder.toString());
        } else {
            this.cache.clear();
        }
    }
}

function isFileNotFound(error: unknown): boolean {
    return (
        error instanceof vscode.FileSystemError &&
        (error.code === 'FileNotFound' || error.code === 'EntryNotFound')
    );
}

export const manifestStore = new ManifestStore();