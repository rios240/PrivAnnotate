# PrivAnnotate evaluation corpus

A self-contained test bed for measuring how accurately PrivAnnotate detects data practices.
It contains:

* **Trailmark** (`trailmark/`), a small fictional hiking-tracker web app whose code implements
  the eight detection rules in
  [`docs/privacy-detection-information-categories.md`](../docs/privacy-detection-information-categories.md).
  Some cases mirror the rule text and worked examples closely. Others move one step away,
  to test whether the model generalizes.
* **A hand-labeled ground truth** (`ground-truth/`), in exactly the format of the manifest
  the extension writes (`.privannotate/findings.json`), plus the labels it is built from.
* **Two zero-dependency Node scripts** (`tools/`): one builds the ground truth, the other
  scores an extension run against it.

Nothing here is part of the extension build: `.vscodeignore` excludes `evaluation/`, and
`tsc`, ESLint and Prettier only look at `src/`.

```
evaluation/
  trailmark/                     the app under test: open THIS folder in VS Code
  ground-truth/
    labels.json                  source of truth: hand-written, span-based labels
    findings.json                generated: the ground truth as an extension manifest
    inventory.md                 generated: every label with file:line links, for review
  tools/
    build-ground-truth.mjs       labels.json -> findings.json + inventory.md
    score.mjs                    extension manifest vs. ground truth -> metrics
    lib.mjs                      shared helpers (anchors, fingerprints, IoU)
```

## Running an evaluation

1. Launch the Extension Development Host (<kbd>F5</kbd> in this repository), then use
   **File > Open Folder** to open `evaluation/trailmark`. Opening that folder rather than the
   repository root matters: the extension shows the model each file's workspace-relative
   path, and `evaluation/...` in that path would hint that the code is a test fixture.
2. Pin the model you want to measure with `privAnnotate.model.vendor` / `privAnnotate.model.family`.
3. Run **PrivAnnotate: Reset Findings Manifest**, so nothing from an earlier run carries over.
4. Open each of the 18 in-scope files and run **Analyze Privacy Practices** on each. That is
   about 144 model requests in total:

   ```
   public/index.html                  server/routes/auth.js          server/jobs/nightly.js
   public/js/consent.js               server/routes/account.js       worker/coach.py
   public/js/analytics.js             server/routes/activities.js    worker/screening.py
   public/js/recorder.js              server/routes/community.js     db/migrations/0007_location_pings.sql
   server/app.js                      server/routes/billing.js       deploy/nginx.conf
   server/middleware/audience.js      server/services/mailer.js      deploy/logrotate/trailmark.conf
   ```

   `package.json` and `worker/requirements.txt` are there for realism only and are not scored.
5. Score the run from the repository root:

   ```bash
   node evaluation/tools/score.mjs --pred evaluation/trailmark/.privannotate/findings.json
   ```

   To keep a run, copy the manifest elsewhere first (e.g. `evaluation/results/<model>-<date>.json`;
   `results/` and `trailmark/.privannotate/` are git-ignored). LLM output varies between runs,
   so score several runs per model and report the spread, not a single number.

### Scorer options

| Option | Default | Effect |
| --- | --- | --- |
| `--pred <path>` | *(required)* | The extension manifest to score |
| `--iou <0..1>` | `0` | Minimum line IoU for a match. `0` accepts any overlap; `0.5` is a strict, detection-style setting |
| `--min-confidence low\|medium\|high` | `low` | Ignore predictions below this confidence |
| `--include-resolved` | off | Also score findings stamped `resolvedAt` (those left over from earlier runs) |
| `--json <path>` | | Write every metric and each finding's individual outcome as JSON |
| `--labels <path>` | `ground-truth/labels.json` | Score against a different labels file |

Manifest keys may be relative to `trailmark/` or to the repository root; both are accepted.
In-scope files missing from the manifest are reported as **not analyzed** and left out of
every metric, so a partial run still scores what it covered.

### How predictions are matched

Matching follows the object-detection convention, with line ranges as the boxes. It is done
per file and per rule:

1. Predictions and ground-truth positives are paired **one-to-one, greedily by line IoU**.
   A matched pair is a **true positive**. A positive left unmatched is a **false negative**.
2. An unmatched prediction that overlaps an *already matched* positive is a **duplicate**:
   the same practice reported at a different granularity. Duplicates are counted but are not
   false positives.
3. An unmatched prediction on an **optional** label (see below) is **ignored**.
4. Every other prediction is a **false positive**. When it lands on a hard negative for its
   rule, it is also tagged `hard-negative`, and the report lists which near-misses fooled the model.

The report includes:

* micro and macro precision, recall and F1
* per-rule results, with recall split into **direct** and **boundary** cases
* per-language/format results
* hard negatives triggered
* precision and recall at each confidence threshold (a three-point operating curve)
* mean IoU of the matched pairs, as a measure of localization quality
* every miss and false positive, with `file:line`

A sanity check: scoring the ground truth against itself gives 100% everywhere.

```bash
node evaluation/tools/score.mjs --pred evaluation/ground-truth/findings.json
```

## The ground truth

| Rule | Positives (direct / boundary) | Hard negatives | Optional |
| --- | --- | --- | --- |
| FP-01 First-party collection/use | 9 (5 / 4) | 2 | 8 |
| TP-02 Third-party sharing | 9 (6 / 3) | 3 | 2 |
| UC-03 User choice/control | 6 (4 / 2) | 2 | 4 |
| UA-04 User access/edit/deletion | 5 (4 / 1) | 2 | 1 |
| DR-05 Data retention | 5 (2 / 3) | 3 | 0 |
| DS-06 Data security | 8 (3 / 5) | 2 | 4 |
| DNT-07 Do Not Track | 4 (1 / 3) | 2 | 0 |
| AI-08 AI/ML usage | 5 (3 / 2) | 2 | 0 |
| **Total** | **51 (28 / 23)** over 49 spans | **18** | **19** |

The totals come to about 50 positives rather than 40 because the rules expect code to match
several categories at once. The extension sends one request per rule, so a span that
matches three rules yields three findings, and the ground truth labels it three times.
[`ground-truth/inventory.md`](ground-truth/inventory.md) lists every label with a link to its
lines, and is the file to read when checking the labels by hand.

### Label kinds

* **Positive**: the rule applies to this span, and the extension should report it. Each
  positive becomes one `accepted` finding in `findings.json`.
* **Hard negative**: a near miss that must *not* be reported for that rule. Most are taken
  directly from a rule's negative worked example:
  * a `MAX_UPLOAD_SIZE_MB` constant
  * a call to an internal service
  * an unconditional receipt email
  * an admin delete
  * an insert with no TTL
  * a DNT value that is read but never used
  * an LLM given only aggregate data

  The rest are generalization traps:
  * base64 passed off as encryption
  * a `randomBytes` token stored in plaintext
  * an env flag mistaken for user consent
  * a hand-written score mistaken for ML
  * a 28-day query window mistaken for retention
  * nginx asset caching
  * `sendBeacon` to a first-party URL
  * a `CREATE TABLE` definition
  * a DNT header that is only logged
  * a member profile fetched by an arbitrary id
  * aggregate-only stats posted to Slack
* **Optional**: the rule text honestly supports either answer, so a prediction there counts
  as neither a hit nor a mistake. The main cases are:
  * UC-03 on DNT/GPC checks (the catalog lists UC-03 as related to DNT-07)
  * FP-01 on code whose only user data is a preference, or on AI output that gets persisted
  * DS-06 on `requireAuth` guards and on call sites of helpers implemented elsewhere

  Each optional label records its reason (`why`).

### Tiers

* **direct**: conventional names and APIs, close to the rule's own description or worked
  examples (the bcrypt hash, the opt-in-gated marketing email, the `doNotTrack`-gated `gtag`,
  the moderation call that auto-hides content, `include_in_training=True`).
* **boundary**: one deliberate step away. Each boundary label's `probe` says which step:
  * **another format**: SQL row-level security, `pg_cron`, nginx TLS and `log_format`,
    logrotate, HTML markup
  * **an unfamiliar API**: Web Bluetooth with numeric UUIDs, raw AES-GCM, Stripe signature
    checks, Meta's Conversions API
  * **indirection**: an early-return guard, GPC inside a combined condition, retention
    expressed as a delayed queue job
  * **unrevealing names**: a `coach_sft` JSONL corpus, `sealNote`

### Labeling policy

* **The rule text decides.** Each (span, rule) pair is judged only against that rule's text
  and worked examples, not against a general sense of what is privacy-relevant.
* **FP-01 means acquiring or deriving user data**, from a request, a sensor, a log format or
  a computation, and then storing or acting on it. Three things are *not* FP-01:
  * reading back stored records to serve them to their owner (that is UA-04)
  * handing data to a vendor (that is TP-02, per FP-01's fourth question)
  * schema definitions
* **Only implemented mechanisms count** for DR-05 and DS-06, as the rules require. The
  *absence* of a safeguard is never labeled.
* **A span is one distinct practice**, usually a function or route handler. Matching is
  lenient about granularity: any overlap matches, and a finer-grained second report of the
  same practice counts as a duplicate, not a false positive.
* **The app gives nothing away.** No comment, identifier or path in `trailmark/` names a
  rule or category. File names avoid rule vocabulary wherever a natural name exists (e.g.
  `jobs/nightly.js` rather than `retention.js`), because the model sees each path. Comments
  are kept to what a normal codebase would have.
* **Trailmark is static.** The code is written to parse (`node --check`, `py_compile`) and
  hang together as one app, but it is never installed or run. Helpers it imports, such as
  `../db`, `../lib/guards` and `trailmark_worker`, deliberately don't exist.

## Viewing the ground truth in the editor

`findings.json` is a valid manifest, so the extension can display it. With `evaluation/trailmark`
open as the workspace folder:

```bash
mkdir -p evaluation/trailmark/.privannotate
cp evaluation/ground-truth/findings.json evaluation/trailmark/.privannotate/findings.json
```

Every positive then shows as an accepted (blue) finding. Its hover gives the span ID, tier
and probe (in the reasoning field) and the evidence sentence. Run **Reset Findings Manifest**
before your next scored run.

## Changing the labels or the app

`labels.json` is the only file to edit by hand. Each span names its code with anchors, not
line numbers:

```jsonc
{
  "id": "AV6",
  "file": "server/routes/activities.js",
  "start": "router.delete('/activities/:id'",   // substring that must match exactly one line
  "end": "=});",                                // first line at/after start containing this;
                                                // a leading "=" means an exact whole-line match,
                                                // and an array is searched in sequence
  "positives": [{ "rule": "UA-04", "tier": "direct", "probe": "...", "evidence": "..." }],
  "optional":  [{ "rule": "FP-01", "why": "..." }],
  "negatives": [{ "rule": "DS-06", "tier": "boundary", "probe": "..." }]
}
```

Then regenerate the ground truth, and check it before committing:

```bash
node evaluation/tools/build-ground-truth.mjs          # rewrite findings.json and inventory.md
node evaluation/tools/build-ground-truth.mjs --check  # exit 1 if either is stale
```

Because anchors are text, editing the app moves the labels with the code. An anchor that
stops matching, or matches twice, fails the build with the span's ID. The build also:

* rejects a hard negative that overlaps a positive or optional label for the same rule
* rejects two positives that would share a fingerprint
* recomputes every fingerprint with the extension's own `out/findings/fingerprint.js`, when
  the extension has been compiled (`npm run compile`)
