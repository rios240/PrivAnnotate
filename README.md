# PrivAudit

**Automatic Privacy Audit during Code Authoring** - a VS Code extension that reads the
file you are working on and annotates the *data practices* it implements: what personal
data the code collects, where it sends it, whether the user can control it, how long it
is kept, how it is protected, and whether it feeds an AI/ML model.

Findings are surfaced as inline editor decorations, triaged with an accept/reject
decision, and stored in a workspace manifest (`.privaudit/findings.json`) so the audit
trail survives restarts, edits, and code review.

The goal is not vulnerability scanning. It is producing a code-level record of privacy
practices that can be compared against an organization's *written* privacy policy to
surface inconsistencies - so precision matters more than volume.

---

## How it works

1. **Plan.** The active file is split into chunks that each fit the model's context
   window alongside one detection card, with a 20-line overlap so a practice straddling
   a boundary is intact in at least one chunk.
2. **Ask.** For every (chunk x card) pair, a prompt is rendered with
   [`@vscode/prompt-tsx`](https://github.com/microsoft/vscode-prompt-tsx) and sent
   through the VS Code Language Model API (`vscode.lm`). One request handles exactly one
   category - eight cards means eight requests per chunk, at most three in flight.
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
   found) is written to the **PrivAudit** output channel.

A deeper, module-by-module description lives in
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## The detection cards

Analysis is driven by the **Privacy Practice Detection Card (PDC)** deck in
`src/pdc/categories.ts` - a LINDDUN GO-style card set adapted from the OPP-115 privacy
policy taxonomy (Wilson et al., 2016). Each card carries a base description, reasoning
guidance, elicitation questions, and worked positive *and* negative examples, and is the
single source of truth for prompt content.

| Card | Category | Covers |
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

A span that matches more than one category is reported once, under the requested card,
with the others listed in its `crossReferences` field.

## Requirements

* **VS Code `^1.120.0`** - the extension targets the stable Language Model API.
* **A Copilot chat model.** `priv-audit.analyze` calls
  `vscode.lm.selectChatModels({ vendor: 'copilot' })`, so GitHub Copilot Chat must be
  installed and signed in. Without it the command reports *"no suitable language model
  found"* and stops. Requests consume your Copilot quota; a large file can queue dozens
  of them.
* **A workspace folder** for persistence. Untitled files and files opened outside any
  workspace folder are still analyzed and decorated, but their findings cannot be saved.

## Commands

| Command | Title | Where |
| --- | --- | --- |
| `priv-audit.analyze` | Analyze Privacy Practices | Command palette, and the shield icon in the editor title bar |
| `priv-audit.showReport` | Show Analysis Report | Command palette - opens the PrivAudit output channel |
| `priv-audit.toggleRejected` | Toggle Rejected Findings | Command palette - reveals rejected findings so a mistaken rejection can be undone |
| `priv-audit.acceptFinding` | Accept Finding | Hover link only |
| `priv-audit.rejectFinding` | Reject Finding | Hover link only |
| `priv-audit.clearDecision` | Clear Finding Decision | Hover link only |

The three decision commands are hidden from the command palette; they are invoked from
the `command:` links in a finding's hover, which carry the document URI and the
finding's fingerprint.

## Reading the annotations

Findings decorate whole lines, with overlapping findings merged into one decoration:

* **Orange** - undecided. The badge is the card ID (`⚠ TP-02`), or a count when several
  findings share the span (`⚠ 3 privacy practices`). Low-confidence spans are labelled
  `(low confidence)`.
* **Blue** - accepted (`✔`).
* **Grey** - rejected (`✖`), painted only while *Toggle Rejected Findings* is on.

Hovering a decoration shows, per finding: card ID and display name, confidence, the
evidence sentence, the model's reasoning steps, cross-referenced categories, when the
finding was first seen, a staleness warning if the span could not be located in the
current text, and the Accept / Reject / Undo links.

## The manifest

Each workspace folder gets one `.privaudit/findings.json`:

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

## Extension settings

None yet. The extension contributes no `configuration` points - concurrency, chunk
overlap, and the instruction token reserve are constants in `src/command.ts` and
`src/chunking.ts`.

## Development

```bash
npm install
npm run compile      # tsc -p ./            --> out/
npm run watch        # tsc -w
npm run lint         # eslint src
npm run test:unit    # mocha against the vscode stub - no VS Code download needed
npm test             # @vscode/test-cli, runs in an Extension Development Host
```

Press <kbd>F5</kbd> to launch the Extension Development Host with PrivAudit loaded; the
`watch` task is wired as the default build task.

`npm run test:unit` is the fast path: `src/test/stub/register.ts` intercepts
`require('vscode')` and serves the minimal shim in `src/test/stub/vscodeStub.ts`, so the
same test files run as plain Node tests on a machine or CI runner that cannot download a
VS Code build.

## Known issues and limitations

* **Analysis is per-file and manual.** There is no workspace-wide scan and no analysis
  on save; you run *Analyze Privacy Practices* on the file you care about.
* **Cost scales with file size.** Requests = chunks x 8 cards. A file needing four
  chunks is 32 model requests.
* **Findings are only as good as the model.** Grounding checks catch excerpts that do
  not appear in the claimed span (confidence is downgraded, not dropped), but a
  plausible-looking false positive still reaches the editor - hence accept/reject.
* **Copilot-only.** The model vendor is hard-coded to `copilot`.
* **Stale spans.** When a stored excerpt's anchor line no longer exists, the finding is
  marked stale and decorated at its clamped old position rather than being moved.

## Project background

PrivAudit began as a Copilot chat participant, became an editor command driven by a
LINDDUN GO threat-card deck, and was reworked into the current per-category PDC
framework with JSON findings and a persistent manifest. See
[CHANGELOG.md](CHANGELOG.md) for that history.