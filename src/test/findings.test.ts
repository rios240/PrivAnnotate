import * as assert from 'assert';
import { computeFingerprint, excerptAnchor, normalizeExcerpt } from '../findings/fingerprint';
import {
    emptyManifest,
    isStoredFinding,
    parseManifest,
    serializeManifest,
    StoredFinding,
} from '../findings/manifest';
import { mergeForStorage, reconcile, relocate, TextSource } from '../findings/reconcile';
import { PrivacyFinding } from '../pdc/schema';

const NOW = '2026-08-27T12:00:00.000Z';
const EARLIER = '2026-08-01T09:00:00.000Z';

function fresh(excerpt: string, start = 10, end = 11): PrivacyFinding {
    return {
        id: `id-${excerpt}`,
        fingerprint: computeFingerprint('FIRST_PARTY_COLLECTION_USE', excerpt),
        category: 'FIRST_PARTY_COLLECTION_USE',
        lineRange: { start, end },
        excerpt,
        evidence: 'Reads user-supplied data.',
        confidence: 'high',
        status: 'undecided',
        firstSeen: NOW,
        lastSeen: NOW,
    };
}

function stored(excerpt: string, overrides: Partial<StoredFinding> = {}): StoredFinding {
    return {
        fingerprint: computeFingerprint('FIRST_PARTY_COLLECTION_USE', excerpt),
        category: 'FIRST_PARTY_COLLECTION_USE',
        lineRange: { start: 3, end: 4 },
        excerpt,
        evidence: 'Reads user-supplied data.',
        confidence: 'high',
        status: 'undecided',
        firstSeen: EARLIER,
        lastSeen: EARLIER,
        ...overrides,
    };
}

function source(lines: string[]): TextSource {
    return {
        lineCount: lines.length,
        lineAt: line => (line >= 1 && line <= lines.length ? lines[line - 1] : undefined),
    };
}

suite('fingerprint', () => {
    test('ignores indentation, trailing space, and line-number prefixes', () => {
        const a = 'lat = request.json["lat"]';
        const b = '    lat  =  request.json["lat"]   ';
        const c = '11| lat = request.json["lat"]';

        assert.strictEqual(normalizeExcerpt(b), a);
        assert.strictEqual(normalizeExcerpt(c), a);
        assert.strictEqual(
            computeFingerprint('FIRST_PARTY_COLLECTION_USE', b),
            computeFingerprint('FIRST_PARTY_COLLECTION_USE', c)
        );
    });

    test('distinguishes different code and different categories', () => {
        assert.notStrictEqual(
            computeFingerprint('FIRST_PARTY_COLLECTION_USE', 'a = req.a'),
            computeFingerprint('FIRST_PARTY_COLLECTION_USE', 'a = req.b')
        );
        assert.notStrictEqual(
            computeFingerprint('FIRST_PARTY_COLLECTION_USE', 'a = req.a'),
            computeFingerprint('DATA_SECURITY', 'a = req.a')
        );
    });

    test('drops blank lines and exposes the first real line as the anchor', () => {
        assert.strictEqual(normalizeExcerpt('\n\n  x = 1\n\n  y = 2\n'), 'x = 1\ny = 2');
        assert.strictEqual(excerptAnchor('\n\n  x = 1\n  y = 2'), 'x = 1');
        assert.strictEqual(excerptAnchor('   \n  '), undefined);
    });
});

suite('reconcile', () => {
    test('carries an accept decision across a re-run even when lines moved', () => {
        const previous = [stored('a = req.a', { status: 'accepted', decidedAt: EARLIER })];
        const result = reconcile([fresh('a = req.a', 42, 43)], previous, NOW);

        const [finding] = result.findings;
        assert.strictEqual(finding.status, 'accepted');
        assert.strictEqual(finding.decidedAt, EARLIER);
        assert.strictEqual(finding.firstSeen, EARLIER, 'provenance should come from the manifest');
        assert.strictEqual(finding.lastSeen, NOW);
        assert.deepStrictEqual(finding.lineRange, { start: 42, end: 43 }, 'location from the fresh run');
        assert.deepStrictEqual(result.added, []);
        assert.strictEqual(result.persisted.length, 1);
    });

    test('suppresses a previously rejected finding instead of re-triaging it', () => {
        const previous = [stored('a = req.a', { status: 'rejected', decidedAt: EARLIER })];
        const result = reconcile([fresh('a = req.a')], previous, NOW);

        assert.strictEqual(result.suppressed.length, 1);
        assert.strictEqual(result.persisted.length, 0);
        assert.strictEqual(result.findings[0].status, 'rejected');
    });

    test('reports genuinely new findings as added and undecided', () => {
        const result = reconcile([fresh('a = req.a')], [], NOW);

        assert.strictEqual(result.added.length, 1);
        assert.strictEqual(result.added[0].status, 'undecided');
        assert.strictEqual(result.added[0].firstSeen, NOW);
    });

    test('reports manifest entries the run did not re-observe as resolved', () => {
        const previous = [stored('a = req.a'), stored('b = req.b')];
        const result = reconcile([fresh('a = req.a')], previous, NOW);

        assert.strictEqual(result.resolved.length, 1);
        assert.strictEqual(result.resolved[0].excerpt, 'b = req.b');
    });

    test('does not re-report an already-resolved entry', () => {
        const previous = [stored('b = req.b', { resolvedAt: EARLIER })];
        const result = reconcile([], previous, NOW);

        assert.deepStrictEqual(result.resolved, []);
    });

    test('clears resolvedAt and reports a finding that came back', () => {
        const previous = [stored('a = req.a', { status: 'accepted', resolvedAt: EARLIER })];
        const result = reconcile([fresh('a = req.a')], previous, NOW);

        assert.strictEqual(result.reopened.length, 1);
        assert.strictEqual(result.findings[0].resolvedAt, undefined);
        assert.strictEqual(result.findings[0].status, 'accepted');
    });

    test('collapses the same span found twice via overlapping chunks', () => {
        const result = reconcile([fresh('a = req.a', 10, 11), fresh('a = req.a', 10, 11)], [], NOW);

        assert.strictEqual(result.findings.length, 1);
        assert.strictEqual(result.added.length, 1);
    });

    test('mergeForStorage keeps unobserved entries and stamps them resolved', () => {
        const previous = [stored('a = req.a'), stored('b = req.b')];
        const result = reconcile([fresh('a = req.a')], previous, NOW);
        const merged = mergeForStorage(result, previous, NOW);

        assert.strictEqual(merged.length, 2, 'the audit trail should not lose entries');
        const gone = merged.find(f => f.excerpt === 'b = req.b');
        assert.strictEqual(gone?.resolvedAt, NOW);
        assert.strictEqual(merged.find(f => f.excerpt === 'a = req.a')?.resolvedAt, undefined);
    });

    test('mergeForStorage preserves an existing resolvedAt rather than restamping it', () => {
        const previous = [stored('b = req.b', { resolvedAt: EARLIER })];
        const merged = mergeForStorage(reconcile([], previous, NOW), previous, NOW);

        assert.strictEqual(merged[0].resolvedAt, EARLIER);
    });
});

suite('relocate', () => {
    const text = source([
        'import os',
        '',
        'def checkin():',
        '    lat = request.json["lat"]',
        '    return lat',
    ]);

    test('leaves an already-correct span alone', () => {
        const result = relocate(text, '    lat = request.json["lat"]', { start: 4, end: 4 });

        assert.deepStrictEqual(result.lineRange, { start: 4, end: 4 });
        assert.strictEqual(result.stale, false);
    });

    test('finds a span that drifted and preserves its height', () => {
        const result = relocate(text, 'lat = request.json["lat"]\nreturn lat', { start: 1, end: 2 });

        assert.deepStrictEqual(result.lineRange, { start: 4, end: 5 });
        assert.strictEqual(result.stale, false);
    });

    test('marks a span stale when its anchor is gone', () => {
        const result = relocate(text, 'stripe.charges.create(token)', { start: 3, end: 3 });

        assert.strictEqual(result.stale, true);
        assert.deepStrictEqual(result.lineRange, { start: 3, end: 3 });
    });

    test('clamps a stored range that runs past the end of a shortened file', () => {
        const result = relocate(text, 'gone', { start: 40, end: 50 });

        assert.strictEqual(result.stale, true);
        assert.deepStrictEqual(result.lineRange, { start: 5, end: 5 });
    });

    test('prefers the occurrence nearest the remembered position', () => {
        const repeated = source(['x = 1', 'y = 2', 'x = 1', 'z = 3', 'x = 1']);
        assert.strictEqual(relocate(repeated, 'x = 1', { start: 5, end: 5 }).lineRange.start, 5);
        assert.strictEqual(relocate(repeated, 'x = 1', { start: 2, end: 2 }).lineRange.start, 1);
    });
});

suite('manifest serialization', () => {
    test('round-trips through serialize and parse', () => {
        const manifest = emptyManifest();
        manifest.files['src/app.py'] = {
            lastAnalyzedAt: NOW,
            findings: [stored('a = req.a', { status: 'accepted', decidedAt: NOW })],
        };

        const reparsed = parseManifest(serializeManifest(manifest));
        assert.deepStrictEqual(reparsed, manifest);
    });

    test('sorts files and findings so the manifest diffs cleanly', () => {
        const manifest = emptyManifest();
        manifest.files['src/z.py'] = { lastAnalyzedAt: NOW, findings: [] };
        manifest.files['src/a.py'] = {
            lastAnalyzedAt: NOW,
            findings: [
                stored('later', { lineRange: { start: 40, end: 41 } }),
                stored('earlier', { lineRange: { start: 2, end: 3 } }),
            ],
        };

        const text = serializeManifest(manifest);
        assert.ok(text.indexOf('src/a.py') < text.indexOf('src/z.py'));
        assert.ok(text.indexOf('earlier') < text.indexOf('later'));
    });

    test('drops malformed findings but keeps the rest of the file entry', () => {
        const raw = JSON.stringify({
            version: 1,
            files: {
                'src/app.py': {
                    lastAnalyzedAt: NOW,
                    findings: [
                        stored('good'),
                        { fingerprint: 'x', category: 'NOT_A_CATEGORY' },
                        { excerpt: 'no fingerprint' },
                    ],
                },
            },
        });

        const manifest = parseManifest(raw);
        assert.strictEqual(manifest.files['src/app.py'].findings.length, 1);
        assert.strictEqual(manifest.files['src/app.py'].findings[0].excerpt, 'good');
    });

    test('rejects an unknown manifest version rather than misreading it', () => {
        assert.throws(() => parseManifest(JSON.stringify({ version: 99, files: {} })));
    });

    test('isStoredFinding requires the fields the extension depends on', () => {
        assert.ok(isStoredFinding(stored('a = req.a')));
        assert.strictEqual(isStoredFinding({ ...stored('a'), status: 'maybe' }), false);
        assert.strictEqual(isStoredFinding({ ...stored('a'), confidence: 'very high' }), false);
        assert.strictEqual(isStoredFinding({ ...stored('a'), fingerprint: '' }), false);
        assert.strictEqual(isStoredFinding(null), false);
    });
});
