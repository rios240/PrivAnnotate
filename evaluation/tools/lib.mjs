// Shared helpers for the ground-truth build and scoring scripts. No dependencies.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = join(EVAL_DIR, '..');
export const APP_DIR = join(EVAL_DIR, 'trailmark');
export const LABELS_PATH = join(EVAL_DIR, 'ground-truth', 'labels.json');
export const GT_MANIFEST_PATH = join(EVAL_DIR, 'ground-truth', 'findings.json');
export const INVENTORY_PATH = join(EVAL_DIR, 'ground-truth', 'inventory.md');

/** Must match MANIFEST_VERSION in src/findings/manifest.ts. */
export const MANIFEST_VERSION = 1;
/** The extension asks the model to cap excerpts at 15 lines plus a "..." line. */
export const EXCERPT_MAX_LINES = 15;

/** Rule ID -> category enum name, as in src/rules/catalog.ts. */
export const RULES = {
    'FP-01': 'FIRST_PARTY_COLLECTION_USE',
    'TP-02': 'THIRD_PARTY_SHARING_COLLECTION',
    'UC-03': 'USER_CHOICE_CONTROL',
    'UA-04': 'USER_ACCESS_EDIT_DELETION',
    'DR-05': 'DATA_RETENTION',
    'DS-06': 'DATA_SECURITY',
    'DNT-07': 'DO_NOT_TRACK',
    'AI-08': 'AI_USAGE',
};
export const RULE_IDS = Object.keys(RULES);
export const CATEGORY_NAMES = Object.values(RULES);
export const RULE_BY_CATEGORY = Object.fromEntries(Object.entries(RULES).map(([id, cat]) => [cat, id]));

export const TIERS = ['direct', 'boundary'];
export const CONFIDENCE_RANK = { low: 1, medium: 2, high: 3 };

/* ------------------------------------------------------------------ */
/* Fingerprints - a line-for-line mirror of src/findings/fingerprint.ts */
/* ------------------------------------------------------------------ */

export function stripLinePrefix(line) {
    return line.replace(/^\s*\d+\s*\|\s?/, '');
}

export function normalizeExcerpt(excerpt) {
    return excerpt
        .split(/\r?\n/)
        .map(line => stripLinePrefix(line).replace(/\s+/g, ' ').trim())
        .filter(line => line.length > 0)
        .join('\n');
}

export function computeFingerprint(category, excerpt) {
    return createHash('sha256')
        .update(`${category}\n${normalizeExcerpt(excerpt)}`)
        .digest('hex')
        .slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Line ranges                                                          */
/* ------------------------------------------------------------------ */

/** Ranges are 1-based and inclusive, like the manifest's lineRange. */
export function overlaps(a, b) {
    return a.start <= b.end && b.start <= a.end;
}

/** Intersection over union, counted in lines. */
export function iou(a, b) {
    const intersection = Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1;
    if (intersection <= 0) return 0;
    const union = a.end - a.start + 1 + (b.end - b.start + 1) - intersection;
    return intersection / union;
}

export function formatRange(range) {
    return range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`;
}

/* ------------------------------------------------------------------ */
/* Labels                                                               */
/* ------------------------------------------------------------------ */

export function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

export function readLines(path) {
    return readFileSync(path, 'utf8').replace(/\n$/, '').split(/\r?\n/);
}

/**
 * An anchor is a substring of the line it names. A leading "=" makes it an
 * exact whole-line match instead, e.g. "=});" for a handler's closing line.
 */
function lineMatches(line, anchor) {
    return anchor.startsWith('=') ? line === anchor.slice(1) : line.includes(anchor);
}

/**
 * Resolves a span's anchors to a 1-based inclusive line range. `start` must
 * match exactly one line. `end` (optional; defaults to the start line) is found
 * at or after the start; an array of end anchors is searched in sequence, each
 * from the line the previous one matched.
 */
export function resolveAnchors(lines, span) {
    const starts = [];
    lines.forEach((line, i) => {
        if (lineMatches(line, span.start)) starts.push(i);
    });
    if (starts.length !== 1) {
        throw new Error(
            `${span.id}: start anchor ${JSON.stringify(span.start)} matches ${starts.length} lines ` +
                `in ${span.file}; it must match exactly one`
        );
    }

    const start = starts[0];
    let end = start;
    const endAnchors = span.end === undefined ? [] : [].concat(span.end);
    for (const anchor of endAnchors) {
        const from = end;
        end = lines.findIndex((line, i) => i >= from && lineMatches(line, anchor));
        if (end === -1) {
            throw new Error(
                `${span.id}: end anchor ${JSON.stringify(anchor)} not found at or after line ${from + 1} ` +
                    `of ${span.file}`
            );
        }
    }
    return { start: start + 1, end: end + 1 };
}

/** The span's code as the extension would quote it: verbatim, capped at 15 lines. */
export function excerptFor(lines, range) {
    const slice = lines.slice(range.start - 1, range.end);
    return slice.length > EXCERPT_MAX_LINES
        ? [...slice.slice(0, EXCERPT_MAX_LINES), '...'].join('\n')
        : slice.join('\n');
}

function fail(message) {
    throw new Error(`labels.json: ${message}`);
}

function requireString(value, where) {
    if (typeof value !== 'string' || value.length === 0) fail(`${where} must be a non-empty string`);
}

function toLabel(entry, span, kind) {
    const where = `span ${span.id} ${kind}`;
    if (!RULES[entry.rule]) fail(`${where}: unknown rule ${JSON.stringify(entry.rule)}`);
    if (kind === 'optional') {
        requireString(entry.why, `${where} ${entry.rule}.why`);
    } else {
        if (!TIERS.includes(entry.tier)) fail(`${where} ${entry.rule}: tier must be one of ${TIERS.join(', ')}`);
        requireString(entry.probe, `${where} ${entry.rule}.probe`);
    }
    if (kind === 'positives') requireString(entry.evidence, `${where} ${entry.rule}.evidence`);
    return { ...entry, category: RULES[entry.rule] };
}

/**
 * Loads labels.json, resolves every span against the app source, and checks
 * the labels are internally consistent. Throws with a specific message on any
 * problem, so a stale anchor never silently mislabels code.
 */
export function loadGroundTruth(labelsPath = LABELS_PATH, appDir = APP_DIR) {
    const labels = readJson(labelsPath);
    if (labels.version !== 1) fail('version must be 1');
    requireString(labels.labeledAt, 'labeledAt');
    if (typeof labels.files !== 'object' || labels.files === null) fail('"files" must be an object');
    if (!Array.isArray(labels.spans)) fail('"spans" must be an array');

    const fileLines = new Map();
    for (const [file, meta] of Object.entries(labels.files)) {
        requireString(meta?.language, `files["${file}"].language`);
        fileLines.set(file, readLines(join(appDir, file)));
    }

    const ids = new Set();
    const spans = labels.spans.map(raw => {
        requireString(raw.id, 'span id');
        if (ids.has(raw.id)) fail(`duplicate span id ${raw.id}`);
        ids.add(raw.id);
        if (!fileLines.has(raw.file)) fail(`span ${raw.id}: file ${JSON.stringify(raw.file)} is not listed in "files"`);
        requireString(raw.start, `span ${raw.id}.start`);

        const span = {
            ...raw,
            language: labels.files[raw.file].language,
            range: resolveAnchors(fileLines.get(raw.file), raw),
            positives: (raw.positives ?? []).map(entry => toLabel(entry, raw, 'positives')),
            optional: (raw.optional ?? []).map(entry => toLabel(entry, raw, 'optional')),
            negatives: (raw.negatives ?? []).map(entry => toLabel(entry, raw, 'negatives')),
        };

        const seen = [...span.positives, ...span.optional, ...span.negatives].map(l => l.rule);
        const repeated = seen.find((rule, i) => seen.indexOf(rule) !== i);
        if (repeated) fail(`span ${raw.id}: ${repeated} appears more than once across positives/optional/negatives`);
        if (seen.length === 0) fail(`span ${raw.id} has no labels`);
        return span;
    });

    // A hard negative must not sit on code that is positive or optional for the
    // same category, or the scorer could not tell a mistake from a correct hit.
    for (const a of spans) {
        for (const neg of a.negatives) {
            for (const b of spans) {
                if (b.file !== a.file || !overlaps(a.range, b.range)) continue;
                const clash = [...b.positives, ...b.optional].find(l => l.category === neg.category);
                if (clash && b !== a) {
                    fail(`hard negative ${a.id} ${neg.rule} overlaps span ${b.id}, which labels ${neg.rule} as well`);
                }
            }
        }
    }

    return { labels, spans, fileLines };
}

/* ------------------------------------------------------------------ */
/* Manifest                                                             */
/* ------------------------------------------------------------------ */

/**
 * The ground truth as an extension manifest: one accepted finding per positive
 * label, shaped exactly like `toStoredFinding` in src/findings/manifest.ts.
 */
export function buildManifest({ labels, spans, fileLines }) {
    const files = {};
    for (const file of Object.keys(labels.files)) {
        files[file] = { lastAnalyzedAt: labels.labeledAt, findings: [] };
    }

    const fingerprints = new Map();
    for (const span of spans) {
        const excerpt = excerptFor(fileLines.get(span.file), span.range);
        for (const label of span.positives) {
            const fingerprint = computeFingerprint(label.category, excerpt);
            if (fingerprints.has(fingerprint)) {
                fail(`spans ${fingerprints.get(fingerprint)} and ${span.id} produce the same ${label.rule} fingerprint`);
            }
            fingerprints.set(fingerprint, span.id);

            const others = span.positives.filter(l => l !== label).map(l => l.category);
            files[span.file].findings.push({
                fingerprint,
                category: label.category,
                lineRange: { ...span.range },
                excerpt,
                evidence: label.evidence,
                confidence: 'high',
                reasoning: [`Ground truth ${span.id} (${label.rule}, ${label.tier}): ${label.probe}`],
                crossReferences: others.length ? others : undefined,
                status: 'accepted',
                firstSeen: labels.labeledAt,
                lastSeen: labels.labeledAt,
                decidedAt: labels.labeledAt,
            });
        }
    }

    return { version: MANIFEST_VERSION, files };
}

/** Mirrors `serializeManifest` in src/findings/manifest.ts so the file diffs cleanly. */
export function serializeManifest(manifest) {
    const files = {};
    for (const path of Object.keys(manifest.files).sort()) {
        const entry = manifest.files[path];
        files[path] = {
            lastAnalyzedAt: entry.lastAnalyzedAt,
            findings: [...entry.findings].sort(
                (a, b) => a.lineRange.start - b.lineRange.start || a.fingerprint.localeCompare(b.fingerprint)
            ),
        };
    }
    return JSON.stringify({ version: manifest.version, files }, null, 2) + '\n';
}
