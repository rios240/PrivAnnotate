import * as assert from 'assert';
import * as vscode from 'vscode';
import { DEFAULT_SETTINGS, getSettings, normalizeSettings } from '../config';

interface StubHelpers {
    __setConfiguration?: (values: Record<string, unknown>) => void;
}

const setConfiguration = (vscode as unknown as StubHelpers).__setConfiguration;

suite('settings', () => {
    test('an empty configuration yields the defaults', () => {
        assert.deepStrictEqual(normalizeSettings({}), DEFAULT_SETTINGS);
    });

    test('clamps numeric settings into range and rounds them', () => {
        const low = normalizeSettings({ 'analysis.maxConcurrentRequests': 0, 'analysis.chunkOverlapLines': -5 });
        assert.strictEqual(low.maxConcurrentRequests, 1);
        assert.strictEqual(low.chunkOverlapLines, 0);

        const high = normalizeSettings({ 'analysis.maxConcurrentRequests': 999, 'analysis.chunkOverlapLines': 1e6 });
        assert.strictEqual(high.maxConcurrentRequests, 16);
        assert.strictEqual(high.chunkOverlapLines, 200);

        assert.strictEqual(normalizeSettings({ 'analysis.maxConcurrentRequests': 4.6 }).maxConcurrentRequests, 5);
    });

    test('falls back to defaults for values of the wrong type', () => {
        const settings = normalizeSettings({
            'model.vendor': 42,
            'analysis.maxConcurrentRequests': 'lots',
            'analysis.chunkOverlapLines': NaN,
        });
        assert.deepStrictEqual(settings, DEFAULT_SETTINGS);
    });

    test('treats a blank model family as "any" and trims names', () => {
        assert.strictEqual(normalizeSettings({ 'model.family': '   ' }).modelFamily, undefined);
        assert.strictEqual(normalizeSettings({ 'model.family': ' gpt-4o ' }).modelFamily, 'gpt-4o');
        assert.strictEqual(normalizeSettings({ 'model.vendor': '' }).modelVendor, 'copilot');
    });

    (setConfiguration ? test : test.skip)('getSettings reads the privAudit section', () => {
        setConfiguration!({ 'model.vendor': 'other', 'analysis.maxConcurrentRequests': 2 });
        try {
            const settings = getSettings();
            assert.strictEqual(settings.modelVendor, 'other');
            assert.strictEqual(settings.maxConcurrentRequests, 2);
        } finally {
            setConfiguration!({});
        }
    });
});