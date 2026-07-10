import {
    PromptElement,
    PromptSizing,
    AssistantMessage,
    UserMessage,
    PrioritizedList,
    renderPrompt,
    BasePromptElementProps,
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';

export interface IAuditPromptProps extends BasePromptElementProps {
    contents: string,
    file: string,
    language: string
}

export class AuditPrompt extends PromptElement<IAuditPromptProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        return (
            <>
                <AssistantMessage>
                    You are a privacy and security auditor specializing in code review.
                    Your job is to analyze code for potential privacy concerns including but not limited to:
                    - Logging or exposing PII (names, emails, addresses, IDs)
                    - Insecure storage or transmission of sensitive data
                    - Missing or insufficient access controls
                    - Third-party data sharing without clear consent
                    - Overly broad data collection
                    Be specific and reference exact line numbers or code snippets where possible.
                </AssistantMessage>
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

export async function constructAuditPrompt(
    model: vscode.LanguageModelChat,
    props: IAuditPromptProps
) {
    const { messages } = await renderPrompt(
        AuditPrompt,
        props,
        { modelMaxPromptTokens: model.maxInputTokens },
        model
    );

    return messages;
}