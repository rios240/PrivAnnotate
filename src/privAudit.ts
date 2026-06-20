import * as vscode from 'vscode';
import { constructAuditPrompt, constructDefaultPrompt} from './prompts';

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

        const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-5-mini'});
        console.log('Selected models:', models);
		if (models.length > 0) {
            const chatModel = models[0];
            console.log('Using language model:', chatModel);

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

            try {
                const messages = await constructAuditPrompt(chatModel, {
                    contents,
                    file,
                    language
                });

                const response = await chatModel.sendRequest(messages, {}, token);
                for await (const fragment of response.text) {
                    stream.markdown(fragment);
                }

            } catch (error) {
                console.error('[registerPrivAuditParticipant] Error in audit handler:', error);
                stream.markdown(`Error: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
            }

            return {metadata: {command: 'audit'}};
        
            } else {
                try {
                    const messages = await constructDefaultPrompt(chatModel, { userQuery: request.prompt });

                    const response = await chatModel.sendRequest(messages, {}, token);

                    for await (const fragment of response.text) {
                        stream.markdown(fragment);
                    }

                } catch (error) {
                    console.error('[registerPrivAuditParticipant] Error in default handler:', error);
                    stream.markdown(`Error: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
                }

                return {metadata: {command: ''} };
            }

		} else {
            console.error('No suitable language model found.');
			return {metadata: {command: ''} };
        }
    };
    
    vscode.chat.createChatParticipant(PRIV_AUDIT_PARTICIPANT_ID, handler);

}