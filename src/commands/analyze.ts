import * as vscode from 'vscode';
import { CODE_INPUT_START, constructCategoryPrompt, ITruncationInfo } from '../analysis/prompts';
import { buildParseContext, parseCategoryResponse } from '../analysis/parseResponse';
import { Chunk, codeBudgetFor, planChunks } from '../analysis/chunking';
import { PRIVACY_RULES, PrivacyRule } from '../rules/catalog';
import { PrivacyFinding } from '../findings/schema';
import { StoredFinding } from '../findings/manifest';
import { mergeForStorage, reconcile, ReconcileResult } from '../findings/reconcile';
import { loadStoredFindings, persistFindings, relocateAll } from '../findings/persistence';
import { setFindings } from '../findings/store';
import { refreshEditorsFor } from '../ui/decorations';
import { reportRun } from '../ui/report';
import { getSettings } from '../config';

interface AnalysisUnit {
    rule: PrivacyRule;
    chunk: Chunk;
}

/**
 * URIs with an analysis in flight. Two overlapping runs on one file would race
 * on reconcile-then-persist, and the later one would silently discard the
 * earlier one's result after paying for every request.
 */
const inFlight = new Set<string>();

/** Claims `uri` for an analysis run; false when one is already running. */
export function tryBeginAnalysis(uri: vscode.Uri): boolean {
    const key = uri.toString();
    if (inFlight.has(key)) {
        return false;
    }
    inFlight.add(key);
    return true;
}

export function endAnalysis(uri: vscode.Uri): void {
    inFlight.delete(uri.toString());
}

export function registerAnalyzeCommand(context: vscode.ExtensionContext) {
    const analyzeCommand = vscode.commands.registerTextEditorCommand(
        'priv-annotate.analyze',
        async (textEditor: vscode.TextEditor) => {
            const uri = textEditor.document.uri;
            if (!tryBeginAnalysis(uri)) {
                vscode.window.showInformationMessage('priv-annotate: this file is already being analyzed.');
                return;
            }

            try {
                await analyze(textEditor);
            } finally {
                endAnalysis(uri);
            }
        }
    );

    context.subscriptions.push(analyzeCommand);
}

async function analyze(textEditor: vscode.TextEditor): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing code for privacy practices',
            cancellable: true,
        },
        async (progress, cancellationToken) => {
            progress.report({ message: 'Selecting model...' });

            // Read once per run, so a settings change mid-run cannot mix configurations.
            const settings = getSettings();
            const [model] = await vscode.lm.selectChatModels({
                vendor: settings.modelVendor,
                ...(settings.modelFamily ? { family: settings.modelFamily } : {}),
                ...(settings.modelId ? { id: settings.modelId } : {}),
            });

            if (!model) {
                const wanted = settings.modelFamily
                    ? `${settings.modelVendor}/${settings.modelFamily}`
                    : settings.modelVendor;
                vscode.window.showErrorMessage(
                    `priv-annotate: no language model found for "${wanted}". Check the privAnnotate.model settings.`
                );
                return;
            }

            if (cancellationToken.isCancellationRequested) {
                return;
            }

            const document = textEditor.document;
            // Findings are located by line number against the text as it was
            // when each chunk was read; an edit mid-run moves the code under them.
            const startVersion = document.version;

            progress.report({ message: 'Planning coverage...' });

            // The whole file is analyzed, split into windows that each fit the
            // model's context alongside one detection rule.
            const chunks = await planChunks(
                document,
                codeBudgetFor(model.maxInputTokens),
                text => Promise.resolve(model.countTokens(text, cancellationToken)),
                settings.chunkOverlapLines
            );

            if (chunks.length === 0) {
                vscode.window.showInformationMessage('priv-annotate: nothing to analyze in this file.');
                return;
            }

            if (cancellationToken.isCancellationRequested) {
                return;
            }

            // Eight requests per chunk would otherwise raise the same warning many
            // times over. Last write wins: prompt-tsx may size an element more
            // than once, and only the final pass reflects what gets sent.
            let truncation: ITruncationInfo | undefined;
            const onTruncated = (info: ITruncationInfo) => {
                truncation = info;
            };

            const units: AnalysisUnit[] = chunks.flatMap(chunk =>
                PRIVACY_RULES.map(rule => ({ rule, chunk }))
            );

            let completed = 0;
            const failures = new Set<string>();
            const reportProgress = () =>
                progress.report({
                    message:
                        chunks.length > 1
                            ? `${completed}/${units.length} requests (${chunks.length} chunks)...`
                            : `Analyzed ${completed}/${units.length} categories...`,
                });

            reportProgress();

            const analyzeUnit = async ({ rule, chunk }: AnalysisUnit): Promise<PrivacyFinding[]> => {
                if (cancellationToken.isCancellationRequested) {
                    return [];
                }

                const parseContext = buildParseContext(document, chunk.range);

                try {
                    const messages = await constructCategoryPrompt(model, {
                        rule,
                        document,
                        range: chunk.range,
                        filePath: parseContext.filePath,
                        onTruncated,
                    });

                    if (cancellationToken.isCancellationRequested) {
                        return [];
                    }

                    // If the instructions alone exhausted the context window, the
                    // code message is pruned away entirely. Sending that costs a
                    // request and can only produce ungrounded findings.
                    if (!containsCodeInput(messages)) {
                        throw new Error(
                            `context window too small to include any code alongside rule ${rule.id}`
                        );
                    }

                    const response = await model.sendRequest(messages, {}, cancellationToken);
                    return await parseCategoryResponse(response, rule, parseContext);
                } catch (error) {
                    if (cancellationToken.isCancellationRequested) {
                        return [];
                    }
                    console.error(
                        `priv-annotate: category ${rule.id} failed on chunk ${chunk.index}/${chunk.total}:`,
                        error
                    );
                    failures.add(rule.id);
                    return [];
                } finally {
                    completed += 1;
                    reportProgress();
                }
            };

            const results = await runWithConcurrency(units, settings.maxConcurrentRequests, analyzeUnit);

            if (cancellationToken.isCancellationRequested) {
                return;
            }

            progress.report({ message: 'Reconciling with previous findings...' });

            // Re-anchor before reconciling: fingerprints ignore line numbers, so
            // identity is unaffected, and every downstream view gets current lines.
            const editedDuringRun = document.version !== startVersion;
            const fresh = editedDuringRun ? relocateAll(document, results.flat()) : results.flat();
            const previous = await loadStoredFindings(document);
            const result = reconcile(fresh, previous);

            setFindings(document.uri, result.findings);
            // The originating editor may have been closed mid-run; repaint by URI.
            refreshEditorsFor(document.uri);

            const saved = await persistAnalysis(document, result, previous);

            reportRun(document, result, {
                chunks: chunks.length,
                requests: units.length,
                failedCategories: [...failures],
                truncation,
                saved,
                editedDuringRun,
            });
        }
    );
}

async function persistAnalysis(
    document: vscode.TextDocument,
    result: ReconcileResult,
    previous: StoredFinding[]
): Promise<boolean> {
    try {
        // Findings the run did not re-observe are retained and stamped resolved,
        // so the manifest keeps the annotate trail instead of forgetting them.
        return await persistFindings(document, mergeForStorage(result, previous));
    } catch (error) {
        console.error('priv-annotate: could not write the findings manifest:', error);
        vscode.window.showErrorMessage(
            'priv-annotate: analysis finished but the manifest could not be saved. See console for details.'
        );
        return false;
    }
}

/** True when the rendered prompt still carries the code under analysis. */
export function containsCodeInput(messages: readonly vscode.LanguageModelChatMessage[]): boolean {
    return messages.some(message =>
        message.content.some(
            part => part instanceof vscode.LanguageModelTextPart && part.value.includes(CODE_INPUT_START)
        )
    );
}

/**
 * Maps `worker` over `items` with at most `limit` calls in flight, preserving
 * input order in the results. `worker` is expected to handle its own errors;
 * a rejection here rejects the whole run.
 */
export async function runWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) {
                return;
            }
            results[index] = await worker(items[index], index);
        }
    });

    await Promise.all(runners);
    return results;
}
