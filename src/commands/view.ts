import * as vscode from 'vscode';
import {
    isShowingFindings,
    isShowingRejected,
    repaintVisibleEditors,
    setShowFindings,
    setShowRejected,
} from '../ui/decorations';
import { showReport } from '../ui/report';

/** Commands that change what is shown, never what is stored. */
export function registerViewCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('priv-audit.showReport', showReport),
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
        })
    );
}