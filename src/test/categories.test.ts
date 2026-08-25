import * as assert from 'assert';
import {
    CATEGORY_BY_CARD_ID,
    CATEGORY_NAMES,
    getCard,
    isCategoryName,
    PDC_CARDS,
} from '../pdc/categories';

suite('PDC card deck', () => {
    test('defines exactly the eight framework categories', () => {
        assert.strictEqual(PDC_CARDS.length, 8);
        assert.strictEqual(new Set(PDC_CARDS.map(c => c.category)).size, 8);
        assert.deepStrictEqual(
            PDC_CARDS.map(c => c.id),
            ['FP-01', 'TP-02', 'UC-03', 'UA-04', 'DR-05', 'DS-06', 'DNT-07', 'AI-08']
        );
    });

    test('every card category is a declared category name', () => {
        for (const card of PDC_CARDS) {
            assert.ok(isCategoryName(card.category), `${card.id} has an unknown category`);
        }
        assert.strictEqual(CATEGORY_NAMES.length, PDC_CARDS.length);
    });

    test('every card carries the prompt fields the renderer reads', () => {
        for (const card of PDC_CARDS) {
            assert.ok(card.displayName.length > 0, `${card.id} display name`);
            assert.ok(card.baseDescription.length > 0, `${card.id} base description`);
            assert.ok(card.chainOfThought.length > 0, `${card.id} chain-of-thought`);
            assert.ok(card.elicitationQuestions.length > 0, `${card.id} elicitation questions`);
        }
    });

    test('every card has at least one positive and one negative exemplar', () => {
        for (const card of PDC_CARDS) {
            const positive = card.examples.filter(e => e.kind === 'positive');
            const negative = card.examples.filter(e => e.kind === 'negative');
            assert.ok(positive.length >= 1, `${card.id} is missing a positive example`);
            assert.ok(negative.length >= 1, `${card.id} is missing a negative example`);

            for (const example of card.examples) {
                assert.ok(example.code.length > 0, `${card.id} example code`);
                assert.ok(example.reasoning.length > 0, `${card.id} example reasoning`);
                assert.ok(example.conclusion.length > 0, `${card.id} example conclusion`);
            }
        }
    });

    test('cross-references point at real cards and never at the card itself', () => {
        const ids = new Set(PDC_CARDS.map(c => c.id));
        for (const card of PDC_CARDS) {
            for (const ref of card.crossReferences ?? []) {
                assert.ok(ids.has(ref), `${card.id} cross-references unknown card ${ref}`);
                assert.notStrictEqual(ref, card.id, `${card.id} cross-references itself`);
            }
        }
    });

    test('AI-08 cross-references the categories the framework calls out', () => {
        const ai = PDC_CARDS.find(c => c.id === 'AI-08');
        assert.ok(ai);
        assert.deepStrictEqual(ai.crossReferences, ['TP-02', 'DR-05', 'UA-04']);
    });

    test('getCard round-trips every category, CATEGORY_BY_CARD_ID every id', () => {
        for (const name of CATEGORY_NAMES) {
            assert.strictEqual(getCard(name).category, name);
        }
        for (const card of PDC_CARDS) {
            assert.strictEqual(CATEGORY_BY_CARD_ID.get(card.id), card.category);
        }
    });
});