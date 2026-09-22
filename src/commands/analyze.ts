import * as vscode from 'vscode';
import { CODE_INPUT_START, constructCategoryPrompt, ITruncationInfo } from '../analysis/prompts';
import { buildParseContext, parseCategoryResponse } from '../analysis/parseResponse';
import { Chunk, codeBudgetFor, planChunks } from '../analysis/chunking';
import { PRIVACY_RULES, PrivacyRule } from '../rules/catalog';
import { PrivacyFinding } from '../findings/schema';
import { StoredFinding } from '../findings/manifest';
import { mergeForStorage, reconcile, ReconcileResult } from '../findings/reconcile';
import { loadStoredFindings, persistFindings } from '../findings/persistence';
import { setFindings } from '../findings/store';
import { updateDecorations } from '../ui/decorations';
import { reportRun } from '../ui/report';

/**
 * How many per-category requests are in flight at once. Kept small so a single
 * Analyze run doesn't burst the language-model quota - with chunking a large
 * file can queue dozens of requests.
 */
const MAX_CONCURRENT_REQUESTS = 3;

interface AnalysisUnit {
    rule: PrivacyRule;
    chunk: Chunk;
}

export function registerAnalyzeCommand(context: vscode.ExtensionContext) {
  const analyzeCommand = vscode.commands.registerTextEditorCommand(
    'priv-audit.analyze',
    async (textEditor: vscode.TextEditor) => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Analyzing code for privacy practices',
          cancellable: true,
        },
        async (progress, cancellationToken) => {
          progress.report({ message: 'Selecting model...' });

          const [model] = await vscode.lm.selectChatModels({
              vendor: 'copilot'
          });

          if (!model) {
              vscode.window.showErrorMessage('priv-audit: no suitable language model found.');
              return;
          }

          if (cancellationToken.isCancellationRequested) {return;}

          const document = textEditor.document;

          progress.report({ message: 'Planning coverage...' });

          // The whole file is analyzed, split into windows that each fit the
          // model's context alongside one detection rule.
          const chunks = await planChunks(
              document,
              codeBudgetFor(model.maxInputTokens),
              text => Promise.resolve(model.countTokens(text, cancellationToken))
          );

          if (chunks.length === 0) {
              vscode.window.showInformationMessage('priv-audit: nothing to analyze in this file.');
              return;
          }

          if (cancellationToken.isCancellationRequested) {return;}

          // Eight requests per chunk would otherwise raise the same warning many
          // times over. Last write wins: prompt-tsx may size an element more
          // than once, and only the final pass reflects what gets sent.
          let truncation: ITruncationInfo | undefined;
          const onTruncated = (info: ITruncationInfo) => { truncation = info; };

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
              if (cancellationToken.isCancellationRequested) {return [];}

              const parseContext = buildParseContext(document, chunk.range);

              try {
                  const messages = await constructCategoryPrompt(model, {
                      rule,
                      document,
                      range: chunk.range,
                      filePath: parseContext.filePath,
                      onTruncated,
                  });

                  if (cancellationToken.isCancellationRequested) {return [];}

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
                  if (cancellationToken.isCancellationRequested) {return [];}
                  console.error(
                      `priv-audit: category ${rule.id} failed on chunk ${chunk.index}/${chunk.total}:`,
                      error
                  );
                  failures.add(rule.id);
                  return [];
              } finally {
                  completed += 1;
                  reportProgress();
              }
          };

          const results = await runWithConcurrency(units, MAX_CONCURRENT_REQUESTS, analyzeUnit);

          if (cancellationToken.isCancellationRequested) {return;}

          progress.report({ message: 'Reconciling with previous findings...' });

          const fresh = results.flat();
          const previous = await loadStoredFindings(document);
          const result = reconcile(fresh, previous);

          setFindings(document.uri, result.findings);
          updateDecorations(textEditor);

          const saved = await persistAnalysis(document, result, previous);

          reportRun(document, result, {
              chunks: chunks.length,
              requests: units.length,
              failedCategories: [...failures],
              truncation,
              saved,
          });
        }
      );
    }
  );

  context.subscriptions.push(analyzeCommand);
}

async function persistAnalysis(
    document: vscode.TextDocument,
    result: ReconcileResult,
    previous: StoredFinding[]
): Promise<boolean> {
    try {
        // Findings the run did not re-observe are retained and stamped resolved,
        // so the manifest keeps the audit trail instead of forgetting them.
        return await persistFindings(document, mergeForStorage(result, previous));
    } catch (error) {
        console.error('priv-audit: could not write the findings manifest:', error);
        vscode.window.showErrorMessage(
            'priv-audit: analysis finished but the manifest could not be saved. See console for details.'
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
            if (index >= items.length) {return;}
            results[index] = await worker(items[index], index);
        }
    });

    await Promise.all(runners);
    return results;
}