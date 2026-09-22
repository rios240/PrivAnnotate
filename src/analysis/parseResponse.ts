import * as vscode from 'vscode';
import { CategoryName, isCategoryName, CATEGORY_BY_RULE_ID, PrivacyRule } from '../rules/catalog';
import { downgradeConfidence, isRawFinding, PrivacyFinding, RawFinding } from '../findings/schema';
import { computeFingerprint, stripLinePrefix } from '../findings/fingerprint';

/** Everything the parser needs to ground a finding against real source text. */
export interface ParseContext {
    /** Full text of each analyzed line, keyed by 1-based line number. */
    lineText: (line: number) => string | undefined;
    /** First analyzed line, 1-based inclusive. */
    rangeStart: number;
    /** Last analyzed line, 1-based inclusive. */
    rangeEnd: number;
    /** Workspace-relative path; omitted for untitled documents. */
    filePath?: string;
}

export function buildParseContext(
    document: vscode.TextDocument,
    range: vscode.Range
): ParseContext {
    return {
        lineText: line =>
            line >= 1 && line <= document.lineCount ? document.lineAt(line - 1).text : undefined,
        rangeStart: range.start.line + 1,
        rangeEnd: Math.min(range.end.line + 1, document.lineCount),
        filePath: document.isUntitled ? undefined : vscode.workspace.asRelativePath(document.uri),
    };
}

/**
 * Extracts the outermost JSON array from a model response. Models don't always
 * honor "no fencing, no prose", so strip a fence and any surrounding chatter
 * rather than failing an otherwise valid array.
 */
export function extractJsonArray(text: string): string | undefined {
    const cleaned = text
        .trim()
        .replace(/^```[a-zA-Z]*\s*/, '')
        .replace(/```\s*$/, '')
        .trim();

    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) {return undefined;}

    return cleaned.slice(start, end + 1);
}

function normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Checks that the excerpt actually came from the claimed span. An excerpt that
 * matches nothing in its own line range is the signature of a hallucinated or
 * misplaced finding, so it costs a confidence step rather than being trusted.
 */
function isExcerptGrounded(excerpt: string, start: number, end: number, ctx: ParseContext): boolean {
    const firstLine = excerpt
        .split(/\r?\n/)
        .map(line => normalize(stripLinePrefix(line)))
        .find(line => line.length > 0);

    if (!firstLine) {return false;}

    for (let line = start; line <= end; line++) {
        const source = ctx.lineText(line);
        if (source && normalize(source).includes(firstLine)) {return true;}
    }
    return false;
}

/**
 * Accepts either a category enum name or a rule ID (models sometimes answer
 * "TP-02" where the schema asks for the enum), and rejects anything else.
 */
function resolveCategory(value: string): CategoryName | undefined {
    if (isCategoryName(value)) {return value;}
    return CATEGORY_BY_RULE_ID.get(value.trim().toUpperCase());
}

function toFinding(raw: RawFinding, rule: PrivacyRule, ctx: ParseContext): PrivacyFinding | undefined {
    const start = Math.round(raw.lineRange.start);
    const end = Math.round(raw.lineRange.end);

    if (start > end) {
        console.warn(`priv-audit: [${rule.id}] dropping finding with inverted line range`, raw.lineRange);
        return undefined;
    }
    if (end < ctx.rangeStart || start > ctx.rangeEnd) {
        console.warn(`priv-audit: [${rule.id}] dropping finding outside the analyzed range`, raw.lineRange);
        return undefined;
    }

    const clampedStart = Math.max(start, ctx.rangeStart);
    const clampedEnd = Math.min(end, ctx.rangeEnd);

    let confidence = raw.confidence;
    if (!isExcerptGrounded(raw.excerpt, clampedStart, clampedEnd, ctx)) {
        console.warn(
            `priv-audit: [${rule.id}] excerpt not found at lines ${clampedStart}-${clampedEnd}; ` +
            'downgrading confidence'
        );
        confidence = downgradeConfidence(confidence);
    }

    const crossReferences = (raw.crossReferences ?? [])
        .map(resolveCategory)
        .filter((name): name is CategoryName => name !== undefined && name !== rule.category);

    const now = new Date().toISOString();

    return {
        fingerprint: computeFingerprint(rule.category, raw.excerpt),
        // The rule decides the category, not the model - one request, one lane.
        category: rule.category,
        file: ctx.filePath,
        lineRange: { start: clampedStart, end: clampedEnd },
        excerpt: raw.excerpt,
        evidence: raw.evidence,
        confidence,
        reasoning: raw.reasoning?.length ? raw.reasoning : undefined,
        crossReferences: crossReferences.length ? [...new Set(crossReferences)] : undefined,
        // Reconciliation replaces these from the manifest when the finding is
        // already known; a genuinely new finding starts undecided.
        status: 'undecided',
        firstSeen: now,
        lastSeen: now,
    };
}

/**
 * Turns one category's response into findings. Never throws: a category that
 * answers with garbage yields no findings and does not sink the other seven.
 */
export function parseCategoryFindings(
    text: string,
    rule: PrivacyRule,
    ctx: ParseContext
): PrivacyFinding[] {
    const json = extractJsonArray(text);
    if (json === undefined) {
        console.warn(`priv-audit: [${rule.id}] response contained no JSON array:`, text.slice(0, 200));
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        console.warn(`priv-audit: [${rule.id}] malformed JSON response:`, json.slice(0, 200), error);
        return [];
    }

    if (!Array.isArray(parsed)) {
        console.warn(`priv-audit: [${rule.id}] expected a JSON array, got:`, typeof parsed);
        return [];
    }

    const findings: PrivacyFinding[] = [];
    for (const entry of parsed) {
        if (!isRawFinding(entry)) {
            console.warn(`priv-audit: [${rule.id}] skipping element that does not match the schema:`, entry);
            continue;
        }
        const finding = toFinding(entry, rule, ctx);
        if (finding) {findings.push(finding);}
    }

    return findings;
}

/** Drains the streamed response, then parses it. */
export async function parseCategoryResponse(
    response: vscode.LanguageModelChatResponse,
    rule: PrivacyRule,
    ctx: ParseContext
): Promise<PrivacyFinding[]> {
    let fullText = '';
    for await (const fragment of response.text) {
        fullText += fragment;
    }
    return parseCategoryFindings(fullText, rule, ctx);
}