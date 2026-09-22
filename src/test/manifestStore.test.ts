import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    emptyManifest,
    ManifestStore,
    manifestStore,
    manifestUri,
    StoredFinding,
} from '../findings/manifest';
import { computeFingerprint } from '../findings/fingerprint';
import { loadFindingsFor } from '../findings/persistence';
import { resetManifest } from '../commands/manifest';
import { clearAllFindings, getFindings, setFindings } from '../findings/store';
import { PrivacyFinding } from '../findings/schema';

/**
 * Test-only helpers on the Node `vscode` stub. Under the Extension Development
 * Host these do not exist, so this suite is skipped there - the real host has a
 * real file system and a real workspace, which these fakes stand in for.
 */
interface StubHelpers {
    __setWorkspaceFolder?: (uri: vscode.Uri, name?: string) => void;
    __resetFileSystem?: () => void;
    __readFile?: (uri: vscode.Uri) => string | undefined;
    __setWarningResponse?: (choice: string | undefined) => void;
}

const stub = vscode as unknown as Required<StubHelpers>;
const isStub = typeof (vscode as unknown as StubHelpers).__setWorkspaceFolder === 'function';

const FOLDER = vscode.Uri.parse('file:///workspace');
const FILE = vscode.Uri.parse('file:///workspace/src/app.py');
const NOW = '2026-08-27T12:00:00.000Z';

function stored(excerpt: string): StoredFinding {
    return {
        fingerprint: computeFingerprint('FIRST_PARTY_COLLECTION_USE', excerpt),
        category: 'FIRST_PARTY_COLLECTION_USE',
        lineRange: { start: 1, end: 1 },
        excerpt,
        evidence: 'Reads user-supplied data.',
        confidence: 'high',
        status: 'accepted',
        firstSeen: NOW,
        lastSeen: NOW,
        decidedAt: NOW,
    };
}

function withEntry(store: ManifestStore): Promise<void> {
    return store.update(FOLDER, manifest => {
        manifest.files['src/app.py'] = { lastAnalyzedAt: NOW, findings: [stored('a = req.a')] };
    });
}

async function openFile(): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({
        content: 'a = req.a\nb = 2',
        language: 'python',
        uri: FILE,
    } as unknown as { content: string; language: string });
}

(isStub ? suite : suite.skip)('ManifestStore.reset', () => {
    setup(() => {
        stub.__setWorkspaceFolder(FOLDER);
        stub.__resetFileSystem();
    });

    test('deletes the manifest and leaves an empty one cached', async () => {
        const store = new ManifestStore();
        await withEntry(store);
        assert.ok(stub.__readFile(manifestUri(FOLDER)), 'precondition: manifest was written');

        await store.reset(FOLDER);

        assert.strictEqual(stub.__readFile(manifestUri(FOLDER)), undefined);
        assert.deepStrictEqual(await store.load(FOLDER), emptyManifest());
    });

    test('is a no-op when no manifest exists yet', async () => {
        await new ManifestStore().reset(FOLDER);
        assert.strictEqual(stub.__readFile(manifestUri(FOLDER)), undefined);
    });

    test('runs after a write that was already queued', async () => {
        const store = new ManifestStore();
        const pending = withEntry(store);
        const reset = store.reset(FOLDER);
        await Promise.all([pending, reset]);

        assert.strictEqual(stub.__readFile(manifestUri(FOLDER)), undefined);
        assert.deepStrictEqual((await store.load(FOLDER)).files, {});
    });

    test('a fresh store reads nothing back after a reset', async () => {
        const store = new ManifestStore();
        await withEntry(store);
        await store.reset(FOLDER);

        assert.deepStrictEqual((await new ManifestStore().load(FOLDER)).files, {});
    });
});

(isStub ? suite : suite.skip)('resetManifest command', () => {
    let document: vscode.TextDocument;

    function painted(): PrivacyFinding {
        return { ...stored('a = req.a') };
    }

    setup(async () => {
        stub.__setWorkspaceFolder(FOLDER);
        stub.__resetFileSystem();
        manifestStore.invalidate();
        document = await openFile();
        await withEntry(manifestStore);
        setFindings(document.uri, [painted()]);
    });

    teardown(() => {
        stub.__setWarningResponse(undefined);
        clearAllFindings();
        manifestStore.invalidate();
    });

    test('does nothing unless the user confirms', async () => {
        stub.__setWarningResponse(undefined);
        await resetManifest();

        assert.ok(stub.__readFile(manifestUri(FOLDER)), 'manifest should survive a cancelled reset');
        assert.strictEqual(getFindings(document.uri).length, 1);
    });

    test('wipes the manifest and the in-memory findings once confirmed', async () => {
        stub.__setWarningResponse('Reset');
        await resetManifest();

        assert.strictEqual(stub.__readFile(manifestUri(FOLDER)), undefined);
        assert.deepStrictEqual(getFindings(document.uri), []);
    });
});

(isStub ? suite : suite.skip)('loadFindingsFor', () => {
    setup(() => {
        stub.__setWorkspaceFolder(FOLDER);
        stub.__resetFileSystem();
        manifestStore.invalidate();
    });

    teardown(() => {
        clearAllFindings();
        manifestStore.invalidate();
    });

    test('hydrates findings from the manifest entry', async () => {
        const document = await openFile();
        await withEntry(manifestStore);

        assert.strictEqual(await loadFindingsFor(document), true);
        assert.strictEqual(getFindings(document.uri).length, 1);
        assert.strictEqual(getFindings(document.uri)[0].status, 'accepted');
    });

    test('clears painted findings when the manifest no longer has an entry', async () => {
        const document = await openFile();
        setFindings(document.uri, [{ ...stored('a = req.a') }]);

        assert.strictEqual(await loadFindingsFor(document), false);
        assert.deepStrictEqual(getFindings(document.uri), []);
    });
});
