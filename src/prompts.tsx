import {
    PromptElement,
    PromptSizing,
    AssistantMessage,
    UserMessage,
    renderPrompt,
    BasePromptElementProps,
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';

import { CardExample, PdcCard } from './pdc/categories';
import { FINDING_JSON_SCHEMA } from './pdc/schema';

/**
 * Boundary markers around the code under analysis. Explicit delimiters (rather
 * than a backtick fence) survive code that itself contains fences, and give the
 * model an unambiguous edge for "only annotate what is between these markers".
 */
export const CODE_INPUT_START = '<<<CODE_INPUT>>>';
export const CODE_INPUT_END = '<<<END_CODE_INPUT>>>';

export interface ITruncationInfo {
    totalLines: number;
    includedLines: number;
}

/* ------------------------------------------------------------------ */
/* 1. Prelude — role, grounding rules, framework context               */
/* ------------------------------------------------------------------ */

export interface IPreludeProps extends BasePromptElementProps {
    card: PdcCard;
}

export class PreludeElement extends PromptElement<IPreludeProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const card = this.props.card;
        return (
            <>
                You are a privacy engineer annotating source code with the data practices it
                implements. You work from the Privacy Practice Detection Card set: eight
                code-relevant categories adapted from the OPP-115 privacy-policy taxonomy, plus
                one custom category covering AI/ML usage. Downstream, your annotations are
                compared against an organization's written privacy policy to surface
                inconsistencies, so precision matters more than volume.
                <br />
                <br />
                SCOPE OF THIS REQUEST: you are given exactly one card — {card.id} (
                {card.displayName}) — and you report matches for that category only. Other
                categories are being handled by separate requests. If a span also matches a
                different category, note that in the finding's "crossReferences" field; do not
                emit a finding for it.
                <br />
                <br />
                GROUNDING RULES:<br />
                &nbsp;&nbsp;- Annotate only code that actually appears between the{' '}
                {CODE_INPUT_START} and {CODE_INPUT_END} markers. Never invent, complete, or
                assume code that is not shown.<br />
                &nbsp;&nbsp;- Each line of the input is prefixed with its exact line number in
                the format "N| code". Use those numbers verbatim. Do not recount, offset, or
                estimate line numbers.<br />
                &nbsp;&nbsp;- The "excerpt" of a finding must be copied verbatim from the input
                with the "N| " prefix stripped. Do not paraphrase, reformat, or reindent it.<br />
                &nbsp;&nbsp;- Report each distinct matching span as its own finding. Do not merge
                unrelated spans into one finding, and do not emit duplicate findings for the same
                span.<br />
                &nbsp;&nbsp;- Imports, bare variable declarations, type definitions, comments, and
                static configuration constants are not by themselves data practices. An operation
                must actually occur.<br />
                &nbsp;&nbsp;- The code shown may be a fragment of a larger file, so context may be
                missing. When a match depends on context you cannot see, still report it, but
                lower the confidence rather than guessing.<br />
                &nbsp;&nbsp;- Finding nothing is a correct and expected outcome. Most code spans
                do not match any given category. Do not stretch to produce a match.
            </>
        );
    }
}

/* ------------------------------------------------------------------ */
/* 2. Category — one detection card                                    */
/* ------------------------------------------------------------------ */

export interface ICardExampleProps extends BasePromptElementProps {
    example: CardExample;
    index: number;
}

export class CardExampleElement extends PromptElement<ICardExampleProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const { example, index } = this.props;
        return (
            <>
                <br />
                Example {index} - {example.label}<br />
                ```{example.language}<br />
                {example.code}<br />
                ```<br />
                Reasoning:<br />
                {example.reasoning.map((step, i) => (
                    <>&nbsp;&nbsp;{i + 1}. {step}<br /></>
                ))}
                Conclusion: {example.conclusion}<br />
            </>
        );
    }
}

export interface ICategoryCardProps extends BasePromptElementProps {
    card: PdcCard;
}

export class CategoryCardElement extends PromptElement<ICategoryCardProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const card = this.props.card;
        return (
            <>
                '''<br />
                IDENTIFIER: {card.id}<br />
                CATEGORY: {card.category}<br />
                CATEGORY NAME: {card.displayName}<br />
                <br />
                BASE DESCRIPTION:<br />
                {card.baseDescription}<br />
                <br />
                HOW TO REASON ABOUT THIS CATEGORY:<br />
                {card.chainOfThought}<br />
                <br />
                ELICITATION QUESTIONS (guidance, not an exhaustive test — a span may match this
                category without answering any of these):<br />
                {card.elicitationQuestions.map(q => (
                    <>&nbsp;&nbsp;- {q}<br /></>
                ))}
                <br />
                WORKED EXAMPLES (the negative examples define the boundary as much as the
                positive ones — study both):<br />
                {card.examples.map((example, i) => (
                    <CardExampleElement example={example} index={i + 1} />
                ))}
                {card.crossReferences?.length ? (
                    <>
                        <br />
                        RELATED CATEGORIES: spans matching {card.id} frequently also match{' '}
                        {card.crossReferences.join(', ')}. List those in "crossReferences" rather
                        than emitting findings for them.<br />
                    </>
                ) : (
                    <></>
                )}
                '''
            </>
        );
    }
}

/* ------------------------------------------------------------------ */
/* 3. Output — response format                                         */
/* ------------------------------------------------------------------ */

export interface IOutputFormatProps extends BasePromptElementProps {
    card: PdcCard;
}

export class OutputFormatElement extends PromptElement<IOutputFormatProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const card = this.props.card;
        return (
            <>
                RESPONSE FORMAT<br />
                <br />
                Respond with a single JSON array and nothing else. No prose before or after, no
                explanation, no markdown code fence, no backticks. Your entire response must
                parse as JSON.<br />
                <br />
                The array must conform to this schema:<br />
                {JSON.stringify(FINDING_JSON_SCHEMA, null, 2)}<br />
                <br />
                Every element's "category" must be exactly "{card.category}" — the category of
                the one card you were given.<br />
                <br />
                If no span in the supplied code matches {card.id}, respond with exactly:{' '}
                {'[]'}
            </>
        );
    }
}

/* ------------------------------------------------------------------ */
/* 4. Code / Task — the analysis target                                */
/* ------------------------------------------------------------------ */

export interface ICodeTaskProps extends BasePromptElementProps {
    document: vscode.TextDocument;
    range?: vscode.Range;
    /** Path shown to the model; omitted for untitled documents. */
    filePath?: string;
    card: PdcCard;
    onTruncated?: (info: ITruncationInfo) => void;
}

interface ICodeTaskState {
    body: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    truncated: boolean;
}

export class CodeTaskElement extends PromptElement<ICodeTaskProps, ICodeTaskState> {
    async prepare(sizing: PromptSizing): Promise<ICodeTaskState> {
        const doc = this.props.document;
        const range = this.props.range ?? new vscode.Range(
            0, 0,
            doc.lineCount - 1,
            doc.lineAt(doc.lineCount - 1).text.length
        );

        // VS Code positions are 0-based; show 1-based line numbers to the LLM
        // so "lineRange" in its JSON response maps directly onto real editor lines.
        const startLine = range.start.line + 1;
        const lines = doc.getText(range).split(/\r?\n/);
        const maxLineNo = startLine + lines.length - 1;
        const width = String(maxLineNo).length;
        const numberedLines = lines.map((line, i) =>
            `${String(startLine + i).padStart(width, ' ')}| ${line}`
        );

        const header = `${CODE_INPUT_START}\n`;
        const footer = `\n${CODE_INPUT_END}`;
        const fixedCost = await sizing.countTokens(header + footer);
        const budget = sizing.tokenBudget - fixedCost;

        const includedLines: string[] = [];
        let usedTokens = 0;
        for (const line of numberedLines) {
            const lineTokens = await sizing.countTokens(line + '\n');
            if (usedTokens + lineTokens > budget) break;
            includedLines.push(line);
            usedTokens += lineTokens;
        }

        const truncated = includedLines.length < numberedLines.length;
        if (truncated) {
            this.props.onTruncated?.({
                totalLines: numberedLines.length,
                includedLines: includedLines.length,
            });
        }

        return {
            body: `${header}${includedLines.join('\n')}${footer}`,
            startLine,
            endLine: startLine + includedLines.length - 1,
            totalLines: numberedLines.length,
            truncated,
        };
    }

    render(state: ICodeTaskState) {
        const { card, document, filePath } = this.props;
        return (
            <>
                TASK: analyze the {document.languageId} code below against card {card.id} (
                {card.displayName}) only, and report every span that matches it.<br />
                {filePath ? <>FILE: {filePath}<br /></> : <></>}
                LINES SHOWN: {state.startLine} to {state.endLine}
                {state.truncated ? ' (the remainder of the selection did not fit and is not shown)' : ''}
                <br />
                <br />
                {state.body}
            </>
        );
    }
}

/* ------------------------------------------------------------------ */
/* 5. Top-level assembler                                              */
/* ------------------------------------------------------------------ */

export interface ICategoryAnalysisPromptProps extends BasePromptElementProps {
    card: PdcCard;
    document: vscode.TextDocument;
    range?: vscode.Range;
    filePath?: string;
    onTruncated?: (info: ITruncationInfo) => void;
}

/**
 * One request's worth of prompt: prelude + a single category card + output
 * contract, followed by the code under analysis.
 *
 * Instruction content sits in an AssistantMessage rather than a system message
 * because `vscode.LanguageModelChatMessage` only has user and assistant roles.
 *
 * Priorities order what survives a tight token budget, most indispensable
 * first: without the output contract the reply is unparseable, and without the
 * code there is nothing to analyze at all — so both outrank the prelude and the
 * card, whose examples are the affordable thing to lose. `flexGrow` still lets
 * the code claim whatever budget the instructions leave behind.
 */
export class CategoryAnalysisPrompt extends PromptElement<ICategoryAnalysisPromptProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const card = this.props.card;
        return (
            <>
                <AssistantMessage priority={90}>
                    <PreludeElement card={card} />
                </AssistantMessage>
                <AssistantMessage priority={100}>
                    <OutputFormatElement card={card} />
                </AssistantMessage>
                <AssistantMessage priority={85}>
                    DETECTION CARD FOR THIS REQUEST:<br />
                    <CategoryCardElement card={card} />
                </AssistantMessage>
                <UserMessage priority={95} flexGrow={1}>
                    <CodeTaskElement
                        card={card}
                        document={this.props.document}
                        range={this.props.range}
                        filePath={this.props.filePath}
                        onTruncated={this.props.onTruncated}
                    />
                </UserMessage>
            </>
        );
    }
}

export async function constructCategoryPrompt(
    model: vscode.LanguageModelChat,
    props: ICategoryAnalysisPromptProps
) {
    const { messages } = await renderPrompt(
        CategoryAnalysisPrompt,
        props,
        { modelMaxPromptTokens: model.maxInputTokens },
        model
    );

    return messages;
}