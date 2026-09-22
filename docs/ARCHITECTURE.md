# PrivAudit - Code Documentation

A module-by-module reference for the extension's source. For what PrivAudit does and how
to run it, see the [README](../README.md).

Everything under `src/` compiles with `tsc -p ./` to `out/`, which is what
`package.json`'s `main` (`./out/extension.js`) loads.

---

## Contents

1. [Data flow](#1-data-flow)
2. [Source map](#2-source-map)
3. [Core types](#3-core-types) - `src/pdc/schema.ts`
4. [The card deck](#4-the-card-deck) - `src/pdc/categories.ts`
5. [Prompt construction](#5-prompt-construction) - `src/prompts.tsx`
6. [Chunking](#6-chunking) - `src/chunking.ts`
7. [The analyze command](#7-the-analyze-command) - `src/command.ts`
8. [Response parsing and grounding](#8-response-parsing-and-grounding) - `src/parseResponse.ts`
9. [Identity: fingerprints](#9-identity-fingerprints) - `src/findings/fingerprint.ts`
10. [Reconciliation and relocation](#10-reconciliation-and-relocation) - `src/findings/reconcile.ts`
11. [The manifest](#11-the-manifest) - `src/findings/manifest.ts`
12. [Decisions](#12-decisions) - `src/decisions.ts`
13. [Decorations and the in-memory store](#13-decorations-and-the-in-memory-store) - `src/misc/decorations.ts`
14. [Reporting](#14-reporting) - `src/report.ts`
15. [Activation and lifecycle](#15-activation-and-lifecycle) - `src/extension.ts`
16. [Tests](#16-tests) - `src/test/`
17. [Design decisions worth knowing](#17-design-decisions-worth-knowing)
18. [Extending the extension](#18-extending-the-extension)

---

## 1. Data flow

```
                   priv-audit.analyze (src/command.ts)
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
   vscode.lm.selectChatModels        planChunks()  (src/chunking.ts)
        vendor: 'copilot'            file --> overlapping line windows
              │                                   │
              └──────────────┬────────────────────┘
                             ▼
                units = chunks x PDC_CARDS          (8 cards)
                             │
                runWithConcurrency(limit 3)
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
 constructCategoryPrompt (src/prompts.tsx)  ── renderPrompt / prompt-tsx
        │  prelude + one card + output contract + numbered code
        ▼
 model.sendRequest --> streamed text
        │
        ▼
 parseCategoryResponse (src/parseResponse.ts)
        │  extract JSON array --> validate --> clamp range --> ground excerpt
        ▼
   PrivacyFinding[]  (fingerprinted, status 'undecided')
        │
        ▼
 reconcile(fresh, stored)  (src/findings/reconcile.ts)
        │  match by fingerprint --> carry status/firstSeen/decidedAt forward
        ├──────────────► setFindings + updateDecorations (src/misc/decorations.ts)
        ├──────────────► persistFindings + mergeForStorage --> .privaudit/findings.json
        └──────────────► reportRun (src/report.ts) --> output channel + notification
```

On a later session, the same `PrivacyFinding[]` arrives from the other direction:
`loadFindingsFor` reads the manifest, `hydrate` relocates each stored span against the
current text, and `updateDecorations` paints it.

## 2. Source map

| File | Lines | Responsibility |
| --- | ---: | --- |
| `src/extension.ts` | 78 | Activation, session restore, manifest watcher, disposal |
| `src/command.ts` | 218 | The `analyze` command: model selection, fan-out, concurrency, orchestration |
| `src/chunking.ts` | 126 | Splitting a file into windows that fit the context budget |
| `src/prompts.tsx` | 341 | prompt-tsx elements: prelude, card, output contract, code task |
| `src/parseResponse.ts` | 186 | Model text --> validated, grounded `PrivacyFinding[]` |
| `src/decisions.ts` | 219 | Accept/reject/undo, view-toggle and reset commands, hydration, persistence entry point |
| `src/report.ts` | 128 | Output channel report and summary notification |
| `src/pdc/categories.ts` | 632 | The eight detection cards (framework content) |
| `src/pdc/schema.ts` | 156 | Finding types, type guards, the JSON schema sent to the model |
| `src/findings/fingerprint.ts` | 40 | Excerpt normalization, fingerprint, relocation anchor |
| `src/findings/reconcile.ts` | 157 | Fresh-vs-stored merge, storage merge, span relocation |
| `src/findings/manifest.ts` | 258 | Manifest types, validation, (de)serialization, `ManifestStore` |
| `src/misc/decorations.ts` | 281 | In-memory finding store, decoration types, hover markdown |
| `src/test/` | ~1550 | Mocha TDD suites plus the `vscode` stub |

## 3. Core types

`src/pdc/schema.ts` defines the shape everything else passes around.

```ts
type Confidence    = 'high' | 'medium' | 'low';
type FindingStatus = 'undecided' | 'accepted' | 'rejected';
interface LineRange { start: number; end: number }   // 1-based, inclusive
```

`LineRange` is **1-based** throughout the finding pipeline, matching the line numbers
printed into the prompt. VS Code's own `Position`/`Range` are 0-based, so conversions
happen exactly at the boundaries - `buildParseContext`, `CodeTaskElement.prepare`, and
`updateDecorations`.

### `PrivacyFinding`

The runtime form: a validated, grounded finding ready to decorate an editor.

| Field | Notes |
| --- | --- |
| `id` | Session-local, from `nextFindingId()`. Never comes from the model. |
| `fingerprint` | Stable identity across runs and sessions. See [§9](#9-identity-fingerprints). |
| `category` | Always forced to the requesting card's category, never the model's claim. |
| `file` | Workspace-relative; absent for untitled documents. |
| `lineRange` | Clamped to the analyzed range. |
| `excerpt` | Verbatim source, `N| ` prefix stripped by the model (and tolerated if not). |
| `evidence` | One or two sentences naming the concrete call/field/branch. |
| `confidence` | Downgraded one step if the excerpt is not found in its claimed span. |
| `reasoning` | Optional model reasoning steps, rendered in the hover. |
| `crossReferences` | Other categories this same span matches. |
| `status` | `undecided` until the user decides. |
| `firstSeen` / `lastSeen` | ISO timestamps; `firstSeen` is preserved across re-runs. |
| `decidedAt` | Set when the status changes away from `undecided`. |
| `resolvedAt` | Set when a run no longer observes the finding; keeps the audit trail. |
| `stale` | Set during hydration when the stored span could not be re-located. |

### `RawFinding` and `isRawFinding`

`RawFinding` is the finding *as the model emits it*. `isRawFinding` is a hand-written
type guard: category must be a known enum name, `excerpt`/`evidence` must be strings,
`confidence` must be one of the three levels, `lineRange.start`/`.end` must be finite
numbers, and the optional fields must be strings or string arrays. Anything else is
skipped, element by element - one bad object does not discard the rest of the array.

### `FINDING_JSON_SCHEMA`

A `const` object rendered verbatim into the prompt's output contract by
`OutputFormatElement`. Keeping the schema next to the parser is deliberate: the contract
the model is shown and the contract the parser enforces come from the same file and
cannot drift apart.

## 4. The card deck

`src/pdc/categories.ts` is framework content, it exports:

* `CATEGORY_NAMES` / `CategoryName` / `isCategoryName` - the eight-category enum.
* `PdcCard` - `{ id, category, displayName, baseDescription, chainOfThought,
  elicitationQuestions, examples, crossReferences? }`.
* `CardExample` - `{ kind: 'positive' | 'negative', label, language, code, reasoning,
  conclusion }`. Every card carries at least one of each kind; the negative exemplars are
  what sharpen the detection boundary.
* `PDC_CARDS` - the deck, in card-ID order.
* `CATEGORY_BY_CARD_ID` - `'TP-02' --> 'THIRD_PARTY_SHARING_COLLECTION'`, used by the
  parser when a model answers with a card ID where the schema asked for the enum.
* `getCard(category)` - reverse lookup; throws for an unknown category.

Card text is transcribed from the framework document and is the single source of truth
for prompt content - `src/prompts.tsx` renders these fields directly, so editing a card
changes the prompt with no code change.

## 5. Prompt construction

`src/prompts.tsx` builds one request's prompt with
[`@vscode/prompt-tsx`](https://github.com/microsoft/vscode-prompt-tsx). The JSX factory
is configured in `tsconfig.json` (`jsxFactory: vscpp`, `jsxFragmentFactory: vscppf`).

Four elements, assembled by `CategoryAnalysisPrompt`:

| Element | Message | Priority | Content |
| --- | --- | ---: | --- |
| `OutputFormatElement` | assistant | 100 | Response contract + `FINDING_JSON_SCHEMA` + "respond `[]` if nothing matches" |
| `CodeTaskElement` | user | 95 (`flexGrow: 1`) | Task header, file path, line span, and the numbered code between markers |
| `PreludeElement` | assistant | 90 | Role, framework context, single-card scope, grounding rules |
| `CategoryCardElement` | assistant | 85 | The one card: description, reasoning guidance, elicitation questions, worked examples, related categories |

**Priorities are a survival order under a tight budget**, most indispensable first:
without the output contract the reply is unparseable; without the code there is nothing
to analyze; the prelude and the card's examples are the affordable things to lose.
`flexGrow: 1` lets the code claim whatever budget the instructions leave behind.

Instruction content sits in `AssistantMessage` rather than a system message because
`vscode.LanguageModelChatMessage` has only user and assistant roles - the historical
cause of the "unknown context" bug noted in the changelog.

### `CODE_INPUT_START` / `CODE_INPUT_END`

The code under analysis is fenced with `<<<CODE_INPUT>>>` / `<<<END_CODE_INPUT>>>`
rather than backticks, so code that itself contains markdown fences cannot break the
boundary. `command.ts` also uses `CODE_INPUT_START` as the marker for
`containsCodeInput`.

### `CodeTaskElement.prepare`

Runs before render and does the token accounting:

1. Take the requested range (default: the whole document).
2. Convert to 1-based numbering and prefix every line `N| `, right-aligned to the widest
   line number.
3. Subtract the fixed cost of the header and footer from `sizing.tokenBudget`.
4. Add lines while they fit; stop at the first one that does not.
5. If anything was dropped, call `onTruncated({ totalLines, includedLines })` and say so
   in the rendered "LINES SHOWN" header.

`constructCategoryPrompt(model, props)` renders the tree with
`modelMaxPromptTokens: model.maxInputTokens` and returns the message array.

> **Note.** prompt-tsx may size an element more than once, so `onTruncated` can fire
> repeatedly for a single render. `command.ts` keeps only the last value.

## 6. Chunking

`src/chunking.ts` guarantees whole-file coverage without exceeding the context window.

Constants:

| Constant | Value | Why |
| --- | ---: | --- |
| `CHUNK_OVERLAP_LINES` | 20 | A practice straddling a boundary stays intact in the later chunk; duplicates are collapsed by fingerprint later. |
| `INSTRUCTION_RESERVE_TOKENS` | 5000 | Room for prelude + contract + the largest card (`AI-08` renders at roughly 3k). Over-reserving costs a chunk; under-reserving silently costs code lines. |
| `MIN_CHUNK_LINES` | 20 | Never split below this, however tight the budget. |
| `MIN_CODE_BUDGET_TOKENS` | 500 | A tiny context window still yields a plan. |
| `OVERLAP_HEADROOM` | 0.9 | Chunks are sized to 90% of budget so prepending overlap stays inside the real budget rather than relying on prompt-tsx to trim - a trim would drop end-of-chunk lines no other chunk covers. |
| `MAX_SPLIT_DEPTH` | 12 | Terminates on a file of enormous single lines. |

`codeBudgetFor(maxInputTokens)` --> `max(500, maxInputTokens − 5000)`.

`splitToFit` measures the whole window first - the common case is that a file fits in one
request, and that costs a single `countTokens` call - and only halves and re-measures
when it does not. Call count therefore scales with the number of chunks, not lines.

`planChunks(document, budget, countTokens)` returns `Chunk[]` of
`{ range, index, total }` (`index` is 1-based, for progress messages). Every line appears
in at least one chunk; each chunk after the first is grown backwards by
`CHUNK_OVERLAP_LINES`.

`countTokens` is injected as `(text) => Promise<number>` rather than taken from the
model, which is what lets `chunking.test.ts` drive the planner with a synthetic counter.

## 7. The analyze command

`src/command.ts` - `registerAnalyzeCommand(context)` registers `priv-audit.analyze` as a
**text editor** command, so it only runs with an active editor.

The run, inside a cancellable `withProgress` notification:

1. **Select a model** - `vscode.lm.selectChatModels({ vendor: 'copilot' })`, first
   result. None --> error message, stop.
2. **Plan coverage** - `planChunks` with `codeBudgetFor(model.maxInputTokens)` and the
   model's own `countTokens`. Zero chunks --> informational message, stop.
3. **Fan out** - `units = chunks.flatMap(chunk => PDC_CARDS.map(card => ({ card, chunk })))`.
4. **Run** - `runWithConcurrency(units, MAX_CONCURRENT_REQUESTS /* 3 */, analyzeUnit)`.
5. **Reconcile** - `reconcile(results.flat(), await loadStoredFindings(document))`.
6. **Paint** - `setFindings` + `updateDecorations`.
7. **Persist** - `persistFindings(document, mergeForStorage(result, previous))`.
8. **Report** - `reportRun` with chunk count, request count, failed categories,
   truncation info, and whether the save succeeded.

### `analyzeUnit`

Per (card, chunk): build a parse context, render the prompt, **check
`containsCodeInput`**, send, parse. If the instructions alone exhausted the context
window the code message is pruned away entirely - sending that would cost a request and
could only produce ungrounded findings, so it throws instead.

Errors are caught per unit: the card ID is added to a `failures` set and the unit yields
no findings. One category failing never sinks the other seven. The `finally` block always
advances the progress counter.

Cancellation is checked before model selection, after planning, before and after each
request, and before reconciliation.

### `runWithConcurrency<T, R>`

A small worker-pool `map`: `min(limit, items.length)` runners pull from a shared index
until exhausted, writing into a pre-sized results array so **input order is preserved
regardless of completion order**. The worker is expected to handle its own errors - a
rejection here rejects the whole run.

### `containsCodeInput(messages)`

Exported for testing. True when some rendered message part is a
`LanguageModelTextPart` containing `CODE_INPUT_START`.

## 8. Response parsing and grounding

`src/parseResponse.ts` turns one category's response text into findings. **It never
throws**: garbage from one category yields an empty array.

### `ParseContext`

`{ lineText(line), rangeStart, rangeEnd, filePath? }` - a minimal view of the analyzed
region, built by `buildParseContext(document, range)`, converting VS Code's 0-based
positions to the 1-based numbers the model was shown.

### `extractJsonArray(text)`

Trims, strips a leading ` ```lang ` fence and a trailing fence, then slices from the
first `[` to the last `]`. Models do not always honor "no fencing, no prose", and an
otherwise valid array should not be thrown away over its wrapper.

### `parseCategoryFindings(text, card, ctx)`

Extract --> `JSON.parse` --> must be an array --> per element `isRawFinding` --> `toFinding`.
Every rejection path logs a `console.warn` prefixed with the card ID.

### `toFinding` - the validation gauntlet

1. **Round** the line numbers.
2. **Drop** an inverted range (`start > end`).
3. **Drop** a range entirely outside the analyzed chunk.
4. **Clamp** a range that overhangs the chunk.
5. **Ground** the excerpt: take its first non-empty line, strip any `N| ` prefix,
   collapse whitespace, and look for it as a substring of some source line in the claimed
   span. Not found --> `downgradeConfidence`, with a warning. The finding is kept: an
   ungrounded excerpt is a *signal*, not proof of nonsense.
6. **Resolve cross-references** via `resolveCategory` (enum name or card ID), dropping
   junk, self-references, and duplicates.
7. **Force the category** to `card.category`. One request, one lane - the card decides,
   not the model.
8. Assign a fresh `id`, compute the fingerprint, and stamp `status: 'undecided'` with
   `firstSeen`/`lastSeen` - reconciliation overwrites these when the finding is already
   known.

`parseCategoryResponse(response, card, ctx)` drains the streamed
`LanguageModelChatResponse` into a string, then delegates to `parseCategoryFindings`.

## 9. Identity: fingerprints

`src/findings/fingerprint.ts` - small, and load-bearing for everything persistent.

* `normalizeExcerpt(excerpt)` - per line: strip a leading `N| ` prefix, collapse
  whitespace runs, trim, drop blanks. Reindentation and retabbing therefore do not change
  identity; the actual tokens still do.
* `computeFingerprint(category, excerpt)` - `sha256(category + '\n' + normalized)`,
  first 16 hex chars.
* `excerptAnchor(excerpt)` - the first non-empty normalized line, used to relocate a
  span.

**Line numbers are deliberately excluded.** The same practice moves up and down a file as
it is edited; a fingerprint that moved with it would make every re-run look like an
entirely new set of findings, discarding the user's accept/reject decisions.

## 10. Reconciliation and relocation

`src/findings/reconcile.ts`. Pure functions over a `TextSource`
(`{ lineCount, lineAt(line) }`, 1-based) rather than `vscode.TextDocument`, which keeps
the module testable outside VS Code.

### `reconcile(fresh, stored, now?)` --> `ReconcileResult`

Matching is by fingerprint. **Line ranges, evidence, and confidence always come from the
fresh run; status and provenance always come from the manifest.**

| Bucket | Meaning |
| --- | --- |
| `findings` | Everything to show and persist |
| `added` | First seen in this run |
| `persisted` | Known and found again, not rejected |
| `suppressed` | Known, found again, previously rejected - hidden without re-triage |
| `resolved` | In the manifest, not found by this run, not already resolved |
| `reopened` | Found again after previously being stamped `resolvedAt` |

A `seen` set collapses the same span surfaced twice through overlapping chunks, and a
reopened finding has its `resolvedAt` cleared.

### `mergeForStorage(result, stored, now?)`

Returns what the manifest should hold: this run's findings, plus every stored entry the
run did **not** re-observe, retained with `resolvedAt` stamped (an existing `resolvedAt`
is preserved rather than restamped). Nothing is ever silently forgotten.

### `relocate(source, excerpt, storedRange)`

Between sessions the file may have been edited, so stored line numbers drift.

1. Clamp the stored range to the current line count.
2. No usable anchor --> `{ clamped, stale: true }`.
3. Anchor already matches at the start line --> done, not stale. (The common case, and
   cheaper than scanning.)
4. Otherwise scan the file for lines matching the anchor and take the candidate
   **nearest the remembered position**, preserving the span's height.
5. No match anywhere --> `{ clamped, stale: true }` - reported as stale rather than
   decorating arbitrary lines.

## 11. The manifest

`src/findings/manifest.ts`. On-disk format at `.privaudit/findings.json`
(`MANIFEST_DIR` / `MANIFEST_FILE`), `MANIFEST_VERSION = 1`.

```ts
interface Manifest {
  version: number;
  files: Record<string /* workspace-relative, POSIX separators */, ManifestFileEntry>;
}
interface ManifestFileEntry { lastAnalyzedAt: string; findings: StoredFinding[] }
```

`StoredFinding` is `PrivacyFinding` minus the session-local `id`, the `file` path (the
entry key carries it), and `stale` (recomputed on load). `toStoredFinding` does the
projection.

### Validation

The manifest is a plain file a user may hand-edit or a merge tool may mangle, so it is
validated rather than trusted:

* `isStoredFinding` checks every field the extension depends on.
* `parseManifest` throws on a non-object root, a `version` mismatch, or a missing `files`
  object; within a valid file it **drops only the entries that are actually malformed**
  and keeps the rest.
* `ManifestStore.load` catches everything, logging unless the error is a plain
  file-not-found, and falls back to an empty manifest.

### `serializeManifest`

Sorts file keys alphabetically and findings by start line then fingerprint, and emits
two-space JSON with a trailing newline - so the file diffs cleanly when committed
alongside code.

### `ManifestStore`

One instance is exported as `manifestStore`.

* **Caches** the parsed manifest per workspace folder.
* **Serializes writes per folder** through a promise chain: an analysis run finishes
  eight categories at once and accept/reject clicks can land while a save is in flight,
  so overlapping read-modify-write cycles would otherwise lose decisions. The chain is
  kept alive with `.catch(() => undefined)` so one failure does not block later writes.
* `update(folder, mutate)` - load, mutate, write, re-cache.
* `reset(folder)` - delete the manifest file (a missing file is fine) and cache an empty
  manifest. It goes through the same per-folder queue as `update`, so a decision write
  already in flight lands first and cannot resurrect the file afterwards.
* `invalidate(folder?)` - drop cached state so the next load re-reads from disk; used by
  the file watcher.

### `locate(document)`

`{ folder, path }` or `undefined` for untitled and out-of-workspace documents - which is
exactly the "cannot be persisted" case surfaced in the report as
*"findings were not persisted"*.

## 12. Decisions

`src/decisions.ts` owns the accept/reject lifecycle.

* `textSourceFor(document)` - adapts a `TextDocument` to `TextSource`.
* `hydrate(document, stored)` - maps stored findings to runtime findings, relocating each
  span and flagging staleness.
* `loadFindingsFor(document)` - manifest --> `hydrate` --> `setFindings`. Returns false when
  the document has no manifest entry, and in that case also clears the document's
  in-memory findings - so a manifest that was reset, deleted, or reverted stops
  decorating the editor. Untitled and out-of-workspace documents are left alone.
* `persistFindings(document, findings)` - replaces the file's entry wholesale and stamps
  `lastAnalyzedAt`. Returns false when the document cannot be located in a workspace.
* `registerDecisionCommands(context)` - registers `acceptFinding`, `rejectFinding`,
  `clearDecision`, `toggleRejected`, `toggleFindings`, and `resetManifest`.
* `resetManifest()` - behind a modal confirmation, calls `ManifestStore.reset` for every
  workspace folder (settling all of them, so one failure does not leave the rest
  half-reset), then `clearAllFindings()` and `repaintVisibleEditors()`.

`setStatus(args, status)` is the shared implementation. Arguments arrive from a hover's
`command:` link as `{ uri, fingerprint }` and are validated by `isDecisionArgs`. It
updates the in-memory finding, **repaints immediately** (persisting is not something the
user should wait on), then writes the status and `decidedAt` into the manifest,
warning if the file lives outside a workspace folder.

## 13. Decorations and the in-memory store

`src/misc/decorations.ts` holds both the per-document finding store and all rendering.

### Store

`findingsByDocument: Map<string /* uri */, PrivacyFinding[]>`, with `setFindings`
(replaces wholesale), `getFindings`, `getFinding(uri, fingerprint)`, `clearFindings`,
`clearAllFindings` (every document, used by reset), and the monotonic `nextFindingId()`.

### Decoration types

One `TextEditorDecorationType` per status, created lazily and disposed on deactivation:

| Status | Background | Overview ruler | Badge |
| --- | --- | --- | --- |
| `undecided` | orange 12% | orange, right | `⚠` |
| `accepted` | blue 13% | blue, right | `✔` |
| `rejected` | grey 8% | - | `✖` |

`showRejected` (module state, toggled by `priv-audit.toggleRejected`) gates whether
rejected findings are painted at all. They are hidden by default - that is the point of
rejecting one - and the toggle exists so a mistaken rejection is reversible from the
editor rather than only by hand-editing the manifest.

`showFindings` (toggled by `priv-audit.toggleFindings`) is the master switch above it:
while off, no status is painted at all. It is a view preference only - the store and
manifest are untouched, and turning it back on restores exactly what was painted, with
rejected findings still following `showRejected`. Both flags are applied in one place,
`visibleFindings(findings, status)`. `repaintVisibleEditors()` repaints every visible
editor after either toggle or a reset.

### `updateDecorations(textEditor)`

Recomputes from the full store and applies in one shot per status -
`setDecorations` always replaces the entire set for a type, so recomputing from scratch
is correct.

For each status: take `visibleFindings(findings, status)` (that status, excluding
`resolvedAt` entries, subject to both view toggles - a hidden status still gets an empty
`setDecorations` call, which is what clears it), merge overlapping
spans with `mergeOverlappingFindings` (sort by start, then a standard interval merge with
a running group end), and emit one `DecorationOption` per group with a range, a hover, and
an `after` badge. The badge is the card ID for a single finding, or a count for a group;
a group whose highest confidence is `low` is labelled `(low confidence)` in a dimmer
colour.

### `buildHoverMessage(uri, group)`

A trusted `MarkdownString` (`isTrusted = true` is required for `command:` links to be
clickable), one block per finding separated by rules: **card ID + display name +
confidence**, the evidence sentence, numbered reasoning steps, *Also matches:*
cross-references, *First seen:*, a staleness warning, and the decision links.
`decisionLinks` shows Accept/Reject for an undecided finding and the current state plus
the inverse action and Undo otherwise.

`refreshEditorsFor(uri)` repaints every visible editor showing that URI - split views
included.

## 14. Reporting

`src/report.ts` owns the lazily created `PrivAudit` output channel.

`reportRun(document, result, context)` writes a timestamped header with the request and
chunk counts, then a section per non-empty bucket - **New**, **Still present**,
**Suppressed (previously rejected)**, **Reopened (previously resolved)**, **No longer
found** - each line rendered as `[CARD-ID] L12-18 (high) - evidence`. It then appends
warnings for truncation, failed categories, and findings that could not be persisted.

`showSummary` raises a one-line notification (a warning when any category failed,
otherwise information) with a **Show report** button that reveals the channel.
`registerReportCommand` wires `priv-audit.showReport` to the same reveal;
`disposeReport` disposes the channel.

The point of the previous-vs-current diff is that a re-run says *what changed* rather
than just replacing the annotations.

## 15. Activation and lifecycle

`src/extension.ts`. Activation is `onStartupFinished` (see `package.json`), so restored
findings are on screen without the user running anything.

`activate(context)`:

1. Registers the analyze, decision, and report commands.
2. Restores findings for every already-visible editor.
3. Subscribes to `onDidChangeVisibleTextEditors` (restore newly shown editors),
   `onDidCloseTextDocument` (drop the hydration marker), the manifest watcher, and
   disposal hooks for decorations and the output channel.

`hydratedAt: Map<uriString, documentVersion>` records the document version each URI's
findings were last located against. Stored spans are anchored to text, so an edit
invalidates them; repainting without re-locating would put decorations on lines the code
has since moved off. `restore(editor)` repaints when the version is unchanged and
re-hydrates otherwise.

`watchManifest()` creates a `FileSystemWatcher` on `**/.privaudit/findings.json`; on
create, change, or delete it invalidates the store cache, clears `hydratedAt`, and
re-restores every visible editor - so a colleague's commit pulled in, or a hand-edited
decision, shows up without a reload.

`deactivate()` is a no-op; everything disposable is in `context.subscriptions`.

## 16. Tests

Mocha's **TDD interface** (`suite`/`test`), compiled to `out/test/` and run two ways:

```bash
npm test          # @vscode/test-cli --> real Extension Development Host
npm run test:unit # mocha --ui tdd --require ./out/test/stub/register.js
```

`src/test/stub/register.ts` patches `Module._load` to serve
`src/test/stub/vscodeStub.ts` for `require('vscode')`. The stub implements only the API
surface the extension and prompt-tsx actually touch (`Position`, `Range`, `Uri`,
message/part classes, a minimal `workspace`/`window`); anything richer belongs in the
integration run. It is *not* loaded under `npm test`, where the host injects the real
module.

| Suite | Covers |
| --- | --- |
| `categories.test.ts` | Deck integrity: eight categories, valid enums, required prompt fields, a positive and a negative exemplar per card, cross-references pointing at real and other cards, `getCard` / `CATEGORY_BY_CARD_ID` round-trips |
| `chunking.test.ts` | Budget arithmetic, single-chunk fit, splitting, full coverage, overlap, per-chunk budget, termination on very long lines, single-line files |
| `command.test.ts` | `runWithConcurrency` (limit respected, order preserved, each item once, limit > items, an error-swallowing worker), the finding store including `clearAllFindings`, and `visibleFindings` under both view toggles |
| `parseResponse.test.ts` | `extractJsonArray` (bare, fenced, buried in prose, absent) and the full validation gauntlet including category forcing, range clamping, grounding downgrade, and cross-reference filtering |
| `findings.test.ts` | Fingerprints, `reconcile`, `mergeForStorage`, `relocate`, manifest serialization and validation |
| `manifestStore.test.ts` | `ManifestStore.reset` (deletes the file, tolerates a missing one, runs after a queued write), the `resetManifest` command (cancel keeps everything, confirm wipes file and store), and `loadFindingsFor` clearing findings with no manifest entry. Uses the stub's in-memory file system, so it is skipped under `npm test` |
| `prompts.test.ts` | Exactly one card rendered, card content present, both exemplars, the code fence with 1-based numbering, partial-range numbering, the output contract, optional file path, truncation reporting, code surviving a tight budget, and `containsCodeInput` |

90 tests pass under `npm run test:unit`.

## 17. Design decisions worth knowing

**One card per request.** Eight requests per chunk costs more than one combined prompt,
but each card gets the full context window, a failure is isolated to one category, and
the model is never asked to juggle eight taxonomies at once. `command.ts` enforces the
"one request, one lane" rule by overwriting the model's `category` with the card's.

**Grounding downgrades, it does not delete.** An excerpt that matches nothing in its own
line range is the signature of a hallucinated or misplaced finding - but the model may
also have lightly reformatted real code. It costs a confidence step, and the user
decides.

**Fingerprints over line numbers.** The whole persistence story depends on identity
surviving edits; see [§9](#9-identity-fingerprints).

**Nothing is deleted.** Rejected findings stay in the manifest so a later run does not
re-surface the same false positive; unobserved findings are stamped `resolvedAt` rather
than dropped. The manifest is an audit trail, not a cache.

**The manifest is untrusted input.** It is a plain file that gets committed, merged, and
occasionally hand-edited, so every read path validates.

**Immediate paint, deferred persist.** Decision commands repaint before awaiting the
write; the user never waits on disk.

**Testability by injection.** `planChunks` takes a `countTokens` function, `reconcile`
and `relocate` take a `TextSource`. That is what lets the bulk of the logic run in plain
Node against a stub.

## 18. Extending the extension

**Add or edit a detection category.** Add the enum name to `CATEGORY_NAMES` and a card to
`PDC_CARDS` in `src/pdc/categories.ts` - with at least one positive and one negative
exemplar, and cross-references pointing at real, other cards. Nothing else needs to
change: prompts render from the card, the parser validates against the enum, and
`categories.test.ts` will check the invariants. Note that request count is
`chunks x cards`, and that `categories.test.ts` asserts a deck of exactly eight.

**Change a model or vendor.** `vscode.lm.selectChatModels({ vendor: 'copilot' })` in
`src/command.ts` is the single selection point.

**Tune cost or coverage.** `MAX_CONCURRENT_REQUESTS` (`src/command.ts`),
`CHUNK_OVERLAP_LINES` and `INSTRUCTION_RESERVE_TOKENS` (`src/chunking.ts`). None are
user-configurable yet; exposing them would mean adding a `contributes.configuration`
block to `package.json` and reading it at the same points.

**Add a finding field.** Touch `PrivacyFinding` and `StoredFinding`
(`src/pdc/schema.ts`, `src/findings/manifest.ts`), `toStoredFinding`, `isStoredFinding`,
and - if the model supplies it - `FINDING_JSON_SCHEMA`, `isRawFinding`, and `toFinding`.
An on-disk shape change should bump `MANIFEST_VERSION`, which currently makes older
manifests fail to parse rather than migrate.

**Change how findings are displayed.** `src/misc/decorations.ts` is self-contained:
`STATUS_STYLE` and `getDecorations` for colours and badges, `buildHoverMessage` for the
hover.