import * as vscode from 'vscode';
import { constructAuditPrompt} from './prompts';
import { LINKING_THREATS, IDENTIFYING_THREATS, NON_REPUDIATION_THREATS} from './misc/linddun';


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
                    linkingThreats: LINKING_THREATS,
                    identifyingThreats: IDENTIFYING_THREATS,
                    nonRepudiationThreats: NON_REPUDIATION_THREATS
                });

                const response = await request.model.sendRequest(messages, {}, token);
                for await (const fragment of response.text) {
                    stream.markdown(fragment);
                }
                logger.logUsage('request', { type: 'audit' });
            } catch (error) {
                handleError(logger, error, stream);
            }
            return {metadata: {command: 'audit'}};
    
        } else {
            logger.logUsage('request', { type: '' });
            return {metadata: {command: ''} };
        }
    };
    
    vscode.chat.createChatParticipant(PRIV_AUDIT_PARTICIPANT_ID, handler);

    const logger = vscode.env.createTelemetryLogger({
        sendEventData(eventName, data) {
            // Capture event telemetry
            console.log(`[PrivAudit] Event: ${eventName}`, data);
        },
        sendErrorData(error, data) {
            // Capture error telemetry
            console.error(`[PrivAudit] Error: ${error}`, data);
        }
    });
}

function handleError(logger: vscode.TelemetryLogger, error: unknown, stream: vscode.ChatResponseStream): void {
    logger.logError(error instanceof Error ? error : new Error(String(error)));

    if (error instanceof vscode.LanguageModelError) {
        console.error(`[PrivAudit] LanguageModelError: ${error.message}`, { code: error.code, cause: error.cause });
        
        switch(error.code) {
            case 'NoPermissions':
                stream.markdown(
                    'PrivAudit needs permission to use the requested language model.'
                );
                break;
            case 'NotFound':
                stream.markdown(
                    'No suitable language model is available.'
                );
                break;
            case 'Blocked':
                stream.markdown(
                    'The request was blocked by content filtering before an audit could be completed.'
                );
                break;
            default:
                stream.markdown(
                    `The language model encountered an unexpected error: (${error.code ?? 'unknown'}). ` +
                    'Please try again.'
                );
        }
    } else {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        stream.markdown(`Audit could not be completed due to an internal error: ${message}`);
    }
}