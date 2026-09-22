import * as vscode from 'vscode';
import { registerAnalyzeCommand } from './commands/analyze';
import { registerDecisionCommands } from './commands/decisions';
import { registerManifestCommands } from './commands/manifest';
import { registerViewCommands } from './commands/view';
import { manifestStore, MANIFEST_DIR, MANIFEST_FILE } from './findings/manifest';
import { loadFindingsFor } from './findings/persistence';
import { disposeDecorations, updateDecorations } from './ui/decorations';
import { registerHoverProvider } from './ui/hover';
import { disposeReport } from './ui/report';

export function activate(context: vscode.ExtensionContext) {
    console.log('PrivAudit is now active.');

    registerAnalyzeCommand(context);
    registerDecisionCommands(context);
    registerManifestCommands(context);
    registerViewCommands(context);
    registerHoverProvider(context);

    // Findings persist between sessions, so restore them for whatever is
    // already open and for anything the user opens later.
    vscode.window.visibleTextEditors.forEach(editor => {
        void restore(editor);
    });

    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(editors => {
            editors.forEach(editor => {
                void restore(editor);
            });
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            hydratedAt.delete(document.uri.toString());
        }),
        watchManifest(),
        { dispose: disposeDecorations },
        { dispose: disposeReport }
    );
}

/**
 * Document version each URI's findings were last located against. Stored spans
 * are anchored to text, so an edit invalidates them; repainting without
 * re-locating would put decorations on lines the code has since moved off.
 */
const hydratedAt = new Map<string, number>();

async function restore(editor: vscode.TextEditor): Promise<void> {
    const key = editor.document.uri.toString();
    const version = editor.document.version;

    if (hydratedAt.get(key) === version) {
        // Still current; just repaint, since a new editor has no decorations.
        updateDecorations(editor);
        return;
    }

    try {
        await loadFindingsFor(editor.document);
        hydratedAt.set(key, version);
        updateDecorations(editor);
    } catch (error) {
        console.error('priv-audit: could not restore findings for', key, error);
    }
}

/**
 * Picks up manifests edited outside the extension - a colleague's commit pulled
 * in, or a hand-edited decision - by dropping that folder's cache and
 * rehydrating. Events caused by the extension's own writes are skipped: the
 * in-memory state already matches, and every accept/reject would otherwise
 * re-read the file and re-locate every visible editor's findings.
 */
function watchManifest(): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${MANIFEST_DIR}/${MANIFEST_FILE}`);

    const reload = async (uri: vscode.Uri) => {
        const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri;
        if (folder && (await manifestStore.isInSync(folder))) {
            return;
        }

        manifestStore.invalidate(folder);
        hydratedAt.clear();
        vscode.window.visibleTextEditors.forEach(editor => {
            void restore(editor);
        });
    };

    watcher.onDidChange(uri => void reload(uri));
    watcher.onDidCreate(uri => void reload(uri));
    watcher.onDidDelete(uri => void reload(uri));

    return watcher;
}

export function deactivate() {}
