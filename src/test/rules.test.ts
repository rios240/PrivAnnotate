import * as assert from 'assert';
import {
    CATEGORY_BY_RULE_ID,
    CATEGORY_NAMES,
    getRule,
    isCategoryName,
    PRIVACY_RULES,
} from '../rules/catalog';

suite('detection rule catalog', () => {
    test('defines exactly the eight framework categories', () => {
        assert.strictEqual(PRIVACY_RULES.length, 8);
        assert.strictEqual(new Set(PRIVACY_RULES.map(c => c.category)).size, 8);
        assert.deepStrictEqual(
            PRIVACY_RULES.map(c => c.id),
            ['FP-01', 'TP-02', 'UC-03', 'UA-04', 'DR-05', 'DS-06', 'DNT-07', 'AI-08']
        );
    });

    test('every rule category is a declared category name', () => {
        for (const rule of PRIVACY_RULES) {
            assert.ok(isCategoryName(rule.category), `${rule.id} has an unknown category`);
        }
        assert.strictEqual(CATEGORY_NAMES.length, PRIVACY_RULES.length);
    });

    test('every rule carries the prompt fields the renderer reads', () => {
        for (const rule of PRIVACY_RULES) {
            assert.ok(rule.displayName.length > 0, `${rule.id} display name`);
            assert.ok(rule.baseDescription.length > 0, `${rule.id} base description`);
            assert.ok(rule.chainOfThought.length > 0, `${rule.id} chain-of-thought`);
            assert.ok(rule.elicitationQuestions.length > 0, `${rule.id} elicitation questions`);
        }
    });

    test('every rule has at least one positive and one negative exemplar', () => {
        for (const rule of PRIVACY_RULES) {
            const positive = rule.examples.filter(e => e.kind === 'positive');
            const negative = rule.examples.filter(e => e.kind === 'negative');
            assert.ok(positive.length >= 1, `${rule.id} is missing a positive example`);
            assert.ok(negative.length >= 1, `${rule.id} is missing a negative example`);

            for (const example of rule.examples) {
                assert.ok(example.code.length > 0, `${rule.id} example code`);
                assert.ok(example.reasoning.length > 0, `${rule.id} example reasoning`);
                assert.ok(example.conclusion.length > 0, `${rule.id} example conclusion`);
            }
        }
    });

    test('cross-references point at real rules and never at the rule itself', () => {
        const ids = new Set(PRIVACY_RULES.map(c => c.id));
        for (const rule of PRIVACY_RULES) {
            for (const ref of rule.crossReferences ?? []) {
                assert.ok(ids.has(ref), `${rule.id} cross-references unknown rule ${ref}`);
                assert.notStrictEqual(ref, rule.id, `${rule.id} cross-references itself`);
            }
        }
    });

    test('AI-08 cross-references the categories the framework calls out', () => {
        const ai = PRIVACY_RULES.find(c => c.id === 'AI-08');
        assert.ok(ai);
        assert.deepStrictEqual(ai.crossReferences, ['TP-02', 'DR-05', 'UA-04']);
    });

    test('getRule round-trips every category, CATEGORY_BY_RULE_ID every id', () => {
        for (const name of CATEGORY_NAMES) {
            assert.strictEqual(getRule(name).category, name);
        }
        for (const rule of PRIVACY_RULES) {
            assert.strictEqual(CATEGORY_BY_RULE_ID.get(rule.id), rule.category);
        }
    });
});
