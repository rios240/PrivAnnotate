import * as vscode from 'vscode';
import { constructAuditPrompt} from './prompts';

const PRIV_AUDIT_PARTICIPANT_ID = 'priv-audit.participant';

interface IPrivAuditChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    }
}

export function registerPrivAuditParticipant(context: vscode.ExtensionContext) {

    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<IPrivAuditChatResult> => {
        console.log(`[PrivAudit] Budget: ${request.model.maxInputTokens}`);

        if (request.command === 'audit') {
            stream.progress('Auditing code for privacy concerns...');
            
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                stream.markdown("No file is currently opened. Please open a file and try again.");
                return {metadata: {command: 'audit'} };
            }

            const document = editor.document;

            const selection = editor.selection;
            const contents = selection.isEmpty 
                ? document.getText()
                : document.getText(selection);
            const file = document.uri.fsPath;
            const language = document.languageId;

            if (document.isUntitled) {
                stream.markdown("Cannot audit untitled files. Please save the file and try again.");
                return {metadata: {command: 'audit'} };
            }

            try {
                const messages = await constructAuditPrompt(request.model, {
                    contents,
                    file,
                    language,
                    onTruncated: (info) => {
                        console.log(`[PrivAudit] Truncated: ${JSON.stringify(info)}`);
                    }
                });

                const response = await request.model.sendRequest(messages, {}, token);
                for await (const fragment of response.text) {
                    stream.markdown(fragment);
                }
            } catch (error) {
                console.log(`[PrivAudit] Error: ${error}`);
            }
            return {metadata: {command: 'audit'}};
        } else {
            return {metadata: {command: ''} };
        }
    };
    
    vscode.chat.createChatParticipant(PRIV_AUDIT_PARTICIPANT_ID, handler);
}
