import {
    PromptElement,
    PromptSizing,
    AssistantMessage,
    TextChunk,
    UserMessage,
    PrioritizedList,
    renderPrompt,
    BasePromptElementProps,
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';

import { Threat, THREATS } from './misc/linddun';
import { RESPONSE } from './misc/response';

export interface IAuditPromptProps extends BasePromptElementProps {
    contents: string,
    file: string,
    language: string,
}

export class AuditPrompt extends PromptElement<IAuditPromptProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        return (
            <>
                <AssistantMessage priority={100}>
                    You are a cyber security expert with more than 10 years experience of using the
                    LINDDUN GO threat modelling methodology to produce comprehensive privacy threat
                    models for a wide range of applications. Your task is to analyze code to produce
                    a list of LINDDUN specific threats for the code, producing JSON output.
                    <br />
                    The 3 key LINDDUN threat types to consider are as follows:<br />
                    <br />
                    &nbsp;&nbsp;1. Linking - Learning more about an individual or a group by associating 
                    data items or user actions. Combining related data items may reveal (additional) information 
                    about a data subject or groups of data subjects.<br />
                    &nbsp;&nbsp;2. Identifying - Identifying threats arise when the identity of individuals can
                    can be revealed through leaks, deduction, or inference in cases where this is not desired.
                    A key distinction is made between threats in the context of identified data (where there is 
                    an explicit link), and identifiable data (where the link can be derived).<br />
                    &nbsp;&nbsp;3. Non-Repudiation - Non-repudiation threats pertain to situations where an individual
                    can no longer deny specific claims. The system retains evidence related to a particular action or fact, 
                    influencing the ability to deny claims.<br />
                    <br />
                    Additionally, a list of specific privacy threats (threat cards) may be provided for each LINDDUN type. 
                    If provided, you must use the threat cards to fine-grain the analysis, if not use the general LINDDUN types. Each threat card is 
                    enclosed in triple quotes and contain the following fields:<br />
                    &nbsp;&nbsp;- IDENTIFIER: unique identifier for the card.<br />
                    &nbsp;&nbsp;- TYPE: LINDDUN type the threat belongs to.<br />
                    &nbsp;&nbsp;- TITLE: name of the threat.<br />
                    &nbsp;&nbsp;- DESCRIPTION: brief explanation of the threat.<br />
                    &nbsp;&nbsp;- HOTSPOT: where the threat occurs in the system.<br />
                    &nbsp;&nbsp;- ELICITATION QUESTIONS: to help determine if the threat applies. DO NOT assume
                    the threat is applicable to ONLY these questions.<br />
                    &nbsp;&nbsp;- EXAMPLES: the help illustrate the threat. DO NOT assume the threat is limited to ONLY
                    these examples.
                    <br />
                    <ThreatList threats={THREATS} priority={80} descending={true} />
                </AssistantMessage>
                <AssistantMessage priority={95}>
                        Respond with ONLY a single JSON object with markdown code fences, no prose before or after. 
                        The JSON must conform exactly to this schema:
                        <br />
                        {JSON.stringify(RESPONSE, null, 2)}
                        <br />
                        Example of a valid response:
                        <br />
                        {JSON.stringify({
                            findings: [
                                {
                                    threatId: 'L1',
                                    category: 'Linking',
                                    title: 'Linked User Requests',
                                    description: 'The `userId` field is logged alongside the IP address on line 42, enabling linkage of requests to a single individual across sessions.',
                                    location: { startLine: 42, endLine: 42, snippet: 'logger.info(`Request from user ${userId} at ${ip}`)' },
                                    confidence: 'high',
                                    recommendation: 'Hash or omit the userId in logs, or use a rotating session token instead.'
                                }
                            ]
                        }, null, 2)}
                        <br />
                        If no privacy concerns are found, return {'{'} "findings": [] {'}'}. Do not invent findings that aren't grounded in the code you were given.
                </AssistantMessage>
                <UserMessage priority={90} flexGrow={1}>
                    Analyze the following {this.props.language} code from {this.props.file} against
                    the threat cards. The code will be fenced in triple backticks.<br />
                    ```<br />
                    <TextChunk breakOn="\n">
                        {this.props.contents}
                    </TextChunk><br />
                    ```
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
                TITLE: {threat.title}<br />
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