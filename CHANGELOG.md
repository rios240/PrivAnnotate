# Changelog

All notable changes to the **PrivAudit** extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Nothing has been published to a marketplace yet, so every entry below is pre-release
development history, dated by the commit that introduced it.

## [Unreleased]

The current state of `main`: a per-category privacy analysis command with grounded JSON
findings, accept/reject triage, and a persistent workspace manifest.

### Added - 2026-09-22

* **Toggle All Findings.** `priv-audit.toggleFindings` hides or shows every finding
  decoration across all editors without touching the manifest; the rejected-findings
  toggle still applies once findings are shown again (`src/misc/decorations.ts`).
* **Reset Findings Manifest.** `priv-audit.resetManifest` asks for confirmation, then
  deletes `.privaudit/findings.json` in every workspace folder and clears all in-memory
  findings. The delete is queued behind in-flight writes so a pending decision cannot
  resurrect the file (`ManifestStore.reset`, `src/decisions.ts`).

### Fixed - 2026-09-22

* Deleting or reverting the manifest outside the extension no longer leaves stale
  decorations on screen: `loadFindingsFor` now clears a workspace file's findings when
  the manifest has no entry for it.
* Removed the unused `@types/jest` runtime dependency (the tests run on mocha).
* Deduplicated the `isStringArray` guard and the `"N| "` line-prefix regex.

### Added - 2026-08-27

* **Persistent findings manifest.** `.privaudit/findings.json` per workspace folder,
  written through a per-folder serialized `ManifestStore` so overlapping writes cannot
  lose decisions. Keys and findings are sorted on write so the file diffs cleanly when
  committed (`src/findings/manifest.ts`).
* **Accept / reject / undo triage.** Decision commands invoked from `command:` links in
  a finding's hover, with `priv-audit.toggleRejected` to bring hidden rejections back for
  review (`src/decisions.ts`, `src/misc/decorations.ts`).
* **Content fingerprints.** SHA-256 over the category plus a whitespace-normalized
  excerpt, deliberately excluding line numbers, so a decision survives the code moving
  or being reindented (`src/findings/fingerprint.ts`).
* **Reconciliation across runs.** A fresh run is merged with the manifest into added /
  still present / suppressed / reopened / no longer found. Entries a run did not
  re-observe are retained and stamped `resolvedAt` instead of being dropped
  (`src/findings/reconcile.ts`).
* **Span relocation and staleness.** Stored spans are re-anchored on their first
  excerpt line, preferring the candidate nearest the remembered position; a span whose
  anchor is gone is marked stale rather than decorating arbitrary lines.
* **Chunked whole-file analysis.** The file is split into windows that each fit the
  model's context alongside one card, with a 20-line overlap between neighbours and a
  5000-token instruction reserve (`src/chunking.ts`).
* **Bounded concurrency.** At most three model requests in flight per run, so a large
  file does not burst the Copilot quota (`src/command.ts`).
* **Run report.** A `PrivAudit` output channel with a previous-vs-current comparison,
  truncation and failed-category warnings, and a one-line summary notification;
  `priv-audit.showReport` reopens it (`src/report.ts`).
* **Session restore.** Findings are rehydrated for visible editors on activation and on
  editor changes, and a file-system watcher reloads the manifest when it is edited
  outside the extension - a pulled commit or a hand edit (`src/extension.ts`).
* **Status-aware decorations.** Distinct undecided / accepted / rejected styles,
  overlapping findings merged into one decoration, and a low-confidence label.
* **Unit-test path without VS Code.** `npm run test:unit` runs the suite in plain Node
  against a `vscode` stub, alongside the Extension Development Host run (`npm test`).

### Changed - 2026-08-24

* **Reworked detection around the Privacy Practice Detection Card framework.** Replaced
  the LINDDUN GO threat deck with eight PDC cards adapted from the OPP-115 taxonomy
  (`FP-01`–`DS-06`, `DNT-07`) plus a custom `AI-08` AI/ML usage category
  (`src/pdc/categories.ts`).
* **One request per category.** Each card is sent on its own instead of all categories
  sharing a prompt, so a card gets the full context window and one failure cannot sink
  the others.
* **Structured JSON findings.** Responses must match a schema shared between the prompt
  and the parser, replacing free-text parsing. Findings are validated, clamped to the
  analyzed range, and confidence-downgraded when the excerpt is not found in the span it
  claims (`src/pdc/schema.ts`, `src/parseResponse.ts`).
* **Cross-references instead of duplicates.** A span matching several categories is
  reported once with the others listed, rather than emitted repeatedly.

### Removed - 2026-08-24

* `src/misc/linddun.ts` and `src/misc/response.ts`, superseded by the PDC deck and the
  JSON schema.

## Pre-PDC development history

### 2026-08-09

* **Editor command.** `priv-audit.analyze` implemented end to end as a text-editor
  command with progress reporting and cancellation, replacing the chat participant
  (`src/participant.ts` removed).

### 2026-07-27

* Full LINDDUN GO card deck transcribed into the extension.

### 2026-07-16

* Prompt construction completed for three LINDDUN threat types plus a response format.

### 2026-07-11

* First LINDDUN GO threat cards and prompt construction.

### 2026-07-09

* Removed the default prompt construction; added the logging system.

### 2026-06-29

* Version 1.0 of the privacy detection spec (`src/spec/privacyDetection.md`).

### 2026-06-20

* Fixed the "unknown context" error caused by a `SystemMessage` prompt element -
  `vscode.LanguageModelChatMessage` has only user and assistant roles, so instruction
  content lives in an `AssistantMessage`.

### 2026-06-09

* Initial `privAudit` chat participant and audit command.
* Package renamed to PACT, then to PrivAudit.

### 2026-06-02

* Initial extension scaffold.

[Unreleased]: https://github.com/rios240/privaudit/commits/main