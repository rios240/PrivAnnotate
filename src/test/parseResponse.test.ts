import * as assert from 'assert';
import { extractJsonArray, parseCategoryFindings, ParseContext } from '../analysis/parseResponse';
import { getRule } from '../rules/catalog';
import { computeFingerprint } from '../findings/fingerprint';

const RULE = getRule('FIRST_PARTY_COLLECTION_USE');

/** Lines 10-13 of a hypothetical file, as the parser would see them. */
const SOURCE: Record<number, string> = {
    10: 'def checkin():',
    11: '    lat = request.json["lat"]',
    12: '    lon = request.json["lon"]',
    13: '    db.checkins.insert_one({"lat": lat, "lon": lon})',
};

const ctx: ParseContext = {
    lineText: line => SOURCE[line],
    rangeStart: 10,
    rangeEnd: 13,
    filePath: 'app/routes.py',
};

function finding(overrides: Record<string, unknown> = {}) {
    return {
        category: 'FIRST_PARTY_COLLECTION_USE',
        lineRange: { start: 11, end: 12 },
        excerpt: '    lat = request.json["lat"]\n    lon = request.json["lon"]',
        evidence: 'Reads user location from the request body.',
        confidence: 'high',
        ...overrides,
    };
}

suite('extractJsonArray', () => {
    test('accepts a bare array', () => {
        assert.strictEqual(extractJsonArray('[1, 2]'), '[1, 2]');
    });

    test('strips a markdown fence', () => {
        assert.strictEqual(extractJsonArray('```json\n[1, 2]\n```'), '[1, 2]');
    });

    test('recovers an array buried in prose', () => {
        assert.strictEqual(
            extractJsonArray('Here are my findings:\n[1, 2]\nHope that helps!'),
            '[1, 2]'
        );
    });

    test('returns undefined when there is no array', () => {
        assert.strictEqual(extractJsonArray('I found no matches.'), undefined);
    });
});

suite('parseCategoryFindings', () => {
    test('parses a well-formed finding', () => {
        const [result] = parseCategoryFindings(JSON.stringify([finding()]), RULE, ctx);

        assert.ok(result);
        assert.strictEqual(result.category, 'FIRST_PARTY_COLLECTION_USE');
        assert.strictEqual(result.file, 'app/routes.py');
        assert.deepStrictEqual(result.lineRange, { start: 11, end: 12 });
        assert.strictEqual(result.confidence, 'high');
        assert.strictEqual(result.fingerprint, computeFingerprint(result.category, result.excerpt));
    });

    test('parses through a fence and surrounding prose', () => {
        const text = 'Sure - here you go:\n```json\n' + JSON.stringify([finding()]) + '\n```';
        assert.strictEqual(parseCategoryFindings(text, RULE, ctx).length, 1);
    });

    test('returns nothing for an empty array', () => {
        assert.deepStrictEqual(parseCategoryFindings('[]', RULE, ctx), []);
    });

    test('returns nothing for malformed JSON', () => {
        assert.deepStrictEqual(parseCategoryFindings('[{"category":', RULE, ctx), []);
    });

    test('returns nothing when the response is not an array', () => {
        assert.deepStrictEqual(parseCategoryFindings(JSON.stringify(finding()), RULE, ctx), []);
    });

    test('forces the category to the requested rule', () => {
        const text = JSON.stringify([finding({ category: 'DATA_SECURITY' })]);
        const [result] = parseCategoryFindings(text, RULE, ctx);

        assert.ok(result);
        assert.strictEqual(result.category, 'FIRST_PARTY_COLLECTION_USE');
    });

    test('skips elements missing required fields', () => {
        const text = JSON.stringify([
            { category: 'FIRST_PARTY_COLLECTION_USE', lineRange: { start: 11, end: 12 } },
            finding(),
        ]);
        assert.strictEqual(parseCategoryFindings(text, RULE, ctx).length, 1);
    });

    test('skips elements with an unusable confidence value', () => {
        const text = JSON.stringify([finding({ confidence: 'very high' })]);
        assert.deepStrictEqual(parseCategoryFindings(text, RULE, ctx), []);
    });

    test('drops a finding whose range is inverted', () => {
        const text = JSON.stringify([finding({ lineRange: { start: 13, end: 11 } })]);
        assert.deepStrictEqual(parseCategoryFindings(text, RULE, ctx), []);
    });

    test('drops a finding entirely outside the analyzed range', () => {
        const text = JSON.stringify([finding({ lineRange: { start: 40, end: 42 } })]);
        assert.deepStrictEqual(parseCategoryFindings(text, RULE, ctx), []);
    });

    test('clamps a range that overhangs the analyzed span', () => {
        const text = JSON.stringify([finding({ lineRange: { start: 5, end: 40 } })]);
        const [result] = parseCategoryFindings(text, RULE, ctx);

        assert.ok(result);
        assert.deepStrictEqual(result.lineRange, { start: 10, end: 13 });
    });

    test('downgrades confidence when the excerpt is not in the claimed span', () => {
        const text = JSON.stringify([
            finding({ excerpt: 'stripe.charges.create(token)', confidence: 'high' }),
        ]);
        const [result] = parseCategoryFindings(text, RULE, ctx);

        assert.ok(result);
        assert.strictEqual(result.confidence, 'medium');
    });

    test('grounds an excerpt that still carries its line-number prefix', () => {
        const text = JSON.stringify([finding({ excerpt: '11|     lat = request.json["lat"]' })]);
        const [result] = parseCategoryFindings(text, RULE, ctx);

        assert.ok(result);
        assert.strictEqual(result.confidence, 'high');
    });

    test('keeps valid cross-references and discards junk and self-references', () => {
        const text = JSON.stringify([
            finding({
                crossReferences: [
                    'THIRD_PARTY_SHARING_COLLECTION',
                    'DR-05',
                    'FIRST_PARTY_COLLECTION_USE',
                    'NOT_A_CATEGORY',
                ],
            }),
        ]);
        const [result] = parseCategoryFindings(text, RULE, ctx);

        assert.ok(result);
        assert.deepStrictEqual(result.crossReferences, [
            'THIRD_PARTY_SHARING_COLLECTION',
            'DATA_RETENTION',
        ]);
    });

    test('omits the file field when the context has no path', () => {
        const text = JSON.stringify([finding()]);
        const [result] = parseCategoryFindings(text, RULE, { ...ctx, filePath: undefined });

        assert.ok(result);
        assert.strictEqual(result.file, undefined);
    });
});