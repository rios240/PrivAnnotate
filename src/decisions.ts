import * as vscode from 'vscode';
import { FindingStatus, PrivacyFinding } from './pdc/schema';
import { locate, manifestStore, StoredFinding, toStoredFinding } from './findings/manifest';
import { relocate, TextSource } from './findings/reconcile';
import {
    clearAllFindings,
    getFinding,
    isShowingFindings,
    isShowingRejected,
    nextFindingId,
    refreshEditorsFor,
    repaintVisibleEditors,
    setFindings,
    setShowFindings,
    setShowRejected,
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
    if (!entry) {
        // The manifest is the source of truth for workspace files: if it no
        // longer has an entry (reset, deleted, reverted), drop what is painted.
        setFindings(document.uri, []);
        return false;
    }

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
            repaintVisibleEditors();
            vscode.window.setStatusBarMessage(
                isShowingRejected()
                    ? 'PrivAudit: showing rejected findings'
                    : 'PrivAudit: hiding rejected findings',
                3000
            );
        }),
        vscode.commands.registerCommand('priv-audit.toggleFindings', () => {
            setShowFindings(!isShowingFindings());
            repaintVisibleEditors();
            vscode.window.setStatusBarMessage(
                isShowingFindings()
                    ? 'PrivAudit: showing all findings'
                    : 'PrivAudit: hiding all findings',
                3000
            );
        }),
        vscode.commands.registerCommand('priv-audit.resetManifest', resetManifest)
    );
}

/**
 * Wipes every finding and decision in the workspace: deletes each folder's
 * manifest and clears the in-memory store. Irreversible short of version
 * control, so it always asks first.
 */
export async function resetManifest(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        vscode.window.showInformationMessage('priv-audit: open a workspace folder to reset its findings manifest.');
        return;
    }

    const confirm = 'Reset';
    const choice = await vscode.window.showWarningMessage(
        'Delete all PrivAudit findings and accept/reject decisions in this workspace? This cannot be undone.',
        { modal: true },
        confirm
    );
    if (choice !== confirm) return;

    // Settle every folder rather than stopping at the first failure, so one
    // unwritable folder does not leave the others half-reset.
    const results = await Promise.allSettled(folders.map(folder => manifestStore.reset(folder.uri)));
    const failed = folders.filter((_, i) => results[i].status === 'rejected');

    clearAllFindings();
    repaintVisibleEditors();

    if (failed.length > 0) {
        results.forEach(result => {
            if (result.status === 'rejected') {
                console.error('priv-audit: could not reset the findings manifest:', result.reason);
            }
        });
        vscode.window.showErrorMessage(
            `priv-audit: could not reset the manifest in ${failed.map(f => f.name).join(', ')}. ` +
            'See console for details.'
        );
        return;
    }

    vscode.window.showInformationMessage('priv-audit: findings manifest reset; all findings cleared.');
}