import {
    PromptElement,
    PromptSizing,
    AssistantMessage,
    UserMessage,
    renderPrompt,
    BasePromptElementProps,
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';

import { RuleExample, PrivacyRule } from '../rules/catalog';
import { FINDING_JSON_SCHEMA } from '../findings/schema';

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
/* 1. Prelude - role, grounding rules, framework context               */
/* ------------------------------------------------------------------ */

export interface IPreludeProps extends BasePromptElementProps {
    rule: PrivacyRule;
}

export class PreludeElement extends PromptElement<IPreludeProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const rule = this.props.rule;
        return (
            <>
                You are a privacy engineer annotating source code with the data practices it implements. You
                work from the Privacy Practice Detection Rules: eight code-relevant categories adapted from
                the OPP-115 privacy-policy taxonomy, plus one custom category covering AI/ML usage.
                Downstream, your annotations are compared against an organization's written privacy policy to
                surface inconsistencies, so precision matters more than volume.
                <br />
                <br />
                SCOPE OF THIS REQUEST: you are given exactly one rule - {rule.id} ({rule.displayName}) - and
                you report matches for that category only. Other categories are being handled by separate
                requests. If a span also matches a different category, note that in the finding's
                "crossReferences" field; do not emit a finding for it.
                <br />
                <br />
                GROUNDING RULES:
                <br />
                &nbsp;&nbsp;- Annotate only code that actually appears between the {CODE_INPUT_START} and{' '}
                {CODE_INPUT_END} markers. Never invent, complete, or assume code that is not shown.
                <br />
                &nbsp;&nbsp;- Each line of the input is prefixed with its exact line number in the format "N|
                code". Use those numbers verbatim. Do not recount, offset, or estimate line numbers.
                <br />
                &nbsp;&nbsp;- The "excerpt" of a finding must be copied verbatim from the input with the "N| "
                prefix stripped. Do not paraphrase, reformat, or reindent it.
                <br />
                &nbsp;&nbsp;- Report each distinct matching span as its own finding. Do not merge unrelated
                spans into one finding, and do not emit duplicate findings for the same span.
                <br />
                &nbsp;&nbsp;- Imports, bare variable declarations, type definitions, comments, and static
                configuration constants are not by themselves data practices. An operation must actually
                occur.
                <br />
                &nbsp;&nbsp;- The code shown may be a fragment of a larger file, so context may be missing.
                When a match depends on context you cannot see, still report it, but lower the confidence
                rather than guessing.
                <br />
                &nbsp;&nbsp;- Finding nothing is a correct and expected outcome. Most code spans do not match
                any given category. Do not stretch to produce a match.
            </>
        );
    }
}

/* ------------------------------------------------------------------ */
/* 2. Category - one detection rule                                    */
/* ------------------------------------------------------------------ */

export interface IRuleExampleProps extends BasePromptElementProps {
    example: RuleExample;
    index: number;
}

export class RuleExampleElement extends PromptElement<IRuleExampleProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const { example, index } = this.props;
        return (
            <>
                <br />
                Example {index} - {example.label}
                <br />
                ```{example.language}
                <br />
                {example.code}
                <br />
                ```
                <br />
                Reasoning:
                <br />
                {example.reasoning.map((step, i) => (
                    <>
                        &nbsp;&nbsp;{i + 1}. {step}
                        <br />
                    </>
                ))}
                Conclusion: {example.conclusion}
                <br />
            </>
        );
    }
}

export interface IRuleProps extends BasePromptElementProps {
    rule: PrivacyRule;
}

export class RuleElement extends PromptElement<IRuleProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const rule = this.props.rule;
        return (
            <>
                '''
                <br />
                IDENTIFIER: {rule.id}
                <br />
                CATEGORY: {rule.category}
                <br />
                CATEGORY NAME: {rule.displayName}
                <br />
                <br />
                BASE DESCRIPTION:
                <br />
                {rule.baseDescription}
                <br />
                <br />
                HOW TO REASON ABOUT THIS CATEGORY:
                <br />
                {rule.chainOfThought}
                <br />
                <br />
                ELICITATION QUESTIONS (guidance, not an exhaustive test - a span may match this category
                without answering any of these):
                <br />
                {rule.elicitationQuestions.map(q => (
                    <>
                        &nbsp;&nbsp;- {q}
                        <br />
                    </>
                ))}
                <br />
                WORKED EXAMPLES (the negative examples define the boundary as much as the positive ones -
                study both):
                <br />
                {rule.examples.map((example, i) => (
                    <RuleExampleElement example={example} index={i + 1} />
                ))}
                {rule.crossReferences?.length ? (
                    <>
                        <br />
                        RELATED CATEGORIES: spans matching {rule.id} frequently also match{' '}
                        {rule.crossReferences.join(', ')}. List those in "crossReferences" rather than
                        emitting findings for them.
                        <br />
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
/* 3. Output - response format                                         */
/* ------------------------------------------------------------------ */

export interface IOutputFormatProps extends BasePromptElementProps {
    rule: PrivacyRule;
}

export class OutputFormatElement extends PromptElement<IOutputFormatProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const rule = this.props.rule;
        return (
            <>
                RESPONSE FORMAT
                <br />
                <br />
                Respond with a single JSON array and nothing else. No prose before or after, no explanation,
                no markdown code fence, no backticks. Your entire response must parse as JSON.
                <br />
                <br />
                The array must conform to this schema:
                <br />
                {JSON.stringify(FINDING_JSON_SCHEMA, null, 2)}
                <br />
                <br />
                Every element's "category" must be exactly "{rule.category}" - the category of the one rule
                you were given.
                <br />
                <br />
                If no span in the supplied code matches {rule.id}, respond with exactly: {'[]'}
            </>
        );
    }
}

/* ------------------------------------------------------------------ */
/* 4. Code / Task - the analysis target                                */
/* ------------------------------------------------------------------ */

export interface ICodeTaskProps extends BasePromptElementProps {
    document: vscode.TextDocument;
    range?: vscode.Range;
    /** Path shown to the model; omitted for untitled documents. */
    filePath?: string;
    rule: PrivacyRule;
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
        const range =
            this.props.range ??
            new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);

        // VS Code positions are 0-based; show 1-based line numbers to the LLM
        // so "lineRange" in its JSON response maps directly onto real editor lines.
        const startLine = range.start.line + 1;
        const lines = doc.getText(range).split(/\r?\n/);
        const maxLineNo = startLine + lines.length - 1;
        const width = String(maxLineNo).length;
        const numberedLines = lines.map(
            (line, i) => `${String(startLine + i).padStart(width, ' ')}| ${line}`
        );

        const header = `${CODE_INPUT_START}\n`;
        const footer = `\n${CODE_INPUT_END}`;
        const fixedCost = await sizing.countTokens(header + footer);
        const budget = sizing.tokenBudget - fixedCost;

        const includedLines = numberedLines.slice(
            0,
            await longestFittingPrefix(numberedLines, budget, text => sizing.countTokens(text))
        );

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
        const { rule, document, filePath } = this.props;
        return (
            <>
                TASK: analyze the {document.languageId} code below against rule {rule.id} ({rule.displayName})
                only, and report every span that matches it.
                <br />
                {filePath ? (
                    <>
                        FILE: {filePath}
                        <br />
                    </>
                ) : (
                    <></>
                )}
                LINES SHOWN: {state.startLine} to {state.endLine}
                {state.truncated ? ' (the remainder of the selection did not fit and is not shown)' : ''}
                <br />
                <br />
                {state.body}
            </>
        );
    }
}

/**
 * How many leading lines fit in `budget` tokens. Chunking already sized the
 * range to fit, so one count of the whole body settles the common case; only
 * an overflow falls back to a binary search over prefix lengths - O(log n)
 * counts instead of one per line. Token counts are monotone in prefix length,
 * which is what makes the search valid.
 */
export async function longestFittingPrefix(
    lines: readonly string[],
    budget: number,
    countTokens: (text: string) => number | Promise<number>
): Promise<number> {
    const fits = async (n: number) => n === 0 || (await countTokens(lines.slice(0, n).join('\n'))) <= budget;

    if (await fits(lines.length)) return lines.length;

    // Invariant: a prefix of `low` lines fits, one of `high` lines does not.
    let low = 0;
    let high = lines.length;
    while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (await fits(mid)) {
            low = mid;
        } else {
            high = mid;
        }
    }
    return low;
}

/* ------------------------------------------------------------------ */
/* 5. Top-level assembler                                              */
/* ------------------------------------------------------------------ */

export interface ICategoryAnalysisPromptProps extends BasePromptElementProps {
    rule: PrivacyRule;
    document: vscode.TextDocument;
    range?: vscode.Range;
    filePath?: string;
    onTruncated?: (info: ITruncationInfo) => void;
}

/**
 * One request's worth of prompt: prelude + a single category rule + output
 * contract, followed by the code under analysis.
 *
 * Instruction content sits in an AssistantMessage rather than a system message
 * because `vscode.LanguageModelChatMessage` only has user and assistant roles.
 *
 * Priorities order what survives a tight token budget, most indispensable
 * first: without the output contract the reply is unparseable, and without the
 * code there is nothing to analyze at all - so both outrank the prelude and the
 * rule, whose examples are the affordable thing to lose. `flexGrow` still lets
 * the code claim whatever budget the instructions leave behind.
 */
export class CategoryAnalysisPrompt extends PromptElement<ICategoryAnalysisPromptProps, void> {
    render(_state: void, _sizing: PromptSizing) {
        const rule = this.props.rule;
        return (
            <>
                <AssistantMessage priority={90}>
                    <PreludeElement rule={rule} />
                </AssistantMessage>
                <AssistantMessage priority={100}>
                    <OutputFormatElement rule={rule} />
                </AssistantMessage>
                <AssistantMessage priority={85}>
                    DETECTION RULE FOR THIS REQUEST:
                    <br />
                    <RuleElement rule={rule} />
                </AssistantMessage>
                <UserMessage priority={95} flexGrow={1}>
                    <CodeTaskElement
                        rule={rule}
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
