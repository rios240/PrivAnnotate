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

import { Threat, THREATS } from './misc/linddun';
import { RESPONSE } from './misc/response';

export interface IAnalyzePromptProps extends BasePromptElementProps {
    document: vscode.TextDocument,
    range?: vscode.Range,
    onTruncated?: (info: { totalLines: number; includedLines: number }) => void;
}

export class AnalyzePrompt extends PromptElement<IAnalyzePromptProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        return (
            <>
                <AssistantMessage priority={100}>
                    You are a cyber security expert with more than 10 years experience of using the
                    LINDDUN GO threat modelling methodology to produce comprehensive privacy threat
                    models for a wide range of applications. Your task is to analyze raw code to detect
                    LINDDUN specific threats, producing JSON output.
                    <br />
                    A list of LINDDUN GO privacy threats, known as threat cards, will be provided. 
                    Each threat card is enclosed in triple quotes and contain the following fields:<br />
                    &nbsp;&nbsp;- IDENTIFIER: unique identifier for the card.<br />
                    &nbsp;&nbsp;- TYPE: LINDDUN type the threat belongs to.<br />
                    &nbsp;&nbsp;- THREAT: name of the threat.<br />
                    &nbsp;&nbsp;- DESCRIPTION: brief explanation of the threat.<br />
                    &nbsp;&nbsp;- HOTSPOT: where the threat occurs in the system.<br />
                    &nbsp;&nbsp;- ELICITATION QUESTIONS: to help determine if the threat applies. DO NOT assume
                    the threat is applicable to ONLY these questions.<br />
                    &nbsp;&nbsp;- EXAMPLES: to help illustrate the threat. DO NOT assume the threat is limited to ONLY
                    these examples.
                    <br />
                    <ThreatList threats={THREATS} priority={70} descending={true} />
                </AssistantMessage>
                <AssistantMessage priority={90}>
                        Respond ONLY with a series of JSON objects each separated with a vertical bar "|", no backticks, no prose before or after. 
                        The JSON must conform exactly to this schema:
                        <br />
                        {JSON.stringify(RESPONSE, null, 2)}
                        <br />
                        If no privacy threats are found, return {'{}'}. Do not invent findings that aren't grounded in the code or threat cards you are given.
                </AssistantMessage>
                <UserMessage priority={80} flexGrow={1}>
                    Analyze the following {this.props.document.languageId} code against the provided threat cards. The code is fenced in triple backticks. 
                    Each line is prefixed with its exact line number "N" (format: "N| code"). Use these exact numbers verbatim in the "location" field 
                    of your JSON output. DO NOT recalculate or estimate line numbers yourself.<br />
                    <br />
                    <CodeElement
                        document={this.props.document}
                        range={this.props.range}
                        onTruncated={this.props.onTruncated}
                    />
                </UserMessage>
            </>
        )
    }
}

export interface IThreatListProps extends BasePromptElementProps {
    threats: Threat[];
    priority: number;
    descending?: boolean;
}

export class ThreatList extends PromptElement<IThreatListProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        return (
            <PrioritizedList priority={this.props.priority} descending={this.props.descending ?? false}>
                {this.props.threats.map(threat => (
                    <ThreatElement threat={threat} />
                ))}
            </PrioritizedList>
        );
    }
}

export interface IThreatProps extends BasePromptElementProps {
    threat: Threat
}

export class ThreatElement extends PromptElement<IThreatProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const threat = this.props.threat;
        return (
            <>
                '''<br />
                IDENTIFIER: {threat.id}<br />
                TYPE: {threat.type}<br />
                THREAT: {threat.threat}<br />
                DESCRIPTION: {threat.description}<br />
                HOTSPOT: {threat.hotspot}<br />
                ELICITATION QUESTIONS:<br />
                {threat.elicitation.map(e => <>&nbsp;&nbsp;- {e}<br /></>)}
                EXAMPLES:<br />
                {threat.examples.map(e => <>&nbsp;&nbsp;- {e}<br /></>)}
                '''
            </>
        )
    }
}

export interface ICodeElementProps extends BasePromptElementProps {
    document: vscode.TextDocument;
    range?: vscode.Range
    onTruncated?: (info: { totalLines: number; includedLines: number }) => void;
}

interface ICodeElementState {
    body: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    truncated: boolean;
}

export class CodeElement extends PromptElement<ICodeElementProps, ICodeElementState> {
    async prepare(sizing: PromptSizing): Promise<ICodeElementState> {
        const doc = this.props.document;
        const range = this.props.range ?? new vscode.Range(
            0, 0,
            doc.lineCount - 1,
            doc.lineAt(doc.lineCount - 1).text.length
        );

        // VS Code positions are 0-based; show 1-based line numbers to the LLM
        // so "location" in its JSON response maps directly onto real editor lines.
        const startLine = range.start.line + 1;
        const lines = doc.getText(range).split(/\r?\n/);
        const maxLineNo = startLine + lines.length - 1;
        const width = String(maxLineNo).length;
        const numberedLines = lines.map((line, i) =>
            `${String(startLine + i).padStart(width, ' ')}| ${line}`
        );

        const header = `\`\`\`\n`;
        const footer = `\n\`\`\``;
        const fixedCost = await sizing.countTokens(header + footer);
        const budget = sizing.tokenBudget - fixedCost;

        let includedLines: string[] = [];
        let usedTokens = 0;
        for (const line of numberedLines) {
            const lineTokens = await sizing.countTokens(line + '\n');
            if (usedTokens + lineTokens > budget) break;
            includedLines.push(line);
            usedTokens += lineTokens;
        }

        const truncated = includedLines.length < numberedLines.length;
        if (truncated) {
            this.props.onTruncated?.({ totalLines: numberedLines.length, includedLines: includedLines.length });
        }

        return {
            body: `${header}${includedLines.join('\n')}${footer}`,
            startLine,
            endLine: startLine + includedLines.length - 1,
            totalLines: numberedLines.length,
            truncated
        };
    }

    render(state: ICodeElementState) {
        return <>{state.body}</>;
    }
}

export async function constructAnalyzePrompt(
    model: vscode.LanguageModelChat,
    props: IAnalyzePromptProps
) {
    const { messages } = await renderPrompt(
        AnalyzePrompt,
        props,
        { modelMaxPromptTokens: model.maxInputTokens },
        model
    );

    return messages;
}