import * as vscode from 'vscode';
import { getRule } from '../rules/catalog';
import { PrivacyFinding } from '../findings/schema';
import { StoredFinding } from '../findings/manifest';
import { ReconcileResult } from '../findings/reconcile';
import { ITruncationInfo } from '../analysis/prompts';

export interface RunContext {
    chunks: number;
    requests: number;
    failedCategories: string[];
    truncation?: ITruncationInfo;
    /** False when the file lives outside a workspace folder and can't be saved. */
    saved: boolean;
}

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
    channel ??= vscode.window.createOutputChannel('PrivAudit');
    return channel;
}

export function disposeReport(): void {
    channel?.dispose();
    channel = undefined;
}

/** Reveals the report channel without stealing focus from the editor. */
export function showReport(): void {
    getChannel().show(true);
}

function describe(finding: PrivacyFinding | StoredFinding): string {
    const rule = getRule(finding.category);
    const lines =
        finding.lineRange.start === finding.lineRange.end
            ? `L${finding.lineRange.start}`
            : `L${finding.lineRange.start}-${finding.lineRange.end}`;
    return `  [${rule.id}] ${lines} (${finding.confidence}) - ${finding.evidence}`;
}

function section(
    out: vscode.OutputChannel,
    title: string,
    items: Array<PrivacyFinding | StoredFinding>
): void {
    if (items.length === 0) {return;}
    out.appendLine(`${title} (${items.length})`);
    items.forEach(item => out.appendLine(describe(item)));
    out.appendLine('');
}

/**
 * Writes a full previous-vs-current comparison to the output channel and
 * surfaces a one-line summary, so a re-run says what actually changed rather
 * than just replacing the annotations.
 */
export function reportRun(
    document: vscode.TextDocument,
    result: ReconcileResult,
    context: RunContext
): void {
    const out = getChannel();
    const path = vscode.workspace.asRelativePath(document.uri);

    out.appendLine(`--- ${new Date().toLocaleString()} · ${path}`);
    out.appendLine(
        `${context.requests} requests across ${context.chunks} ` +
        `chunk${context.chunks === 1 ? '' : 's'}`
    );
    out.appendLine('');

    section(out, 'New', result.added);
    section(out, 'Still present', result.persisted);
    section(out, 'Suppressed (previously rejected)', result.suppressed);
    section(out, 'Reopened (previously resolved)', result.reopened);
    section(out, 'No longer found', result.resolved);

    if (result.added.length === 0 && result.persisted.length === 0 &&
        result.suppressed.length === 0 && result.resolved.length === 0) {
        out.appendLine('No privacy practices detected.');
        out.appendLine('');
    }

    if (context.truncation) {
        out.appendLine(
            `Warning: a chunk was trimmed to ${context.truncation.includedLines} of ` +
            `${context.truncation.totalLines} lines to fit the model context.`
        );
    }
    if (context.failedCategories.length > 0) {
        out.appendLine(`Warning: categories that failed: ${context.failedCategories.join(', ')}`);
    }
    if (!context.saved) {
        out.appendLine('Warning: findings were not persisted (file is outside a workspace folder).');
    }
    out.appendLine('');

    showSummary(result, context);
}

function showSummary(result: ReconcileResult, context: RunContext): void {
    const parts: string[] = [];
    if (result.added.length) {parts.push(`${result.added.length} new`);}
    if (result.persisted.length) {parts.push(`${result.persisted.length} still present`);}
    if (result.resolved.length) {parts.push(`${result.resolved.length} no longer found`);}
    if (result.suppressed.length) {parts.push(`${result.suppressed.length} suppressed`);}

    const summary = parts.length > 0 ? parts.join(', ') : 'no privacy practices detected';
    const failed = context.failedCategories.length > 0
        ? ` · ${context.failedCategories.length} categories failed`
        : '';

    const message = `priv-audit: ${summary}${failed}.`;
    const show = 'Show report';

    const notify =
        context.failedCategories.length > 0
            ? vscode.window.showWarningMessage(message, show)
            : vscode.window.showInformationMessage(message, show);

    notify.then(choice => {
        if (choice === show) {showReport();}
    });
}