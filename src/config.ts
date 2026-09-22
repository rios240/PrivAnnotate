import * as vscode from 'vscode';
import { CHUNK_OVERLAP_LINES } from './analysis/chunking';

export const CONFIG_SECTION = 'privAudit';

/** Resolved, range-checked settings. See `contributes.configuration` in package.json. */
export interface Settings {
    /** Language-model vendor passed to `vscode.lm.selectChatModels`. */
    modelVendor: string;
    /** Optional model family; undefined lets the vendor pick. */
    modelFamily?: string;
    /** Per-rule requests in flight at once during an Analyze run. */
    maxConcurrentRequests: number;
    /** Lines repeated between adjacent chunks. */
    chunkOverlapLines: number;
}

export const DEFAULT_SETTINGS: Settings = {
    modelVendor: 'copilot',
    modelFamily: undefined,
    maxConcurrentRequests: 3,
    chunkOverlapLines: CHUNK_OVERLAP_LINES,
};

const MAX_CONCURRENT_REQUESTS = 16;
const MAX_CHUNK_OVERLAP_LINES = 200;

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {return fallback;}
    return Math.min(max, Math.max(min, Math.round(value)));
}

function nonEmpty(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Settings are user input: a hand-edited settings.json can hold anything, so
 * every value is type-checked and clamped rather than trusted.
 */
export function normalizeSettings(raw: Record<string, unknown>): Settings {
    return {
        modelVendor: nonEmpty(raw['model.vendor']) ?? DEFAULT_SETTINGS.modelVendor,
        modelFamily: nonEmpty(raw['model.family']),
        maxConcurrentRequests: clampInteger(
            raw['analysis.maxConcurrentRequests'],
            1,
            MAX_CONCURRENT_REQUESTS,
            DEFAULT_SETTINGS.maxConcurrentRequests
        ),
        chunkOverlapLines: clampInteger(
            raw['analysis.chunkOverlapLines'],
            0,
            MAX_CHUNK_OVERLAP_LINES,
            DEFAULT_SETTINGS.chunkOverlapLines
        ),
    };
}

export function getSettings(): Settings {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const keys = [
        'model.vendor',
        'model.family',
        'analysis.maxConcurrentRequests',
        'analysis.chunkOverlapLines',
    ];
    return normalizeSettings(Object.fromEntries(keys.map(key => [key, config.get(key)])));
}