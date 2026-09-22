import * as vscode from 'vscode';
import { PrivacyFinding } from './schema';

/**
 * The findings currently loaded for each document, keyed by URI string. This is
 * what the editor paints and what decision commands mutate; the manifest on
 * disk is the durable copy.
 */
const findingsByDocument = new Map<string, PrivacyFinding[]>();

/** Replaces a document's findings wholesale. */
export function setFindings(uri: vscode.Uri, findings: PrivacyFinding[]): void {
    findingsByDocument.set(uri.toString(), findings);
}

export function getFindings(uri: vscode.Uri): PrivacyFinding[] {
    return findingsByDocument.get(uri.toString()) ?? [];
}

export function getFinding(uri: vscode.Uri, fingerprint: string): PrivacyFinding | undefined {
    return findingsByDocument.get(uri.toString())?.find(f => f.fingerprint === fingerprint);
}

export function clearFindings(uri: vscode.Uri): void {
    findingsByDocument.delete(uri.toString());
}

/** Empties the store for every document, e.g. after the manifest is reset. */
export function clearAllFindings(): void {
    findingsByDocument.clear();
}