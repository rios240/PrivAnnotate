#!/usr/bin/env node
// Scores a PrivAnnotate findings manifest against the Trailmark ground truth.
//
//   node evaluation/tools/score.mjs --pred evaluation/trailmark/.privannotate/findings.json
//
// Options:
//   --iou <0..1>              minimum line IoU for a match (default 0: any overlap)
//   --min-confidence <level>  ignore predictions below low|medium|high (default low)
//   --include-resolved        also score findings stamped resolvedAt (default: skip them)
//   --json <path>             write the full results, including per-finding outcomes
//   --labels <path>           labels file (default evaluation/ground-truth/labels.json)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
    buildManifest,
    CATEGORY_NAMES,
    CONFIDENCE_RANK,
    formatRange,
    GT_MANIFEST_PATH,
    iou,
    LABELS_PATH,
    loadGroundTruth,
    MANIFEST_VERSION,
    overlaps,
    readJson,
    RULE_BY_CATEGORY,
    serializeManifest,
    TIERS,
} from './lib.mjs';

const USAGE = 'usage: node evaluation/tools/score.mjs --pred <findings.json> [--iou 0] [--min-confidence low] ' +
    '[--include-resolved] [--json <out.json>] [--labels <labels.json>]';

function parseOptions() {
    const { values } = parseArgs({
        options: {
            pred: { type: 'string' },
            labels: { type: 'string', default: LABELS_PATH },
            iou: { type: 'string', default: '0' },
            'min-confidence': { type: 'string', default: 'low' },
            'include-resolved': { type: 'boolean', default: false },
            json: { type: 'string' },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    if (values.help || !values.pred) {
        console.log(USAGE);
        process.exit(values.help ? 0 : 2);
    }
    const iouThreshold = Number(values.iou);
    if (!Number.isFinite(iouThreshold) || iouThreshold < 0 || iouThreshold > 1) {
        throw new Error('--iou must be a number between 0 and 1');
    }
    if (!CONFIDENCE_RANK[values['min-confidence']]) {
        throw new Error('--min-confidence must be low, medium or high');
    }
    return {
        pred: values.pred,
        labels: values.labels,
        iouThreshold,
        minConfidence: values['min-confidence'],
        includeResolved: values['include-resolved'],
        json: values.json,
    };
}

/* ------------------------------------------------------------------ */
/* Predictions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Maps each prediction file key onto a ground-truth file. The extension keys
 * files relative to the opened workspace folder, so the same file is
 * "server/app.js" when trailmark/ is opened and
 * "evaluation/trailmark/server/app.js" when the repository root is.
 */
function matchFileKey(key, gtFiles) {
    const normalized = key.replace(/\\/g, '/');
    return gtFiles.find(file => normalized === file || normalized.endsWith(`/${file}`));
}

function isUsablePrediction(finding) {
    return (
        typeof finding === 'object' &&
        finding !== null &&
        CATEGORY_NAMES.includes(finding.category) &&
        typeof finding.lineRange?.start === 'number' &&
        typeof finding.lineRange?.end === 'number' &&
        finding.lineRange.start <= finding.lineRange.end
    );
}

function loadPredictions(path, gtFiles, { includeResolved }) {
    const manifest = readJson(path);
    if (manifest.version !== MANIFEST_VERSION || typeof manifest.files !== 'object' || manifest.files === null) {
        throw new Error(`${path} is not a version-${MANIFEST_VERSION} findings manifest`);
    }

    const byFile = new Map();
    const unmatchedKeys = [];
    let skippedResolved = 0;
    let skippedInvalid = 0;

    for (const [key, entry] of Object.entries(manifest.files)) {
        const file = matchFileKey(key, gtFiles);
        if (!file) {
            unmatchedKeys.push(key);
            continue;
        }
        const findings = [];
        for (const finding of Array.isArray(entry?.findings) ? entry.findings : []) {
            if (!isUsablePrediction(finding)) {
                skippedInvalid += 1;
                continue;
            }
            if (finding.resolvedAt && !includeResolved) {
                skippedResolved += 1;
                continue;
            }
            findings.push({
                file,
                category: finding.category,
                rule: RULE_BY_CATEGORY[finding.category],
                lineRange: { start: finding.lineRange.start, end: finding.lineRange.end },
                confidence: CONFIDENCE_RANK[finding.confidence] ? finding.confidence : 'low',
                status: finding.status,
                fingerprint: finding.fingerprint,
                excerpt: typeof finding.excerpt === 'string' ? finding.excerpt : '',
            });
        }
        byFile.set(file, [...(byFile.get(file) ?? []), ...findings]);
    }

    return { byFile, unmatchedKeys, skippedResolved, skippedInvalid };
}

/* ------------------------------------------------------------------ */
/* Matching                                                             */
/* ------------------------------------------------------------------ */

function describePrediction(p) {
    const firstLine = p.excerpt.split(/\r?\n/).find(line => line.trim().length > 0) ?? '';
    return {
        file: p.file,
        rule: p.rule,
        lines: formatRange(p.lineRange),
        confidence: p.confidence,
        excerpt: firstLine.trim().slice(0, 80),
    };
}

/**
 * Matches one run against the ground truth, per file and category, like a
 * detection benchmark: predictions and positive spans are paired one-to-one,
 * greedily by line IoU. An unmatched prediction is a duplicate if it overlaps
 * an already-matched positive, ignored if it lands on an optional label, and a
 * false positive otherwise.
 */
function evaluate({ spans, labels }, predictions, analyzedFiles, { iouThreshold, minConfidence }) {
    const outcomes = { tp: [], fp: [], fn: [], duplicate: [], ignored: [] };
    const hardNegatives = [];

    for (const file of analyzedFiles) {
        const fileSpans = spans.filter(s => s.file === file);
        const filePreds = (predictions.get(file) ?? []).filter(
            p => CONFIDENCE_RANK[p.confidence] >= CONFIDENCE_RANK[minConfidence]
        );

        for (const category of CATEGORY_NAMES) {
            const positives = fileSpans.flatMap(span =>
                span.positives.filter(l => l.category === category).map(label => ({ span, label }))
            );
            const optional = fileSpans.filter(span => span.optional.some(l => l.category === category));
            const negatives = fileSpans.flatMap(span =>
                span.negatives.filter(l => l.category === category).map(label => ({ span, label }))
            );
            const preds = filePreds.filter(p => p.category === category);

            const pairs = [];
            preds.forEach((p, pi) =>
                positives.forEach((g, gi) => {
                    const score = iou(p.lineRange, g.span.range);
                    if (score > 0 && score >= iouThreshold) pairs.push({ pi, gi, score });
                })
            );
            pairs.sort((a, b) => b.score - a.score || a.pi - b.pi || a.gi - b.gi);

            const predMatch = new Map();
            const gtMatch = new Map();
            for (const { pi, gi, score } of pairs) {
                if (predMatch.has(pi) || gtMatch.has(gi)) continue;
                predMatch.set(pi, { gi, score });
                gtMatch.set(gi, { pi, score });
            }

            positives.forEach(({ span, label }, gi) => {
                const record = {
                    span: span.id,
                    file,
                    rule: label.rule,
                    lines: formatRange(span.range),
                    tier: label.tier,
                    language: span.language,
                    probe: label.probe,
                };
                const match = gtMatch.get(gi);
                if (match) {
                    const p = preds[match.pi];
                    outcomes.tp.push({ ...record, iou: match.score, predicted: describePrediction(p) });
                } else {
                    outcomes.fn.push(record);
                }
            });

            const falsePositives = [];
            preds.forEach((p, pi) => {
                if (predMatch.has(pi)) return;
                const base = { ...describePrediction(p), language: labels.files[file].language };
                const matchedOverlap = positives.find((g, gi) => gtMatch.has(gi) && overlaps(p.lineRange, g.span.range));
                if (matchedOverlap) {
                    outcomes.duplicate.push({ ...base, of: matchedOverlap.span.id });
                    return;
                }
                const lowIou = positives.find(g => overlaps(p.lineRange, g.span.range));
                const optionalSpan = optional.find(span => overlaps(p.lineRange, span.range));
                if (!lowIou && optionalSpan) {
                    outcomes.ignored.push({ ...base, optional: optionalSpan.id });
                    return;
                }
                const hitNegatives = negatives.filter(n => overlaps(p.lineRange, n.span.range));
                const tags = [];
                if (lowIou) tags.push(`low-iou vs ${lowIou.span.id}`);
                if (hitNegatives.length) tags.push(`hard-negative ${hitNegatives.map(n => n.span.id).join(',')}`);
                falsePositives.push(p);
                outcomes.fp.push({ ...base, tags });
            });

            for (const { span, label } of negatives) {
                hardNegatives.push({
                    span: span.id,
                    file,
                    rule: label.rule,
                    lines: formatRange(span.range),
                    tier: label.tier,
                    probe: label.probe,
                    triggered: falsePositives.some(p => overlaps(p.lineRange, span.range)),
                });
            }
        }
    }

    return { outcomes, hardNegatives };
}

/* ------------------------------------------------------------------ */
/* Metrics                                                              */
/* ------------------------------------------------------------------ */

function ratio(num, den) {
    return den === 0 ? null : num / den;
}

function prf(tp, fp, fn) {
    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);
    const f1 = precision === null || recall === null || precision + recall === 0
        ? (tp + fp + fn === 0 ? null : 0)
        : (2 * precision * recall) / (precision + recall);
    return { tp, fp, fn, precision, recall, f1 };
}

function mean(values) {
    const defined = values.filter(v => v !== null);
    return defined.length ? defined.reduce((a, b) => a + b, 0) / defined.length : null;
}

function summarize({ outcomes, hardNegatives }) {
    const count = (list, pred) => list.filter(pred).length;

    const perRule = {};
    for (const category of CATEGORY_NAMES) {
        const rule = RULE_BY_CATEGORY[category];
        const is = x => x.rule === rule;
        const tierRecall = {};
        for (const tier of TIERS) {
            const tp = count(outcomes.tp, x => is(x) && x.tier === tier);
            const fn = count(outcomes.fn, x => is(x) && x.tier === tier);
            tierRecall[tier] = ratio(tp, tp + fn);
        }
        perRule[rule] = {
            ...prf(count(outcomes.tp, is), count(outcomes.fp, is), count(outcomes.fn, is)),
            recallDirect: tierRecall.direct,
            recallBoundary: tierRecall.boundary,
            duplicates: count(outcomes.duplicate, is),
            ignored: count(outcomes.ignored, is),
            hardNegativesTriggered: count(hardNegatives, x => is(x) && x.triggered),
            hardNegatives: count(hardNegatives, is),
        };
    }

    const rules = Object.values(perRule);
    const micro = prf(outcomes.tp.length, outcomes.fp.length, outcomes.fn.length);
    const macro = {
        precision: mean(rules.map(r => r.precision)),
        recall: mean(rules.map(r => r.recall)),
        f1: mean(rules.map(r => r.f1)),
    };

    const byTier = {};
    for (const tier of TIERS) {
        const tp = count(outcomes.tp, x => x.tier === tier);
        const fn = count(outcomes.fn, x => x.tier === tier);
        byTier[tier] = { tp, fn, recall: ratio(tp, tp + fn) };
    }

    const languages = [...new Set([...outcomes.tp, ...outcomes.fn, ...outcomes.fp].map(x => x.language))].sort();
    const byLanguage = {};
    for (const language of languages) {
        const is = x => x.language === language;
        byLanguage[language] = prf(count(outcomes.tp, is), count(outcomes.fp, is), count(outcomes.fn, is));
    }

    return {
        micro,
        macro,
        perRule,
        byTier,
        byLanguage,
        meanIou: mean(outcomes.tp.map(x => x.iou)),
        duplicates: outcomes.duplicate.length,
        ignored: outcomes.ignored.length,
        hardNegatives: {
            triggered: count(hardNegatives, x => x.triggered),
            total: hardNegatives.length,
        },
    };
}

/* ------------------------------------------------------------------ */
/* Report                                                               */
/* ------------------------------------------------------------------ */

function pct(value) {
    return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}

function table(headers, rows, rightAligned = new Set()) {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
    const line = cells =>
        cells
            .map((c, i) => (rightAligned.has(i) ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i])))
            .join('  ')
            .trimEnd();
    return [line(headers), line(widths.map(w => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

function report(result) {
    const { settings, coverage, summary, outcomes, hardNegatives, operatingPoints } = result;
    const out = [];

    out.push('PrivAnnotate evaluation - Trailmark ground truth', '');
    out.push(`predictions:     ${settings.pred}`);
    out.push(
        `matching:        line IoU ${settings.iouThreshold > 0 ? `>= ${settings.iouThreshold}` : '> 0 (any overlap)'}, ` +
            `confidence >= ${settings.minConfidence}, resolved findings ${settings.includeResolved ? 'included' : 'skipped'}`
    );
    out.push(`files analyzed:  ${coverage.analyzed.length}/${coverage.inScope}`);
    if (coverage.notAnalyzed.length) {
        out.push(`  NOT ANALYZED (excluded from every metric): ${coverage.notAnalyzed.join(', ')}`);
    }
    if (coverage.unmatchedKeys.length) {
        out.push(`  ignored manifest entries outside the ground truth: ${coverage.unmatchedKeys.join(', ')}`);
    }
    if (coverage.skippedResolved || coverage.skippedInvalid) {
        out.push(`  skipped findings: ${coverage.skippedResolved} resolved, ${coverage.skippedInvalid} malformed`);
    }
    out.push('');

    const { micro, macro } = summary;
    out.push(
        `micro   P ${pct(micro.precision)}  R ${pct(micro.recall)}  F1 ${pct(micro.f1)}   ` +
            `(TP ${micro.tp}, FP ${micro.fp}, FN ${micro.fn})`
    );
    out.push(`macro   P ${pct(macro.precision)}  R ${pct(macro.recall)}  F1 ${pct(macro.f1)}`);
    out.push(
        `recall  direct ${pct(summary.byTier.direct.recall)} (${summary.byTier.direct.tp}/${summary.byTier.direct.tp + summary.byTier.direct.fn})` +
            `   boundary ${pct(summary.byTier.boundary.recall)} (${summary.byTier.boundary.tp}/${summary.byTier.boundary.tp + summary.byTier.boundary.fn})`
    );
    out.push(
        `hard negatives triggered ${summary.hardNegatives.triggered}/${summary.hardNegatives.total}   ` +
            `duplicates ${summary.duplicates}   ignored (optional) ${summary.ignored}   mean IoU of matches ${pct(summary.meanIou)}`
    );
    out.push('');

    out.push('Per rule');
    out.push(
        table(
            ['rule', 'TP', 'FP', 'FN', 'P', 'R', 'F1', 'R direct', 'R boundary', 'hard neg', 'dup', 'ign'],
            Object.entries(summary.perRule).map(([rule, r]) => [
                rule, r.tp, r.fp, r.fn, pct(r.precision), pct(r.recall), pct(r.f1),
                pct(r.recallDirect), pct(r.recallBoundary),
                `${r.hardNegativesTriggered}/${r.hardNegatives}`, r.duplicates, r.ignored,
            ]),
            new Set([1, 2, 3, 4, 5, 6, 7, 8, 10, 11])
        )
    );
    out.push('');

    out.push('Per language/format');
    out.push(
        table(
            ['language', 'TP', 'FP', 'FN', 'P', 'R', 'F1'],
            Object.entries(summary.byLanguage).map(([language, r]) => [
                language, r.tp, r.fp, r.fn, pct(r.precision), pct(r.recall), pct(r.f1),
            ]),
            new Set([1, 2, 3, 4, 5, 6])
        )
    );
    out.push('');

    out.push('Confidence operating points (micro)');
    out.push(
        table(
            ['confidence >=', 'TP', 'FP', 'FN', 'P', 'R', 'F1'],
            operatingPoints.map(({ minConfidence, micro: m }) => [
                minConfidence, m.tp, m.fp, m.fn, pct(m.precision), pct(m.recall), pct(m.f1),
            ]),
            new Set([1, 2, 3, 4, 5, 6])
        )
    );
    out.push('');

    const triggered = hardNegatives.filter(h => h.triggered);
    if (triggered.length) {
        out.push('Hard negatives triggered');
        for (const h of triggered) {
            out.push(`  ${h.rule.padEnd(6)} ${h.span.padEnd(4)} ${h.file}:${h.lines}  (${h.tier}) ${h.probe}`);
        }
        out.push('');
    }

    if (outcomes.fn.length) {
        out.push('Missed (false negatives)');
        for (const x of outcomes.fn) {
            out.push(`  ${x.rule.padEnd(6)} ${x.span.padEnd(4)} ${x.file}:${x.lines}  (${x.tier}) ${x.probe}`);
        }
        out.push('');
    }

    if (outcomes.fp.length) {
        out.push('False positives');
        for (const x of outcomes.fp) {
            const tags = x.tags.length ? `  [${x.tags.join('; ')}]` : '';
            out.push(`  ${x.rule.padEnd(6)} ${x.file}:${x.lines}  (${x.confidence})${tags}  ${x.excerpt}`);
        }
        out.push('');
    }

    return out.join('\n');
}

/* ------------------------------------------------------------------ */

function main() {
    const options = parseOptions();
    const gt = loadGroundTruth(options.labels);
    const gtFiles = Object.keys(gt.labels.files);

    if (!existsSync(GT_MANIFEST_PATH) || readFileSync(GT_MANIFEST_PATH, 'utf8') !== serializeManifest(buildManifest(gt))) {
        console.warn(
            'warning: ground-truth/findings.json is out of date with labels.json; ' +
                'run `node evaluation/tools/build-ground-truth.mjs`\n'
        );
    }

    const predictions = loadPredictions(options.pred, gtFiles, options);
    const analyzed = gtFiles.filter(file => predictions.byFile.has(file));
    if (analyzed.length === 0) {
        throw new Error(`no file in ${options.pred} matches a ground-truth file; nothing to score`);
    }

    const run = evaluate(gt, predictions.byFile, analyzed, options);
    const operatingPoints = ['low', 'medium', 'high']
        .filter(level => CONFIDENCE_RANK[level] >= CONFIDENCE_RANK[options.minConfidence])
        .map(level => ({
            minConfidence: level,
            micro: summarize(evaluate(gt, predictions.byFile, analyzed, { ...options, minConfidence: level }))
                .micro,
        }));

    const result = {
        settings: {
            pred: options.pred,
            iouThreshold: options.iouThreshold,
            minConfidence: options.minConfidence,
            includeResolved: options.includeResolved,
        },
        coverage: {
            inScope: gtFiles.length,
            analyzed,
            notAnalyzed: gtFiles.filter(file => !predictions.byFile.has(file)),
            unmatchedKeys: predictions.unmatchedKeys,
            skippedResolved: predictions.skippedResolved,
            skippedInvalid: predictions.skippedInvalid,
        },
        summary: summarize(run),
        operatingPoints,
        hardNegatives: run.hardNegatives,
        outcomes: run.outcomes,
    };

    console.log(report(result));
    if (options.json) {
        writeFileSync(options.json, JSON.stringify(result, null, 2) + '\n');
        console.log(`wrote ${options.json}`);
    }
}

try {
    main();
} catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
}
