import * as assert from 'assert';
import * as vscode from 'vscode';
import { endAnalysis, runWithConcurrency, tryBeginAnalysis } from '../commands/analyze';

suite('runWithConcurrency', () => {
    test('never exceeds the concurrency limit', async () => {
        let inFlight = 0;
        let peak = 0;

        await runWithConcurrency(
            Array.from({ length: 8 }, (_, i) => i),
            3,
            async () => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise(resolve => setTimeout(resolve, 5));
                inFlight -= 1;
            }
        );

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
        await runWithConcurrency(
            Array.from({ length: 8 }, (_, i) => i),
            3,
            async i => {
                seen.push(i);
            }
        );

        assert.deepStrictEqual(
            [...seen].sort((a, b) => a - b),
            [0, 1, 2, 3, 4, 5, 6, 7]
        );
    });

    test('handles a limit larger than the item count', async () => {
        const results = await runWithConcurrency([1, 2], 8, async n => n * 2);
        assert.deepStrictEqual(results, [2, 4]);
    });

    test('a worker that swallows its own error does not stop the others', async () => {
        // Mirrors analyzeCategory: failures are caught per unit and yield [].
        const results = await runWithConcurrency([1, 2, 3], 3, async n => {
            try {
                if (n === 2) {
                    throw new Error('category failed');
                }
                return n;
            } catch {
                return 0;
            }
        });

        assert.deepStrictEqual(results, [1, 0, 3]);
    });
});

suite('analysis in-flight guard', () => {
    const uri = vscode.Uri.parse('file:///workspace/src/app.py');
    const other = vscode.Uri.parse('file:///workspace/src/other.py');

    teardown(() => {
        endAnalysis(uri);
        endAnalysis(other);
    });

    test('refuses a second run on the same file until the first ends', () => {
        assert.strictEqual(tryBeginAnalysis(uri), true);
        assert.strictEqual(tryBeginAnalysis(uri), false);

        endAnalysis(uri);
        assert.strictEqual(tryBeginAnalysis(uri), true);
    });

    test('runs on different files do not block each other', () => {
        assert.strictEqual(tryBeginAnalysis(uri), true);
        assert.strictEqual(tryBeginAnalysis(other), true);
    });
});
