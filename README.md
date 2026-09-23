# PrivAnnotate

**Automatic Privacy Annotating during Code Authoring** - a VS Code extension that reads the
file you are working on and annotates the *data practices* it implements: what personal
data the code collects, where it sends it, whether the user can control it, how long it
is kept, how it is protected, and whether it feeds an AI/ML model.

Findings are surfaced as inline editor decorations, triaged with an accept/reject
decision, and stored in a workspace manifest (`.privannotate/findings.json`) so the annotate
trail survives restarts, edits, and code review.

The goal is to produce a code-level record of privacy
practices that can be compared against an organization's *written* privacy policy to
surface inconsistencies.

---

## How it works

1. **Plan.** The active file is split into chunks that each fit the model's context
   window alongside one detection rule, with a 20-line overlap (configurable) so a practice straddling
   a boundary is intact in at least one chunk.
2. **Ask.** For every (chunk x rule) pair, a prompt is rendered with
   [`@vscode/prompt-tsx`](https://github.com/microsoft/vscode-prompt-tsx) and sent
   through the VS Code Language Model API (`vscode.lm`). One request handles exactly one
   category - eight rules means eight requests per chunk, at most three in flight by default.
3. **Ground.** Each response must be a JSON array matching a fixed schema. The parser
   validates every element, drops findings outside the analyzed range, and *downgrades
   confidence* when the quoted excerpt cannot be found in the lines it claims to come
   from - the signature of a hallucinated finding.
4. **Reconcile.** Fresh findings are matched against the manifest by content
   fingerprint, not line number, so your accept/reject decisions survive re-runs and
   edits. Findings a run no longer sees are retained and stamped `resolvedAt` rather
   than deleted.
5. **Report.** Decorations are repainted, the manifest is written, and a
   previous-vs-current diff (new / still present / suppressed / reopened / no longer
   found) is written to the **PrivAnnotate** output channel.

A deeper, module-by-module description lives in
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## The detection rules

Analysis is driven by the **Privacy Practice Detection Rules** in `src/rules/catalog.ts` -
one rule per data-practice category, adapted from the OPP-115 privacy policy taxonomy
(Wilson et al., 2016) and structured after the LINDDUN GO card format. Each rule carries
a base description, reasoning guidance, elicitation questions, and worked positive *and*
negative examples, and is the single source of truth for prompt content. The full
framework text is in [docs/privacy-detection-information-categories.md](docs/privacy-detection-information-categories.md).

| Rule | Category | Covers |
| --- | --- | --- |
| `FP-01` | `FIRST_PARTY_COLLECTION_USE` | The app's own logic reading, sensing, or deriving user data |
| `TP-02` | `THIRD_PARTY_SHARING_COLLECTION` | User data leaving the first-party boundary (APIs, SDKs, webhooks) |
| `UC-03` | `USER_CHOICE_CONTROL` | Consent flags, opt-in/opt-out, permission checks before a data operation |
| `UA-04` | `USER_ACCESS_EDIT_DELETION` | Endpoints letting users view, correct, export, or delete their own data |
| `DR-05` | `DATA_RETENTION` | TTLs, expiry config, purge/archive jobs, log rotation |
| `DS-06` | `DATA_SECURITY` | Encryption, hashing, access control, transport protection |
| `DNT-07` | `DO_NOT_TRACK` | DNT / Global Privacy Control / App Tracking Transparency signal handling |
| `AI-08` | `AI_USAGE` | User data sent to a model, model output driving decisions about a user, training data |

`FP-01` through `DS-06` map to the first six OPP-115 categories; `DNT-07` is OPP-115's
ninth category reformulated for code; `AI-08` is a custom category with no OPP-115
equivalent, since OPP-115 predates widespread LLM/ML integration.

A span that matches more than one category is reported once, under the requested rule,
with the others listed in its `crossReferences` field.

## Requirements

* **VS Code `^1.120.0`** - the extension targets the stable Language Model API.
* **A Copilot chat model.** `priv-annotate.analyze` calls
  `vscode.lm.selectChatModels({ vendor: 'copilot' })`, so GitHub Copilot Chat must be
  installed and signed in. Without it the command reports *"no suitable language model
  found"* and stops. Requests consume your Copilot quota; a large file can queue dozens
  of them.
* **A workspace folder** for persistence. Untitled files and files opened outside any
  workspace folder are still analyzed and decorated, but their findings cannot be saved.

## Commands

| Command | Title | Where |
| --- | --- | --- |
| `priv-annotate.analyze` | Analyze Privacy Practices | Command palette, and the shield icon in the editor title bar |
| `priv-annotate.showReport` | Show Analysis Report | Command palette - opens the PrivAnnotate output channel |
| `priv-annotate.toggleRejected` | Toggle Rejected Findings | Command palette (while findings are shown) - reveals rejected findings so a mistaken rejection can be undone |
| `priv-annotate.toggleFindings` | Toggle All Findings | Command palette, and the eye icon in the editor title bar - hides or shows every finding decoration in all editors; the manifest is untouched |
| `priv-annotate.resetManifest` | Reset Findings Manifest | Command palette - after a confirmation, deletes `.privannotate/findings.json` in every workspace folder and clears all annotations |
| `priv-annotate.acceptFinding` | Accept Finding | Hover link only |
| `priv-annotate.rejectFinding` | Reject Finding | Hover link only |
| `priv-annotate.clearDecision` | Clear Finding Decision | Hover link only |

The three decision commands are hidden from the command palette; they are invoked from
the `command:` links in a finding's hover, which carry the document URI and the
finding's fingerprint.

## Reading the annotations

Findings decorate whole lines, with overlapping findings merged into one decoration:

* **Orange** - undecided. The badge is the rule ID (`⚠ TP-02`), or a count when several
  findings share the span (`⚠ 3 privacy practices`). Low-confidence spans are labelled
  `(low confidence)`.
* **Blue** - accepted (`✔`).
* **Grey** - rejected (`✖`), painted only while *Toggle Rejected Findings* is on.

*Toggle All Findings* hides every decoration at once and brings them back as they were -
useful for reading or presenting code without the annotations.

Hovering a highlighted line shows, for every visible finding covering that line: rule ID and display name, confidence, the
evidence sentence, the model's reasoning steps, cross-referenced categories, when the
finding was first seen, a staleness warning if the span could not be located in the
current text, and the Accept / Reject / Undo links.

## The manifest

Each workspace folder gets one `.privannotate/findings.json`:

```jsonc
{
  "version": 1,
  "files": {
    "src/server/checkin.ts": {
      "lastAnalyzedAt": "2026-08-27T18:03:11.402Z",
      "findings": [
        {
          "fingerprint": "9f2c1b7ae0d34c58",
          "category": "FIRST_PARTY_COLLECTION_USE",
          "lineRange": { "start": 42, "end": 49 },
          "excerpt": "const lat = req.body.lat;",
          "evidence": "Reads latitude/longitude from the request body and persists it against the user id.",
          "confidence": "high",
          "reasoning": ["..."],
          "crossReferences": ["THIRD_PARTY_SHARING_COLLECTION"],
          "status": "accepted",
          "firstSeen": "2026-08-20T09:12:00.000Z",
          "lastSeen": "2026-08-27T18:03:11.402Z",
          "decidedAt": "2026-08-20T09:15:42.000Z"
        }
      ]
    }
  }
}
```

Notes on living with the file:

* **Upgrading from PrivAudit.** An existing `.privaudit/findings.json` is still read when
  no `.privannotate/findings.json` exists; the next write lands in the new location, after
  which the old folder can be deleted (Reset Findings Manifest removes both).

* **Commit it** if you want the audit trail shared. Keys and findings are sorted on
  write so it diffs cleanly, and the extension watches the file - a pulled change or a
  hand edit is picked up without a reload.
* **Fingerprints, not line numbers, are identity.** A fingerprint is a SHA-256 prefix
  over the category plus a whitespace-normalized excerpt, so reindenting or moving code
  keeps a finding's decision; changing the code itself does not.
* **It is validated, not trusted.** Malformed findings are dropped individually; an
  unrecognized `version` makes the extension start from empty rather than misread it.
* **Nothing is deleted.** A finding a later run does not re-observe is kept and stamped
  `resolvedAt`; it stops decorating the editor but stays in the record.
* **Starting over.** *Reset Findings Manifest* is the one exception: it deletes the manifest
  in every workspace folder, wiping all findings *and* accept/reject decisions. It asks
  for confirmation first and cannot be undone other than through version control.

## Extension settings

| Setting | Default | Effect |
| --- | --- | --- |
| `privAnnotate.model.vendor` | `copilot` | Language-model vendor passed to `vscode.lm.selectChatModels` |
| `privAnnotate.model.family` | *(empty)* | Model family to request; empty means the vendor's first available model |
| `privAnnotate.analysis.maxConcurrentRequests` | `3` | Rule requests in flight at once (1-16) |
| `privAnnotate.analysis.chunkOverlapLines` | `20` | Lines repeated between adjacent chunks (0-200) |

Out-of-range or mistyped values are clamped or fall back to the default. The instruction
token reserve remains a constant in `src/analysis/chunking.ts`.

Two context keys mirror the view toggles for use in your own keybindings or `when`
clauses: `privAnnotate.findingsVisible` and `privAnnotate.rejectedVisible`.

## Development

```bash
npm install
npm run compile      # tsc -p ./            --> out/
npm run watch        # tsc -w
npm run lint         # eslint src
npm run format       # prettier --write (format:check verifies without writing)
npm run test:unit    # mocha against the vscode stub - no VS Code download needed
npm test             # @vscode/test-cli, runs in an Extension Development Host
```

Press <kbd>F5</kbd> to launch the Extension Development Host with PrivAnnotate loaded; the
`watch` task is wired as the default build task.

`npm run test:unit` is the fast path: `src/test/stub/register.ts` intercepts
`require('vscode')` and serves the minimal shim in `src/test/stub/vscodeStub.ts`, so the
same test files run as plain Node tests on a machine or CI runner that cannot download a
VS Code build.

### Evaluation

`evaluation/` holds a test bed for measuring detection accuracy: *Trailmark*, a small
multi-language web app whose code implements the eight rules, and a hand-labeled ground
truth in the same format as `.privannotate/findings.json`. It also has a scorer that reports
precision and recall per rule, recall on direct vs. boundary cases, and which hard negatives
were flagged. See [evaluation/README.md](evaluation/README.md).

## Known issues and limitations

* **Analysis is per-file and manual.** There is no workspace-wide scan and no analysis
  on save; you run *Analyze Privacy Practices* on the file you care about.
* **Cost scales with file size.** Requests = chunks x 8 rules. A file needing four
  chunks is 32 model requests.
* **Findings are only as good as the model.** Grounding checks catch excerpts that do
  not appear in the claimed span (confidence is downgraded, not dropped), but a
  plausible-looking false positive still reaches the editor - hence accept/reject.
* **Model choice is by vendor/family only.** `privAnnotate.model.*` picks the first model
  matching the vendor and family; there is no per-rule model selection.
* **Stale spans.** When a stored excerpt's anchor line no longer exists, the finding is
  marked stale and decorated at its clamped old position rather than being moved.

## Project background

PrivAnnotate began as a Copilot chat participant, became an editor command driven by a
LINDDUN GO threat-card deck, and was reworked into the current per-category detection
rules (originally called the PDC, "Privacy Practice Detection Card", framework) with JSON findings and a persistent manifest. See
[CHANGELOG.md](CHANGELOG.md) for that history.
