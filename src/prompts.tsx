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

import { Threat } from './misc/linddun';

export interface IAuditPromptProps extends BasePromptElementProps {
    contents: string,
    file: string,
    language: string,
    linkingThreats: Threat[],
    identifyingThreats: Threat[],
    nonRepudiationThreats: Threat[]
}

export class AuditPrompt extends PromptElement<IAuditPromptProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        return (
            <>
                <AssistantMessage priority={100}>
                    You are a cyber security expert with more than 10 years experience of using the
                    LINDDUN GO threat modelling methodology to produce comprehensive privacy threat
                    models for a wide range of applications. Your task is to analyze code to produce
                    a list of LINDDUN specific threats for the code.
                    <br />
                    The 3 key LINDDUN threat types to consider are as follows, enclosed in triple quotes:<br />
                    '''<br />
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
                    '''
                    <br />
                    Additionally, a list of specific privacy threats (threat cards) may be provided for each LINDDUN type. 
                    If provided, you must use the threat cards to fine-grain the analysis. The threat cards are enclosed in 
                    quadruple quotes and contain the following fields:<br />
                    &nbsp;&nbsp;- IDENTIFIER: unique identifier for the card.<br />
                    &nbsp;&nbsp;- TYPE: LINDDUN type the threat belongs to.<br />
                    &nbsp;&nbsp;- TITLE: name of the threat.<br />
                    &nbsp;&nbsp;- DESCRIPTION: brief explanation of the threat.<br />
                    &nbsp;&nbsp;- HOTSPOT: where the threat occurs in the system.<br />
                    &nbsp;&nbsp;- ELICITATION QUESTIONS: to help determine if the threat applies. DO NOT assume
                    the threat is applicable to ONLY these questions.<br />
                    &nbsp;&nbsp;- EXAMPLES: the help illustrate the threat. DO NOT assume the threat is limited to ONLY
                    these examples.
                </AssistantMessage>
                <PrioritizedList priority={70} descending={true}>
                    {this.props.linkingThreats.map((threat, index) => (
                        <ThreatElement threat={threat} priority={70 - index} />
                    ))}
                </PrioritizedList>
                <PrioritizedList priority={70} descending={true}>
                    {this.props.identifyingThreats.map((threat, index) => (
                        <ThreatElement threat={threat} priority={70 - index} />
                    ))}
                </PrioritizedList>
                <PrioritizedList priority={70} descending={true}>
                    {this.props.nonRepudiationThreats.map((threat, index) => (
                        <ThreatElement threat={threat} priority={70 - index} />
                    ))}
                </PrioritizedList>
                <UserMessage>
                    Finally, analyze the following {this.props.language} code from {this.props.file} against
                    only the threat cards.
                    <br />
                    <PrioritizedList priority={90} descending={false}>
                        {this.props.contents}
                    </PrioritizedList>
                </UserMessage>
            </>
        )
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
                ''''<br />
                IDENTIFIER: {threat.id}<br />
                TYPE: {threat.type}<br />
                TITLE: {threat.title}<br />
                DESCRIPTION: {threat.description}<br />
                HOTSPOT: {threat.hotspot}<br />
                ELICITATION QUESTIONS:<br />
                {threat.elicitation.map(e => <>&nbsp;&nbsp;- {e}<br /></>)}
                EXAMPLES:<br />
                {threat.examples.map(e => <>&nbsp;&nbsp;- {e}<br /></>)}
                '''''
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