import * as vscode from 'vscode';
import { getCard } from '../pdc/categories';
import { Confidence, LineRange, PrivacyFinding } from '../pdc/schema';

// One store per open document, keyed by URI string.
const findingsByDocument = new Map<string, PrivacyFinding[]>();

let decorationType: vscode.TextEditorDecorationType | undefined;

function getDecorationType(): vscode.TextEditorDecorationType {
    if (!decorationType) {
        decorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: 'rgba(255, 140, 0, 0.12)',
            overviewRulerColor: 'orange',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
    }
    return decorationType;
}

let idCounter = 0;
export function nextFindingId(): string {
    idCounter += 1;
    return `finding-${idCounter}`;
}

export function addFindings(document: vscode.TextDocument, findings: PrivacyFinding[]): void {
    const key = document.uri.toString();
    const existing = findingsByDocument.get(key) ?? [];
    findingsByDocument.set(key, existing.concat(findings));
}

/**
 * Swaps in a fresh result set for one analyzed span: prior findings overlapping
 * `range` are discarded, findings elsewhere in the document survive. Re-running
 * Analyze on the same viewport therefore refreshes rather than duplicates.
 */
export function replaceFindingsInRange(
    document: vscode.TextDocument,
    range: LineRange,
    findings: PrivacyFinding[]
): void {
    const key = document.uri.toString();
    const kept = (findingsByDocument.get(key) ?? []).filter(
        f => f.lineRange.end < range.start || f.lineRange.start > range.end
    );
    findingsByDocument.set(key, kept.concat(findings));
}

export function getFindings(document: vscode.TextDocument): PrivacyFinding[] {
    return findingsByDocument.get(document.uri.toString()) ?? [];
}

export function clearFindings(document: vscode.TextDocument): void {
    findingsByDocument.delete(document.uri.toString());
}

/**
 * Groups findings whose line spans overlap into merged clusters, so each
 * cluster becomes a single decoration. Sorts by start line first so overlap can
 * be checked with a single running "current group end" pointer (standard
 * interval-merge).
 */
function mergeOverlappingFindings(findings: PrivacyFinding[]): PrivacyFinding[][] {
    if (findings.length === 0) return [];

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

function buildHoverMessage(group: PrivacyFinding[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);

    group.forEach((finding, idx) => {
        if (idx > 0) md.appendMarkdown('\n\n---\n\n');

        const card = getCard(finding.category);
        md.appendMarkdown(`**[${card.id}] ${card.displayName}** · confidence: ${finding.confidence}\n\n`);
        md.appendMarkdown(`${finding.evidence}\n\n`);

        if (finding.reasoning?.length) {
            finding.reasoning.forEach((step, i) => md.appendMarkdown(`${i + 1}. ${step}\n`));
            md.appendMarkdown('\n');
        }

        if (finding.crossReferences?.length) {
            const related = finding.crossReferences
                .map(category => {
                    const other = getCard(category);
                    return `${other.id} ${other.displayName}`;
                })
                .join(', ');
            md.appendMarkdown(`*Also matches:* ${related}`);
        }
    });

    return md;
}

/**
 * Recomputes decorations for the given editor from its full accumulated finding
 * store and applies them in one shot. setDecorations always replaces the entire
 * set for a given decoration type, so recomputing from scratch is correct.
 */
export function updateDecorations(textEditor: vscode.TextEditor): void {
    const findings = getFindings(textEditor.document);
    const groups = mergeOverlappingFindings(findings);

    const options: vscode.DecorationOptions[] = groups.map(group => {
        const startLine = Math.max(
            0,
            Math.min(...group.map(f => f.lineRange.start)) - 1 // to 0-based
        );
        const endLine = Math.min(
            Math.max(...group.map(f => f.lineRange.end)) - 1,
            textEditor.document.lineCount - 1
        );
        const lineLength = textEditor.document.lineAt(endLine).text.length;

        const topConfidence = group.reduce<Confidence>(
            (best, f) => (CONFIDENCE_RANK[f.confidence] > CONFIDENCE_RANK[best] ? f.confidence : best),
            'low'
        );
        const label =
            group.length > 1
                ? ` ⚠ ${group.length} privacy practices`
                : ` ⚠ ${getCard(group[0].category).id}`;

        return {
            range: new vscode.Range(startLine, 0, endLine, lineLength),
            hoverMessage: buildHoverMessage(group),
            renderOptions: {
                after: {
                    contentText: topConfidence === 'low' ? `${label} (low confidence)` : label,
                    color: topConfidence === 'low' ? 'rgba(255, 140, 0, 0.6)' : 'orange',
                },
            },
        };
    });

    textEditor.setDecorations(getDecorationType(), options);
}