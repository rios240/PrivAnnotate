import * as vscode from 'vscode';
import { FindingStatus, PrivacyFinding } from './pdc/schema';
import { locate, manifestStore, StoredFinding, toStoredFinding } from './findings/manifest';
import { relocate, TextSource } from './findings/reconcile';
import {
    getFinding,
    isShowingRejected,
    nextFindingId,
    refreshEditorsFor,
    setFindings,
    setShowRejected,
    updateDecorations,
} from './misc/decorations';

/** Argument shape carried by the hover's `command:` links. */
interface DecisionArgs {
    uri: string;
    fingerprint: string;
}

function isDecisionArgs(value: unknown): value is DecisionArgs {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return typeof v.uri === 'string' && typeof v.fingerprint === 'string';
}

export function textSourceFor(document: vscode.TextDocument): TextSource {
    return {
        lineCount: document.lineCount,
        lineAt: line =>
            line >= 1 && line <= document.lineCount ? document.lineAt(line - 1).text : undefined,
    };
}

/**
 * Rehydrates stored findings against the document's current text, relocating
 * spans that drifted while the file was edited outside the extension.
 */
export function hydrate(document: vscode.TextDocument, stored: StoredFinding[]): PrivacyFinding[] {
    const source = textSourceFor(document);

    return stored.map(entry => {
        const { lineRange, stale } = relocate(source, entry.excerpt, entry.lineRange);
        return {
            ...entry,
            id: nextFindingId(),
            lineRange,
            stale: stale || undefined,
        };
    });
}

/** Loads a document's findings from the manifest into the in-memory store. */
export async function loadFindingsFor(document: vscode.TextDocument): Promise<boolean> {
    const location = locate(document);
    if (!location) return false;

    const manifest = await manifestStore.load(location.folder);
    const entry = manifest.files[location.path];
    if (!entry) return false;

    setFindings(document.uri, hydrate(document, entry.findings));
    return true;
}

async function setStatus(args: unknown, status: FindingStatus): Promise<void> {
    if (!isDecisionArgs(args)) {
        console.warn('priv-audit: decision command invoked without a finding reference.');
        return;
    }

    const uri = vscode.Uri.parse(args.uri);
    const finding = getFinding(uri, args.fingerprint);
    if (!finding) {
        vscode.window.showWarningMessage('priv-audit: that finding is no longer loaded.');
        return;
    }

    const document = vscode.workspace.textDocuments.find(
        doc => doc.uri.toString() === uri.toString()
    );
    if (!document) return;

    const decidedAt = status === 'undecided' ? undefined : new Date().toISOString();
    finding.status = status;
    finding.decidedAt = decidedAt;

    // Repaint immediately; persisting is not something the user should wait on.
    refreshEditorsFor(uri);

    const location = locate(document);
    if (!location) {
        vscode.window.showWarningMessage(
            'priv-audit: decisions on files outside a workspace folder cannot be saved.'
        );
        return;
    }

    try {
        await manifestStore.update(location.folder, manifest => {
            const entry = manifest.files[location.path];
            if (!entry) return;
            const stored = entry.findings.find(f => f.fingerprint === args.fingerprint);
            if (!stored) return;
            stored.status = status;
            stored.decidedAt = decidedAt;
        });
    } catch (error) {
        console.error('priv-audit: could not persist decision:', error);
        vscode.window.showErrorMessage('priv-audit: could not save that decision. See console for details.');
    }
}

/**
 * Writes the current in-memory findings for a document into the manifest,
 * replacing that file's entry.
 */
export async function persistFindings(
    document: vscode.TextDocument,
    findings: PrivacyFinding[]
): Promise<boolean> {
    const location = locate(document);
    if (!location) return false;

    await manifestStore.update(location.folder, manifest => {
        manifest.files[location.path] = {
            lastAnalyzedAt: new Date().toISOString(),
            findings: findings.map(toStoredFinding),
        };
    });

    return true;
}

export function registerDecisionCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('priv-audit.acceptFinding', args =>
            setStatus(args, 'accepted')
        ),
        vscode.commands.registerCommand('priv-audit.rejectFinding', args =>
            setStatus(args, 'rejected')
        ),
        vscode.commands.registerCommand('priv-audit.clearDecision', args =>
            setStatus(args, 'undecided')
        ),
        vscode.commands.registerCommand('priv-audit.toggleRejected', () => {
            setShowRejected(!isShowingRejected());
            vscode.window.visibleTextEditors.forEach(updateDecorations);
            vscode.window.setStatusBarMessage(
                isShowingRejected()
                    ? 'PrivAudit: showing rejected findings'
                    : 'PrivAudit: hiding rejected findings',
                3000
            );
        })
    );
}