import { CategoryName, isCategoryName } from './categories';

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = typeof CONFIDENCE_LEVELS[number];

export function isConfidence(value: unknown): value is Confidence {
    return typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

/** Drops a finding one confidence step; 'low' is the floor. */
export function downgradeConfidence(confidence: Confidence): Confidence {
    return confidence === 'high' ? 'medium' : 'low';
}

/** 1-based, inclusive - matches the line numbers printed into the prompt. */
export interface LineRange {
    start: number;
    end: number;
}

/** A finding after validation and grounding, ready to decorate the editor. */
export interface PrivacyFinding {
    /** Local identifier from `nextFindingId()`; not supplied by the model. */
    id: string;
    category: CategoryName;
    /** Workspace-relative path; omitted for untitled documents. */
    file?: string;
    lineRange: LineRange;
    excerpt: string;
    evidence: string;
    confidence: Confidence;
    reasoning?: string[];
    crossReferences?: CategoryName[];
}

/** A finding exactly as the model emits it, before validation. */
export interface RawFinding {
    category: string;
    file?: string;
    lineRange: LineRange;
    excerpt: string;
    evidence: string;
    confidence: Confidence;
    reasoning?: string[];
    crossReferences?: string[];
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

export function isRawFinding(value: unknown): value is RawFinding {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;

    if (!isCategoryName(v.category)) return false;
    if (typeof v.excerpt !== 'string') return false;
    if (typeof v.evidence !== 'string') return false;
    if (!isConfidence(v.confidence)) return false;

    if (typeof v.lineRange !== 'object' || v.lineRange === null) return false;
    const range = v.lineRange as Record<string, unknown>;
    if (typeof range.start !== 'number' || !Number.isFinite(range.start)) return false;
    if (typeof range.end !== 'number' || !Number.isFinite(range.end)) return false;

    if (v.file !== undefined && typeof v.file !== 'string') return false;
    if (v.reasoning !== undefined && !isStringArray(v.reasoning)) return false;
    if (v.crossReferences !== undefined && !isStringArray(v.crossReferences)) return false;

    return true;
}

/**
 * Rendered into the Output element so the prompt's contract and the parser's
 * contract come from one place and cannot drift apart.
 */
export const FINDING_JSON_SCHEMA = {
    type: 'array',
    description: 'All spans in the supplied code that match this request\'s single category. Empty if none match.',
    items: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                description: 'The category enum name for this request\'s card. Must match exactly.',
            },
            file: {
                type: 'string',
                description: 'The file path given in the task header. Omit this field entirely if no path was given.',
            },
            lineRange: {
                type: 'object',
                description: 'The span this finding covers, using the line numbers printed in the code input.',
                properties: {
                    start: { type: 'number', description: 'First line of the span, inclusive.' },
                    end: { type: 'number', description: 'Last line of the span, inclusive.' },
                },
                required: ['start', 'end'],
            },
            excerpt: {
                type: 'string',
                description:
                    'The matching code, copied verbatim with the "N| " line-number prefix removed. ' +
                    'If the span exceeds 15 lines, include the first 15 and append a line containing only "...".',
            },
            evidence: {
                type: 'string',
                description:
                    'One or two sentences naming what specifically in this code justifies the category - ' +
                    'the concrete call, field, or branch, not a restatement of the category description.',
            },
            confidence: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description:
                    'high: the pattern is unambiguous in this span. medium: likely, but depends on context not shown. ' +
                    'low: weak or speculative evidence.',
            },
            reasoning: {
                type: 'array',
                items: { type: 'string' },
                description: 'The reasoning steps that led to this match, in the style of the card\'s worked examples.',
            },
            crossReferences: {
                type: 'array',
                items: { type: 'string' },
                description:
                    'Category enum names OTHER than this request\'s that this same span also appears to match. ' +
                    'Do not emit separate findings for those - list them here only.',
            },
        },
        required: ['category', 'lineRange', 'excerpt', 'evidence', 'confidence'],
    },
} as const;