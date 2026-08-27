import { LineRange, PrivacyFinding } from '../pdc/schema';
import { StoredFinding } from './manifest';
import { excerptAnchor, normalizeExcerpt } from './fingerprint';

/** Minimal view of a document, so reconciliation stays testable without vscode. */
export interface TextSource {
    lineCount: number;
    lineAt(line: number): string | undefined; // 1-based
}

export interface ReconcileResult {
    /** Findings to show and persist, with decisions carried over from before. */
    findings: PrivacyFinding[];
    /** Seen for the first time in this run. */
    added: PrivacyFinding[];
    /** Present in the manifest and found again. */
    persisted: PrivacyFinding[];
    /** Previously rejected, so hidden from the editor without re-triage. */
    suppressed: PrivacyFinding[];
    /** In the manifest, not found by this run - the code likely changed. */
    resolved: StoredFinding[];
    /** Findings that reappeared after previously being marked resolved. */
    reopened: PrivacyFinding[];
}

/**
 * Merges a fresh analysis into what the manifest already knows about a file.
 *
 * Matching is by fingerprint, so a practice keeps its accept/reject decision
 * even after the code around it moves. Line ranges, evidence, and confidence
 * always come from the fresh run; status and provenance always come from the
 * manifest.
 */
export function reconcile(
    fresh: PrivacyFinding[],
    stored: StoredFinding[],
    now: string = new Date().toISOString()
): ReconcileResult {
    const storedByFingerprint = new Map(stored.map(f => [f.fingerprint, f]));
    const seen = new Set<string>();

    const findings: PrivacyFinding[] = [];
    const added: PrivacyFinding[] = [];
    const persisted: PrivacyFinding[] = [];
    const suppressed: PrivacyFinding[] = [];
    const reopened: PrivacyFinding[] = [];

    for (const finding of fresh) {
        // A single run can surface the same span twice via overlapping chunks.
        if (seen.has(finding.fingerprint)) continue;
        seen.add(finding.fingerprint);

        const previous = storedByFingerprint.get(finding.fingerprint);

        if (!previous) {
            const entry: PrivacyFinding = { ...finding, firstSeen: now, lastSeen: now };
            findings.push(entry);
            added.push(entry);
            continue;
        }

        const entry: PrivacyFinding = {
            ...finding,
            status: previous.status,
            firstSeen: previous.firstSeen,
            lastSeen: now,
            decidedAt: previous.decidedAt,
            resolvedAt: undefined,
        };

        findings.push(entry);
        if (previous.resolvedAt) reopened.push(entry);
        if (entry.status === 'rejected') {
            suppressed.push(entry);
        } else {
            persisted.push(entry);
        }
    }

    const resolved = stored.filter(f => !seen.has(f.fingerprint) && !f.resolvedAt);

    return { findings, added, persisted, suppressed, resolved, reopened };
}

/**
 * Merges a run's findings with the manifest entries it did not re-observe.
 * Entries missing from the run are retained and stamped `resolvedAt`, so the
 * manifest keeps the full audit trail rather than silently forgetting them.
 */
export function mergeForStorage(
    result: ReconcileResult,
    stored: StoredFinding[],
    now: string = new Date().toISOString()
): PrivacyFinding[] {
    const fresh = new Map(result.findings.map(f => [f.fingerprint, f]));
    const retained: PrivacyFinding[] = [];

    for (const previous of stored) {
        if (fresh.has(previous.fingerprint)) continue;
        retained.push({
            ...previous,
            id: `stored-${previous.fingerprint}`,
            resolvedAt: previous.resolvedAt ?? now,
        });
    }

    return [...result.findings, ...retained];
}

/**
 * Finds where a stored span now lives in the current text.
 *
 * Between sessions the file may have been edited, so the stored line numbers
 * drift. Anchoring on the excerpt's first line and preferring the candidate
 * nearest the old position re-locates the span; when the anchor is gone the
 * span is reported as stale rather than decorating arbitrary lines.
 */
export function relocate(
    source: TextSource,
    excerpt: string,
    stored: LineRange
): { lineRange: LineRange; stale: boolean } {
    const clamped = clampRange(stored, source.lineCount);
    const anchor = excerptAnchor(excerpt);
    if (!anchor) return { lineRange: clamped, stale: true };

    // Already correct: the common case, and cheaper than scanning the file.
    if (lineMatches(source, clamped.start, anchor)) {
        return { lineRange: clamped, stale: false };
    }

    let best: number | undefined;
    for (let line = 1; line <= source.lineCount; line++) {
        if (!lineMatches(source, line, anchor)) continue;
        if (best === undefined || Math.abs(line - stored.start) < Math.abs(best - stored.start)) {
            best = line;
        }
    }

    if (best === undefined) return { lineRange: clamped, stale: true };

    const span = Math.max(0, stored.end - stored.start);
    return {
        lineRange: clampRange({ start: best, end: best + span }, source.lineCount),
        stale: false,
    };
}

function lineMatches(source: TextSource, line: number, anchor: string): boolean {
    const text = source.lineAt(line);
    return text !== undefined && normalizeExcerpt(text) === anchor;
}

function clampRange(range: LineRange, lineCount: number): LineRange {
    const start = Math.min(Math.max(1, range.start), Math.max(1, lineCount));
    const end = Math.min(Math.max(start, range.end), Math.max(1, lineCount));
    return { start, end };
}