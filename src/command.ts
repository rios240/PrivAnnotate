import * as vscode from 'vscode';
import { CODE_INPUT_START, constructCategoryPrompt, ITruncationInfo } from './prompts';
import { buildParseContext, parseCategoryResponse } from './parseResponse';
import { PDC_CARDS, PdcCard } from './pdc/categories';
import { PrivacyFinding } from './pdc/schema';
import { replaceFindingsInRange, updateDecorations } from './misc/decorations';

/**
 * How many of the eight per-category requests are in flight at once. Kept small
 * so a single Analyze run doesn't burst the language-model quota.
 */
const MAX_CONCURRENT_REQUESTS = 3;

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

          if (cancellationToken.isCancellationRequested) return;

          // Snapshot the target once so all eight categories analyze identical
          // input even if the user scrolls while the run is in flight.
          const document = textEditor.document;
          const range = getVisibleRange(textEditor);
          const parseContext = buildParseContext(document, range);

          // Eight requests would otherwise raise the same truncation warning.
          // Last write wins: prompt-tsx may size an element more than once, and
          // only the final pass reflects what actually gets sent.
          let truncation: ITruncationInfo | undefined;
          const onTruncated = (info: ITruncationInfo) => { truncation = info; };

          let completed = 0;
          const failures: string[] = [];
          const reportProgress = () =>
              progress.report({
                  message: `Analyzed ${completed}/${PDC_CARDS.length} categories...`,
              });

          reportProgress();

          const analyzeCategory = async (card: PdcCard): Promise<PrivacyFinding[]> => {
              if (cancellationToken.isCancellationRequested) return [];

              try {
                  const messages = await constructCategoryPrompt(model, {
                      card,
                      document,
                      range,
                      filePath: parseContext.filePath,
                      onTruncated,
                  });

                  if (cancellationToken.isCancellationRequested) return [];

                  // If the instructions alone exhausted the context window, the
                  // code message is pruned away entirely. Sending that costs a
                  // request and can only produce ungrounded findings.
                  if (!containsCodeInput(messages)) {
                      throw new Error(
                          `context window too small to include any code alongside card ${card.id}`
                      );
                  }

                  const response = await model.sendRequest(messages, {}, cancellationToken);
                  return await parseCategoryResponse(response, card, parseContext);
              } catch (error) {
                  if (cancellationToken.isCancellationRequested) return [];
                  console.error(`priv-audit: category ${card.id} failed:`, error);
                  failures.push(card.id);
                  return [];
              } finally {
                  completed += 1;
                  reportProgress();
              }
          };

          const results = await runWithConcurrency(
              PDC_CARDS,
              MAX_CONCURRENT_REQUESTS,
              analyzeCategory
          );

          if (cancellationToken.isCancellationRequested) return;

          const findings = results.flat();

          replaceFindingsInRange(
              document,
              { start: parseContext.rangeStart, end: parseContext.rangeEnd },
              findings
          );
          updateDecorations(textEditor);

          if (truncation) {
              vscode.window.showWarningMessage(
                  `priv-audit: only ${truncation.includedLines} of ${truncation.totalLines} ` +
                  'visible lines fit in the model context; the rest were not analyzed.'
              );
          }

          if (failures.length > 0) {
              vscode.window.showWarningMessage(
                  `priv-audit: ${failures.length} of ${PDC_CARDS.length} categories failed ` +
                  `(${failures.join(', ')}). See console for details.`
              );
          } else if (findings.length === 0) {
              vscode.window.showInformationMessage(
                  'priv-audit: no privacy practices detected in the visible code.'
              );
          }
        }
      );
    }
  );

  context.subscriptions.push(analyzeCommand);
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
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    });

    await Promise.all(runners);
    return results;
}

/**
 * Returns a single Range spanning the editor's visible viewport, from the
 * first visible line through the last. If code is folded within that span,
 * its text is still included - this does not exclude folded regions, it
 * only bounds the range to what's scrolled into view vertically.
 */
export function getVisibleRange(textEditor: vscode.TextEditor): vscode.Range {
    const ranges = textEditor.visibleRanges;

    if (ranges.length === 0) {
        const doc = textEditor.document;
        return new vscode.Range(
            0, 0,
            doc.lineCount - 1,
            doc.lineAt(doc.lineCount - 1).text.length
        );
    }

    const start = ranges.reduce(
        (min, r) => (r.start.isBefore(min) ? r.start : min),
        ranges[0].start
    );
    const end = ranges.reduce(
        (max, r) => (r.end.isAfter(max) ? r.end : max),
        ranges[0].end
    );

    return new vscode.Range(start, end);
}