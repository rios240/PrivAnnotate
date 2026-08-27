import { createHash } from 'crypto';
import { CategoryName } from '../pdc/categories';

/**
 * Strips the "N| " prefix the prompt adds, trims each line, and collapses
 * internal whitespace runs. Reindentation, retabbing, and line moves therefore
 * do not change a finding's identity, while the actual tokens still do.
 */
export function normalizeExcerpt(excerpt: string): string {
    return excerpt
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*\d+\s*\|\s?/, '').replace(/\s+/g, ' ').trim())
        .filter(line => line.length > 0)
        .join('\n');
}

/**
 * Stable identity for a finding across analysis runs and editing sessions.
 *
 * Deliberately excludes line numbers: the same practice moves up and down a
 * file as it is edited, and a fingerprint that changed with it would make every
 * re-run look like an entirely new set of findings, discarding the user's
 * accept/reject decisions.
 */
export function computeFingerprint(category: CategoryName, excerpt: string): string {
    return createHash('sha256')
        .update(`${category}\n${normalizeExcerpt(excerpt)}`)
        .digest('hex')
        .slice(0, 16);
}

/** The first non-empty normalized line — the anchor used to relocate a span. */
export function excerptAnchor(excerpt: string): string | undefined {
    const [first] = normalizeExcerpt(excerpt).split('\n');
    return first && first.length > 0 ? first : undefined;
}