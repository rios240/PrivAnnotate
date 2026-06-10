import * as vscode from 'vscode';
import { constructAuditPrompt, constructDefaultPrompt} from './prompt';

const PRIV_AUDIT_PARTICIPANT_ID = 'priv-audit.priv-audit-participant';

interface PrivAuditChatResult extends vscode.ChatResult {
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
    ): Promise<PrivAuditChatResult> => {

        const [model] = await vscode.lm.selectChatModels({ 
            vendor: 'copliot',
            family: 'claude-sonnet' 
        });

        if (!model) {
            console.log('Model not found. Please make sure the GitHub Copilot Chat extension is installed and enabled.');
            return {metadata: {command: ''} };
        }

        if (request.command === 'audit') {
            stream.progress('Auditing code for privacy concerns...');
            
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                stream.markdown("No file is currently opened. Please open a file and try again.");
                return {metadata: {command: ''} };
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
                return {metadata: {command: ''} };
            }

            const messages = await constructAuditPrompt(model, {
                contents,
                file,
                language
            });

            const response = await model.sendRequest(messages, {}, token);
            for await (const fragment of response.text) {
                stream.markdown(fragment);
            }

            return {metadata: {command: 'audit'}};
        
        } else {
            const messages = await constructDefaultPrompt(model);

            const response = await model.sendRequest(messages, {}, token);
            for await (const fragment of response.text) {
                stream.markdown(fragment);
            }
            return {metadata: {command: ''} };
        }

    };
    
    const privAudit = vscode.chat.createChatParticipant(PRIV_AUDIT_PARTICIPANT_ID, handler);

}