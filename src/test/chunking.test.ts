import * as assert from 'assert';
import * as vscode from 'vscode';
import { CHUNK_OVERLAP_LINES, codeBudgetFor, planChunks } from '../chunking';

/** Same rough estimate the prompt tests use: four characters to a token. */
const estimate = async (text: string) => Math.ceil(text.length / 4);

async function documentOf(lineCount: number, line = (i: number) => `x_${i} = compute_${i}()`) {
    return vscode.workspace.openTextDocument({
        content: Array.from({ length: lineCount }, (_, i) => line(i)).join('\n'),
        language: 'python',
    });
}

function coveredLines(chunks: Array<{ range: vscode.Range }>): Set<number> {
    const covered = new Set<number>();
    for (const chunk of chunks) {
        for (let line = chunk.range.start.line; line <= chunk.range.end.line; line++) {
            covered.add(line);
        }
    }
    return covered;
}

suite('codeBudgetFor', () => {
    test('reserves room for the instructions', () => {
        assert.ok(codeBudgetFor(128_000) < 128_000);
        assert.ok(codeBudgetFor(128_000) > 100_000);
    });

    test('never returns a non-positive budget on a tiny context window', () => {
        assert.ok(codeBudgetFor(1000) > 0);
    });
});

suite('planChunks', () => {
    test('uses a single chunk when the file fits', async () => {
        const document = await documentOf(200);
        const chunks = await planChunks(document, 100_000, estimate);

        assert.strictEqual(chunks.length, 1);
        assert.strictEqual(chunks[0].range.start.line, 0);
        assert.strictEqual(chunks[0].range.end.line, 199);
        assert.deepStrictEqual([chunks[0].index, chunks[0].total], [1, 1]);
    });

    test('splits a file that does not fit', async () => {
        const document = await documentOf(4000);
        const chunks = await planChunks(document, 2000, estimate);

        assert.ok(chunks.length > 1, 'expected the file to be split');
        chunks.forEach((chunk, i) => {
            assert.strictEqual(chunk.index, i + 1);
            assert.strictEqual(chunk.total, chunks.length);
        });
    });

    test('covers every line of the file', async () => {
        const document = await documentOf(4000);
        const chunks = await planChunks(document, 2000, estimate);
        const covered = coveredLines(chunks);

        for (let line = 0; line < document.lineCount; line++) {
            assert.ok(covered.has(line), `line ${line} was not covered by any chunk`);
        }
    });

    test('overlaps adjacent chunks so a boundary-straddling span stays intact', async () => {
        const document = await documentOf(4000);
        const chunks = await planChunks(document, 2000, estimate);

        for (let i = 1; i < chunks.length; i++) {
            const overlap = chunks[i - 1].range.end.line - chunks[i].range.start.line + 1;
            assert.ok(
                overlap >= CHUNK_OVERLAP_LINES,
                `chunks ${i - 1} and ${i} overlap by only ${overlap} lines`
            );
        }
    });

    test('keeps each chunk within budget', async () => {
        const document = await documentOf(4000);
        const budget = 2000;
        const chunks = await planChunks(document, budget, estimate);

        for (const chunk of chunks) {
            const tokens = await estimate(document.getText(chunk.range));
            // Overlap is added after sizing, so allow for those extra lines.
            const slack = CHUNK_OVERLAP_LINES * 8;
            assert.ok(tokens <= budget + slack, `chunk ran to ${tokens} tokens against ${budget}`);
        }
    });

    test('terminates on a file of very long lines rather than splitting forever', async () => {
        const document = await documentOf(64, () => 'y = "' + 'z'.repeat(4000) + '"');
        const chunks = await planChunks(document, 100, estimate);

        assert.ok(chunks.length >= 1);
        assert.ok(chunks.length <= document.lineCount);
        const covered = coveredLines(chunks);
        for (let line = 0; line < document.lineCount; line++) {
            assert.ok(covered.has(line), `line ${line} was not covered`);
        }
    });

    test('handles a single-line file', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: 'lat = request.json["lat"]',
            language: 'python',
        });
        const chunks = await planChunks(document, 100_000, estimate);

        assert.strictEqual(chunks.length, 1);
        assert.strictEqual(chunks[0].range.start.line, 0);
        assert.strictEqual(chunks[0].range.end.line, 0);
    });
});