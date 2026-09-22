import * as vscode from 'vscode';

/**
 * Lines of context repeated between adjacent chunks, so a practice that spans a
 * boundary is fully visible in at least one chunk. Duplicate findings from the
 * overlap are collapsed by fingerprint during reconciliation.
 */
export const CHUNK_OVERLAP_LINES = 20;

/**
 * Tokens held back from `maxInputTokens` for the prelude, output contract, and
 * detection rule. The largest rule (AI-08) plus instructions renders at roughly
 * 3k tokens; the reserve is generous because under-reserving silently costs
 * code lines, while over-reserving only adds a chunk.
 */
export const INSTRUCTION_RESERVE_TOKENS = 5000;

/** Never plan a chunk below this many lines, however tight the budget. */
const MIN_CHUNK_LINES = 20;

/** Floor on the code budget, so a tiny context window still yields a plan. */
const MIN_CODE_BUDGET_TOKENS = 500;

/**
 * Fraction of the budget a chunk may occupy before overlap is added. The
 * overlap lines are prepended after sizing, so leaving headroom keeps the final
 * chunk inside the real budget rather than relying on prompt-tsx to trim it -
 * a trim would drop lines off the end that no other chunk covers.
 */
const OVERLAP_HEADROOM = 0.9;

/** Guards against pathological splitting on a file of enormous single lines. */
const MAX_SPLIT_DEPTH = 12;

export interface Chunk {
    range: vscode.Range;
    /** 1-based, for progress reporting. */
    index: number;
    total: number;
}

export type CountTokens = (text: string) => Promise<number>;

export function codeBudgetFor(maxInputTokens: number): number {
    return Math.max(MIN_CODE_BUDGET_TOKENS, maxInputTokens - INSTRUCTION_RESERVE_TOKENS);
}

/**
 * Lines [startLine, endLine] (0-based, inclusive) rendered the way
 * `CodeTaskElement` will render them - with the "N| " prefix included, since
 * those prefixes are a real and non-trivial share of the chunk's tokens.
 */
function sliceText(document: vscode.TextDocument, startLine: number, endLine: number): string {
    const width = String(document.lineCount).length;
    const lines: string[] = [];
    for (let line = startLine; line <= endLine; line++) {
        lines.push(`${String(line + 1).padStart(width, ' ')}| ${document.lineAt(line).text}`);
    }
    return lines.join('\n');
}

function toRange(document: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
    return new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
}

/**
 * Splits [startLine, endLine] into windows that each fit `budget`.
 *
 * Measures the whole window first - the overwhelmingly common case is that a
 * file fits in one request, and that costs a single `countTokens` call. Only
 * when it does not fit is the window halved and each half measured, which keeps
 * the number of calls proportional to the number of chunks rather than lines.
 */
async function splitToFit(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
    budget: number,
    countTokens: CountTokens,
    depth: number
): Promise<Array<[number, number]>> {
    const tokens = await countTokens(sliceText(document, startLine, endLine));
    const lineCount = endLine - startLine + 1;

    if (tokens <= budget || lineCount <= MIN_CHUNK_LINES || depth >= MAX_SPLIT_DEPTH) {
        return [[startLine, endLine]];
    }

    const mid = startLine + Math.floor(lineCount / 2) - 1;
    const left = await splitToFit(document, startLine, mid, budget, countTokens, depth + 1);
    const right = await splitToFit(document, mid + 1, endLine, budget, countTokens, depth + 1);
    return [...left, ...right];
}

/**
 * Plans the chunks covering an entire document. Every line appears in at least
 * one chunk; adjacent chunks overlap by `CHUNK_OVERLAP_LINES`.
 */
export async function planChunks(
    document: vscode.TextDocument,
    budget: number,
    countTokens: CountTokens
): Promise<Chunk[]> {
    if (document.lineCount === 0) {return [];}

    const lastLine = document.lineCount - 1;
    const spans = await splitToFit(
        document,
        0,
        lastLine,
        Math.floor(budget * OVERLAP_HEADROOM),
        countTokens,
        0
    );

    // Grow each chunk backwards into its predecessor so a span straddling a
    // boundary is intact in the later chunk.
    const withOverlap = spans.map(([start, end], i): [number, number] =>
        i === 0 ? [start, end] : [Math.max(0, start - CHUNK_OVERLAP_LINES), end]
    );

    return withOverlap.map(([start, end], i) => ({
        range: toRange(document, start, end),
        index: i + 1,
        total: withOverlap.length,
    }));
}