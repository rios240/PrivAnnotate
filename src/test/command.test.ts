import * as assert from 'assert';
import * as vscode from 'vscode';
import { runWithConcurrency } from '../command';
import {
    clearFindings,
    getFindings,
    nextFindingId,
    replaceFindingsInRange,
} from '../misc/decorations';
import { PrivacyFinding } from '../pdc/schema';

function makeFinding(start: number, end: number): PrivacyFinding {
    return {
        id: nextFindingId(),
        category: 'FIRST_PARTY_COLLECTION_USE',
        lineRange: { start, end },
        excerpt: 'x = request.json["x"]',
        evidence: 'Reads user-supplied data.',
        confidence: 'high',
    };
}

suite('runWithConcurrency', () => {
    test('never exceeds the concurrency limit', async () => {
        let inFlight = 0;
        let peak = 0;

        await runWithConcurrency(Array.from({ length: 8 }, (_, i) => i), 3, async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise(resolve => setTimeout(resolve, 5));
            inFlight -= 1;
        });

        assert.ok(peak <= 3, `peak concurrency was ${peak}`);
        assert.ok(peak > 1, 'work did not actually run in parallel');
    });

    test('preserves input order regardless of completion order', async () => {
        const delays = [30, 5, 20, 1, 15];
        const results = await runWithConcurrency(delays, 3, async delay => {
            await new Promise(resolve => setTimeout(resolve, delay));
            return delay;
        });

        assert.deepStrictEqual(results, delays);
    });

    test('runs every item exactly once', async () => {
        const seen: number[] = [];
        await runWithConcurrency(Array.from({ length: 8 }, (_, i) => i), 3, async i => {
            seen.push(i);
        });

        assert.deepStrictEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
    });

    test('handles a limit larger than the item count', async () => {
        const results = await runWithConcurrency([1, 2], 8, async n => n * 2);
        assert.deepStrictEqual(results, [2, 4]);
    });

    test('a worker that swallows its own error does not stop the others', async () => {
        // Mirrors analyzeCategory: failures are caught per unit and yield [].
        const results = await runWithConcurrency([1, 2, 3], 3, async n => {
            try {
                if (n === 2) throw new Error('category failed');
                return n;
            } catch {
                return 0;
            }
        });

        assert.deepStrictEqual(results, [1, 0, 3]);
    });
});

suite('replaceFindingsInRange', () => {
    let document: vscode.TextDocument;

    setup(async () => {
        document = await vscode.workspace.openTextDocument({
            content: Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'),
            language: 'python',
        });
        clearFindings(document);
    });

    teardown(() => clearFindings(document));

    test('replaces findings overlapping the analyzed range and keeps the rest', () => {
        replaceFindingsInRange(document, { start: 1, end: 40 }, [
            makeFinding(2, 3),   // inside the re-analyzed range
            makeFinding(9, 12),  // straddles its lower edge
            makeFinding(25, 26), // outside it
        ]);

        replaceFindingsInRange(document, { start: 10, end: 20 }, [makeFinding(14, 15)]);

        const remaining = getFindings(document)
            .map(f => `${f.lineRange.start}-${f.lineRange.end}`)
            .sort();

        assert.deepStrictEqual(remaining, ['14-15', '2-3', '25-26']);
    });

    test('re-running over the same range refreshes rather than duplicates', () => {
        replaceFindingsInRange(document, { start: 10, end: 20 }, [makeFinding(11, 12)]);
        replaceFindingsInRange(document, { start: 10, end: 20 }, [makeFinding(11, 12)]);

        assert.strictEqual(getFindings(document).length, 1);
    });

    test('an empty result clears that range', () => {
        replaceFindingsInRange(document, { start: 10, end: 20 }, [makeFinding(11, 12)]);
        replaceFindingsInRange(document, { start: 10, end: 20 }, []);

        assert.deepStrictEqual(getFindings(document), []);
    });
});