import * as vscode from 'vscode';
import { FindingStatus } from '../findings/schema';
import { locate, manifestStore } from '../findings/manifest';
import { getFinding } from '../findings/store';
import { refreshEditorsFor } from '../ui/decorations';

/** Argument shape carried by the hover's `command:` links. */
interface DecisionArgs {
    uri: string;
    fingerprint: string;
}

function isDecisionArgs(value: unknown): value is DecisionArgs {
    if (typeof value !== 'object' || value === null) {return false;}
    const v = value as Record<string, unknown>;
    return typeof v.uri === 'string' && typeof v.fingerprint === 'string';
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
    if (!document) {return;}

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
            if (!entry) {return;}
            const stored = entry.findings.find(f => f.fingerprint === args.fingerprint);
            if (!stored) {return;}
            stored.status = status;
            stored.decidedAt = decidedAt;
        });
    } catch (error) {
        console.error('priv-audit: could not persist decision:', error);
        vscode.window.showErrorMessage('priv-audit: could not save that decision. See console for details.');
    }
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
        )
    );
}