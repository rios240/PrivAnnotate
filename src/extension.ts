import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	// console.log('Congratulations, your extension "pact" is now active!');

	const cmdHellowWorld = vscode.commands.registerCommand('priv-audit.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from PrivAudit!');
	});

	context.subscriptions.push(cmdHellowWorld);
}

// This method is called when your extension is deactivated
export function deactivate() {}
