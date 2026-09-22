import * as vscode from 'vscode';
import {
    isShowingFindings,
    isShowingRejected,
    repaintVisibleEditors,
    setShowFindings,
    setShowRejected,
} from '../ui/decorations';
import { showReport } from '../ui/report';

/** `when`-clause keys mirroring the view toggles, for menus and keybindings. */
export const CONTEXT_FINDINGS_VISIBLE = 'privAudit.findingsVisible';
export const CONTEXT_REJECTED_VISIBLE = 'privAudit.rejectedVisible';

/** Publishes the current toggle state to VS Code's context-key service. */
export function syncViewContext(): void {
    void vscode.commands.executeCommand('setContext', CONTEXT_FINDINGS_VISIBLE, isShowingFindings());
    void vscode.commands.executeCommand('setContext', CONTEXT_REJECTED_VISIBLE, isShowingRejected());
}

/** Commands that change what is shown, never what is stored. */
export function registerViewCommands(context: vscode.ExtensionContext) {
    syncViewContext();

    context.subscriptions.push(
        vscode.commands.registerCommand('priv-audit.showReport', showReport),
        vscode.commands.registerCommand('priv-audit.toggleRejected', () => {
            setShowRejected(!isShowingRejected());
            syncViewContext();
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
            syncViewContext();
            repaintVisibleEditors();
            vscode.window.setStatusBarMessage(
                isShowingFindings() ? 'PrivAudit: showing all findings' : 'PrivAudit: hiding all findings',
                3000
            );
        })
    );
}
