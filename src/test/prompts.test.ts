import * as assert from 'assert';
import * as vscode from 'vscode';
import { renderPrompt } from '@vscode/prompt-tsx';
import {
    CategoryAnalysisPrompt,
    CODE_INPUT_END,
    CODE_INPUT_START,
    ICategoryAnalysisPromptProps,
    ITruncationInfo,
} from '../prompts';
import { getCard, PDC_CARDS } from '../pdc/categories';
import { containsCodeInput } from '../command';

const SAMPLE = [
    'def checkin():',
    '    lat = request.json["lat"]',
    '    db.checkins.insert_one({"lat": lat})',
].join('\n');

/**
 * Stands in for a real language model. renderPrompt only needs `countTokens`
 * (it wraps the object in a VSCodeTokenizer), so a rough char-based estimate is
 * enough to exercise the budgeting path without a Copilot session.
 */
function stubModel(maxInputTokens = 100_000): vscode.LanguageModelChat {
    return {
        maxInputTokens,
        countTokens: async (text: string | vscode.LanguageModelChatMessage) =>
            Math.ceil((typeof text === 'string' ? text : JSON.stringify(text)).length / 4),
    } as unknown as vscode.LanguageModelChat;
}

async function render(
    props: Omit<ICategoryAnalysisPromptProps, 'document'> & { document?: vscode.TextDocument },
    model = stubModel()
): Promise<string> {
    const document =
        props.document ??
        (await vscode.workspace.openTextDocument({ content: SAMPLE, language: 'python' }));

    const { messages } = await renderPrompt(
        CategoryAnalysisPrompt,
        { ...props, document },
        { modelMaxPromptTokens: model.maxInputTokens },
        model
    );

    return messages
        .flatMap(message =>
            message.content.map(part => ('value' in part ? String(part.value) : ''))
        )
        .join('\n');
}

suite('CategoryAnalysisPrompt', () => {
    test('includes exactly one card and no other card by id', async () => {
        for (const card of PDC_CARDS) {
            const text = await render({ card });
            const others = PDC_CARDS.filter(c => c.id !== card.id);

            assert.ok(text.includes(card.id), `${card.id} prompt omits its own card id`);

            for (const other of others) {
                // A card may legitimately name another in its cross-reference
                // line; what must never appear is another card's own content.
                assert.ok(
                    !text.includes(other.chainOfThought),
                    `${card.id} prompt leaked ${other.id}'s reasoning guidance`
                );
                assert.ok(
                    !text.includes(other.baseDescription),
                    `${card.id} prompt leaked ${other.id}'s base description`
                );
            }
        }
    });

    test('carries the card content the framework supplies', async () => {
        const card = getCard('AI_USAGE');
        const text = await render({ card });

        assert.ok(text.includes(card.displayName));
        assert.ok(text.includes(card.baseDescription));
        assert.ok(text.includes(card.chainOfThought));
        for (const question of card.elicitationQuestions) {
            assert.ok(text.includes(question), `missing elicitation question: ${question}`);
        }
        for (const example of card.examples) {
            assert.ok(text.includes(example.code), `missing example code for ${example.label}`);
            assert.ok(text.includes(example.conclusion), `missing conclusion for ${example.label}`);
        }
    });

    test('renders both the positive and the negative exemplar', async () => {
        const card = getCard('DO_NOT_TRACK');
        const text = await render({ card });

        assert.ok(text.includes('Positive match'));
        assert.ok(text.includes('Negative (non-match)'));
    });

    test('fences the code in boundary delimiters with 1-based line numbers', async () => {
        const text = await render({ card: getCard('FIRST_PARTY_COLLECTION_USE') });

        assert.ok(text.includes(CODE_INPUT_START));
        assert.ok(text.includes(CODE_INPUT_END));
        assert.ok(text.includes('1| def checkin():'));
        assert.ok(text.includes('2|     lat = request.json["lat"]'));
        assert.ok(text.includes('LINES SHOWN: 1 to 3'));
    });

    test('numbers lines from the start of a partial range', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: Array.from({ length: 30 }, (_, i) => `stmt_${i + 1}()`).join('\n'),
            language: 'python',
        });
        const text = await render({
            card: getCard('DATA_SECURITY'),
            document,
            range: new vscode.Range(9, 0, 11, 0),
        });

        assert.ok(text.includes('10| stmt_10()'), 'range start should print as line 10');
        assert.ok(!text.includes('stmt_9()'), 'lines before the range should not appear');
        assert.ok(!text.includes('stmt_13()'), 'lines after the range should not appear');
    });

    test('states the output contract and the requested category', async () => {
        const card = getCard('THIRD_PARTY_SHARING_COLLECTION');
        const text = await render({ card });

        assert.ok(text.includes('single JSON array'));
        assert.ok(text.includes('crossReferences'));
        assert.ok(text.includes(card.category));
    });

    test('includes the file path only when one is supplied', async () => {
        const card = getCard('DATA_RETENTION');

        assert.ok((await render({ card, filePath: 'src/jobs/purge.py' })).includes('src/jobs/purge.py'));
        assert.ok(!(await render({ card })).includes('FILE:'));
    });

    test('reports truncation when the code does not fit the budget', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: Array.from({ length: 4000 }, (_, i) => `x_${i} = compute_${i}()`).join('\n'),
            language: 'python',
        });

        const seen: ITruncationInfo[] = [];
        const text = await render(
            {
                card: getCard('FIRST_PARTY_COLLECTION_USE'),
                document,
                onTruncated: info => seen.push(info),
            },
            stubModel(4000)
        );

        assert.ok(seen.length > 0, 'onTruncated was never called');
        const last = seen[seen.length - 1];
        assert.ok(last.includedLines < last.totalLines);
        assert.ok(text.includes('did not fit'));
    });

    test('keeps the code when the budget forces something to be dropped', async () => {
        // The card's examples are the affordable loss; the code is not. A prompt
        // whose code was pruned away is a wasted request.
        const document = await vscode.workspace.openTextDocument({
            content: Array.from({ length: 4000 }, (_, i) => `x_${i} = compute_${i}()`).join('\n'),
            language: 'python',
        });

        const model = stubModel(4000);
        const { messages } = await renderPrompt(
            CategoryAnalysisPrompt,
            { card: getCard('FIRST_PARTY_COLLECTION_USE'), document },
            { modelMaxPromptTokens: model.maxInputTokens },
            model
        );

        assert.ok(containsCodeInput(messages), 'the code message was pruned out of the prompt');
    });

    test('containsCodeInput rejects a prompt with no code', async () => {
        const model = stubModel();
        const { messages } = await renderPrompt(
            CategoryAnalysisPrompt,
            { card: getCard('FIRST_PARTY_COLLECTION_USE'), document: await emptyDocument() },
            { modelMaxPromptTokens: model.maxInputTokens },
            model
        );

        assert.ok(containsCodeInput(messages));
        assert.strictEqual(containsCodeInput([]), false);
    });
});

async function emptyDocument(): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ content: '', language: 'python' });
}