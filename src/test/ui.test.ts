import * as assert from 'assert';
import * as vscode from 'vscode';
import { clearAllFindings, clearFindings, getFinding, getFindings, setFindings } from '../findings/store';
import {
    allVisibleFindings,
    isShowingFindings,
    isShowingRejected,
    setShowFindings,
    setShowRejected,
    visibleFindings,
} from '../ui/decorations';
import { buildHoverMessage, findingsAtLine } from '../ui/hover';
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
        assert.deepStrictEqual(
            visibleFindings(all, 'accepted').map(f => f.excerpt),
            ['b = req.b']
        );
    });
});

suite('hover', () => {
    const a = makeFinding(2, 4, 'a = req.a');
    const b = makeFinding(4, 6, 'b = req.b');
    const c = makeFinding(9, 9, 'c = req.c');

    teardown(() => {
        setShowRejected(false);
        setShowFindings(true);
    });

    test('findingsAtLine returns every finding covering the line, in reading order', () => {
        assert.deepStrictEqual(
            findingsAtLine([b, c, a], 4).map(f => f.excerpt),
            ['a = req.a', 'b = req.b']
        );
        assert.deepStrictEqual(
            findingsAtLine([a, b, c], 9).map(f => f.excerpt),
            ['c = req.c']
        );
        assert.deepStrictEqual(findingsAtLine([a, b, c], 7), []);
    });

    test('hovers only describe findings that are painted', () => {
        const rejected = { ...makeFinding(4, 4, 'r = req.r'), status: 'rejected' as const };
        const lines = () => findingsAtLine(allVisibleFindings([a, rejected]), 4).map(f => f.excerpt);

        assert.deepStrictEqual(lines(), ['a = req.a']);
        setShowRejected(true);
        assert.deepStrictEqual(lines(), ['a = req.a', 'r = req.r']);
        setShowFindings(false);
        assert.deepStrictEqual(lines(), []);
    });

    test('hover text carries the rule, evidence, and decision links', () => {
        const md = buildHoverMessage(vscode.Uri.parse('file:///workspace/src/app.py'), [a]);

        assert.ok(md.value.includes('[FP-01]'));
        assert.ok(md.value.includes('Reads user-supplied data.'));
        assert.ok(md.value.includes('command:priv-audit.acceptFinding'));
        assert.ok(md.value.includes('command:priv-audit.rejectFinding'));
    });
});
