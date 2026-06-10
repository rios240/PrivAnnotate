import {
    PromptElement,
    PromptSizing,
    SystemMessage,
    UserMessage,
    PrioritizedList,
    renderPrompt,
    BasePromptElementProps,
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';

export interface AuditPromptProps extends BasePromptElementProps {
    contents: string,
    file: string,
    language: string
}

export class AuditPrompt extends PromptElement<AuditPromptProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        return (
            <>
                <SystemMessage>
                    You are a privacy and security auditor specializing in code review.
                    Your job is to analyze code for potential privacy concerns including but not limited to:
                    - Logging or exposing PII (names, emails, addresses, IDs)
                    - Insecure storage or transmission of sensitive data
                    - Missing or insufficient access controls
                    - Third-party data sharing without clear consent
                    - Overly broad data collection
                    Be specific and reference exact line numbers or code snippets where possible.
                </SystemMessage>
                <UserMessage>
                    Please audit the following {this.props.language} code for privacy concerns.
                    File: {this.props.file}
                    <br />
                    <PrioritizedList priority={100} descending={false}>
                        {this.props.contents}
                    </PrioritizedList>
                </UserMessage>
            
            </>
        )
    }
}

export class DefaultPrompt extends PromptElement<BasePromptElementProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        return (
            <>
                <SystemMessage>
                    You are a privacy and security auditor specializing in code review.
                    Your job is to analyze code for potential privacy concerns including but not limited to:
                    - Logging or exposing PII (names, emails, addresses, IDs)
                    - Insecure storage or transmission of sensitive data
                    - Missing or insufficient access controls
                    - Third-party data sharing without clear consent
                    - Overly broad data collection
                    Be specific and reference exact line numbers or code snippets where possible.
                </SystemMessage>
            </>
        )
    }
}

export async function constructAuditPrompt(
    model: vscode.LanguageModelChat,
    props: AuditPromptProps
) {
    try {
        const { messages } = await renderPrompt(
            AuditPrompt,
            props,
            { modelMaxPromptTokens: model.maxInputTokens },
            model
        );

    return messages;
    
    } catch (error) {
        console.error('[constructAuditPrompt]:', error);
        throw error;
    }
}

export async function constructDefaultPrompt(
    model: vscode.LanguageModelChat
) {
    try {
        const { messages } = await renderPrompt(
            DefaultPrompt,
            {},
            { modelMaxPromptTokens: model.maxInputTokens },
            model
        );
        return messages;
    } catch (error) {
        console.error('[constructDefaultPrompt]:', error);
        throw error;
    }
}