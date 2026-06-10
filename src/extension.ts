import * as vscode from 'vscode';
import { registerPrivAuditParticipant } from './privAudit';

export function activate(context: vscode.ExtensionContext) {

	console.log('Privacy Audit is now active.');

	const cmdHellowWorld = vscode.commands.registerCommand('priv-audit.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from PrivAudit!');
	});

	context.subscriptions.push(cmdHellowWorld);

    registerPrivAuditParticipant(context);
}

// This method is called when your extension is deactivated
export function deactivate() {}
