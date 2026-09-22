import * as vscode from 'vscode';
import { getRule } from '../rules/catalog';
import { PrivacyFinding } from '../findings/schema';
import { getFindings } from '../findings/store';
import { allVisibleFindings } from './decorations';

/**
 * Hover text for findings, built only when the user actually hovers. Building a
 * MarkdownString per decoration group on every repaint would cost work
 * proportional to the file's findings for text that is almost never read.
 */
export function registerHoverProvider(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('*', {
            provideHover(document, position) {
                const hits = findingsAtLine(allVisibleFindings(getFindings(document.uri)), position.line + 1);
                if (hits.length === 0) {return undefined;}

                const start = Math.min(...hits.map(f => f.lineRange.start)) - 1;
                const end = Math.min(Math.max(...hits.map(f => f.lineRange.end)), document.lineCount) - 1;
                const range = new vscode.Range(start, 0, end, document.lineAt(end).text.length);
                return new vscode.Hover(buildHoverMessage(document.uri, hits), range);
            },
        })
    );
}

/** Findings whose span covers `line` (1-based), in reading order. */
export function findingsAtLine(findings: PrivacyFinding[], line: number): PrivacyFinding[] {
    return findings
        .filter(f => f.lineRange.start <= line && line <= f.lineRange.end)
        .sort((a, b) => a.lineRange.start - b.lineRange.start || a.lineRange.end - b.lineRange.end);
}

function commandLink(command: string, uri: vscode.Uri, fingerprint: string, label: string): string {
    const args = encodeURIComponent(JSON.stringify([{ uri: uri.toString(), fingerprint }]));
    return `[${label}](command:${command}?${args})`;
}

function decisionLinks(uri: vscode.Uri, finding: PrivacyFinding): string {
    const accept = commandLink('priv-audit.acceptFinding', uri, finding.fingerprint, '$(check) Accept');
    const reject = commandLink('priv-audit.rejectFinding', uri, finding.fingerprint, '$(x) Reject');
    const undo = commandLink('priv-audit.clearDecision', uri, finding.fingerprint, '$(discard) Undo');

    switch (finding.status) {
        case 'accepted':
            return `Accepted · ${reject} · ${undo}`;
        case 'rejected':
            return `Rejected · ${accept} · ${undo}`;
        default:
            return `${accept} · ${reject}`;
    }
}

function formatDate(iso: string | undefined): string | undefined {
    if (!iso) {return undefined;}
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString();
}

export function buildHoverMessage(uri: vscode.Uri, group: PrivacyFinding[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    // Required for the command: links above to be clickable.
    md.isTrusted = true;

    group.forEach((finding, idx) => {
        if (idx > 0) {md.appendMarkdown('\n\n---\n\n');}

        const rule = getRule(finding.category);
        md.appendMarkdown(`**[${rule.id}] ${rule.displayName}** · confidence: ${finding.confidence}\n\n`);
        md.appendMarkdown(`${finding.evidence}\n\n`);

        if (finding.reasoning?.length) {
            finding.reasoning.forEach((step, i) => md.appendMarkdown(`${i + 1}. ${step}\n`));
            md.appendMarkdown('\n');
        }

        if (finding.crossReferences?.length) {
            const related = finding.crossReferences
                .map(category => {
                    const other = getRule(category);
                    return `${other.id} ${other.displayName}`;
                })
                .join(', ');
            md.appendMarkdown(`*Also matches:* ${related}\n\n`);
        }

        const firstSeen = formatDate(finding.firstSeen);
        if (firstSeen) {md.appendMarkdown(`*First seen:* ${firstSeen}\n\n`);}
        if (finding.stale) {
            md.appendMarkdown(
                '*This span could not be located in the current text - the code may have changed since it was recorded.*\n\n'
            );
        }

        md.appendMarkdown(decisionLinks(uri, finding));
    });

    return md;
}