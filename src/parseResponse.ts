import * as vscode from 'vscode';
import { ThreatFinding, addFindings, updateDecorations, nextFindingId } from './misc/decorations';

interface RawThreatResponse {
    threatId: string;
    title: string;
    summary: string;
    location: { startLine: number; endLine: number };
    consequences: string;
    remediation: string;
}

function isRawThreatResponse(value: unknown): value is RawThreatResponse {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;

    if (typeof v.threatId !== 'string') return false;
    if (typeof v.title !== 'string') return false;
    if (typeof v.summary !== 'string') return false;
    if (typeof v.consequences !== 'string') return false;
    if (typeof v.remediation !== 'string') return false;

    if (typeof v.location !== 'object' || v.location === null) return false;
    const loc = v.location as Record<string, unknown>;
    if (typeof loc.startLine !== 'number' || typeof loc.endLine !== 'number') return false;

    return true;
}

/**
 * Defensively strips ```-fencing in case a segment still arrives wrapped
 * (models don't always follow "no fencing" instructions perfectly), so a
 * stray fence doesn't fail JSON.parse for an otherwise valid object.
 */
function cleanSegment(segment: string): string {
    return segment
        .trim()
        .replace(/^```[a-zA-Z]*\s*/, '')
        .replace(/```$/, '')
        .trim();
}

export async function parseResponse(
    response: vscode.LanguageModelChatResponse,
    textEditor: vscode.TextEditor
): Promise<void> {
    let fullText = '';
    for await (const fragment of response.text) {
        fullText += fragment;
    }

    const segments = fullText
        .split('|')
        .map(cleanSegment)
        .filter(segment => segment.length > 0);

    const findings: ThreatFinding[] = [];

    for (const segment of segments) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(segment);
        } catch (error) {
            console.warn('priv-audit: skipping malformed JSON segment:', segment, error);
            continue;
        }

        if (!isRawThreatResponse(parsed)) {
            console.warn('priv-audit: skipping segment that does not match expected schema:', parsed);
            continue;
        }

        if (parsed.threatId === 'N/A') continue;

        findings.push({
            id: nextFindingId(),
            threatId: parsed.threatId,
            title: parsed.title,
            summary: parsed.summary,
            startLine: parsed.location.startLine,
            endLine: parsed.location.endLine,
            consequences: parsed.consequences,
            remediation: parsed.remediation,
        });
    }

    if (findings.length === 0) {
        vscode.window.showInformationMessage('LINDDUN GO analysis: no privacy threats found.');
        return;
    }

    addFindings(textEditor.document, findings);
    updateDecorations(textEditor);
}