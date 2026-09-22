import * as vscode from 'vscode';
import { getRule } from '../rules/catalog';
import { Confidence, FindingStatus, PrivacyFinding } from '../findings/schema';
import { getFindings } from '../findings/store';

type DecorationSet = Record<FindingStatus, vscode.TextEditorDecorationType>;

let decorationSet: DecorationSet | undefined;

function getDecorations(): DecorationSet {
    if (!decorationSet) {
        decorationSet = {
            undecided: vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                backgroundColor: 'rgba(255, 140, 0, 0.12)',
                overviewRulerColor: 'orange',
                overviewRulerLane: vscode.OverviewRulerLane.Right,
            }),
            accepted: vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                backgroundColor: 'rgba(64, 160, 255, 0.13)',
                overviewRulerColor: 'rgba(64, 160, 255, 0.9)',
                overviewRulerLane: vscode.OverviewRulerLane.Right,
            }),
            // Only ever painted while the user is reviewing rejections.
            rejected: vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                backgroundColor: 'rgba(128, 128, 128, 0.08)',
            }),
        };
    }
    return decorationSet;
}

/**
 * Rejected findings are hidden by default - that is the point of rejecting one.
 * The toggle exists so a mistaken rejection is reversible from the editor
 * rather than only by hand-editing the manifest.
 */
let showRejected = false;

export function isShowingRejected(): boolean {
    return showRejected;
}

export function setShowRejected(value: boolean): void {
    showRejected = value;
}

/**
 * Master switch for every finding decoration. Hiding is a view preference only:
 * findings stay in the store and the manifest, and showing them again restores
 * exactly what was painted before (rejected ones still follow `showRejected`).
 */
let showFindings = true;

export function isShowingFindings(): boolean {
    return showFindings;
}

export function setShowFindings(value: boolean): void {
    showFindings = value;
}

export function disposeDecorations(): void {
    if (!decorationSet) {return;}
    Object.values(decorationSet).forEach(type => type.dispose());
    decorationSet = undefined;
}

/**
 * The findings of one status that should be painted, given the current view
 * toggles. Resolved findings are never painted; they live on only in the
 * manifest's audit trail.
 */
export function visibleFindings(findings: PrivacyFinding[], status: FindingStatus): PrivacyFinding[] {
    if (!showFindings) {return [];}
    if (status === 'rejected' && !showRejected) {return [];}
    return findings.filter(f => f.status === status && !f.resolvedAt);
}

/**
 * Groups findings whose line spans overlap into merged clusters, so each
 * cluster becomes a single decoration. Sorts by start line first so overlap can
 * be checked with a single running "current group end" pointer (standard
 * interval-merge).
 */
function mergeOverlappingFindings(findings: PrivacyFinding[]): PrivacyFinding[][] {
    if (findings.length === 0) {return [];}

    const sorted = [...findings].sort(
        (a, b) => a.lineRange.start - b.lineRange.start || a.lineRange.end - b.lineRange.end
    );

    const groups: PrivacyFinding[][] = [sorted.slice(0, 1)];
    let groupEnd = sorted[0].lineRange.end;

    for (let i = 1; i < sorted.length; i++) {
        const finding = sorted[i];
        if (finding.lineRange.start <= groupEnd) {
            groups[groups.length - 1].push(finding);
            groupEnd = Math.max(groupEnd, finding.lineRange.end);
        } else {
            groups.push([finding]);
            groupEnd = finding.lineRange.end;
        }
    }

    return groups;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

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

function buildHoverMessage(uri: vscode.Uri, group: PrivacyFinding[]): vscode.MarkdownString {
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

const STATUS_STYLE: Record<FindingStatus, { mark: string; noun: string; color: string }> = {
    undecided: { mark: '⚠', noun: 'privacy practices', color: 'orange' },
    accepted: { mark: '✔', noun: 'accepted practices', color: 'rgba(64, 160, 255, 0.95)' },
    rejected: { mark: '✖', noun: 'rejected practices', color: 'rgba(150, 150, 150, 0.8)' },
};

function badge(group: PrivacyFinding[], status: FindingStatus): string {
    const style = STATUS_STYLE[status];
    return group.length > 1
        ? ` ${style.mark} ${group.length} ${style.noun}`
        : ` ${style.mark} ${getRule(group[0].category).id}`;
}

/**
 * Recomputes decorations for the given editor from its full finding store and
 * applies them in one shot. setDecorations always replaces the entire set for a
 * given decoration type, so recomputing from scratch is correct.
 *
 * Rejected findings are deliberately not decorated: the user has said they are
 * not pertinent, and they survive only in the manifest. A hidden status still
 * gets an empty `setDecorations` call, which is what clears it from the editor.
 */
export function updateDecorations(textEditor: vscode.TextEditor): void {
    const findings = getFindings(textEditor.document.uri);
    const decorations = getDecorations();

    for (const status of ['undecided', 'accepted', 'rejected'] as const) {
        const groups = mergeOverlappingFindings(visibleFindings(findings, status));

        const options: vscode.DecorationOptions[] = groups.map(group => {
            const startLine = Math.max(0, Math.min(...group.map(f => f.lineRange.start)) - 1);
            const endLine = Math.min(
                Math.max(...group.map(f => f.lineRange.end)) - 1,
                textEditor.document.lineCount - 1
            );
            const lineLength = textEditor.document.lineAt(endLine).text.length;

            const topConfidence = group.reduce<Confidence>(
                (best, f) => (CONFIDENCE_RANK[f.confidence] > CONFIDENCE_RANK[best] ? f.confidence : best),
                'low'
            );
            const label = badge(group, status);
            const lowConfidence = topConfidence === 'low' && status !== 'rejected';

            return {
                range: new vscode.Range(startLine, 0, endLine, lineLength),
                hoverMessage: buildHoverMessage(textEditor.document.uri, group),
                renderOptions: {
                    after: {
                        contentText: lowConfidence ? `${label} (low confidence)` : label,
                        color: lowConfidence ? 'rgba(255, 140, 0, 0.6)' : STATUS_STYLE[status].color,
                    },
                },
            };
        });

        textEditor.setDecorations(decorations[status], options);
    }
}

/** Repaints every visible editor, e.g. after a view toggle or a reset. */
export function repaintVisibleEditors(): void {
    vscode.window.visibleTextEditors.forEach(updateDecorations);
}

/** Repaints every editor currently showing `uri`. */
export function refreshEditorsFor(uri: vscode.Uri): void {
    for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === uri.toString()) {
            updateDecorations(editor);
        }
    }
}