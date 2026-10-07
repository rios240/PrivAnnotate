# PrivAnnotate evaluation: Copilot "auto" model, three runs

This report analyzes three full evaluation runs of PrivAnnotate against the Trailmark corpus,
plus a strict re-score of run 3 at line IoU 0.5. The files it is based on:

| File | What it is |
| --- | --- |
| `copilot-auto-findings-{1,2,3}.json` | The extension manifest written by each run |
| `copilot-auto-score-{1,2,3}.json` | `score.mjs --json` output for each run, default settings (IoU > 0, all confidences) |
| `copilot-auto-score-iou-half.json` | Run 3 re-scored with `--iou 0.5` |

All three runs used the Copilot vendor with no pinned model ("auto"). The manifest does not
record which model served the requests, so the numbers below describe *whatever Copilot picked*,
not a named model. Every number in this report was re-derived from the committed manifests with
`score.mjs` and matches the committed score files exactly (see the appendix).

**Summary.**

* The extension finds most practices: **~85% recall**, equally well on textbook and on
  deliberately disguised code.
* It is noisy: **~49% precision**, roughly one wrong finding per right one.
* The runs are nearly deterministic. 40 of run 3's 47 false positives and all 7 of its misses
  occur in every run, so the errors are systematic. They come from how the model reads the rules,
  not from sampling noise, and can be fixed in the prompts and rules.
* About half of the false positives point at code that is genuinely privacy-relevant. In 11
  cases the rule text itself supports the model's reading, which argues for revising a few labels
  and rule definitions.

---

## 1. The evaluation setup

### 1.1 What is being measured

PrivAnnotate analyzes one file at a time. It splits the file into chunks and sends one request
per (chunk × rule) to a language model. Each request carries exactly **one** of the eight
detection rules (FP-01 … AI-08), and the model returns a JSON array of findings. Each finding has
a category, a line range, a verbatim excerpt, a confidence (`low`/`medium`/`high`), an evidence
sentence and reasoning steps. The findings land in a manifest (`.privannotate/findings.json`).
The evaluation scores that manifest against a hand-labeled ground truth.

The code under test is **Trailmark** (`evaluation/trailmark/`), a fictional hiking-tracker app
written for this purpose. 18 files are in scope, across six languages and formats:

* `browser-js` (3 files)
* `html` (1)
* `node` (9: an Express server, its middleware, routes, a mailer and a cron job)
* `python` (2 workers)
* `sql` (1 migration)
* `config` (nginx and logrotate)

No comment, identifier or path names a rule, so the model has to recognize each practice from the
code alone.

### 1.2 The ground-truth labels

The labels live in `ground-truth/labels.json`. Each entry is a **span**: a contiguous line range,
usually one function or route handler, located by text anchors rather than line numbers. Each
span carries per-rule labels of three kinds:

| Kind | Count | Meaning |
| --- | ---: | --- |
| **Positive** | 51 | The rule applies here, and the extension should report it |
| **Hard negative** | 18 | A deliberate near miss that must *not* be reported for that rule |
| **Optional** | 19 | The rule text honestly supports either answer, so a prediction here counts for nothing |

A span can be positive for several rules at once: the AI moderation call in `community.js` is
both TP-02 and AI-08, for example. That is why 51 positives sit on 49 spans. Each positive also
has a **tier**:

* **direct** (28): conventional names and APIs, close to the rule's own worked examples. Examples
  are bcrypt, an opt-in-gated email, and a `doNotTrack`-gated `gtag`.
* **boundary** (23): one deliberate step away from the rule text, recorded in the label's
  `probe`. The steps are:
  * another format: SQL row-level security, `pg_cron`, nginx, logrotate
  * an unfamiliar API: Web Bluetooth with numeric UUIDs, raw AES-GCM, Meta's Conversions API
  * indirection: an early-return guard, GPC buried in a compound condition
  * names that don't reveal the purpose: `sealNote`, `coach_sft`

The hard negatives come in two kinds:

* 7 are taken directly from a rule's own negative worked example: a `MAX_UPLOAD_SIZE_MB`
  constant, an internal service call, an unconditional receipt email, an admin delete, an insert
  with no TTL, a dead DNT read, and an LLM given only aggregate data.
* 11 are generalization traps: base64 passed off as encryption, a `randomBytes` token stored in
  plaintext, an operator env flag that looks like consent, and so on.

Four labeling-policy decisions matter for reading the results:

* **FP-01 means acquiring or deriving user data.** Reading stored data back to its owner is
  UA-04, handing data to a vendor is TP-02, and schemas are not collection.
* **Only implemented mechanisms count** for DR-05 and DS-06. The absence of a safeguard is never
  labeled.
* **Granularity is coarse:** a span is a whole practice, usually a whole function.
* **Each (span, rule) pair is judged against that rule's text only,** not against a general sense
  of what is privacy-relevant.

### 1.3 How findings are scored

`tools/score.mjs` matches predictions to labels the way object-detection benchmarks do, with line
ranges as the boxes. It works separately for every (file, rule) pair:

1. **Pairing.** Every (prediction, positive) pair with line IoU > 0 and IoU ≥ `--iou` is a
   candidate. Candidates are sorted by IoU and taken greedily, one-to-one. A matched pair is a
   **true positive (TP)**; a positive left unmatched is a **false negative (FN)**.
2. **Duplicates.** An unmatched prediction that overlaps an *already matched* positive is a
   **duplicate**: the same practice reported at a different granularity, for example `req.ip` and
   `req.get('User-Agent')` reported separately inside the signup handler. Duplicates are counted
   but not penalized.
3. **Optional labels.** An unmatched prediction that overlaps an optional span, and no positive,
   is **ignored**.
4. **Everything else is a false positive (FP).** If the FP overlaps a hard negative for the same
   rule, it is also tagged `hard-negative`, and that hard negative counts as **triggered**. With a
   non-zero `--iou`, a prediction that overlaps a positive below the threshold is also an FP
   (tagged `low-iou`), while the positive it missed becomes an FN. A sloppy box is penalized twice.

From those outcomes the scorer reports:

* **Micro P/R/F1** over all findings, and **macro** P/R/F1: the unweighted mean of the eight
  per-rule values, so each rule counts equally however many labels it has.
* Recall split by **tier** (direct vs. boundary), and results **per language**.
* **Hard negatives triggered**, out of 18.
* **Mean IoU** of the matched pairs, a measure of how tightly predictions fit the labeled spans.
* An **operating curve** at confidence ≥ low, ≥ medium and ≥ high.

Files missing from the manifest are excluded from every metric. All three runs covered all 18
files, and none had resolved or invalid findings.

A property of the default setting is worth keeping in mind. At IoU > 0, *any* overlap matches,
so pointing at a single correct line inside a 30-line handler earns full credit. The default
measures **"did the model find the practice?"**, not "did it draw the box the labeler drew?".
Section 2.3 deals with the second question.

---

## 2. Metrics

### 2.1 The three runs side by side

| Metric | Run 1 | Run 2 | Run 3 | Mean ± sd |
| --- | ---: | ---: | ---: | ---: |
| Findings emitted | 117 | 116 | 118 | 117 |
| TP / FP / FN | 43 / 45 / 8 | 43 / 45 / 8 | **44** / 47 / **7** | |
| Micro precision | **48.9%** | **48.9%** | 48.4% | 48.7 ± 0.3 |
| Micro recall | 84.3% | 84.3% | **86.3%** | 85.0 ± 1.1 |
| **Micro F1** | 61.9% | 61.9% | **62.0%** | 61.9 ± 0.1 |
| Macro precision | 52.9% | **54.4%** | 53.8% | 53.7 ± 0.8 |
| Macro recall | 84.6% | 84.6% | **86.0%** | 85.1 ± 0.8 |
| Macro F1 | 63.9% | **65.0%** | 64.7% | 64.5 ± 0.6 |
| Recall, direct (of 28) | 85.7% | **89.3%** | **89.3%** | |
| Recall, boundary (of 23) | **82.6%** | 78.3% | **82.6%** | |
| Hard negatives triggered (of 18) | 12 | **11** | **11** | |
| Duplicates / ignored | 11 / 18 | 9 / 19 | 10 / 17 | |
| Mean IoU of matches | 48.6% | 49.5% | **51.0%** | |
| F1 at confidence = high | 67.2% | 67.7% | **70.4%** | |
| F1 at IoU ≥ 0.5 (strict) | 25.9%¹ | 30.3%¹ | **30.9%** | 29.0 ± 2.7 |

¹ Runs 1 and 2 were not re-scored at IoU 0.5 in the committed files. These two numbers were
computed for this report with the same command used for run 3.

**Per-rule F1:**

| Rule | Run 1 | Run 2 | Run 3 | Pattern |
| --- | ---: | ---: | ---: | --- |
| FP-01 First-party collection | 46.7 | 43.8 | 50.0 | Recall 78–89%, precision 30–35%: the most FPs of any rule |
| TP-02 Third-party sharing | 76.2 | 76.2 | 72.7 | Strongest rule overall |
| UC-03 User choice | 80.0 | 85.7 | 92.3 | Perfect recall; FPs fell from 3 to 1 |
| UA-04 Access/edit/delete | 55.6 | 55.6 | 52.6 | Perfect recall, 36–38% precision |
| DR-05 Retention | 71.4 | 83.3 | 76.9 | Perfect recall; varies with whether the 28-day trap fires |
| DS-06 Security | 54.5 | 54.5 | 52.2 | Same 2 misses and 2 traps every run |
| DNT-07 Do Not Track | 66.7 | 66.7 | 66.7 | Identical in every run: 3 TP, 2 FP (both traps), 1 FN |
| AI-08 AI/ML usage | 60.0 | 54.5 | 54.5 | Misses both training-data cases every run |

**Per-language F1:**

| Language | Run 1 | Run 2 | Run 3 | Notes |
| --- | ---: | ---: | ---: | --- |
| browser-js | 73.3 | 75.9 | 75.9 | 100% recall in every run |
| node | 66.7 | 64.9 | 65.0 | Most FPs in absolute terms (21–25) |
| config | 66.7 | 80.0 | 80.0 | nginx log format (NG2) always missed |
| html | 66.7 | 66.7 | 66.7 | |
| sql | 50.0 | 50.0 | 50.0 | 100% recall, 33% precision |
| **python** | **23.5** | **23.5** | **23.5** | 2 TP / 10 FP / 3 FN in every run |

### 2.2 Which run is best

**Run 3 is the best run**, by a small margin:

* the highest micro F1 (62.0%) and recall (86.3%), and the fewest misses (7)
* the fewest hard negatives triggered (11, tied with run 2)
* the tightest localization (mean IoU 51.0%)
* the best strict-IoU score (30.9%)
* the best high-confidence operating point (F1 70.4%)

The high-confidence point is the most practical one. Every one of run 3's 44 true positives is
high-confidence, so filtering to `high` costs no recall at all and removes 17 of 47 FPs.

Run 2 has a slightly higher macro F1 (65.0% vs. 64.7%) because it triggered one fewer DR-05 trap,
and runs 1 and 2 have marginally higher precision. **The runs differ by one TP and two FPs, so
"best" here means "most representative of the model on a good day", not a meaningful difference.**

The more important result is **how stable the runs are**:

* The set of matched positives is identical across all three runs except for two FP-01 labels
  (AV5 is missed in run 2, CM1 in run 1).
* The **same 7 positives are missed in all three runs**.
* **40 of run 3's 47 FPs also appear in both other runs** (same file, rule and overlapping lines).
* 9 of the 18 hard negatives are triggered in every run.

With micro F1 at 61.9 ± 0.1, three runs are enough to say the variance is small. They also show
that the errors are reproducible behavior of this model under this prompt, not noise.

### 2.3 The strict IoU 0.5 re-score of run 3

| | IoU > 0 (default) | IoU ≥ 0.5 | Change |
| --- | ---: | ---: | --- |
| TP / FP / FN | 44 / 47 / 7 | 23 / 75 / 28 | −21 TP |
| Micro P / R / F1 | 48.4 / 86.3 / 62.0 | 23.5 / 45.1 / 30.9 | F1 halved |
| Recall direct / boundary | 89.3 / 82.6 | 46.4 / 43.5 | |
| Duplicates | 10 | 3 | |
| Mean IoU of matches | 51.0% | 81.7% | Only the well-fitting matches survive |

The extra FPs come from the scoring rule, not from new mistakes: 47 + 21 TPs that fell below 0.5
+ 7 former duplicates that now overlap an *unmatched* positive = 75. No prediction changed. The
same 21 predictions are now counted as both an FP and an FN.

Per rule, the strict score shows **two different localization styles**:

| Rule | Mean IoU (run 3 matches) | TPs kept at ≥ 0.5 | What the model points at |
| --- | ---: | --- | --- |
| UA-04 | **0.93** | 5 / 5 | The whole route handler (`router.get('/me', …)` to `});`) |
| DS-06 | 0.62 | 5 / 6 | Whole config blocks (nginx TLS, RLS policies), but single lines for bcrypt |
| UC-03 | 0.46 | 3 / 6 | Mixed |
| TP-02 | 0.45 | 4 / 8 | The SDK call line (`window.gtag('config', …)`, `Sentry.init(…)`) |
| DR-05 | 0.45 | 2 / 5 | The TTL line (`ttl: 60 * 60 * 24 * 14`), `rotate 14` |
| FP-01 | 0.44 | 3 / 8 | The read (`req.body` destructuring, `watchPosition`) |
| DNT-07 | 0.34 | 1 / 3 | The `if (navigator.doNotTrack === '1')` guard |
| AI-08 | **0.29** | **0 / 3** | The model call or the threshold branch (`if score >= LOCK_THRESHOLD:`) |

At IoU ≥ 0.5, AI-08 recall drops to 0%, Python to 0 TPs, and DNT-07 to 1 of 4. **None of this
is mislocalization.** In run 3, **43 of the 44 matched predictions lie entirely inside the
labeled span**; the one exception, C1/UC-03, *over*-covers (16–45 vs. 24–42). The model points
at the exact line implementing the practice, while the labels cover the whole function. A
one-line prediction inside a 20-line span scores IoU 0.05 even when it is the most useful answer
a developer could get.

**Takeaway:** IoU ≥ 0.5 measures agreement with the labeler's choice of granularity, which the
labeling policy deliberately left loose. It is the wrong strictness for this task. A
containment- or pointing-based criterion fits the use case better: "the prediction lies inside
the span", or "the prediction contains the span's key line". By that criterion, run 3 scores
essentially the same as at IoU > 0.

### 2.4 What the numbers say about the extension at first glance

1. **It is a high-recall, low-precision detector.** It finds about 85% of labeled practices,
   with every positive found in UC-03, UA-04 and DR-05. But a reviewer sees roughly one wrong
   annotation for each correct one, and the extension's own prompt states that "precision
   matters more than volume". In a triage workflow (accept/reject in the editor) that is
   workable. As an unattended input to a policy comparison it is not.
2. **On recall, it generalizes.** Boundary recall (82.6%) is almost as high as direct (89.3%).
   SQL row-level security, `pg_cron`, logrotate, raw AES-GCM, Web Bluetooth, Meta's Conversions
   API and Stripe signature checks are all found. Section 3 shows that the **rejection** side
   does not generalize the same way.
3. **Errors concentrate in a few rule boundaries.** FP-01, UA-04 and DS-06 produce 33 of the 47
   FPs. Each is a definitional confusion that repeats across files (section 4), not scattered
   noise.
4. **Python is the weak spot.** Two Python files produce 10 FPs and 3 of the 7 misses, including
   the entire training-data pipeline in `coach.py`.
5. **Confidence carries almost no signal.** 98 of 118 findings are `high`. Still, filtering to
   `high` is free in run 3: it removes 17 FPs, about half of them clear errors, without losing a
   single TP. It should be the default view.
6. **The `crossReferences` field is never used.** It is populated in 0 of 351 findings across all
   runs, even though the prompt asks for it and the rules cross-reference heavily. Either the
   model ignores that part of the schema, or the schema doesn't make the field salient.

---

## 3. Hard negatives and false negatives (run 3)

### 3.1 Overview

| Hard negative | Rule | Tier | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | :-: | :-: | :-: |
| A3 `sendBeacon` to a relative URL | TP-02 | boundary | ✗ | ✗ | ✗ |
| A2 DNT only becomes a Sentry tag | DNT-07 | **direct** | ✗ | ✗ | ✗ |
| AU2 DNT header only logged | DNT-07 | boundary | ✗ | ✗ | ✗ |
| AC3 base64 "obfuscation" | DS-06 | boundary | ✗ | ✗ | ✗ |
| AC7 `randomBytes` token stored in plaintext | DS-06 | boundary | ✗ | ✗ | ✗ |
| CM3 member profile by arbitrary id | UA-04 | boundary | ✗ | ✗ | ✗ |
| CO4 aggregate stats posted to Slack | TP-02 | boundary | ✗ | ✗ | ✗ |
| CO4 LLM sees only aggregates | AI-08 | **direct** | ✗ | ✗ | ✗ |
| SQ1 `CREATE TABLE` | FP-01 | boundary | ✗ | ✗ | ✗ |
| AV5 28-day query window | DR-05 | boundary | ✗ | ✓ | ✗ |
| AV5 hand-written readiness formula | AI-08 | boundary | ✓ | ✗ | ✗ |
| AV4 operator env flag | UC-03 | boundary | ✗ | ✗ | ✓ |
| NG4 nginx `expires 30d` | DR-05 | boundary | ✗ | ✓ | ✓ |
| AT3 insert with no TTL | DR-05 | **direct** | ✓ | ✓ | ✓ |
| AC8 admin delete | UA-04 | **direct** | ✓ | ✓ | ✓ |
| AV1 `MAX_UPLOAD_SIZE_MB` | FP-01 | **direct** | ✓ | ✓ | ✓ |
| BL2 internal `ledger.append` | TP-02 | **direct** | ✓ | ✓ | ✓ |
| ML2 unconditional receipt email | UC-03 | **direct** | ✓ | ✓ | ✓ |

✗ = the model fell for it, ✓ = correctly not reported.

**Run 3 resisted 5 of the 7 direct hard negatives, but only 2 of the 11 boundary ones.** The five
negatives it resists in every run are near-copies of the rule's own negative worked examples. On
recall, direct and boundary cases score about the same (89% vs. 83%); on rejection, the gap is
large (71% vs. 18% resisted). **The model has learned the negative examples as templates, not the
distinction behind them.** Change the surface form one step and it falls for the trap. The two
direct negatives it still falls for (A2, CO4/AI-08) each differ from the textbook example in
exactly one detail, discussed below.

### 3.2 The hard negatives that fooled the model

#### A2 / DNT-07: a DNT value that flows into a ternary ([analytics.js:22-29](../trailmark/public/js/analytics.js#L22-L29))

```js
const dnt = navigator.doNotTrack === '1';
window.Sentry.init({ dsn: SENTRY_DSN, release: window.TRAILMARK_RELEASE, tracesSampleRate: 0.2 });
window.Sentry.setTag('dnt', dnt ? 'on' : 'off');
if (user.id) {
    window.Sentry.setUser({ id: user.id, email: user.email });
}
```

The rule's negative example *logs* the DNT value. Here the value goes into a **conditional
expression** (`dnt ? 'on' : 'off'`) that feeds a **vendor SDK call**. That literally answers yes
to two of DNT-07's elicitation questions: "Does the code branch on that signal's value?", and is
a tracking-related call involved? The model's reasoning ("Reads `navigator.doNotTrack`. Sets a
tag in Sentry based on the DNT value") is accurate. What it doesn't ask is whether the branch
*withholds* anything: `Sentry.setUser({ id, email })` runs regardless. The same span also
produced a UC-03 FP ("The Sentry tag is set based on the user's preference"). Triggered in all 3
runs.

#### AU2 / DNT-07: a DNT header that is only logged ([audience.js:10-20](../trailmark/server/middleware/audience.js#L10-L20))

```js
const dnt = req.get('DNT');
res.on('finish', () => {
    logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started, dnt }, 'request');
});
```

This *is* the rule's negative example (read, then only logged), moved to the server. The model's
reasoning ("This indicates an intention to check for Do Not Track preferences") treats reading
the signal as honoring it, which the rule explicitly rejects. In the same file, the model misses
the real GPC gate 10 lines below (FN AU1, section 3.3). For this model, DNT-07 is anchored on the
literal tokens `DNT` / `doNotTrack`, not on whether the signal controls anything.

#### A3 / TP-02: `sendBeacon` to a relative URL ([analytics.js:40-48](../trailmark/public/js/analytics.js#L40-L48))

```js
navigator.sendBeacon('/api/telemetry', JSON.stringify({ screen: name, session: telemetrySession(), user: user.id, ts: Date.now() }));
```

The model's evidence was "sends telemetry data to an endpoint, which may be external", at **low**
confidence. Here the model is following the rule: TP-02 says to flag a destination that "can't be
determined from the available code" at lower confidence. The error is that a relative URL *is*
determinable; it always resolves to the page's own origin. The same reasoning produced the TP-02
FP on `fetch('/api/me/privacy', …)` in `index.html`. Both are fixable with one sentence in the
rule.

#### AC3 / DS-06: base64 passed off as encryption ([account.js:26](../trailmark/server/routes/account.js#L26))

```js
const phoneObf = phone ? Buffer.from(phone, 'utf8').toString('base64') : null;
```

The model said: "The phone number is obfuscated using Base64 encoding … This transformation acts
as a protective measure", at **high** confidence. The identifier does the persuading:
`phoneObf`, and the column `phone_obf`, announce an *intent* to protect, and the model takes the
name at face value. **This is the most harmful error class for the extension's purpose.** The
DS-06 rule says the absence of a safeguard is something the downstream policy comparison should
discover. A policy that says "we protect your phone number" would look *supported* by this
annotation, when the code actually contradicts it. Triggered in all 3 runs.

#### AC7 / DS-06: a `randomBytes` token stored in plaintext ([account.js:77-85](../trailmark/server/routes/account.js#L77-L85))

```js
const token = crypto.randomBytes(24).toString('hex');
await db.query('INSERT INTO api_tokens (user_id, label, token) VALUES ($1, $2, $3)', [req.session.userId, req.body.label || 'default', token]);
```

The model said: "The use of crypto.randomBytes ensures that the token is generated securely".
`crypto.` is a strong lexical trigger, and the model never checks what happens to the value next
(a plaintext `INSERT`). As with AC3, the annotation would make a "credentials are stored
securely" claim look supported. (Section 4.1 notes that this label is partly arguable.)

#### CM3 / UA-04: a member profile fetched by an arbitrary id ([community.js:38-52](../trailmark/server/routes/community.js#L38-L52))

```js
router.get('/members/:id', async (req, res) => {
    const { rows } = await db.query(`SELECT id, display_name, avatar_url, home_region, readiness_score, profile_visibility
         FROM users WHERE id = $1 AND closed_at IS NULL`, [req.params.id]);
    …
    if (member.profile_visibility === 'private' && req.session.userId !== member.id) {
```

The model said: "This operation allows users to view their own profile data". The query is keyed
on `req.params.id`, *any* member. But `req.session.userId` appears in the visibility check, and
the model reads the presence of the session id as self-scoping. The same heuristic produces the
UA-04 FPs in section 4: **"the record is filtered by some user id" is being taken for "the
operation is scoped to the requester".** Triggered in all 3 runs.

#### CO4 / TP-02 and AI-08: aggregate data sent to an LLM and Slack ([coach.py:74-90](../trailmark/worker/coach.py#L74-L90))

```python
stats = db.fetch_one(
    "SELECT count(*) AS activities, coalesce(sum(distance_m), 0) AS meters, "
    "count(DISTINCT user_id) AS active_members "
    "FROM activities WHERE started_at > now() - interval '7 days'"
)
response = client.messages.create(…, "content": f"Summarize this week's platform totals in two sentences: {dict(stats)}")
requests.post(OPS_WEBHOOK, json={"text": response.content[0].text}, timeout=10)
```

AI-08 is a *direct* negative, mirroring the rule's "Summarize this aggregate sales data" example,
and still fails in every run. The difference from the example is the token `user_id` inside
`count(DISTINCT user_id)`. The model's reasoning says "uses aggregated **user data**". It also
reported this at `high` confidence, although the rule says aggregate-only AI use "should be
flagged at low confidence or not at all". For TP-02, `requests.post` to an env-configured URL is
the strongest lexical TP-02 cue in the file. The model claims the payload "includes user-related
content", but the payload is two sentences of platform totals.

#### SQ1 / FP-01: a `CREATE TABLE` ([0007_location_pings.sql:3-11](../trailmark/db/migrations/0007_location_pings.sql#L3-L11))

```sql
user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
lat         double precision NOT NULL,
lon         double precision NOT NULL,
```

The model reported two findings at medium confidence. In both, its own reasoning concedes the
point: "the actual collection operation is not shown in this SQL fragment". The prompt says type
definitions are not data practices, and the rule says the same. The model knows it, and reports
anyway at reduced confidence. The prompt's "when a match depends on context you cannot see, still
report it, but lower the confidence" seems to win over "do not stretch to produce a match".

#### AV5 / DR-05 and AI-08: the readiness score ([activities.js:40-49](../trailmark/server/routes/activities.js#L40-L49))

```js
`SELECT distance_m, avg_heart_rate FROM activities
 WHERE user_id = $1 AND started_at > now() - interval '28 days'`
…
const load = rows.reduce((sum, a) => sum + (a.distance_m / 1000) * (a.avg_heart_rate / 140), 0);
const readiness = Math.max(0, Math.min(100, Math.round(100 - load * 1.5)));
await db.query('UPDATE users SET readiness_score = $1 WHERE id = $2', [readiness, userId]);
```

* **DR-05 (runs 1 and 3).** `now() - interval '28 days'` has exactly the shape of the two real
  purges in the corpus: `created_at < now() - interval '90 days'` in `nightly.js`, and
  `recorded_at < now() - interval '72 hours'` in the migration. Only the verb (`SELECT` vs.
  `DELETE`) and the direction of the comparison differ. The model said these are records "only
  kept for the last 28 days", reading a filter as a lifetime.
* **AI-08 (runs 2 and 3).** The model said: "suggests a model-driven decision … the exact nature
  of the model or algorithm used … is not visible". The algorithm is fully visible two lines
  below. A function that outputs a *score* about a user and persists it is enough to trigger
  AI-08.

### 3.3 The false negatives

All 7 run 3 misses are also missed in runs 1 and 2.

| Span | Rule | Tier | What the model did instead |
| --- | --- | --- | --- |
| AU1 server-side `Sec-GPC` gate | DNT-07 | boundary | Reported the same line as UC-03 (optional), and DNT-07 on the *dead* DNT read |
| AC8 `requireRole('support')` | DS-06 | direct | No finding of any kind on lines 104-107 |
| AV6 ownership check in `WHERE` | DS-06 | boundary | Reported UA-04 (correct) and DR-05 (wrong) |
| CO3 health data sent to Anthropic | TP-02 | direct | Reported AI-08 (correct); TP-02 went only to the Slack post |
| CO1 `include_in_training = True` | AI-08 | direct | Reported FP-01 (optional) and DS-06 (wrong) |
| CO2 `coach_sft` JSONL export | AI-08 | boundary | No finding of any kind on lines 28-38 |
| NG2 nginx `log_format` | FP-01 | boundary | No FP-01 finding anywhere in `nginx.conf` |

#### AU1 / DNT-07: GPC honored server-side ([audience.js:22-41](../trailmark/server/middleware/audience.js#L22-L41))

```js
const gpcOptOut = req.get('Sec-GPC') === '1';
if (eventName && req.method === 'POST' && req.session?.userId && !gpcOptOut) {
    const userData = new UserData().setExternalId(String(req.session.userId)).setClientIpAddress(req.ip)…
```

Two things mislead the model:

1. **The name `gpcOptOut`.** "Opt-out" is UC-03 vocabulary, and the model filed the line there
   ("checks the 'Sec-GPC' header to determine if the user has opted out of tracking"), but never
   under DNT-07.
2. **The gate is the fourth term of a compound condition.**

The client-side equivalent, `choices.marketing && navigator.globalPrivacyControl !== true` in
`consent.js`, is found under DNT-07 in every run. So the model knows GPC; it just doesn't connect
the `Sec-GPC` *header* to the signal family that `navigator.doNotTrack` belongs to. Combined with
the AU2 false positive, the DNT-07 annotations on this file are **inverted**: the extension tells
the reviewer DNT is handled on the line that ignores it, and stays silent on the line that
enforces GPC.

#### AC8 / DS-06: role-based authorization ([account.js:104-107](../trailmark/server/routes/account.js#L104-L107))

```js
router.delete('/admin/members/:id', requireRole('support'), async (req, res) => {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
```

The model correctly declines UA-04 here: this is the rule's own negative example, which never
fails. But it doesn't follow the rule's hint that such code is "better evaluated under DS-06".
The guard is a middleware call implemented elsewhere (`../lib/guards`). Notably, the model *does*
report `requireAuth` on `POST /trails/:trailId/comments` as DS-06, which is optional and so
ignored. The two guards have the same shape; the labels differ because one is authentication and
the other authorization. Either the model doesn't see `requireRole` as a security mechanism, or
it is losing attention at the end of the file: lines 104-107 are the last route of a 109-line
file, and they received **no finding of any category** in run 3. This report can't separate the
two explanations.

#### AV6 / DS-06: ownership check folded into SQL ([activities.js:70-79](../trailmark/server/routes/activities.js#L70-L79))

```js
const result = await db.query('DELETE FROM activities WHERE id = $1 AND user_id = $2', [req.params.id, req.session.userId]);
if (result.rowCount === 0) { return res.status(404).end(); }
```

The `AND user_id = $2` clause is the object-level authorization that prevents one user from
deleting another's activity (IDOR protection). The model reads the very same clause as evidence
of UA-04 ("filters by user_id, ensuring only the requesting user can delete their own activity").
That sentence describes access control, yet the model doesn't file it under DS-06. It recognizes
authorization only when it looks like a guard (`if (owner !== user) return 403`) or a named
middleware, not when it is a predicate inside a query.

#### CO3 / TP-02: personal and health data sent to Anthropic ([coach.py:41-71](../trailmark/worker/coach.py#L41-L71))

```python
client = anthropic.Anthropic()          # line 17
…
response = client.messages.create(      # line 55
    model=COACH_MODEL,
    messages=[{"role": "user", "content": (
        f"Write a four-week hiking plan for {member['display_name']} "
        f"(born {member['birth_date']}, readiness {member['readiness_score']}/100).\n"
        f"Recent activities:\n{history}")}])   # history = dates, distances, avg heart rate
```

This is arguably **the most sensitive data flow in the corpus**: name, date of birth, a
health-derived score and heart-rate history, sent to an external AI provider. The model catches
it as AI-08 in every run, but never as TP-02. Two things work against it:

* **The vendor isn't named where the data leaves.** At line 55 the call site says `client.`, and
  the binding to `anthropic` is 38 lines earlier. Compare CM2 in `community.js`, which is caught
  as TP-02 in every run: there the call is `openai.moderations.create(…)`, with the vendor name
  in the receiver identifier.
* **A more obvious outbound call sits in the same file.** The only TP-02 finding in `coach.py` is
  the `requests.post(OPS_WEBHOOK, …)` at line 90, which is a hard negative.

The model's TP-02 trigger appears to be lexical: a vendor name or an HTTP verb at the call site.
In practice, a policy comparison that filters on third-party sharing would miss this flow
entirely.

#### CO1 and CO2 / AI-08: the training-data pipeline ([coach.py:20-38](../trailmark/worker/coach.py#L20-L38))

```python
def record_feedback(user_id, transcript, rating):
    db.execute(
        "INSERT INTO coach_feedback (user_id, transcript, rating, include_in_training, created_at) "
        "VALUES (%s, %s, %s, %s, %s)",
        (user_id, json.dumps(transcript), rating, True, datetime.now(timezone.utc)),
    )

def export_sft_batch(since):
    rows = db.fetch_all("SELECT transcript FROM coach_feedback WHERE created_at >= %s AND rating >= 4", (since,))
    …
    out.write(json.dumps({"messages": json.loads(row["transcript"])}) + "\n")
```

AI-08's own second worked example is almost this exact function:
`{"user_id", "transcript", "rating", "used_for_finetuning": True}`. Yet CO1 is missed in every
run. The structural difference is that in the rule example the flag is a **key–value pair**,
while here the flag name is a column inside a SQL string, and its value `True` is the fourth
element of a separate tuple. Recognizing the practice requires lining up the column list with
the value tuple, and the model doesn't do it. It reports the function under FP-01 and, wrongly,
under DS-06 ("lacks explicit security measures"). The table name `coach_feedback` gives no hint
of training.

CO2 is the second half of the pipeline: it selects the highly rated transcripts (`rating >= 4`,
a typical quality filter for fine-tuning data) and writes them as chat-format JSONL
(`{"messages": …}`) into `datasets/coach_sft`. The only cues are the abbreviation `sft` and the
data shape, and the model reports nothing on this function at all.

Together, these two misses mean **the extension does not detect the training/fine-tuning
sub-pattern at all** in this corpus. That is the sub-pattern the AI-08 rule singles out as the
most consequential, because model weights cannot easily be made to forget the data, so deleting
the source record (UA-04) doesn't undo the use.

#### NG2 / FP-01: collection declared in nginx config ([nginx.conf:6-7](../trailmark/deploy/nginx.conf#L6-L7))

```nginx
log_format trailmark '$remote_addr - $remote_user [$time_local] "$request" '
                     '$status $body_bytes_sent "$http_referer" "$http_user_agent" $request_time';
```

The model found the TLS block in this file (DS-06), and the log *rotation* in the logrotate
config (DR-05). It never treats the log format as *collection* of IP addresses and User-Agents.
The difference tracks the rule text: DR-05 explicitly mentions "log-rotation settings", while
FP-01's text speaks only of operations in code (requests, sensors, computations). On top of that,
the prompt's grounding rule ("static configuration constants are not by themselves data
practices") pushes directly against reading a config directive as a practice. **In config
formats, recall follows whether the rule text names the format.**

---

## 4. False positives (run 3): errors, or practices the labels missed?

The extension's stated purpose is to surface practices a developer might not be aware of. A
false positive measured against human labels is therefore not automatically a defect: the human
may have missed something. Each of the 47 FPs is placed in one of three groups:

| Group | Count | Meaning |
| --- | ---: | --- |
| **A. Defensible: a case for relabeling** | 11 | The rule's own text supports the model's reading; the label or the rule should change |
| **B. Right code, wrong rule** | 12 | The model points at genuinely privacy-relevant code, but under a category the rules exclude |
| **C. Clear errors** | 24 | No reasonable reading of the rule supports the finding |

Taking the model's side on every group-A item, precision would rise from 48.4% to **55.0%**
(44 / 80). Counting every finding that points at privacy-relevant code (TP + A + B), **67 of 91
(74%)** findings would be useful to a reviewer. That is an informal upper bound, not a metric,
but it shows the gap between "agrees with the labels" and "useful".

FPs by rule in run 3: FP-01 15, UA-04 9, DS-06 9, TP-02 5, DR-05 3, AI-08 3, DNT-07 2, UC-03 1.

### 4.1 Group A: the case for revising labels or rule text (11)

#### FP-01 on data handed to vendors (7)

| Location | Code |
| --- | --- |
| [consent.js:32](../trailmark/public/js/consent.js#L32) | `window.analytics.identify(user.id, { plan: user.plan, region: user.homeRegion });` |
| [consent.js:38](../trailmark/public/js/consent.js#L38) | `window.fbq('init', META_PIXEL_ID, { external_id: user.id });` |
| [analytics.js:18](../trailmark/public/js/analytics.js#L18) | `window.gtag('config', GA_MEASUREMENT_ID, { user_id: user.id });` |
| [analytics.js:27](../trailmark/public/js/analytics.js#L27) | `window.Sentry.setUser({ id: user.id, email: user.email });` |
| [audience.js:22-39](../trailmark/server/middleware/audience.js#L22-L39) | `new UserData().setExternalId(…).setClientIpAddress(req.ip).setClientUserAgent(req.get('User-Agent'))` |
| [mailer.js:10-19](../trailmark/server/services/mailer.js#L10-L19) | `sendTrailDigest`: `to: member.email`, `{ name: member.display_name, region: member.home_region }` |
| [mailer.js:22-33](../trailmark/server/services/mailer.js#L22-L33) | `sendReceipt`: `to: member.email`, billing amounts |

The labeling policy puts all of these under TP-02 only, where every one is already a matched
positive. That follows FP-01's fourth elicitation question ("rather than through a call to an
external service, which belongs to TP-02 instead"). But FP-01 is *First Party Collection/**Use***,
and its base description says the app "collects, generates, infers, **or utilizes** user
information". Under OPP-115, from which the rule is adapted, sending a personalized marketing
digest *is* a first-party use of the email address and home region for a marketing purpose.
`audience.js` adds something the TP-02 label alone doesn't say: the server itself **reads the
client IP and User-Agent from the request** in order to send them. That is a collection step,
even though it exists only to feed Meta.

The rule text contradicts itself, and the model consistently follows the "utilizes" reading. Two
fixes, depending on intent:

* **If FP-01 should mean acquisition only**, remove "or utilizes" from the base description, and
  add a TP-02-style negative example to FP-01: a vendor SDK called with already-held user data.
* **If double-flagging is acceptable**, mark FP-01 optional on these spans, as is already done
  for `ledger.append` (BL2).

Either way, this one decision accounts for 15% of all FPs.

#### DS-06 on account anonymization ([account.js:91](../trailmark/server/routes/account.js#L91))

```sql
SET email = NULL, password_hash = NULL, phone_obf = NULL, display_name = 'Former member', closed_at = now()
```

The model said: "The removal of sensitive information is a security measure to protect user
data", at medium confidence. The labels treat this span as UA-04 (account closure) and DR-05
(deferred erasure). But de-identifying a closed account *is* a technical safeguard against later
disclosure, and GDPR Art. 32(1)(a) names pseudonymisation as a security measure. **Recommend
marking DS-06 optional on AC6.**

#### TP-02 on the Stripe webhook ([billing.js:12](../trailmark/server/routes/billing.js#L12), [billing.js:21](../trailmark/server/routes/billing.js#L21))

```js
event = stripe.webhooks.constructEvent(req.body, req.get('Stripe-Signature'), process.env.STRIPE_WEBHOOK_SECRET);
…
userId: Number(invoice.metadata.userId),
```

The model's stated reasoning is weak ("processes incoming webhook data … from a third-party
service"); TP-02 is about data *leaving*. But the code does carry evidence of third-party
sharing: `invoice.metadata.userId` can only exist because Trailmark **sent its internal user id
to Stripe** when it created the customer or subscription, in code outside this corpus. TP-02 is
"Third Party Sharing/**Collection**", and Stripe receives payment data about Trailmark users. The
labeling policy already marks "call sites of helpers implemented elsewhere" as optional (AV3
TP-02). This is the mirror case: the receiving end of a sharing relationship implemented
elsewhere. **Recommend marking TP-02 optional on BL1 (lines 10-19).** That would absorb the
line-12 finding; the line-21 finding (`if (event.type === 'invoice.paid')`) also falls inside
BL1.

#### DS-06 on the `randomBytes` token ([account.js:78](../trailmark/server/routes/account.js#L78))

This is a hard negative (section 3.2), but it is only half wrong. A CSPRNG-generated token *is*
a real safeguard against token guessing (compare `Math.random()`). What is missing is protection
at rest. The labeled span mixes one safeguard with one absent safeguard. **Recommend keeping the
hard negative**, because the plaintext `INSERT` is the privacy-relevant fact, but noting in the
label's `probe` that the generation half is defensible.

### 4.2 Group B: right code, wrong rule (12)

These findings would be rejected under any reading of the rules, but each points at code a
privacy reviewer would want to see.

**The public member profile** ([community.js:38-51](../trailmark/server/routes/community.js#L38-L51)):
FP-01 at line 42 and UA-04 over the handler (the CM3 hard negative).

```js
router.get('/members/:id', async (req, res) => {        // no requireAuth
    … SELECT id, display_name, avatar_url, home_region, readiness_score, profile_visibility FROM users WHERE id = $1 …
```

This is the most interesting group-B case. The route has **no `requireAuth`**: anyone,
including unauthenticated visitors, can fetch the `home_region` and `readiness_score` of any
member whose visibility isn't `private`. `readiness_score` is derived from heart-rate data in
`refreshReadiness` (activities.js:40-49). So the code **publicly exposes a health-derived score**,
and the default value of `profile_visibility` is not visible in the corpus. The labels capture
only the visibility toggle (UC-03 positive, DS-06 optional). The model labels the finding wrongly
twice, but it is drawn to exactly the right handler. None of the eight rules covers *disclosure
to other users or the public*, which OPP-115 handles partly through its "Audience" categories.
The model is filling a gap in the taxonomy as best it can.

**The readiness score as AI-08** ([activities.js:40-48](../trailmark/server/routes/activities.js#L40-L48),
the AV5 hard negative). The formula is not ML, so the label is correct. But it is automated
*profiling*: a score computed about a person from health data, persisted, and then exposed by
the endpoint above. GDPR's notion of profiling doesn't require ML. AI-08's scope is explicitly
"AI/ML", so this stays a negative, but the attention is well placed.

**The DNT dead reads** ([analytics.js:23-25](../trailmark/public/js/analytics.js#L23-L25) as
DNT-07 and UC-03, and [audience.js:12](../trailmark/server/middleware/audience.js#L12) as
DNT-07). The DNT-07 rule itself says the read-but-ignored pattern "is itself useful evidence for
the downstream comparison stage". The model surfaced both dead reads, which is the useful part.
What is wrong is the label: a `DO_NOT_TRACK` finding reads as "DNT is honored here". The finding
format has no way to say *signal read, not honored*. The underlying behavior matters: a DNT=1
user still has their **email sent to Sentry** (analytics.js:27). On the server, a DNT=1 user
without GPC is still **sent to Meta's Conversions API**, because `syncConversions` checks only
`Sec-GPC`. The fix belongs in the schema, not the labels; see section 5.

**The location schema** ([0007_location_pings.sql:5](../trailmark/db/migrations/0007_location_pings.sql#L5),
[:7-8](../trailmark/db/migrations/0007_location_pings.sql#L7-L8), the SQ1 hard negative). The
rule is clear that a schema is not collection, but a migration that adds
`lat double precision NOT NULL` to a `location_pings` table is the most concrete evidence in the
repository of *what* is stored. For a policy comparison ("we collect your precise location only
while you record a hike"), that is valuable. A data-inventory signal separate from the eight
practice rules would capture it without weakening FP-01.

**Sensitive storage reported as DS-06** ([coach.py:20-25](../trailmark/worker/coach.py#L20-L25)).
This is the `record_feedback` insert, the CO1 training-data span that AI-08 missed. The model
noticed that chat transcripts were being stored, and said "lack of visible security controls".
It found the right code but reasoned from an *absent* safeguard, which DS-06 forbids.

**Read-backs and account closure as FP-01** ([account.js:14-21](../trailmark/server/routes/account.js#L14-L21)
`GET /me`, [account.js:51-73](../trailmark/server/routes/account.js#L51-L73) `GET /me/export`,
[account.js:88-94](../trailmark/server/routes/account.js#L88-L94) `POST /me/close`). All three
handlers are already UA-04 true positives, so the model also reports them as FP-01 because they
read or modify user data. The labeling policy excludes this explicitly. It is the same
"utilizes" ambiguity as group A, applied to the user's own data, and it would disappear with the
same rule fix.

### 4.3 Group C: clear errors (24)

These group into five recurring misreadings. Each traces to a specific cue in the code.

**1. "Filtered by a user id" taken to mean "self-service" (UA-04, 8 FPs).** These are the
largest single source of FPs:

| Location | Code | Model's claim |
| --- | --- | --- |
| [activities.js:51-67](../trailmark/server/routes/activities.js#L51-L67) | `INSERT INTO activities (user_id, …) VALUES ($1 …)` with `req.session.userId` | "self-service creation of the user's own data" |
| [community.js:20-35](../trailmark/server/routes/community.js#L20-L35) | `INSERT INTO comments (… author_id …)` with `req.session.userId` | "self-service operation" |
| [screening.py:34-36](../trailmark/worker/screening.py#L34-L36) | `UPDATE users SET status = 'locked', locked_reason = 'signup_risk' WHERE id = %s` | "allowing them to modify their own account status" |
| [screening.py:53](../trailmark/worker/screening.py#L53) | `UPDATE signup_signals SET screened_at = now() WHERE user_id = %s` | "allowing them to modify their own screening status" |
| [coach.py:41-71](../trailmark/worker/coach.py#L41-L71) | `build_training_plan(user_id)` | "allowing users to generate their own training plans" |
| [0007…sql:22](../trailmark/db/migrations/0007_location_pings.sql#L22), [:28](../trailmark/db/migrations/0007_location_pings.sql#L28) | `WHERE user_id = current_setting('app.current_user_id')::bigint` | "users to access their own location pings" |
| [audience.js:25](../trailmark/server/middleware/audience.js#L25) | `if (eventName && req.method === 'POST' && req.session?.userId …)` | "a user-initiated action" |

The screening entries show the problem most clearly. A machine-learning model *locking a user's
account* is the opposite of self-service, yet it is reported as the user modifying their own
status, because the `UPDATE` ends in `WHERE id = %s`. The RLS `SELECT` policy actually exposes
*other* hikers' locations to group members. The UA-04 rule says "scoped to the requesting user's
own identifier", but the model checks only that *some* user identifier scopes the query, not
where the identifier comes from (session vs. path vs. a worker loop). It also treats *creating* a
record as within UA-04, which covers view, correct, export and delete. Both points need negative
examples in the rule.

**2. "Touches sensitive data" taken to mean "protects it" (DS-06, 6 FPs).**

* [audience.js:26-33](../trailmark/server/middleware/audience.js#L26-L33): building Meta's
  `UserData` ("does not explicitly show encryption").
* [coach.py:70](../trailmark/worker/coach.py#L70): inserting a training plan ("lacks explicit
  security measures").
* [account.js:26](../trailmark/server/routes/account.js#L26): base64 (section 3.2).
* [community.js:28](../trailmark/server/routes/community.js#L28) and
  [:30](../trailmark/server/routes/community.js#L30): content moderation and hiding a flagged
  comment, which is content safety, not data security.
* [screening.py:33-36](../trailmark/worker/screening.py#L33-L36): fraud locking ("safeguard
  against unauthorized access"), which protects the platform from the user rather than the
  user's data.

Two of the model's own justifications state that *no* safeguard is present, the exact case the
rule tells it not to annotate. Four of the six are medium confidence.

**3. Time arithmetic and deletes taken for retention (DR-05, 3 FPs).**

* The 28-day window ([activities.js:42-43](../trailmark/server/routes/activities.js#L42-L43),
  section 3.2).
* The user-initiated `DELETE FROM activities WHERE id = $1 AND user_id = $2`
  ([activities.js:71-74](../trailmark/server/routes/activities.js#L71-L74)): "a mechanism for
  purging data". That is a deletion right (UA-04, already matched), not a time limit.
* `UPDATE signup_signals SET screened_at = now()`
  ([screening.py:53](../trailmark/worker/screening.py#L53)): "a retention mechanism for tracking
  when a user was screened". Writing a timestamp is not a retention policy.

The model treats `now()`, `interval` and `DELETE` as retention cues regardless of what the
statement does.

**4. Destinations it could determine but didn't (TP-02, 3 FPs).**

* The relative `fetch('/api/me/privacy', …)` in
  [index.html:36-40](../trailmark/public/index.html#L36-L40): "may be external depending on the
  server configuration".
* The relative `sendBeacon` (A3).
* The Slack post of aggregates (CO4).

**5. Plumbing and AI by association (4 FPs).**

* `app.use(express.json({ limit: '1mb' }))`
  ([app.js:22](../trailmark/server/app.js#L22)) reported as FP-01 because request bodies "may
  contain user data". This is the same kind of statement as the `MAX_UPLOAD_SIZE_MB` negative,
  which the model resists.
* `pending_screenings()` ([screening.py:44-47](../trailmark/worker/screening.py#L44-L47)), which
  selects user ids for a batch job, reported as FP-01.
* Meta's Conversions API reported as AI-08
  ([audience.js:22-38](../trailmark/server/middleware/audience.js#L22-L38)) because it "likely
  involves AI/ML processing for conversion tracking". Meta does optimize ads with ML downstream,
  but nothing in the code invokes a model, and the rule asks for a visible model operation.
* The aggregate ops digest reported as AI-08
  ([coach.py:80-90](../trailmark/worker/coach.py#L80-L90), the CO4 hard negative, section 3.2).

### 4.4 What neither the labels nor the model caught

The labeling policy and the rules never annotate *absences*, by design. So neither the labels
nor the extension can express the most important finding in Trailmark: **the four tracking paths
honor three different, inconsistent signals.**

| Destination | Gated by consent choice | Honors DNT | Honors GPC |
| --- | :-: | :-: | :-: |
| Google Analytics (`analytics.js:6-20`) | **no** | yes | no |
| Sentry: id + email (`analytics.js:22-29`) | no | **no** (tag only) | no |
| Segment (`consent.js:30-35`) | analytics | no | no |
| Meta Pixel, client (`consent.js:36-41`) | marketing | no | yes |
| Meta Conversions API, server (`audience.js:22-41`) | **no** | **no** (logged only) | yes |
| First-party telemetry (`analytics.js:40-48`) | no | yes | no |

* Google Analytics loads **before and regardless of** the cookie banner's "Product analytics"
  choice.
* The server-side Conversions API sends conversion events to Meta for users who **declined
  "Personalised ads"** in the banner, unless their browser happens to send GPC. The client-side
  Pixel respects that same choice.

This contradiction spans several files, and it is exactly what a privacy policy ("we only share
data with advertising partners if you opt in") would be checked against. A per-file, per-rule
annotator cannot see it, and nothing in the current pipeline puts the per-file annotations side
by side. That is a design observation for the downstream comparison stage, not a scoring issue.

---

## 5. Recommendations

The errors are systematic, so each item below should move the metrics measurably on a re-run.

**Rule text** (`src/rules/catalog.ts` and `docs/privacy-detection-information-categories.md`):

1. **FP-01:** settle "collects … or utilizes". Either drop "utilizes", or accept double-flagging
   and relabel. This alone affects 7–10 FPs per run.
2. **UA-04:** add negative examples for (a) a worker or automated process updating a user row by
   id (the screening lock), and (b) a user *creating* a record. State that the identifier must
   come from the authenticated session.
3. **DS-06:** add base64 / encoding as an explicit negative example. Add "an ownership predicate
   in a query (`WHERE … AND user_id = <session id>`)" and role middleware as positive examples.
4. **TP-02:** state that relative URLs and same-origin paths are first-party. Add a positive
   example where the SDK client is constructed far from the call site (`client = Vendor()` …
   `client.x.create(...)`).
5. **DNT-07:** add the `Sec-GPC` header to a positive example. Add a negative example where the
   signal is used in an expression (a tag or a log field) without withholding anything.
6. **AI-08:** add a training-data example where the flag is a SQL column with a positional value,
   and an example of an SFT / JSONL export. Repeat the aggregate-data instruction in the
   elicitation questions as a "no match" condition, not only a confidence hint.
7. **FP-01:** name server and log configuration (`log_format`, access-log fields) as a form of
   collection, the way DR-05 already names log rotation.

**Prompt and schema:**

8. Add a polarity or sub-type field (e.g. `"implemented" | "read_not_enforced"`) so that dead DNT
   reads and decorative "safeguards" can be reported as useful evidence without claiming the
   practice is honored.
9. Make the conflict between "report with lower confidence when context is missing" and "don't
   stretch" explicit. The schema-definition and relative-URL FPs both come from the first
   instruction overriding the second.
10. Investigate why `crossReferences` is always empty, for example by moving it earlier in the
    schema or adding it to the worked examples.

**Evaluation:**

11. Mark FP-01 optional on vendor-call spans (or fix the rule; see 1), mark DS-06 optional on AC6,
    and mark TP-02 optional on BL1.
12. Add a containment-based matching mode to `score.mjs` (prediction inside the span) and report
    it alongside IoU > 0. Drop IoU 0.5 as the strict setting for this task.
13. Show `minConfidence: high` in the extension by default, since it costs no recall here.
14. Pin a named model (`privAnnotate.model.id`) for future runs, so results can be attributed and
    compared across models. "auto" may change underneath you.

---

## Appendix: reproducing these numbers

From the repository root:

```bash
for i in 1 2 3; do
  node evaluation/tools/score.mjs --pred evaluation/results/copilot-auto-findings-$i.json
  node evaluation/tools/score.mjs --pred evaluation/results/copilot-auto-findings-$i.json --iou 0.5
done
```

The default-setting output for runs 1–3, and the IoU 0.5 output for run 3, match the committed
`copilot-auto-score-*.json` files exactly. (`copilot-auto-score-1.json` records its input as
`results/copilot-auto-findings.json`, the file's name before it was numbered; re-scoring
`copilot-auto-findings-1.json` gives identical results.) The IoU 0.5 figures for runs 1 and 2 in
section 2.1 come from the second command. The cross-run stability, containment and group counts
in sections 2–4 were computed from the `outcomes` arrays of the score files and the
`evidence`/`reasoning` fields of the manifests.
