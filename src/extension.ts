import * as vscode from 'vscode';
import { registerAnalyzeCommand } from './command';

export function activate(context: vscode.ExtensionContext) {

	console.log('PrivAudit is now active.');
    
	registerAnalyzeCommand(context);

}

// This method is called when your extension is deactivated
export function deactivate() {}
