import * as vscode from 'vscode';
import { PrivacyFinding } from './schema';
import { locate, manifestStore, StoredFinding, toStoredFinding } from './manifest';
import { indexLines, relocate, TextSource } from './reconcile';
import { setFindings } from './store';

/** Adapts a document to the 1-based `TextSource` reconciliation works against. */
export function textSourceFor(document: vscode.TextDocument): TextSource {
    return {
        lineCount: document.lineCount,
        lineAt: line =>
            line >= 1 && line <= document.lineCount ? document.lineAt(line - 1).text : undefined,
    };
}

/**
 * Re-anchors findings on the document's current text: spans whose code moved
 * are moved with it, and spans whose anchor line is gone are flagged stale.
 * Used both when loading from the manifest and when the document was edited
 * while an analysis was in flight.
 */
export function relocateAll<T extends StoredFinding>(
    document: vscode.TextDocument,
    findings: T[]
): Array<T & { stale?: boolean }> {
    const source = textSourceFor(document);
    const index = indexLines(source);

    return findings.map(finding => {
        const { lineRange, stale } = relocate(source, finding.excerpt, finding.lineRange, index);
        return { ...finding, lineRange, stale: stale || undefined };
    });
}

/**
 * Rehydrates stored findings against the document's current text, relocating
 * spans that drifted while the file was edited outside the extension.
 */
export function hydrate(document: vscode.TextDocument, stored: StoredFinding[]): PrivacyFinding[] {
    return relocateAll(document, stored);
}

/** Loads a document's findings from the manifest into the in-memory store. */
export async function loadFindingsFor(document: vscode.TextDocument): Promise<boolean> {
    const location = locate(document);
    if (!location) {return false;}

    const manifest = await manifestStore.load(location.folder);
    const entry = manifest.files[location.path];
    if (!entry) {
        // The manifest is the source of truth for workspace files: if it no
        // longer has an entry (reset, deleted, reverted), drop what is painted.
        setFindings(document.uri, []);
        return false;
    }

    setFindings(document.uri, hydrate(document, entry.findings));
    return true;
}

/** The manifest's findings for a document, or none when it cannot be persisted. */
export async function loadStoredFindings(document: vscode.TextDocument): Promise<StoredFinding[]> {
    const location = locate(document);
    if (!location) {return [];}

    const manifest = await manifestStore.load(location.folder);
    return manifest.files[location.path]?.findings ?? [];
}

/**
 * Writes a document's findings into the manifest, replacing that file's entry.
 * Returns false when the document lives outside a workspace folder.
 */
export async function persistFindings(
    document: vscode.TextDocument,
    findings: PrivacyFinding[]
): Promise<boolean> {
    const location = locate(document);
    if (!location) {return false;}

    await manifestStore.update(location.folder, manifest => {
        manifest.files[location.path] = {
            lastAnalyzedAt: new Date().toISOString(),
            findings: findings.map(toStoredFinding),
        };
    });

    return true;
}