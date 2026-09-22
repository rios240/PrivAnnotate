import * as assert from 'assert';
import * as vscode from 'vscode';
import { runWithConcurrency } from '../commands/analyze';
import { clearAllFindings, clearFindings, getFinding, getFindings, setFindings } from '../findings/store';
import {
    isShowingFindings,
    isShowingRejected,
    setShowFindings,
    setShowRejected,
    visibleFindings,
} from '../ui/decorations';
import { PrivacyFinding } from '../findings/schema';
import { computeFingerprint } from '../findings/fingerprint';

function makeFinding(start: number, end: number, excerpt = 'x = request.json["x"]'): PrivacyFinding {
    const now = new Date().toISOString();
    return {
        fingerprint: computeFingerprint('FIRST_PARTY_COLLECTION_USE', excerpt),
        category: 'FIRST_PARTY_COLLECTION_USE',
        lineRange: { start, end },
        excerpt,
        evidence: 'Reads user-supplied data.',
        confidence: 'high',
        status: 'undecided',
        firstSeen: now,
        lastSeen: now,
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
                if (n === 2) {throw new Error('category failed');}
                return n;
            } catch {
                return 0;
            }
        });

        assert.deepStrictEqual(results, [1, 0, 3]);
    });
});

suite('finding store', () => {
    let document: vscode.TextDocument;

    setup(async () => {
        document = await vscode.workspace.openTextDocument({
            content: Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'),
            language: 'python',
        });
        clearFindings(document.uri);
    });

    teardown(() => clearFindings(document.uri));

    test('setFindings replaces the whole file rather than accumulating', () => {
        setFindings(document.uri, [makeFinding(2, 3, 'a = req.a'), makeFinding(9, 12, 'b = req.b')]);
        setFindings(document.uri, [makeFinding(14, 15, 'c = req.c')]);

        assert.deepStrictEqual(
            getFindings(document.uri).map(f => `${f.lineRange.start}-${f.lineRange.end}`),
            ['14-15']
        );
    });

    test('an empty result clears the file', () => {
        setFindings(document.uri, [makeFinding(11, 12)]);
        setFindings(document.uri, []);

        assert.deepStrictEqual(getFindings(document.uri), []);
    });

    test('getFinding looks up by fingerprint', () => {
        const finding = makeFinding(11, 12, 'lat = request.json["lat"]');
        setFindings(document.uri, [finding]);

        assert.strictEqual(getFinding(document.uri, finding.fingerprint), finding);
        assert.strictEqual(getFinding(document.uri, 'deadbeefdeadbeef'), undefined);
    });

    test('clearAllFindings empties every document', async () => {
        const other = await vscode.workspace.openTextDocument({ content: 'x = 1', language: 'python' });
        setFindings(document.uri, [makeFinding(2, 3)]);
        setFindings(other.uri, [makeFinding(1, 1)]);

        clearAllFindings();

        assert.deepStrictEqual(getFindings(document.uri), []);
        assert.deepStrictEqual(getFindings(other.uri), []);
    });
});

suite('decoration visibility', () => {
    const undecided = makeFinding(2, 3, 'a = req.a');
    const accepted = { ...makeFinding(5, 6, 'b = req.b'), status: 'accepted' as const };
    const rejected = { ...makeFinding(8, 9, 'c = req.c'), status: 'rejected' as const };
    const resolved = { ...makeFinding(11, 12, 'd = req.d'), resolvedAt: '2026-01-01T00:00:00Z' };
    const all = [undecided, accepted, rejected, resolved];

    const shown = () =>
        (['undecided', 'accepted', 'rejected'] as const)
            .flatMap(status => visibleFindings(all, status))
            .map(f => f.excerpt)
            .sort();

    setup(() => {
        setShowRejected(false);
        setShowFindings(true);
    });

    teardown(() => {
        setShowRejected(false);
        setShowFindings(true);
    });

    test('findings are shown and rejected ones hidden by default', () => {
        assert.strictEqual(isShowingFindings(), true);
        assert.strictEqual(isShowingRejected(), false);
    });

    test('shows undecided and accepted findings, never resolved ones', () => {
        assert.deepStrictEqual(shown(), ['a = req.a', 'b = req.b']);
    });

    test('rejected findings appear only while the rejected toggle is on', () => {
        setShowRejected(true);
        assert.deepStrictEqual(shown(), ['a = req.a', 'b = req.b', 'c = req.c']);
    });

    test('hiding all findings hides every status, rejected toggle included', () => {
        setShowRejected(true);
        setShowFindings(false);
        assert.deepStrictEqual(shown(), []);
    });

    test('showing findings again restores exactly what was hidden', () => {
        setShowFindings(false);
        setShowFindings(true);
        assert.deepStrictEqual(shown(), ['a = req.a', 'b = req.b']);
    });

    test('filters by the requested status only', () => {
        assert.deepStrictEqual(visibleFindings(all, 'accepted').map(f => f.excerpt), ['b = req.b']);
    });
});