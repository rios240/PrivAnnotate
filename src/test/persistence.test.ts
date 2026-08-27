import * as assert from 'assert';
import * as vscode from 'vscode';
import { ManifestStore, locate, manifestUri, toStoredFinding } from '../findings/manifest';
import { computeFingerprint } from '../findings/fingerprint';
import { hydrate } from '../decisions';
import { PrivacyFinding } from '../pdc/schema';

/**
 * Test-only helpers on the Node `vscode` stub. Under the Extension Development
 * Host these do not exist, so this suite is skipped there - the real host has a
 * real file system and a real workspace, which these fakes stand in for.
 */
interface StubHelpers {
    __setWorkspaceFolder?: (uri: vscode.Uri, name?: string) => void;
    __resetFileSystem?: () => void;
    __readFile?: (uri: vscode.Uri) => string | undefined;
}

const stub = vscode as unknown as StubHelpers;
const isStub = typeof stub.__setWorkspaceFolder === 'function';

const FOLDER = vscode.Uri.parse('file:///workspace');
const FILE = vscode.Uri.parse('file:///workspace/src/app.py');

const SOURCE = [
    'import os',
    '',
    'def checkin():',
    '    lat = request.json["lat"]',
    '    return lat',
].join('\n');

function finding(excerpt: string, overrides: Partial<PrivacyFinding> = {}): PrivacyFinding {
    const now = new Date().toISOString();
    return {
        id: 'local-1',
        fingerprint: computeFingerprint('FIRST_PARTY_COLLECTION_USE', excerpt),
        category: 'FIRST_PARTY_COLLECTION_USE',
        lineRange: { start: 4, end: 4 },
        excerpt,
        evidence: 'Reads user location from the request body.',
        confidence: 'high',
        status: 'undecided',
        firstSeen: now,
        lastSeen: now,
        ...overrides,
    };
}

async function openFile(content = SOURCE): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({
        content,
        language: 'python',
        uri: FILE,
    } as unknown as { content: string; language: string });
}

(isStub ? suite : suite.skip)('manifest persistence', () => {
    let store: ManifestStore;

    setup(() => {
        stub.__resetFileSystem?.();
        stub.__setWorkspaceFolder?.(FOLDER);
        store = new ManifestStore();
    });

    test('locates a workspace file by its folder-relative path', async () => {
        const document = await openFile();
        assert.deepStrictEqual(locate(document)?.path, 'src/app.py');
        assert.strictEqual(locate(document)?.folder.toString(), FOLDER.toString());
    });

    test('writes to .privaudit/findings.json at the workspace root', async () => {
        await store.update(FOLDER, manifest => {
            manifest.files['src/app.py'] = {
                lastAnalyzedAt: new Date().toISOString(),
                findings: [toStoredFinding(finding('lat = request.json["lat"]'))],
            };
        });

        const target = manifestUri(FOLDER);
        assert.strictEqual(target.toString(), 'file:///workspace/.privaudit/findings.json');
        assert.ok(stub.__readFile?.(target), 'the manifest file was not written');
    });

    test('a fresh store reads back what a previous one wrote', async () => {
        await store.update(FOLDER, manifest => {
            manifest.files['src/app.py'] = {
                lastAnalyzedAt: new Date().toISOString(),
                findings: [
                    toStoredFinding(finding('lat = request.json["lat"]', { status: 'accepted' })),
                ],
            };
        });

        // Stands in for closing and reopening the window.
        const reopened = new ManifestStore();
        const manifest = await reopened.load(FOLDER);

        assert.strictEqual(manifest.files['src/app.py'].findings.length, 1);
        assert.strictEqual(manifest.files['src/app.py'].findings[0].status, 'accepted');
    });

    test('returns an empty manifest when none has been written yet', async () => {
        const manifest = await store.load(FOLDER);
        assert.deepStrictEqual(manifest.files, {});
    });

    test('concurrent updates all land instead of overwriting each other', async () => {
        await store.update(FOLDER, manifest => {
            manifest.files['src/app.py'] = { lastAnalyzedAt: '', findings: [] };
        });

        await Promise.all(
            ['a', 'b', 'c', 'd'].map(name =>
                store.update(FOLDER, manifest => {
                    manifest.files['src/app.py'].findings.push(
                        toStoredFinding(finding(`${name} = req.${name}`))
                    );
                })
            )
        );

        const reopened = await new ManifestStore().load(FOLDER);
        assert.strictEqual(reopened.files['src/app.py'].findings.length, 4);
    });

    test('a failed update does not stall later updates', async () => {
        await store.update(FOLDER, () => { throw new Error('boom'); }).catch(() => undefined);
        await store.update(FOLDER, manifest => {
            manifest.files['src/app.py'] = {
                lastAnalyzedAt: '',
                findings: [toStoredFinding(finding('lat = request.json["lat"]'))],
            };
        });

        const reopened = await new ManifestStore().load(FOLDER);
        assert.strictEqual(reopened.files['src/app.py'].findings.length, 1);
    });

    test('invalidate forces the next load to re-read from disk', async () => {
        await store.update(FOLDER, manifest => {
            manifest.files['src/app.py'] = { lastAnalyzedAt: '', findings: [] };
        });

        store.invalidate();
        const manifest = await store.load(FOLDER);
        assert.ok(manifest.files['src/app.py']);
    });
});

(isStub ? suite : suite.skip)('hydrate', () => {
    setup(() => {
        stub.__resetFileSystem?.();
        stub.__setWorkspaceFolder?.(FOLDER);
    });

    test('restores stored findings onto their current lines', async () => {
        const document = await openFile();
        const [restored] = hydrate(document, [
            toStoredFinding(
                finding('lat = request.json["lat"]', { lineRange: { start: 4, end: 4 } })
            ),
        ]);

        assert.deepStrictEqual(restored.lineRange, { start: 4, end: 4 });
        assert.strictEqual(restored.stale, undefined);
        assert.ok(restored.id.startsWith('finding-'), 'should get a fresh runtime id');
    });

    test('relocates a finding whose code moved while the file was edited', async () => {
        const document = await openFile(['# new header', '# another line', SOURCE].join('\n'));
        const [restored] = hydrate(document, [
            toStoredFinding(
                finding('lat = request.json["lat"]', { lineRange: { start: 4, end: 4 } })
            ),
        ]);

        assert.deepStrictEqual(restored.lineRange, { start: 6, end: 6 });
        assert.strictEqual(restored.stale, undefined);
    });

    test('marks a finding stale when its code is gone', async () => {
        const document = await openFile('def checkin():\n    pass');
        const [restored] = hydrate(document, [
            toStoredFinding(finding('lat = request.json["lat"]')),
        ]);

        assert.strictEqual(restored.stale, true);
    });

    test('preserves the accept decision across a reload', async () => {
        const document = await openFile();
        const [restored] = hydrate(document, [
            toStoredFinding(
                finding('lat = request.json["lat"]', { status: 'accepted', decidedAt: 'x' })
            ),
        ]);

        assert.strictEqual(restored.status, 'accepted');
        assert.strictEqual(restored.decidedAt, 'x');
    });
});
