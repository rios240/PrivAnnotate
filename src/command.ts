import * as vscode from 'vscode';
import { constructAnalyzePrompt } from './prompts';
import { parseResponse } from './parseResponse';

export function registerAnalyzeCommand(context: vscode.ExtensionContext) {
  const analyzeCommand = vscode.commands.registerTextEditorCommand(
    'priv-audit.analyze',
    async (textEditor: vscode.TextEditor) => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Analyzing code for privacy threats',
          cancellable: true,
        },
        async (progress, cancellationToken) => {
          progress.report({ message: 'Selecting model...' });

          let [model] = await vscode.lm.selectChatModels({
              vendor: 'copilot'
          });

          if (!model) {
              vscode.window.showErrorMessage('priv-audit: no suitable language model found.');
              return;
          }

          if (cancellationToken.isCancellationRequested) return;

          progress.report({ message: 'Building prompt...' });

          const messages = await constructAnalyzePrompt(model, {
              document: textEditor.document,
              range: getVisibleRange(textEditor)
          });

          if (cancellationToken.isCancellationRequested) return;

          progress.report({ message: 'Waiting for response...' });

          try {
              const response = await model.sendRequest(messages, {}, cancellationToken);
              await parseResponse(response, textEditor);
          } catch (error) {
              if (cancellationToken.isCancellationRequested) {
                  // Expected. User clicked cancel, nothing to report.
                  return;
              }
              console.error('Error occurred while sending request:', error);
              vscode.window.showErrorMessage('priv-audit: analysis failed. See console for details.');
          }
        }
      );
    }
  );

  context.subscriptions.push(analyzeCommand);
}

/**
 * Returns a single Range spanning the editor's visible viewport, from the
 * first visible line through the last. If code is folded within that span,
 * its text is still included — this does not exclude folded regions, it
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

