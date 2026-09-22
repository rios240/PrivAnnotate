import * as vscode from 'vscode';
import { manifestStore } from '../findings/manifest';
import { clearAllFindings } from '../findings/store';
import { repaintVisibleEditors } from '../ui/decorations';

export function registerManifestCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('priv-annotate.resetManifest', resetManifest));
}

/**
 * Wipes every finding and decision in the workspace: deletes each folder's
 * manifest and clears the in-memory store. Irreversible short of version
 * control, so it always asks first.
 */
export async function resetManifest(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        vscode.window.showInformationMessage(
            'priv-annotate: open a workspace folder to reset its findings manifest.'
        );
        return;
    }

    const confirm = 'Reset';
    const choice = await vscode.window.showWarningMessage(
        'Delete all PrivAnnotate findings and accept/reject decisions in this workspace? This cannot be undone.',
        { modal: true },
        confirm
    );
    if (choice !== confirm) {
        return;
    }

    // Settle every folder rather than stopping at the first failure, so one
    // unwritable folder does not leave the others half-reset.
    const results = await Promise.allSettled(folders.map(folder => manifestStore.reset(folder.uri)));
    const failed = folders.filter((_, i) => results[i].status === 'rejected');

    clearAllFindings();
    repaintVisibleEditors();

    if (failed.length > 0) {
        results.forEach(result => {
            if (result.status === 'rejected') {
                console.error('priv-annotate: could not reset the findings manifest:', result.reason);
            }
        });
        vscode.window.showErrorMessage(
            `priv-annotate: could not reset the manifest in ${failed.map(f => f.name).join(', ')}. ` +
                'See console for details.'
        );
        return;
    }

    vscode.window.showInformationMessage('priv-annotate: findings manifest reset; all findings cleared.');
}
