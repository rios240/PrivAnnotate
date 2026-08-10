import * as vscode from 'vscode';

export interface ThreatFinding {
    id: string;
    threatId: string;
    title: string;
    summary: string;
    startLine: number; // 1-based, as returned by the LLM
    endLine: number;   // 1-based, inclusive
    consequences: string;
    remediation: string;
}

// One store per open document, keyed by URI string. Findings accumulate
// across multiple "Analyze" runs and are never auto-removed; re-running
// analyze only adds to this list.
const findingsByDocument = new Map<string, ThreatFinding[]>();

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

export function addFindings(document: vscode.TextDocument, findings: ThreatFinding[]): void {
    const key = document.uri.toString();
    const existing = findingsByDocument.get(key) ?? [];
    findingsByDocument.set(key, existing.concat(findings));
}

export function getFindings(document: vscode.TextDocument): ThreatFinding[] {
    return findingsByDocument.get(document.uri.toString()) ?? [];
}

export function clearFindings(document: vscode.TextDocument): void {
    findingsByDocument.delete(document.uri.toString());
}

/**
 * Groups findings whose [startLine, endLine] spans overlap into merged
 * clusters, so each cluster becomes a single decoration. Sorts by
 * startLine first so overlap can be checked with a single running
 * "current group end" pointer (standard interval-merge).
 */
function mergeOverlappingFindings(findings: ThreatFinding[]): ThreatFinding[][] {
    if (findings.length === 0) return [];

    const sorted = [...findings].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);

    const groups: ThreatFinding[][] = [sorted.slice(0, 1)];
    let groupEnd = sorted[0].endLine;

    for (let i = 1; i < sorted.length; i++) {
        const finding = sorted[i];
        if (finding.startLine <= groupEnd) {
            groups[groups.length - 1].push(finding);
            groupEnd = Math.max(groupEnd, finding.endLine);
        } else {
            groups.push([finding]);
            groupEnd = finding.endLine;
        }
    }

    return groups;
}

function buildHoverMessage(group: ThreatFinding[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);

    group.forEach((finding, idx) => {
        if (idx > 0) md.appendMarkdown('\n\n---\n\n');
        md.appendMarkdown(`**[${finding.threatId}] ${finding.title}**\n\n`);
        md.appendMarkdown(`${finding.summary}\n\n`);
        md.appendMarkdown(`*Consequences:* ${finding.consequences}\n\n`);
        md.appendMarkdown(`*Remediation:* ${finding.remediation}`);
    });

    return md;
}

/**
 * Recomputes decorations for the given editor from its FULL accumulated
 * finding store (including findings from earlier Analyze runs) and
 * applies them in one shot. setDecorations always replaces the entire
 * set for a given decoration type, so this recompute-from-scratch
 * approach is correct even though findings themselves are never deleted.
 */
export function updateDecorations(textEditor: vscode.TextEditor): void {
    const findings = getFindings(textEditor.document);
    const groups = mergeOverlappingFindings(findings);

    const options: vscode.DecorationOptions[] = groups.map(group => {
        const startLine = Math.min(...group.map(f => f.startLine)) - 1; // to 0-based
        const endLine = Math.min(
            Math.max(...group.map(f => f.endLine)) - 1,
            textEditor.document.lineCount - 1
        );
        const lineLength = textEditor.document.lineAt(endLine).text.length;

        return {
            range: new vscode.Range(startLine, 0, endLine, lineLength),
            hoverMessage: buildHoverMessage(group),
            renderOptions: {
                after: {
                    contentText: group.length > 1 ? ` ⚠ ${group.length} threats` : ' ⚠ threat',
                    color: 'orange',
                },
            },
        };
    });

    textEditor.setDecorations(getDecorationType(), options);
}