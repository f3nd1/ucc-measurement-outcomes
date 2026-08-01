# Bench-verify registry

Phase 1 was authored **without a live Frappe bench**. Every assumption that
depends on the real UCC system is listed here and also carries an inline
`TODO: bench-verify` token. Find them all with:

```bash
grep -rn "TODO: bench-verify" frappe-app/
```

The bench-connected (OrbStack) session must resolve each before install/migrate.

## Rate limiting on the guest endpoint — MUST be verified over HTTP

The first real bench test run (Frappe **v15.83.0**) found `api/public.py`
decorated with `@frappe.rate_limit(...)`. **That function does not exist** —
the decorator lives at `frappe.rate_limiter.rate_limit`. The module raised
`AttributeError` at import, which took four tests with it. Now fixed:
`from frappe.rate_limiter import rate_limit`, imported directly with **no
try/except fallback** — a module that imports cleanly while silently dropping
the protection on the only guest-writable endpoint is worse than one that
refuses to load.

**Unit tests cannot prove this works.** Frappe's wrapper begins with
`if not frappe.request: return fun(*args, **kwargs)`, so it no-ops for
in-process calls (bench console, `run-tests`). `test_public_endpoints_are_rate_limited`
only asserts the decorator is *attached*.

Prove it behaviourally, logged out, against a real campaign token:

```bash
TOKEN=<a campaign public_token>
for i in $(seq 1 25); do
  printf "%2d -> " "$i"
  curl -s -o /dev/null -w "%{http_code}\n" \
    "http://ucc.local/api/method/ucc_measurement_outcomes.api.public.get_public_survey?token=$TOKEN"
done
```

Expect `200` for the first 20, then **`429`**. If it stays `200` for all 25,
rate limiting is NOT active — do not expose the public form until it is.
Note the limit keys on `token`, so each campaign gets its own budget; confirm
20/hour suits real respondent traffic before go-live.

## Asset caching — resolved, but know the rule

`/assets/<app>/` is served with `Cache-Control: max-age=31536000` (one year).
That is **correct Frappe behaviour**, not a misconfiguration to "fix" in nginx:
core assets are safe to cache that hard because esbuild gives them
content-hashed filenames, so any change yields a new URL.

Referencing plain files in `app_include_js` opts out of that hashing and pins
them at fixed URLs for a year. This caused a real, repeating bug: a browser
holding a pre-`setEmpty()` copy of `node_canvas.js` made `canvas.setEmpty()` a
TypeError, killing Mapping Studio and Index Studio mid-construction, while
pages whose filenames had changed worked fine — and no amount of `bench build`,
`clear-cache` or `restart` could shift it, because the server was never the
problem.

**Rule:** shared front-end components go in
`public/js/ucc_measurement_outcomes.bundle.js` (esbuild only bundles
`*.bundle.js`). Never add another absolute `/assets/...` path to
`app_include_js`. A `bench build` whose `File | Size` table is **empty** means
nothing was bundled — treat that as a red flag, not a normal result.

Page JS (`<module>/page/<page>/<page>.js`) is unaffected: Frappe reads it
server-side and ships it in the `getpage` response, so `bench --site … clear-cache`
is enough for those.

## Pass 1 self-review (deep review session) — claim verification

Independent re-verification of the prior sessions' claims. Outcome per claim:

| Claim | Verdict |
|---|---|
| Version immutability (content) | **FAILED — fixed.** The guard only blocked *status transitions*; a Published→Published save could rewrite a survey version's header/snapshots (F2), a published index version's entire formula via `save_nodes` (F1, whose comment falsely claimed it was blocked), and a question/section could be re-parented OUT of a published version because only the destination version was checked (F3). All three now guarded (`frozen_fields_blocked`, `assert_doc_version_editable`, formula signature); adversarial bench-run tests in `test_integration_chain.py`. |
| Guest endpoint (token, one-response, atomic) | **Held, with 2 fixes.** Token + atomicity confirmed by trace. One-response check was check-then-insert (race, F4) — submit path now locks the campaign row (`for_update`). Non-dict answer items caused a 500 instead of a clean validation error (F5) — now rejected. Anonymous double-submit remains allowed by design (#11). Duplicate question entries in one payload: last-wins, silent (documented, not changed). |
| Step 1 audit "0 field mismatches" | **Held.** Re-run fresh with stronger checks (24 Links, 4 Table targets, fetch_from, full Explorer catalogue, API field refs): clean. |
| Index Results immutable | **Held for the result row; provenance hole fixed.** `UCCIndexResult` blocks edits, but the published formula it references was mutable (F1, above). Note: results can still be **deleted** (no on_trash guard) and `frappe.db.set_value` bypasses validate (framework-inherent) — both documented, not changed pending Felix's call on audit-trail requirements. |
| Explorer rejects off-catalogue | **Held for doctypes/fields/measures; filter-value hole fixed.** List/dict filter values smuggled frappe filter *operators* past the equality-only contract (F6) — values now restricted to scalars. |
| 9 suites pass | **Held, but assertion gap confirmed:** the versioning suite explicitly asserted Published→Published is unblocked — true for the transition guard, but nothing tested content freezing (the F1/F2 hole). New tests added (`test_frozen_content`, `test_structural_issues`, 3 adversarial bench-run classes). |

Also fixed in this pass: **F8** — `index_calc._load_metric_values` claimed "latest"
metric result but used unordered `get_value` (nondeterministic pick); now ordered
by `calculation_date desc`. **F9** — item #22's cycle check was deferred as
bench-work but is pure logic: `structural_issues()` (single root, no dangling
parents, no duplicate keys, no cycles) now runs in `validate_index`, so a
structurally broken formula cannot be published (compute_index silently ignores
unreachable nodes — that silence is why publish must block it).

| # | New assumption | Where | Action on bench |
|---|---|---|---|
| 47 | `frappe.get_doc(..., for_update=True)` row-locks on the target version | `api/public._get_open_campaign` | Confirm locking semantics; without it the one-response race (F4) reopens |
| 48 | Layout-only edits (`pos_x`/`pos_y`) on a *published* index version stay allowed | `ucc_index_version._formula_signature` | Confirm this interpretation with Felix (canvas layout ≠ formula content) |

## Pass 2 fresh bug hunt (deep review session)

Fixed (each with its reproducing test):

| Finding | Fix |
|---|---|
| **F10** Unknown/missing normalisation rule silently clamped the raw value into 0-100 (Likert 4 with a lost rule became 4/100 and poisoned every index above it) | `normalise()` now returns None (unscoreable) for unknown rules; pure tests |
| **F11** Negative weights were publishable — `weights_valid` only checks the sum, so 120 + (-20) passed as 100 | `structural_issues()` flags negative weights; runs at validate/publish |
| **F12** Question sequences drifted sparse after deletions, breaking every position==sequence assumption: drop-at-position landed one slot late, duplicate landed after the wrong row, append could land mid-list | One `_resequence()` helper (dense 0..n-1, optional insert gap) used by add/delete/bulk-delete/bulk-paste/copy/duplicate-section; bench-run ordering tests |
| **F13** `create_index_from_template` numbered versions by count() — deleting V01 of V01+V02 made the "next" number V02 → DuplicateEntry crash | Probe for the next free number; bench-run test |
| **F14** Filter bar kept a stale tracked value when `setOptions` removed the selected option — `get()` then filtered on an option that no longer existed | `setOptions` re-syncs the tracked value; no JS harness exists in the repo (see report), fix documented inline |

**#44 undo/redo — precise characterisation (documented, NOT fixed; fix is not small):**
the desync boundary is exactly: *any history action whose payload embeds question
names (reorder lists, bulk-delete name lists), undone or redone after a
delete+undo pair has recreated one of those names under a new id.* The replayed
action then references the dead name and the server rejects it ("Question X is
not part of this version"). Compounding it, the JS `_call` wrapper only resolves
on success, so a failed undo leaves the action popped from history but never
pushed to future — the entry is silently lost and the stacks are inconsistent
until reload. A proper fix is an id-remapping table consulted by every action
constructor (touches all six action types) — deferred as beyond a surgical
change. Linear undo/redo without interleaved deletes remains correct.

Reported, deliberately not changed (working or latent-only):
- `explorer_agg.aggregate` row/column sort would TypeError on mixed str/int
  dimension values — unreachable with today's all-string catalogue dimensions;
  becomes real if a numeric dimension is ever catalogued.
- `bulk_parse` drops anything after a third `|` on a line (options containing
  pipes); prototype-inherited contract.
- `data_explorer.js` disables pending datasets via a quote-fragile
  `option:contains` selector — harmless: the server independently rejects
  pending datasets.
- `survey_builder.js` appends its modal to `document.body` once per page load;
  single instance per Desk session, acceptable.
- Unused-import sweep across all `.py`: **clean**.
- Removed tracked `.DS_Store` (junk predating the `.gitignore` that excludes it).

## Pass 3 vague-spec interpretations — DECIDED (Felix, 2026-07-24)

Outcomes, applied where code-able in this environment:

| # | Decision | Status |
|---|---|---|
| V1 | **Hide** display-logic UI until a logic engine exists (engine must ship with a server-side logic-aware required check) | ✅ Applied — controls removed from builder inspector; fields hidden in the DocType, schema kept |
| V2 | **Both gates**: public submission requires version **Published** (blocks Draft/In Review/Closed — the Draft case was a lurking only-published-content violation) and survey not Archived | ✅ Applied in `_get_open_campaign` + 2 bench tests |
| V3 | **Target-based** response rate (`completed / target_responses`); invitation-based later | 📋 Bench work item |
| V4 | **Nightly scheduler job + manual recalculate button** | 📋 Bench work item (worker/queue confirm) |
| V5 | **Consolidate on "Section Heading"** question type | ✅ Applied — `UCC Survey Section` doctype, `duplicate_section` API and the question `section` Link removed (zero migration cost: never installed anywhere) |
| V6 | 1:1 vs multi-objective: **decide from the real mapping PDF** — unreadable in this container (image-based; no poppler) | ⛔ **HARD GATE before data import**: check `reference-documents/02-…mapping-v02.pdf` on the bench; if any question maps to >1 objective, drop the `unique` constraint BEFORE importing |
| V7 | Multi-select stored as **JSON array** | ✅ Applied in `to_text` + pure test (comma-in-label round-trip) |

Original analysis (what the code did before these decisions):

| # | Area | What the code actually does | Decision needed |
|---|---|---|---|
| V1 | Display logic | **Inert.** The dropdown + config are stored, but nothing consumes them: the public form and preview render every question; the server requires all required questions. Circular/dangling logic refs can't break anything because nothing parses the field. **Landmine:** if a future logic engine hides questions client-side only, a hidden *required* question makes submission impossible — the server's required check must become logic-aware in the same change. | Build the logic engine (form + preview + logic-aware required check) or hide the dropdown until then |
| V2 | Archive / version-Closed vs collection | **Campaign status + dates are the only submission gate.** Archiving a survey does NOT stop collection; closing a version does NOT stop collection. | Which statuses should gate public submission? (Archived survey? Closed version? or campaign-only, as now) |
| V3 | Response rate | **Never computed.** Also structurally impossible beyond completed-vs-target: no invited count exists (no Invitation doctype, no invited field). | Target-based rate now, or wait for Invitation records (secure-token feature)? |
| V4 | Calculation cadence | **No scheduler events registered** — metric/index calculation runs only on explicit demand; dashboards show stale results until someone triggers it. | Nightly job? On campaign close? Manual only? |
| V5 | Two sectioning mechanisms | `UCC Survey Section` records exist (with a `duplicate_section` API) but **no UI creates or assigns them** — the inspector doesn't expose `section`. "Section Heading" *question type* is the de-facto mechanism and the only one the public form renders. | Pick one; if Section Heading wins, the Section doctype + API are removable |
| V6 | Objective mapping cardinality | **Hard 1:1** — `unique` on the mapping's question field. Multi-objective questions are impossible. | Confirm 1:1 against the real Survey Objective-Question Mapping before importing UCC's data |
| V7 | Submission semantics | Anonymous double-submit allowed (#11); duplicate answers to one question in a payload: last-wins, silent; multi-select stored comma-joined — **irrecoverable if choice labels contain commas** (#12); "In Progress" submission status exists but no code path creates it (save-and-continue not implemented). | Confirm each, esp. the comma-join before real data arrives |

## Step 1 integration audit (post-merge) — findings + fixes

Field-name cross-check across all cross-module references: **0 mismatches**.
Three semantic gaps in already-merged code were found and fixed:

| Finding | Fix |
|---|---|
| Nothing computed `UCC Metric Result` from answers (index only *read* them) | Added `metric_calc.py` + pure `metric_engine.py` (answers → normalised → Metric Result) |
| `answer_numeric` was read by Explorer but never written | `metric_calc` backfills it from the normalised answer |
| `compute_index` re-normalised metric values → double-normalisation with real 0-100 Metric Results | Index now applies **weights only**; normalisation happens once at the metric layer (decision log 2026-07-24) |

Chain proven end-to-end two ways: `test_chain_contract.py` (bench-free, runs
now) and `test_integration_chain.py` (DB-level, **bench-run**:
`bench --site <site> run-tests --module ucc_measurement_outcomes.test_integration_chain`).

New bench-verify items from this step:

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 33 | Metric result aggregates across all answers (no entity/period split) | `metric_calc.calculate_metric_result` | Add programme/intake/term breakdown once Student/Programme DocTypes confirmed |
| 34 | Operational-field metric sources are skipped in metric calc | `metric_calc` | Wire once external DocTypes (Assessment Result, etc.) confirmed |
| 35 | Worded Likert choices need numeric `choice_value` to score | `metric_engine` (non-numeric → unscored) | Ensure survey choices carry numeric values, or add a label→score map |
| 36 | Index node `normalisation`/`reverse_scored` are now informational only | `ucc_index_node` | Consider removing these fields in a later cleanup; calc ignores them |

## Global

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 1 | Target Frappe version is **v15** | `hooks.py`, all DocType JSON | Confirm version; adjust JSON keys / controller hooks if v14/v13 |
| 2 | Install path is `frappe-app/ucc_measurement_outcomes` | `README.md` | `bench get-app <path>` then `install-app` on a **dev** site only |
| 3 | Permissions are **System Manager only** | every DocType JSON `permissions` | Add real `Survey Manager` / `Survey Author` roles + rules (fixtures) |

## External DocType references (deliberately NOT hard-linked)

Per scope lock, these are plain `Data` fields, not `Link`s, until confirmed:

| # | Field | DocType JSON | Real target to confirm |
|---|---|---|---|
| ~~4~~ | ~~`owner_department`~~ | ~~`ucc_survey`~~ | **DECIDED (Felix, 2026-07-29): Link to `Department`.** See below |

Core Frappe DocTypes are safe to link and **are** linked: `User`
(`ucc_survey_version.published_by`).

`check_repo.sh` fails if any `TODO`/`bench-verify`/`FIXME` string reappears in a
DocType field description, label or HTML options — this file is where those
notes belong, not under a form input.

### #4 `owner_department` → `Link` to `Department` — decided, two things to check live

The scope-lock question is answered: it is a Link to `Department`, and the
migration is `patches/v0_8_0/link_owner_department.py`. Two things could not be
checked without a bench, and both are cheap:

**a. `Department` is ERPNext's, not Frappe's.** Verified against source:
`erpnext/setup/doctype/department/` exists on `version-15`;
`frappe/core/doctype/department/` does not, and neither does `hrms`'s. So this
field now makes the app depend on ERPNext being installed, which
`pyproject.toml` does not declare (it declares only `qrcode`). The site this is
being built for runs educ_sg on ERPNext, so it holds — but on a Frappe-only
site the field is a Link to nothing. The patch detects that
(`frappe.db.table_exists("Department")`), touches no data, and writes an Error
Log saying so rather than half-migrating. **Verify:** `Department` appears in
the Awesomebar on the target site.

**b. A Department's docname is not its name.** ERPNext's autoname is
`f"{department_name} - {company_abbr}"`, so "Academic Affairs" is stored as
`Academic Affairs - UCC`. This is why the migration matches on
`department_name` and not just on the docname — `department_match.py`, with
`test_department_match.py` covering it. **Verify:** the report below shows the
values resolving, not a column of UNMATCHED.

**Run the report BEFORE migrating.** It writes nothing:

```bash
bench --site <site> execute \
    ucc_measurement_outcomes.patches.v0_8_0.link_owner_department.report
```

Anything it cannot match to exactly one Department is moved to
`owner_department_legacy` (read-only, hidden when empty) rather than dropped or
left as a dangling link — a dangling Link value throws on the *next* save of
that survey, which is a landmine, and blanking it loses something a human typed.
`owner_department_legacy` can be deleted from the DocType once the report shows
nothing unmatched.

## Snapshot completeness

| # | Assumption | Where |
|---|---|---|
| 5 | Publish snapshot freezes title + description only | `ucc_survey_version.py before_save` — extend if the reporting layer needs more survey-level fields frozen |

## Builder Desk Page (checkpoint 2)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 6 | Page role access is System Manager only | `page/survey_builder/survey_builder.json` | Add real Survey roles alongside DocType perms |
| 7 | Choices are edited as `label\|value` lines in the inspector | `survey_builder.js` `_apply` | Confirm this is enough, or build a grid editor if matrix/ranking need richer choices |
| 8 | Reorder does N per-question saves | `api/builder.py reorder_questions` | Fine now; batch if surveys reach hundreds of questions |

Manual smoke test once installed: open a Draft version in the builder, drag a
type in, reorder, edit via inspector, then publish the version and confirm the
builder shows the read-only banner and blocks edits.

## Campaign + public submission (checkpoint 3)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 9 | `frappe.rate_limit(key="token", limit=20, seconds=3600)` | `api/public.py` | Confirm the decorator signature on the target Frappe version + agree real limits with UCC (per-token and per-IP) |
| 10 | Storing `respondent_ip` is acceptable | `ucc_survey_submission.json`, `api/public.py` | Confirm PDPA/retention; drop or hash if not permitted |
| 11 | One-response enforcement keys on `respondent_key` only | `api/public.py submit_survey` | When Secure-Token invitations land, derive the key from the invitation; decide IP fallback for pure-anonymous |
| 12 | Multi-select answers stored comma-joined in one row | `submission_utils.to_text` | Confirm per-option breakdown can be parsed later, or split into rows if needed |
| 13 | Guest writes use `ignore_permissions=True` inside the endpoint | `api/public.py` | Intended trust-boundary pattern; confirm no guest role is granted on the DocTypes themselves |

Not built yet in this checkpoint (natural next small piece): the public-facing
web page (portal/`www` route) that renders `get_public_survey` and POSTs to
`submit_survey`. The endpoint + data model are complete and testable via
`frappe.call` without it.

Manual smoke test once installed: publish a version, open a campaign, hit
`get_public_survey`/`submit_survey` as Guest, confirm one Submission + one
Answer row per question and that a second submit with the same respondent_key
is rejected.

## Mapping + Metric shell (checkpoint 4)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 14 | Objective/metric codes are invented placeholders | `ucc_objective`, `ucc_metric_definition` | Import real codes from the existing Survey Objective-Question Mapping instead of hand-entering |
| 15 | Operational metric sources are `Data` paths (e.g. `Assessment Result.grade`) | `ucc_metric_source.source_reference`, `ucc_metric_result.entity` | Confirm real DocType/field paths, then decide Data vs Dynamic Link |
| 16 | Clauses are free-text codes on the mapping, no UCC Clause master | `ucc_question_mapping.primary_clause` | Confirm whether clauses need their own master DocType |
| 17 | Shared canvas loaded via `app_include_js` on every Desk page | `hooks.py`, `public/js/node_canvas.js` | Fine (defines one class); move to a page bundle if load cost matters |
| 18 | Metric mapping uses a `sources` child table (added beyond the listed 5 DocTypes) | `ucc_metric_source` | Confirm this models reusable metrics correctly; it keeps metric mapping separate from objective mapping as required |

Note: added **UCC Metric Source** (child of Metric Definition) beyond the five
listed DocTypes, so a reusable metric can span multiple questions/surveys.
Objective mapping (UCC Question Mapping) and metric mapping (Metric Definition
sources) stay separate records, per the standing decision.

Manual smoke test once installed: open Mapping Studio for a version, map a
question to an objective + clause, add it as a metric source, and confirm the
lineage renders on the shared canvas.

## Index shell + calculation engine (checkpoint 5)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 19 | Metric values read as latest `UCC Metric Result` by metric/period/entity | `index_calc._load_metric_values` | Confirm entity resolution once real DocTypes are known |
| 20 | Calculation runs on the `short` queue | `api/index_studio.calculate` | Confirm worker/queue availability on the bench |
| 21 | `Count`/`Hours` normalisations pass through raw (not 0-100) | `index_engine.normalise` | Agree a scaling rule with UCC if counts/hours must feed a 0-100 index |
| 22 | Circular-reference detection not yet implemented | `api/index_studio.validate_index` | Add a cycle check before production (weights-total check is done) |

Immutability chain (satisfies "a formula edit must never silently change a
published score"): `UCC Index Version` freezes on publish (same rule as survey
versions, shared `versioning.py`); `UCC Index Result` rejects any post-insert
edit; results Link to the exact `index_version` used. Editing a formula ⇒ new
version ⇒ new results.

The scoring/normalisation math lives in the pure `index_engine.py` and is
unit-tested with fixture data (`test_index_engine.py`): a 3-level SEQI-shaped
tree with known inputs produces exactly 85, partial coverage re-bases weights,
and every normalisation rule is checked. `index_calc.py` only wires Frappe data
into it — no arithmetic in the DB layer.

Manual smoke test once installed: build an index version (index → dimensions →
metric nodes), validate weights=100, publish, seed a few `UCC Metric Result`
rows (or pass `metric_values`), calculate, and open the result's breakdown to
trace the score to each metric.

## Dashboard Studio shell (checkpoint 6)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 23 | Custom Desk page for KPIs/trend/contribution/comparison | `dashboard_studio` page | Fine; move simple KPI tiles to native Number Cards on the bench if preferred |
| 24 | Trend sorts periods lexicographically | `api/dashboard._trend` | Sort by real period order once the period structure is confirmed |
| 25 | Dashboard reads only this app's Index Results | `api/dashboard.py` | Bench-safe; no external DocType dependency |

Dashboard Studio reads only this app's own `UCC Index Result` + `UCC Score
Breakdown` (no external DocTypes), so it renders as soon as an index is
calculated. No new DocTypes were added — configurable dashboards
(UCC Dashboard / Widget) are deferred until a real need appears.

Manual smoke test once installed: calculate at least one index result, open
Dashboard Studio, and confirm KPI cards, trend, contribution and comparison
render and respond to the index/period/entity filters.

## Data Explorer shell (checkpoint 7)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 26 | Catalogue covers Answers / Metric Results / Index Results / Objective Mapping | `api/explorer.DATASETS` | Extend the catalogue as more approved datasets are needed — never open it to arbitrary SQL |
| 27 | Aggregation done in Python after `get_all` | `explorer_agg.aggregate` | Fine for shell volumes; push down to SQL group-by (still parameterised) if datasets get large |
| 28 | Export returns file content to the browser to save | `api/explorer.export_analysis` | Confirm acceptable; switch to a streamed `frappe.response` download if preferred |

Security: Data Explorer takes **no SQL**. Every request is checked against the
approved `DATASETS` catalogue — only whitelisted doctypes, dimensions, measures
and filter fields are accepted; anything off-catalogue is rejected, and rows are
fetched with parameterised `frappe.get_all`. Pivot + CSV are pure and
unit-tested (`test_explorer_agg.py`). Reads only this app's own DocTypes.

Manual smoke test once installed: with some Metric/Index Results present, pick a
dataset + measure + row/column, Run, and Export CSV/JSON; confirm off-catalogue
field names are rejected.

## Public survey web page (checkpoint 8)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 29 | Guest website access is enabled (Website Settings) | `www/survey.py`, `www/survey.html` | Confirm the site serves guest web pages |
| 30 | Guest `frappe.call()` to `submit_survey` passes CSRF as configured | `www/survey.html` submit handler | Confirm CSRF handling for guest POST on the real site; adjust if the site enforces it differently |
| 31 | Anonymous model: public campaign token in the URL, no respondent_key | `www/survey.html` | Add per-respondent secure tokens (invitations) + one-response key when that flow lands |
| 32 | Page served at `/survey?token=<public_token>` | `www/survey.py` | Confirm the route; add a QR/link generator on the campaign form later |

The page renders only published content (via `public_survey_payload`, a plain
helper split out of the rate-limited endpoint) and submits through the existing
guest-whitelisted `submit_survey` — the single trusted write boundary. No new
DocTypes. The submission endpoint's own guards (token, one-response, atomic
write) are unchanged.

Manual smoke test once installed: open a campaign, visit
`/survey?token=<public_token>` as a logged-out user, submit, and confirm one
Submission + one Answer per question; check that a closed campaign shows the
unavailable message.

## Mapping Studio coverage analysis (checkpoint 9)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 37 | Duplicate detection is exact-text (normalised whitespace/case), version-scoped | `coverage.find_duplicate_questions` | Add fuzzy / cross-version dedup if UCC needs it |
| 38 | "Unmapped objectives" = every defined UCC Objective not used by this version | `api/mapping.mapping_coverage` | Confirm scope (per-version vs per-programme) once real objective sets are imported |

Coverage/gap analysis is a computed view over existing Mapping/Objective/Question
data (pure `coverage.py`, unit-tested). Unmapped questions render as red "gap"
nodes on the shared canvas.

## Index Studio templates (checkpoint 10)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 39 | 7 index templates (SEQI, SAPI, ESI, TEI, FSI, QIPI, API) with placeholder metric codes | `index_templates.py` | Confirm the real dimension/metric breakdown + targets with UCC quality owners |
| 40 | Aggregated Performance Index consumes tactical indices as "metrics" | `index_templates` API template | Feeding an Index Result into another index needs a wiring mechanism — confirm/build later |

Templates are structure-only starters (weights total 100 per parent,
unit-tested). "New from template" in Index Studio creates a Draft Index
Definition + Version + node graph; the user then attaches real metrics/data.

## Dashboard filters + Criterion 7 view (checkpoint 11)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 41 | Named dimensions (Programme/Intake/Module/Teacher/Department/Student Type) map onto the single generic `entity_type`/`entity` | `api/dashboard.NAMED_DIMENSIONS`, `filter_bar.js` | True simultaneous multi-dimensional filtering needs results dimensioned by real Student/Programme/Module/Instructor DocTypes |
| 42 | Weak-area component threshold is 60/100 | `api/dashboard.WEAK_THRESHOLD` | Confirm the threshold(s) with UCC quality owners; may differ per index |

Shared `UCCFilterBar` (loaded via `app_include_js`) drives both the Overview and
Criterion 7 layouts, which are composed from the same widgets (KPIs, trend,
contribution, comparison) plus a weak-areas widget. Filters wired to real result
fields (index, index_version, period, entity_type, entity).

## Survey Studio editorial conveniences (checkpoint 12)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 43 | QR generation needs the `qrcode` package | `pyproject.toml` (dep added), `api/builder.campaign_qr` | Confirm `qrcode` installs in the bench env (SVG factory, no Pillow needed) |
| 44 | Undo/redo is id-based; a deleted item's undo re-creates it with a new id | `survey_builder.js` `_record`/`_delete` | Fine for linear edit/undo/redo; deep interleaved undo across recreated items can desync |

Built: bulk-paste (pure parser `bulk_parse.py`, unit-tested), multi-select +
bulk delete / copy-to-version, structural undo/redo (reorder, delete, paste),
desktop/mobile preview, and a public-link QR button on the Campaign form.
Duplicate-question already existed from checkpoint 2. (Historical note: the
`duplicate_section` API built here was removed by decision V5 — sectioning is
consolidated on the "Section Heading" question type; `copy_questions_to_version`
carries Section Heading rows like any other question.)

## Data Explorer remaining datasets (checkpoint 13)

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 45 | Two new active datasets (Survey Campaigns, Submissions) over existing DocTypes | `api/explorer.DATASETS` | None — bench-safe (this app's own DocTypes) |
| 46 | Four pending datasets (Student Records, Programme Records, Assessment Results, Graduate Outcomes) read external DocTypes | `api/explorer.PENDING_DATASETS` | Confirm each real DocType/field, then move from PENDING_DATASETS into DATASETS |

Pending datasets are listed in the UI (disabled, with a note) but rejected by
`run_analysis`/`export_analysis` until wired — no arbitrary SQL, no guessed
external field names.

## Not yet built (future phases, not assumptions)

- Quality Action / Quality Meeting integration (needs bench discovery of those DocTypes)
- Secure per-respondent invitation links
- Quality Action / Quality Meeting integration (needs bench discovery of those DocTypes)

## Demo data seed (`demo_data.py`)

Guards are proven without a bench (`python3 test_demo_data.py`, 9 assertions).
Everything that touches the database is compile-checked only — no part of
`seed()` or `remove()` has been executed against a site.

| # | Assumption | Where | Action on bench |
|---|---|---|---|
| 47 | `UCC Survey.status` accepts `"Active"` | `demo_data._build` | Run `remove --kwargs "{'dry_run':1}"`, then `seed`; a bad Select value throws on insert |
| 48 | `default_normalisation` accepts `"Likert 1-5 to 0-100"` | `demo_data._build` | Same run — copied from `test_integration_chain`, unexecuted there too |
| 49 | Deleting a Published survey/index version is permitted (no `on_trash` guard exists) | `demo_data.remove` | Confirm with the dry run, then a real `remove` on demo data only |
| 50 | Clearing `UCC Survey.current_version` is enough to release the link before deleting its version | `demo_data.remove` | If the delete still trips a link check, the message names the blocking DocType |
| 51 | `UCC Survey Campaign` inserts against a Published version without an open-campaign guard | `demo_data._build` | Relates to the existing campaign TODO in `ucc_survey_campaign.py` |

Removal is designed to be run **before** the seed as a no-op proof: with nothing
seeded, the traversal finds zero rows and exits without touching anything.

## Workspace (`survey_studio/workspace/measurement_outcomes/`)

Written without a bench, so its shape is unverified. `Workspace` is a real
DocType and its JSON is imported by `bench migrate`; the fragile parts are
`content` (a JSON *string* of editor.js blocks) and the requirement that each
block's `card_name` exactly matches a `Card Break` label in `links`.

**Verify:** run `bench migrate`, open `/app/measurement-outcomes`, and confirm
both cards render with their links. If the page is blank, the usual cause is a
`content`/`card_name` mismatch — fix it in the UI (Edit Workspace) and re-export
with `bench export-fixtures` or by copying the record's JSON back into this file.

Until then, the fallback navigation is unchanged and already works: Frappe's
awesomebar indexes Page records, so typing "UCC Survey Builder" reaches it.

## Per-page assets on /survey (`www/survey.py`)

The respondent form's JS/CSS moved out of the template into
`public/js/survey_form.js` + `public/css/ucc_survey_form.bundle.css`, loaded through
`context.include_js` / `context.include_css` with **bundle** names
(`ucc_survey_form.bundle.js` / `.css`) rather than raw `/assets/…` paths —
raw paths are served with a one-year cache, which already caused a real
stale-asset bug in this app (see the comment in
`public/js/ucc_measurement_outcomes.bundle.js`).

**RESOLVED 2026-07-28.** `context.include_js` / `include_css` are rendered for a
Web Page *document*, not for a `www/` *template* page — so the form's JS never
loaded, on either route. `survey.py` now resolves the hashed URL itself
(`frappe.utils.jinja_globals.bundled_asset`, falling back to the plain asset path
and logging if that import ever moves) and `survey.html` emits explicit
`<link>`/`<script>` tags above the inline bootstrap.

**Verify:** `bench build --app ucc_measurement_outcomes && bench restart`, then
open `/survey?token=…` **and** `/survey?preview=<version>` and confirm both
render styled. The page fails loudly rather than silently if the JS did not load
— it replaces itself with "This survey could not be loaded" and logs the build
command to the console. That message means *the global is absent*, which is not
the same as the build having failed.

If `templates/web.html` on this Frappe version does not render
`context.include_js`/`include_css` for a **www** page (it does for Web Page),
the fallback is explicit `<script>`/`<link>` tags in `survey.html` pointing at
the same bundles. Load order is safe either way: the page bootstraps on
`DOMContentLoaded`, which fires after every non-deferred script has run.

**A broken asset reference takes the whole app down, silently.** `bench build`
bundles JS and CSS in one run; a CSS failure exits non-zero, so
`sites/assets/assets.json` is never regenerated even though the JS bundles built
fine. assets.json keeps naming the *previous* content hash, which no longer
exists, so every asset 404s and no `UCC*` global is defined. The first symptom is
a Desk page dying on `window.UCCVersionPicker is not a constructor` — four steps
from the cause. If a Studio page reports a missing UCC global, read the tail of
`bench build` before debugging the page. `scripts/check_repo.sh` now catches the
repo-side version of this before it reaches a bench.

`bundled_asset` must be given the BARE bundle name, not a path: it only consults
assets.json `if ".bundle." in path and not path.startswith("/assets")`, so an
`/assets/…` argument is returned unchanged and the caller cannot tell the lookup
never happened. `_bundle_url` now checks the result contains `/dist/` rather than
trusting the call, and there is no fallback — `/assets/<app>/js/…` is the raw
esbuild SOURCE, and serving it gives "Cannot use import statement outside a
module".

Both remaining unverified Frappe symbols are gone: `frappe.utils.quoted` is now
stdlib `urllib.parse.quote`, and `frappe.utils.copy_to_clipboard` is behind
`copyLink()`, which tries the native Clipboard API first and falls back to a
`prompt()` the user can copy from.


## Cache behaviour of the survey page (verified, v15.83.0)

No cache-clearing hook is needed when the theme is saved, and `UCC Survey Theme`
deliberately has none:

- **The page is never cached.** `www/survey.py` sets `context.no_cache = 1`, and
  `website/utils.py:cache_html` only writes the page cache when
  `can_cache(context.no_cache)` is true.
- **The document cache invalidates itself.** `survey.py` reads the Single with
  `frappe.get_cached_doc`, and `Document.run_post_save_methods()` calls
  `self.clear_cache()` → `frappe.clear_document_cache(doctype, name)` on every
  save. For a Single, `name == doctype`.

For the record, checked against the real source rather than assumed:

| Symbol | Exists? |
|---|---|
| `frappe.clear_website_cache` | **No** — this was the AttributeError |
| `frappe.website.utils.clear_website_cache(path)` | Yes, path-scoped |
| `frappe.clear_cache()` | Yes, but **deletes every cache key for the site** |
| `frappe.clear_cache(doctype=…)` / `(user=…)` | Yes, scoped |
| `frappe.clear_document_cache(doctype, name)` | Yes |


## "Start collecting" creates a usable campaign (verify live)

`api/campaign.start_collecting` inserts the Survey Tracking row that turns a
published version into a live campaign. Written without a bench, so verify in
this order on `ucc-sms-v2.orb.local`:

1. `collection_setup` returns a **Link** with a real `options` DocType. If it
   comes back as `Data`, `survey_name` is not a Link on this site and the
   dialog is asking for free text — report the real fieldtype rather than
   working around it.
2. The insert survives educ_sg's own validation. Only `survey_name`,
   `ucc_survey_version` and `ucc_collection_status` are set; if Survey Tracking
   has **other** mandatory fields of educ_sg's, the insert throws and each one
   has to be added to the dialog deliberately (never defaulted).
3. `ucc_public_token` is minted by `survey_tracking_hooks.validate` on that
   insert, and the Builder's public link appears without a reload.
4. `/survey?token=…` accepts a response. Note the collection **window** is not
   set by this path — `date_start`/`date_end` are still the unverified
   fieldnames flagged in `survey_tracking_hooks.validate`, so the campaign is
   unbounded until someone sets dates on the record itself. Resolve those
   fieldnames and this dialog can grow two optional date fields.

## Page Background reaches `body` (verify live)

`theme.py` emits `body{background:var(--ucc-page-bg);}` when — and only when — a
Page Background colour is set. Unverified without a bench: **whether the
portal's Website Theme paints an inner wrapper** (`.main-section`,
`.page_content` or similar) that would sit on top of `body` and hide the colour.

**Verify:** set Page Background to something obvious (e.g. `#ffe9e9`) and open
`/survey?preview=…`. If the area outside the 680px form does not change colour,
the theme is painting a wrapper and that selector needs adding beside `body` —
report the element rather than guessing, given how many unverified selectors have
cost this project already.

Nothing is at risk either way: with no colour set no rule is emitted at all.

## Mapping Studio canvas (verify live)

Written without a bench. Four things to try on `ucc-sms-v2.orb.local`, in order:

1. **Ports appear on question nodes only.** Objectives are drop targets, not
   sources. If a port is missing entirely, `onConnect` was not passed and the
   canvas silently degraded to read-only.
2. **Drag a port onto an objective.** The node should outline dashed while
   hovered, and release should alert "Mapping created". Dropping onto the same
   objective twice gives "Already mapped" — one row, not two.
3. **Click a connector.** The visible line is 2px; a transparent 14px path
   under it carries the click. If clicking does nothing, check that
   `.ucc-nc-edges path.ucc-nc-edge-hit` is beating the `pointer-events:none`
   rule on its siblings.
4. **Scrolling.** `.ucc-nc-shell` is now `overflow:auto` and `render()` sizes
   the stage from node extents. On a long survey the question column must
   scroll; if it clips instead, the stage's explicit width/height is losing to
   `inset:0`. This also affects **Index Studio**, which shares the component —
   check a large index still renders as it did.

## Canvas "question vanishes after connecting" — fix NOT yet confirmed live

Felix hit this on v0.9.0: drag a port onto an objective, and the question
disappears from Canvas and does not appear as mapped in List. Diagnosed by code
reading as a VISIBILITY bug, not a data bug — but the diagnosis is unverified
against the database, and the fix is unverified in a browser.

**First, confirm the data was fine all along** (`bench --site <site> console`):

```python
import frappe
frappe.get_all("UCC Question Mapping",
    fields=["name", "question", "objective", "survey_version", "creation"],
    order_by="creation desc", limit=5)
```

Expect the drag to have produced exactly one row, with the right question, the
right objective, and **survey_version filled in**. That last column is the one
worth staring at: `add_question_mapping` does not set it, relying on the field's
`fetch_from: question.survey_version`, which Frappe applies inside
`_validate_links()` during insert (base_document.py ~line 848, v15.83.0). If it
is NULL, `get_mapping_overview` and `mapping_coverage` both filter it out and
the diagnosis below is wrong — that would be a real data bug.

Then check nothing was destroyed:

```python
frappe.db.count("UCC Question Mapping")   # before/after one drag: +1, never -1
```

**Then re-test the fix in the browser** (this is what "fixed" requires):

1. Canvas, "Unmapped only" ticked. Drag a question's port onto an objective.
2. The question must STAY on the canvas, turn from red to normal, and show the
   new connector. Alert says "Mapping created".
3. Switch to List. The question must appear under that objective's heading, not
   in "⚠ No objective yet".
4. Repeat with the list filter set to "unmapped" first (click the Questions card
   in the coverage header): the write should clear that filter so the result is
   visible instead of being hidden by it.
5. Click the new connector → confirm → the question returns to the gap list and
   reappears on the canvas.

## Canvas: delete affordance, objective panel, default view (verify live)

1. **× on every connector.** Always drawn (not hover-only — hover affordances do
   not exist on touch), grey, turning red on hover, at the curve's real midpoint
   via `getPointAtLength`. Clicking it and clicking the line both delete. If the
   × sits off the line, `getPointAtLength` is being called before the path has
   its `d` attribute — check `_drawEdges` order.
2. **Click an objective node** → the inspector shows its code, name, description
   and the questions mapped to it. Clicking one of those questions swaps to the
   question editor. "Open objective record" routes to the UCC Objective form.
3. **Mapping Studio opens on Canvas.** List is one click away and must still
   render correctly when switched to — including its coverage-header drill-down
   filters, which are never exercised on first paint any more.

## Objectives now come from the register (verify live, v0.10.0)

`UCC Objective` is deleted; `UCC Question Mapping.objective` links to
`Survey Objective`. Run the report BEFORE migrating — it writes nothing:

```bash
bench --site <site> execute \
    ucc_measurement_outcomes.patches.v0_10_0.link_objectives_to_register.report
```

Expect roughly: 7 rows, 97 in the register, ~1 `relink`, ~6 `drop`,
**0 "need a human"**. Anything in the report column means the patch will keep
`UCC Objective` in place rather than orphan a mapping — that is the designed
outcome, not a failure, but it needs a decision before the DocType goes.

Then:

```bash
bench --site <site> migrate
bench build --app ucc_measurement_outcomes
bench --site <site> clear-cache
```

Afterwards, in the browser:

1. Mapping Studio's coverage header now reads against **97**, not 7 — e.g.
   "Objectives 1/97". That is the real Criterion 7.1.1 question and it will look
   much worse than before. It is not a regression.
2. The canvas's right-hand column holds 97 nodes. This is the first time the
   scroll (`overflow:auto` + stage sizing) carries real weight — confirm it
   scrolls and that "Unmapped only" keeps the left column workable.
3. Click an objective node. The panel shows whatever the register carries —
   `clause_or_criterion` and `status` are the confirmed ones. If a row shows a
   raw fieldname or nothing at all, add/remove it from `OBJECTIVE_DETAIL` in
   `api/mapping.py`; the query already resolves against the real meta, so an
   absent field is skipped rather than erroring.
4. "Open objective record" routes to the Survey Objective form.
5. Re-run `demo_data`. Demo mappings should point at the first six real
   objectives by name, and no `DEMO-OBJ-*` objective should be created anywhere.

**If the register is empty** on some site, the patch touches nothing and logs
why, `demo_data` prints a warning and seeds no mappings, and
`test_integration_chain` fails with a message telling you to seed the register.
None of those paths invent an objective.

## "View Responses" and answer correction (verify live, v0.11.0)

1. **Builder toolbar.** A published version with submissions shows a primary
   "View Responses (N)" button beside Preview/Theme. A version with none shows
   nothing at all — confirm the button does NOT appear on an empty version, and
   that N matches `frappe.db.count("UCC Survey Submission", {"survey_version": …})`.
2. **The deep link lands on the right campaign**, not on whichever sorts first.
   Test with two campaigns on the site; the picker should arrive preselected.
3. **Correcting an answer.** Open a UCC Survey Submission → the new
   **Responses** connections section lists its UCC Survey Answer rows. Open one,
   change `answer_value`, save with no reason → must throw. Save with a reason →
   must succeed, and `answer_numeric` must come back **empty** (the next metric
   calculation recomputes it).
4. **The version history tab** on that answer shows old → new, who and when.
   `track_changes` is already 1 on UCC Survey Answer; this confirms Frappe is
   actually recording it rather than the flag merely being set.

## Post-publish wording correction (verify live, v0.12.0)

1. **The happy path.** On a PUBLISHED version, edit a question's text only,
   save with no `correction_reason` → must throw. Add a reason → must save.
2. **The freeze still holds.** On the same published question, change
   `question_type`, a choice label, `is_required`, `matrix_rows` or
   `display_logic` — with or without a reason → must all throw.
3. **Both at once.** Change wording AND `layout_width` in one save → must throw.
   Neither gate accepts it, deliberately: the reason would describe half the
   change.
4. **The marker.** With responses against that question, open Campaign
   Analytics → its distribution row shows a "wording corrected" pill, reason on
   hover. Open the Lineage Report for a result that includes it → the same pill
   beside the question. **If either is missing, the exemption is not safe to
   keep** — the whole basis for allowing it is that a correction is visible
   where the evidence is read.
5. **Version history** on the question shows old → new text.
6. Correcting a question on a DRAFT version needs no reason (nothing is frozen).

## Draft editing after the v0.12.2 fix (re-test first)

The v0.12.0 correction gate fired on DRAFT versions: a wording-only change is
what typing the first real question text *is*, and the gate never checked
whether the version was frozen. Re-test in this order:

1. New survey via the Builder's inline dialog → Draft, no questions.
2. Drag a Short Text question in. Select it. Type real wording. **Apply
   Changes must save**, and the card title must update. No toast about
   published questions.
3. Same draft: change the type, the required flag, choices. All must save.
4. Publish it. Now editing the wording with no reason **must** be refused, with
   a reason **must** save, and changing the type **must** be refused either way.
5. Layout width on the published version must still apply with no reason.

All seven of those paths are covered by `question_edit_verdict` in
`test_versioning_logic.py`, and were driven through the real
`assert_doc_version_editable` in a standalone harness before shipping — but
nothing here has run against a database.

## Index Studio Calculate, source_version, objective display (verify live, v0.13.0)

**Item 3's confirmation query — run this FIRST.** It decides whether the
objective work below was the right fix:

```python
import frappe
from collections import Counter
rows = frappe.get_all("UCC Question Mapping", fields=["question", "objective"])
per_q = Counter(r.question for r in rows)
print(len(rows), "mappings across", len(per_q), "questions")
print("objectives per question:", Counter(per_q.values()))
```

Expect mostly `{1: n, 2: few, 3: fewer}`. **A long tail near 97 means the data
IS wrong** and the presentation fix, while still an improvement, is not the
whole story — say so before going further.

**Index Studio:**
1. Open a **Draft** version → Calculate is disabled, tooltip says publish first,
   and the results panel says draft versions cannot be calculated.
2. Publish → Calculate enables. Press it, confirm. A result appears in the
   history with its score, who calculated it and when (Frappe's `owner` and
   `creation`; no new log was invented).
3. Click a history row → the breakdown table renders from
   `get_result_breakdown`, which had no caller until now.
4. Click a **Metric** node → the inspector shows which questions feed it,
   grouped by survey version. **This is the cross-survey proof surface**: a
   metric drawing on three surveys must show three version groups.
5. A node whose metric has no sources must show the red "Nothing feeds this
   node" panel rather than an empty section.

**`calculate` is now synchronous** — it used to `frappe.enqueue` and return
`{"queued": True}`, against a queue that was never bench-verified. If a real
index turns out slow enough to matter, that is the moment to reconsider, not
before.

**source_version:** run a metric whose sources span two surveys and confirm the
field now reads `EOM-V01, ONB-V01` rather than one of them. Existing rows keep
their single value — still valid text under the new `Small Text` type, so no
data patch was needed.

**QR:** the public-link bar gains a QR button on a version with an open
campaign. `campaign_qr` was reading the retired `UCC Survey Campaign` and would
have thrown; it now reads `Survey Tracking.ucc_public_token`. Needs the
`qrcode` package present in the bench env.

## Measurement Outcomes redesign (verify live, v0.14.0)

New Desk page `/app/measurement-outcomes`, five parallel workspaces. The old
five pages are untouched and still reachable — nothing was deleted, so a
rollback is removing one workspace link.

**Deploy:** `bench build --app ucc_measurement_outcomes` (new CSS bundle AND new
bundled JS), then `bench --site <site> clear-cache`. A `bench build` whose
`File | Size` table is empty means nothing bundled — red flag, not a normal run.

1. **Scoping — check this first.** Open any OTHER Desk page (a DocType list, the
   Frappe workspace). Buttons, tabs and form controls must look exactly as they
   did. `ucc_mo.bundle.css` styles `.btn`, `.field`, `.pane`, `.tab`, `.icon`,
   `.count`, `.search`, `.status` — if any of those changed elsewhere, the
   scoping failed and the CSS must be pulled immediately.
2. **The shell fits.** No whole-page scrollbar on a desktop viewport; each pane
   scrolls on its own. `--ucc-mo-offset` is measured from the mounted element's
   own top, so a different navbar height should still fit.
3. **Published vs draft is REAL.** Open a published version: fields disabled,
   "Review mode, answer-determining fields are protected" in the status strip,
   "Create editable version" as the primary action. That lock comes from
   `get_survey_builder.editable`, not from JS parsing a status string — confirm
   a draft of the same survey unlocks add/delete/reorder.
4. **The wording correction still gates.** On a published version, Content tab →
   corrected wording + reason → saves. Without a reason → refused by
   `versioning.py`, not by the browser.
5. **Metrics workspace, the cross-survey proof.** New metric → Add source →
   search returns questions from EVERY survey → add two from different surveys
   → the status strip reads "2 surveys". Preview calculation shows a value and
   an unscoreable count without writing a UCC Metric Result.
6. **Weights show as recorded, not required.** The source table's total says
   "Recorded only…". This is deliberate: `weight_within_metric` is read by
   nothing and `aggregate_metric` is a plain mean over answers. Do NOT ship an
   amber "add 10% more" bar until the aggregation rule is decided — see the
   2026-07-31 OPEN entry in the decision log.
7. **Indices.** Draft → Calculate disabled with a reason. Publish → Calculate
   writes a result → Results tab lists it with who and when → clicking one shows
   the frozen breakdown.
8. **Criterion 7 reads snapshots only.** A question corrected after a result was
   calculated must still show the "wording corrected" chip beside its old
   wording in the lineage — that marker is the condition the correction
   exemption was granted on.

## Route collision fixed: measurement-outcomes -> ucc-workbench (v0.14.1)

Felix confirmed on ucc-sms-v2.orb.local: `/app/measurement-outcomes` opened the
OLD Studios/Records Workspace, not the new build. Root cause verified against
Frappe's real router source (`frappe/public/js/frappe/router.js`, v15.83.0):

    convert_to_standard_route(route) {
        if (frappe.workspaces[route[0]]) {           // checked FIRST
            route = ["Workspaces", frappe.workspaces[route[0]].title];
        } else if (...) { ... }
        else if (this.routes[route[0]]) { ... }       // Page falls through to here
    }

`frappe.workspaces` is keyed by `slug(title)` (`toLowerCase().replace(/ /g,"-")`).
The pre-existing Workspace is titled "Measurement Outcomes" -> slug
`measurement-outcomes`. The new Page's `page_name` was also
`measurement-outcomes`. The Workspace branch runs unconditionally before a Page
is ever considered, so the new Page was NEVER reachable at that URL - not a
caching issue, `bench build`/`clear-cache` could not have fixed it.

**Fixed by renaming the Page** (not the Workspace, which is the pre-existing
Studios/Records directory): `measurement-outcomes` -> `ucc-workbench`.

**The real, confirmed URL is now:**

    /app/ucc-workbench

Verify:
1. `/app/ucc-workbench` opens the five-workspace redesign.
2. `/app/measurement-outcomes` opens the OLD Workspace (Studios/Records) again,
   unaffected - it was never broken, it was just winning the collision.
3. That old Workspace's "Open the new Workbench" link now points at
   `ucc-workbench` and works.
4. `bench build --app ucc_measurement_outcomes && bench --site <site> clear-cache`
   required - the Page's route name changed, and page JS is served from the
   getpage response keyed by page name.

## Seven-bug live QA pass on ucc-workbench (verify live, v0.14.2)

Felix ran real-Chrome QA against `/app/ucc-workbench` on ucc-sms-v2.orb.local
and filed 7 findings in severity order. Fixed 1-6; 7 investigated and NOT
fixed (see below). A note from Felix going in: an earlier automated pass's
"workspace nav is broken" finding was a synthetic `.click()` failure, not a
real bug - not touched here, and nothing about workspace-nav click handling
changed in this batch.

**1. CRITICAL - page overflow (root-caused by Felix).** `mount()` measured
`getBoundingClientRect().top` on the mounted root at `on_page_load` time, but
`frappe.container.add_page()` creates the page wrapper `.hide()`'d
(`display:none`) BEFORE `on_page_load` runs - verified directly against
`frappe/public/js/frappe/views/pageview.js` and `container.js`, v15.83.0.
A `display:none` ancestor makes `getBoundingClientRect()` return an all-zero
rect, so the offset committed as `12px` against a real chrome height of
~150-160px, overflowing the page by the difference (Felix measured 146px).
Fixed: the real measurement now happens in `UCCMO.refit()`, called only from
`on_page_show` (guaranteed visible - confirmed in the same source, fires
after `.show()`) and on window resize, never at mount time. `refit()` also
refuses to commit a measurement of `top <= 0`, so a caller invoking it too
early is a no-op instead of a silent bad write.
Verify: open `/app/ucc-workbench`, confirm no whole-page scrollbar and the
shell's bottom edge sits flush with the viewport on first load (not just
after a resize). `scripts/qa_page_overflow.js` (new, see below) is a
permanent non-bench regression check for this exact failure mode - run it
after touching `mount()`/`refit()` or the `.ucc-mo` height rule.

**2. CRITICAL - no survey/version picker.** Context bar showed static
title/version text with no way to switch surveys or versions. Fixed by
reusing the existing `UCCVersionPicker` (`version_picker.js`, already used by
the old Survey Builder - not rebuilt) via a new `UCCMO.mountPicker()` helper
that destroys any previous picker instance before mounting a new one, since
`_draw()` rebuilds the whole context bar on nearly every interaction and a
naive remount leaks `document`-level click listeners across renders.
Verify: Survey and Index workspaces both show a working version picker in
the context bar; switching versions reloads the workspace; the picker's own
"+ New" / edit actions still work (Survey only - Index deliberately has none,
no quick-create flow exists for index versions yet).

**3. HIGH - question-type popover help text renders at 7.875px.** My
`popover()` markup used `<b>`/`<small>` for the type-picker's label/help
text; the real prototype uses `<strong>`/bare `<span>`. Two things stacked:
the markup didn't match the CSS selectors the prototype actually targets
(`.type-btn strong` / `.type-btn span`), and `<small>`'s UA-default
`font-size: .875em` compounded on top of the already-9px `.type-btn span`
parent (9 * 0.875 = 7.875). Fixed by matching the prototype's DOM shape
exactly, verified against the fetched prototype HTML rather than assumed.
Verify: open the question-type picker, help text under each type name reads
at a normal, legible size (9px), not visibly tiny.

**4 + 6. HIGH/LOW - question types regressed vs the old Builder.** Three
things, entangled, fixed together:
- The `TYPES` palette array had `"Long Text"` as a stored value, but the real
  `UCC Survey Question.question_type` Select field only accepts
  `"Paragraph"` - verified against Frappe's real `_validate_selects()`
  (`frappe/model/base_document.py`) that this would THROW server-side, not
  just look wrong. This was a functional bug I'd introduced, not cosmetic.
- `"Ranking"` and `"Page Break"` were missing from the palette entirely -
  both are backend-valid Select options with no picker entry.
- `_paginate()` split pages on `"Section Heading"`, but the real
  respondent-facing renderer (`public/js/survey_form.js`) splits on
  `"Page Break"` and treats `"Section Heading"` as an in-page `<h4>` only.
  This meant the workbench's page preview didn't match what respondents
  actually see, and Section Heading rows were being swallowed entirely
  (consumed only as a page title, never rendered as an editable row) -
  a functional regression vs. the old Builder, not just a naming mismatch.
Fixed: `TYPES` now has all 19 real Select options (`"Paragraph"` label
"Multiple lines", `"Ranking"` help "Drag to order", `"Page Break"` help
"Starts a new page"); `mo_icons.js` `BY_TYPE` maps both new types (`Ranking`
-> `i-multiple` as a deliberate nearest-fit, no ranking icon exists in the
prototype's 35-symbol set; `Page Break` -> `i-page`, shared with Section
Heading since both are layout markers per `display_logic.MARKER_TYPES`);
`_paginate()` now splits on `Page Break` and keeps Section Heading rows in
the page body as editable rows; the add-page button now inserts a Page
Break, not a Section Heading.
Verify: palette shows all 19 types including Ranking and Page Break; adding
a Section Heading no longer removes it from the canvas; page count in the
outline matches the number of Page Break questions, not Section Headings;
saving a Paragraph-type question round-trips without a server-side Select
validation error.

**5. MEDIUM - side panes not collapsible.** The brief requires the outline
and inspector panes to collapse to a narrow vertical strip; the click
handlers (`collapse-left`/`collapse-right`) and column-width state already
existed, but nothing ever added a `.collapsed` class to the `.pane` itself,
and the `.hide-collapsed`/`.collapse-label` markup the prototype's CSS
depends on didn't exist in this app's `pane()`/`inspector()` builders at all.
Fixed by fetching the real prototype markup and rebuilding both to match:
a new `o.collapse: {act, label, shortLabel, collapsed, side}` param replaces
the old one-off `o.headAction`.
**Also found and fixed a genuine bug in the reference prototype itself**,
confirmed via live Playwright rendering of the unmodified prototype file:
`.pane.collapsed .pane-head span` (specificity 0,3,1) beats
`.pane.collapsed .collapse-label` (specificity 0,3,0) regardless of source
order, so the vertical label never renders even in the prototype - measured
`display: none` both before and after collapsing, in the artifact as shipped.
Worked around with a targeted, commented override rather than editing the
read-only reference file:
`.ucc-mo .pane.collapsed .pane-head span.collapse-label { display: block; }`
Separately, `.inspector-tabs` sits as a sibling of `.pane-head`/`.pane-body`
in the inspector markup (see `inspector()` in `mo_ui.js`), so none of the
prototype's own collapse rules reach it - added
`.ucc-mo .inspector-panel.collapsed .inspector-tabs { display: none; }` so
the tab row doesn't stay visible/cramped in a collapsed 44px column.
Verify: clicking collapse on the outline or inspector shrinks it to a narrow
strip showing only a vertical label and an icon button; the inspector's tab
row disappears while collapsed; clicking again restores the full pane.

**7. LOW - raw `<br>` in the browser tab title - investigated, NOT fixed.**
Reported title text: "United Ceres College <br> School Management System".
Checked everywhere this app could plausibly set it: `hooks.py` sets
`app_title = "UCC Measurement Outcomes"` (no `<br>`); the `ucc-workbench`
Page's own `title` field is `"Measurement Outcomes"`; no `document.title` or
navbar-title write exists anywhere in `ucc_measurement_outcomes`'s JS - the
few literal `<br>` strings in the codebase are all inside tooltip/message
HTML (`ucc_workbench.js`), not title text. This app does not touch the
browser tab title at all, so the string must come from a site-wide source
(Website Settings / navbar branding, likely in `educ_sg` or core Frappe
config) with an unescaped `<br>` typed into a title field. Out of scope to
fix from this app; flagging for whoever owns Website Settings.

## Permanent regression check: scripts/qa_page_overflow.js

A dev-only (not part of `test_*.py`, not run by `check_repo.sh`) Playwright
script added per Felix's explicit request after Bug 1. It loads the real
`mo_ui.js`/`mo_icons.js`/`ucc_mo.bundle.css` files, mocks only the one piece
of real Frappe behaviour Bug 1 depended on (page wrapper starts
`display:none`, shown later), and asserts:
- `mount()` never commits a `--ucc-mo-offset` measurement while the wrapper
  is still hidden (the actual root cause).
- `refit()` after showing the wrapper commits a realistic offset.
- The resulting document does not overflow the viewport.
- A sanity check: replaying the OLD buggy behavior (forcing a 12px offset
  while hidden) DOES reproduce an overflow, proving the check would have
  caught this regression rather than trivially passing.

No jQuery dependency - `mount()`/`refit()` only touch six jQuery methods, so
the script ships a same-sized inline shim rather than vendoring a real
jQuery build or depending on network access (this sandbox's proxy 403s
`code.jquery.com`; a real bench has no guaranteed outbound access either).

Run after touching `mount()`/`refit()` in `mo_ui.js` or the `.ucc-mo` height
rule in `ucc_mo.bundle.css`:

    NODE_PATH=/opt/node22/lib/node_modules node scripts/qa_page_overflow.js

Requires Playwright, which is not a repo dependency - this environment has
one at `/opt/node22/lib/node_modules`; elsewhere, `npm install playwright`
or point `NODE_PATH` at wherever it lives.

**This is not the real bench.** The chrome mock (fixed navbar + page head,
~158px, the figure Felix measured live) is a plausible stand-in, not a
guarantee that a different theme/site config produces the same numbers -
Bugs 1-6 above were re-verified by rendering the actual bundled CSS/JS in
Playwright (font-size computed styles for Bug 3, collapsed-state computed
`display` for Bug 5's `.collapse-label`/`.inspector-tabs`), which is real
DOM/CSSOM behavior against the real files, but still not a live bench click
-through. Confirm all of Bugs 1-6 by hand on `ucc-sms-v2.orb.local` when next
available.

## Round-2 live QA pass on ucc-workbench (verify live, v0.14.3)

Felix ran a second real-Chrome pass on `ucc-sms-v2.orb.local` after v0.14.2,
confirming page overflow and the version picker fixed. Four new items, one
root cause explaining most of them.

**BUG A (CRITICAL) - pane-body clipped to ~42px, single root cause across 14
call sites.** `.pane { display: grid; grid-template-rows: 42px 1fr; }`
assumes a `.pane-head` sibling claims row 1. Fourteen call sites in
`ucc_workbench.js` hand-roll a `.pane` with ONLY a `.pane-body` child - no
header - across Survey Responses/Exports/Share/Preview, Objectives
Coverage/Governance, Metrics Source library/Validation, and Criterion 7's
main pane. With nothing to claim row 1, CSS grid auto-placement (fills rows
in document order) puts the lone `.pane-body` THERE instead of the empty
1fr row below it - confirmed empirically (`offsetParent`/rect measurement
against the real bundled CSS), not assumed. The data was never wrong -
Felix's own read of `innerText` on the live DOM confirmed full, correct
content in every case - it was just rendered into a 42px scrollable sliver.
Fixed with one rule, not fourteen: `.pane-body { grid-row: -2 / -1; }` -
line -1 is the last explicit row line of whatever `grid-template-rows` its
`.pane` ancestor defines, -2 the line before it, so this always spans the
LAST row regardless of how many siblings precede this element. A no-op for
the many `.pane` instances that already have a header (2-row `.pane`/
`.canvas-pane`/`.mapping-pane`, 3-row `.right-pane` inspector) - verified via
Playwright against all three shapes, before and after.
Verify: open Survey Responses/Exports, Objectives Coverage/Governance,
Metrics Source library/Validation, Criterion 7 Overview - each pane-body now
fills its pane instead of showing one clipped line.

**BUG B (HIGH) - local tab-bar clicks silently swallowed by a mispositioned
info pill.** `.canvas-help` (the "Only this page is shown..." pill, Survey
canvas) is `position: absolute; top: 12px; left: 50%`, but NONE of its
ancestors (`.page-canvas` up through `.ucc-mo`) set `position: relative` -
confirmed via `element.offsetParent`, which resolved to `<body>`, not the
canvas. With no positioned ancestor in this app's own markup, the pill's
`top: 12px` measured from the document root, landing it near the very top of
the page - over the workspace's tabs-bar - instead of over the canvas
content it annotates. It has no `pointer-events: none`, so it silently
absorbed clicks meant for the tab underneath (this is why a real mouse click
sometimes failed while a synthetic `dispatchEvent` at the same coordinates
worked - the synthetic event target bypassed whatever was actually on top).
Fixed two ways: `.page-canvas` now has `position: relative` (the correct,
root-cause fix - the pill anchors to the canvas as its `left:50%` centering
clearly intends), and `.canvas-help` now has `pointer-events: none` as
belt-and-suspenders (it is read-only annotation text in both its usages -
Survey canvas and the Preview tab - never a button or link).
Verify: `.canvas-help`'s `offsetParent` is `.page-canvas`, not `body`; a
real click on any local tab (Content/Preview/Share/Responses/Exports)
switches it reliably, including immediately after the pill has been visible.

**BUG C (MEDIUM) - side inspector didn't clear across local-tab switches,
confirmed scope beyond Indices.** Checked all five workspaces with local
tabs. Survey/Objectives/Metrics already gate their side panel correctly
(`if (tab === "build")` / `tab === "map"` - only rendered and only refreshed
on their one relevant tab). **Indices was the exception**: `data-node-editor`
rendered unconditionally across Formula/Calculate/Results, and
`_renderEditor()` ran every time regardless of tab, so switching to
Calculate/Results kept showing whatever the Formula tab's node editor last
rendered (a selected node's fields, or "Select a node in the formula to edit
it") - a concept that doesn't apply to either tab. Fixed by scoping
`data-node-editor` and `_renderEditor()` to `tab === "formula"` only,
matching every other workspace's pattern; `.index-layout` collapses to a
single column (`grid-template-columns: 1fr`) on Calculate/Results instead of
reserving 300px for an editor that no longer renders.
**Also found, while confirming scope, a more severe instance in Criterion 7**:
`_fill(tab)` accepted the active tab as a parameter but never branched on it
- Narrative and Lineage silently rendered the exact same Overview content
and the same stale "Priority actions" side panel, meaning those two tabs did
nothing at all when clicked. Rather than leave that copy in place (which
would keep failing this exact bug class every time Overview's data changed),
Narrative/Lineage now show an honest "This tab is not built yet" placeholder
until they get real content - consistent with the standing rule against
half-finished features that read as complete.
Verify: Indices Formula → select a node → switch to Calculate - inspector is
gone, not stale; switch back to Formula - inspector is empty (no node
selected, correct - selection does not survive the round trip, by design).
Criterion 7: Narrative/Lineage show the "not built yet" placeholder, not a
copy of Overview.

**ITEM D (design change) - top branding block and global search removed.**
`<header class="topbar">` (brand mark + "Measurement Outcomes / United Ceres
College" + a global search input) sat above the workspace nav, which Felix
judged redundant now that the nav and context bar establish location.
`data-global-search` had no keydown handler or shortcut binding anywhere in
`ucc_workbench.js` - confirmed via full-file grep before removing - so
nothing load-bearing depended on it. Removed the whole header (nothing
useful was left in it once brand+search were gone: `.top-actions` was an
always-empty slot, never filled by anything). `.app`'s grid dropped from
three rows (`topbar-h nav-h 1fr`) to two (`nav-h 1fr`) to match the two
remaining children; the `.topbar`/`.brand`/`.search`/`.top-actions` CSS rules
were removed with the markup, and the ≤900px mobile media query's
`.workspace-nav`/`.workspace` rules updated to drop their now-nonexistent
`--topbar-h` dependency. `.icon-btn` (a generic button style, not topbar-
specific) was left in place. The root `--topbar-h` custom property itself
was left defined but unused - that whole `:root`-equivalent block is
mechanically generated by `scripts/scope_prototype_css.py` from the
prototype file, and hand-pruning one token would create drift from what a
re-run would produce; an unused CSS variable costs nothing at runtime.
Verify: `/app/ucc-workbench` opens directly into the workspace nav with no
branding header above it; page fit (Bug 1's regression check) still passes
with one fewer grid row.

**ITEM E (design change) - section-label sizing and colour.** `.section-label`
(e.g. "Scoring", "Priority actions") was `font-size: 10px; color: var(--muted)`
- identical to `.help`'s body/annotation-text styling in everything but
weight and uppercase, so it barely read as a header next to ordinary body
copy. Investigating "primary pane headers like Results" as the target
surfaced a second, adjacent bug: `pane()`/`inspector()`'s title markup used a
bare `<span>`, which `.pane-head span { color: var(--muted); font-size: 10px }`
governs (that rule's real job is styling the `.count` badge next to the
title - confirmed via grep, nothing else in `.pane-head` uses a bare span) -
meanwhile `.pane-head strong { font-size: 12px }` existed in the CSS but
matched nothing, because no title anywhere used `<strong>`. So "Results" and
every other pane title were ALSO rendering muted and undersized, not the
correctly-styled reference Felix's instruction implied. Fixed both:
`pane()`/`inspector()` titles now render as `<strong>`, finally exercising
the already-written 12px rule (full `var(--text)` ink, since `strong` has no
colour override - confirmed via computed-style measurement: 12px/700/
`rgb(23,32,51)`); `.section-label` now matches that exactly on size and
colour (12px, `var(--text)`), keeping its existing uppercase/letter-spacing/
weight-700 as the distinguishing "this is a header, not body text" signal
Felix asked for.
Verify: any pane title ("Results", "Sources", etc.) and any `.section-label`
in the same pane now read at the same visual weight; `.count` badges next to
pane titles are unaffected (still small/muted - that rule was never touched).

## Round-3 design audit on ucc-workbench (verify live, v0.14.4)

Felix measured computed styles and contrast ratios live on v0.14.3. Three
findings, all fixed. Contrast and font-family were measured as already
correct and were not touched.

**FINDING 1 - 21 elements rendered browser-default black.** Root cause is not
21 missing colour rules, it is one missing line in the reset: `<button>` does
NOT inherit `color` (the UA stylesheet sets `color: buttontext`, i.e. black),
and `.ucc-mo button, input, select, textarea { font: inherit }` inherits font
but never colour. So every unclassed tag inside a button fell back to black -
the 17 `<strong>` type labels inside `.type-btn`, and `.page-title`/`.count`
inside `.page-item-btn`. Buttons carrying their own colour class (`.btn`,
`.tab`, `.workspace-btn`, `.add-page`, `.mini`, `.outline-question`,
`.inspector-tab`, `.segmented button`) were never affected. Fixed with
`color: inherit` on the button reset, which also covers any bare tag added
inside a button in future rather than leaving the next one to reintroduce
this. `.count` additionally got an explicit `var(--muted)` (a count is
secondary to the label beside it, which `.pane-head span` already said for
pane titles); `.workspace-btn .count` is the deliberate exception and now
says `color: inherit` explicitly so it keeps tinting primary when `.active`.
Measured before: 5 distinct element types black in a component render (17 in
the real 19-type palette). After: **0 black elements**, all 17 type labels
rendered.
Verify: open the Add-question type picker - every type name reads navy, its
help line muted grey; the survey outline's page name reads navy and its
count muted, not black.

**FINDING 2 - panes 60-70% empty on low-content records. Chose direction
(b), keep the full-height pane and treat the remainder.** Direction (a),
sizing panes to content, was rejected because it contradicts the shell this
app is built on: `.ucc-mo` is a fixed-height, `overflow:hidden` workbench
whose panes scroll internally and whose multi-column shells
(`.builder-shell`, `.objective-shell`, `.metric-layout`, `.index-layout`,
`.dashboard-layout` - all `height:100%`) depend on columns being the same
height. Content-sized panes would make the three columns ragged, remove
independent scrolling, and reintroduce whole-page scrolling, which is exactly
what round-1 Bug 1 existed to stop.
Two treatments, both measured:
1. *Genuinely empty panes, all five workspaces at once.* `.mapping-empty` is
   the container every `U.empty()` renders, and its default flex row
   left-aligned one line of text at the top of a full-height pane - the thing
   that read as broken. `.pane-body > .mapping-empty:only-child` now fills and
   centres. `:only-child` keeps it to panes that are entirely an empty state;
   a pane with real content plus an inline empty section is untouched.
2. *Sparse-but-not-empty, the survey canvas.* Added an "Add another question"
   affordance below the question list (same dashed `.add-page` pattern the
   outline already uses for "Add page", same `data-act="add-question"` the
   header button carries, so no new handler), and let it grow into whatever
   space is left with a 44px floor. Dead space becomes one large click target
   for the pane's primary action. It is a click affordance only - this
   workbench has no drag-and-drop (that was the old Builder), so it is
   deliberately not styled as a drop zone.
**Measured across all five workspaces on low-content records (1440x900):**

    survey build   canvas            65% empty -> 2%
    survey build   outline (list)    81% empty -> 81%  (unchanged, see below)
    objectives     mapping stage      0% empty -> 0%
    objectives     inspector (empty) 29% empty -> 2%
    indices        formula tree      67% empty -> 67%  (unchanged)
    indices        inspector (empty) 29% empty -> 2%
    criterion7     inspector (empty) 29% empty -> 2%
    metrics        three list panes  84-88% empty      (unchanged)

The unchanged ones are deliberate and reported rather than papered over:
they are narrow list/nav columns (216-250px) and populated detail panes whose
primary action already sits in the pane head. Whitespace in a sidebar list
reads as "the list has not filled yet", not as a broken pane, and giving
"Add page" a 400px dashed target would over-weight a secondary action against
the canvas's primary one. If Felix wants those treated too, say so - it is a
per-workspace affordance decision, not a structural one.

**Found while measuring Finding 2, fixed: the inspector was never a grid.**
`.inspector-panel.active { display: block }` (0,3,0) outranks
`.pane { display: grid }` (0,2,0), so every inspector silently cancelled the
pane grid - its body sat at natural height inside a full-height pane, and the
empty-state fill above did nothing there (`min-height:100%` needs a definite
parent height). Now `display: grid` with an explicit
`grid-template-rows: 42px auto 1fr`, because `.inspector-tabs` is an optional
middle child: `.pane-body` claims the last row through its own
`grid-row: -2/-1`, tabs auto-place into row 2, and with no tabs that row is
`auto` and collapses to 0. The prototype's `.right-pane` rule (42px 34px 1fr)
was the shape meant to do this and is applied to nothing in this app.
This is the same class of bug `check_repo.sh`'s "Empty state cannot override
a container's layout" guard exists for, one layer up.

**Also found and fixed: collapsed panes boxed their vertical label.**
`.pane.collapsed .pane-head` asks for `height: 100%`, but in a 42px first
grid row that resolves to 42px, so the vertical `.collapse-label` sat in the
header strip instead of running down the column. Measured: "Settings" needs
41px of that 42px head - today's two labels fit by ~1px and any longer
`shortLabel` would clip. `.pane.collapsed { grid-template-rows: 1fr }` gives
the head the whole pane (measured 42px -> 478px of a 480px pane, label
unclipped). Declared after `.inspector-panel.active` because the selectors
tie on specificity and source order decides.
Verify: collapse the outline and the inspector - the vertical label runs down
the full column, not just the top strip.

**FINDING 3 - non-standard font weights.** Two separate answers:
- **650 and 760 are ours** (650 on `.btn`/`.tab`/`.workspace-btn`/`.add-page`,
  760 on `.big-score`), inherited mechanically from the prototype. Snapped to
  standard steps: **650 -> 600, 760 -> 800**. 650 is an exact tie between 600
  and 700 and resolves DOWN so button/tab labels stay lighter than the 700
  used for chips, field labels and section headers - snapping up would flatten
  that hierarchy. Fixed at the boundary the values enter through:
  `scripts/scope_prototype_css.py` now normalises `font-weight` as it emits,
  so re-running it against a new prototype produces standard steps too rather
  than silently reintroducing them. The already-generated CSS was updated to
  match what the generator now produces.
- **420 is NOT ours - do not chase it.** It appears nowhere in
  `ucc_mo.bundle.css` (verified by grep, and by rendering our CSS in isolation:
  the census comes back 400/600/700 with no 420). It is inherited from
  Frappe's own `body { font-weight: var(--weight-regular) }` in
  `frappe/public/scss/desk/global.scss` (verified against real v15.83.0
  source). That is Frappe's design system applying to all of Desk, so
  overriding it inside `.ucc-mo` would make this app the only page in the
  bench with a different body weight - a real documented reason to leave it,
  which is the exception the audit asked to be reported.
Measured before (our CSS): 650 x5, 760 x1. After: **600 x6, 700 x7, 800 x1 -
every declared weight a standard step.** Rendered census: 400/600/700 only.

**Not measured here:** all of the above is Playwright against the real bundled
CSS/JS (computed colour, computed weight, real rect geometry), which is real
DOM/CSSOM behaviour, but still not a live bench. The 420 conclusion in
particular is a claim about what Frappe contributes, verified from Frappe's
source rather than from a running Desk - confirm the census on the bench.

## Round-4 QA on ucc-workbench (verify live, v0.15.0)

Nine items from live screenshots. Minor version bump: Item 7 restores a
dropped feature and Item 3 changes what the Preview tab is.

**ITEM 1 - empty-panel fill extended to the three round-3 exceptions.** Felix
approved treating the survey outline, metrics list and formula tree like the
canvas. Each pane body is a flex column whose trailing dashed affordance grows
into the space; the metrics list had no in-body affordance so it gained a
"New metric" one (same dashed pattern, same `data-act` the context-bar button
already uses, no new handler); the formula surface has no affordance to grow -
it is a read-only tree - so it simply fills. Measured survey outline **81% ->
2% empty**, canvas 2%.

**ITEM 2 - the gap above the workspace nav was Frappe's own `.page-head`.**
`make_app_page` always renders one, and this page passes `title: ""` because
the workspace nav and context bar already say where you are - so it reserved
its full height for an empty heading/breadcrumb/button area. Hidden in
`on_page_load`, scoped to this wrapper so no other Desk page is affected;
`UCCMO.refit()` then measures the smaller top and the shell grows into the
reclaimed space. Not margined away, per the "find where it comes from" ask.

**ITEM 3 - Preview now embeds inline.** It previously only rendered help text
plus an "Open preview" button that did `window.open`. It can be embedded
safely: the preview route is same-origin, so Frappe's default
`X-Frame-Options: SAMEORIGIN` permits the frame, and `preview_link`'s own
docstring records that the URL is not a credential - `preview_payload`
re-checks read permission server-side on every load, and preview collects
nothing. The tab now renders an iframe of the real respondent page (same
renderer and stylesheet a respondent gets, so it cannot drift from a mock),
with "Open in new tab" kept in the pane header for checking a long survey at
full width. No sandbox attribute: it would strip the session cookie the
login-gated preview needs.

**ITEM 4 - the Share tab was NOT a stub; it was rendering off-screen.**
`_fillShare()` has been fully implemented all along - public link, Copy, QR -
and is correctly dispatched per tab. What made it look blank: on a Draft,
`public_link` returns no URL and the tab's entire content is the reason line,
which is a `.canvas-help` - and `.canvas-help` was `position: absolute` with
no positioned ancestor, so it escaped the pane and rendered at the document
origin. Fixed by the root cause below. Verified: the Draft reason now renders
inside the pane (help top 431 vs pane top 409).

**ITEM 5a + the Share/Preview blanks - one root cause in `.canvas-help`.**
Of this app's SEVEN `.canvas-help` usages only ONE is a canvas overlay; the
other six are ordinary inline help paragraphs (Preview, Share, Responses,
Exports, the share reason, the responses message). As an absolute element they
all escaped their pane. The single overlay usage was no better: once round 3
gave it a proper containing block it stopped covering the tab bar and started
covering question 1 - the reported Item 5a. A note that must not cover
anything has no reason to be positioned, so `.canvas-help` is now an ordinary
in-flow block, and the canvas usage moved above the question list where it
reads as a caption. Measured: `position: static`, above question 1, zero
overlap. `.page-canvas`'s round-3 `position: relative` was removed with it -
nothing there is positioned any more.

**ITEM 5b - `.published-lock-row` was locked to `height: 36px`.** Felix's
instinct was right: same shape as round-3 Bug A, a rule written for one
structural context reused in another. The prototype's version is a
single-line bar in the `.add-question` flex row (hence its leftover `flex: 1`),
but all THREE of this app's usages are multi-line notices - "Review mode"
plus a sentence - so the text overflowed the dashed box onto the field below.
Now `min-height` with real padding and left-aligned text. Measured: note is
114px tall, unclipped, and the "Corrected wording" field starts 11px below it
instead of underneath it.

**ITEM 6 - the type picker had `position: absolute` and no offsets.** So it
kept its static position - after every question in the canvas - and rendered
as a large panel far below the trigger. Now anchored to `.canvas-pane` (which
gained `position: relative`) at `top: 46px; right: 12px`, directly under the
"Add question" button that opens it, with `max-height`/`overflow` so a short
viewport scrolls the popover instead of overflowing the pane. Measured:
popover top 413 vs trigger bottom 402 - 11px below it.

**ITEM 7 - drag-to-resize was dropped in the redesign; ported back.** It was
worse than missing: `layout_width` had NO visual representation in the new
canvas at all - the question list was a single-column stack, so a question set
to Half still drew full width and a grip would have had nothing to resize.
Ported the old Survey Builder's own approach rather than rebuilding: the same
12-column grid, the same four spans, the same snapping reduce() and the same
one-save-on-release (free pixel widths would break both the mobile collapse
and the "presentation only" property that lets width be edited after publish -
`layout_width` is the whole of `versioning.PRESENTATION_FIELDS`). Markers
(Section Heading, Page Break) always span the row and get no grip. Measured:
12 columns; a "Half" question renders 408px against a full-width 822px; grips
present on real questions, absent on the Section Heading.
**Found doing this:** the inspector offered `"Full"` for Column width, but the
DocType Select's literal options are `"Full Width"/"Two Thirds"/"Half"/"One
Third"` - Frappe's `_validate_selects` would have thrown on save. Same class
as the round-2 "Long Text" vs "Paragraph" bug. Fixed.
**Not ported, flagged:** drag-to-REORDER is also absent. `questionRow` renders
a "⋮⋮" handle with a "Drag to reorder" tooltip and there is no handler behind
it. Reordering still works through the API, but the affordance currently lies.
Say the word and it is the next port.

**ITEM 8 - contrast is fine; two different real problems.**
- *Green text:* measured every green element in Metrics Build at 1440/1280/
  1180/1100. They all use one token pair, `#087a52` on `#eaf8f2` = **4.9:1,
  which passes WCAG AA**. So the "unreadable" complaint is type SIZE, not
  colour: `.chip` was 9px, the outlier in a system where every other secondary
  label (`.help`, `.eyebrow`, `.pane-head span`) is 10px. Chips are now 10px.
  If the green still reads poorly at 10px the next lever is darkening
  `--success`, which is a token change affecting all five workspaces - say so
  and it is one line.
- *The Likert collision:* not an overlap - a truncation. `.source-row`'s third
  grid track is 64px, which is the prototype's width for a numeric weight
  `<input>`; this app puts the normalisation `<select>` there, whose longest
  option "Likert 1-5 to 0-100" needs 93px of text plus ~28px of select chrome
  = 121px. At 64px it was cut mid-string hard against the delete button, which
  is what read as the control colliding with its neighbour. Track widened to
  150px and the select fills it. Measured: 150px, no truncation, no overlap.

**ITEM 9 - the formula canvas was empty, not blocked. Reproduced exactly.**
Nothing was capturing input. `_formula()` walked down only from nodes with a
falsy `parent_key` and rendered nothing else, so a version whose nodes ALL
carry a parent_key - no root - produced a completely empty canvas with four
real nodes in the data, no error and nothing to click. Dangling or cyclic
parents did the quieter version: **7 nodes in, 4 drawn, no warning.**
`index_engine.validate_structure` catches all of these (no root, multiple
roots, dangling parents, cycles) but only when you press Validate or Publish,
so a Draft reaches this renderer unchecked - the UI has to be total.
It now draws the tree where there is one and puts everything unreachable in a
labelled group explaining what is wrong, and the walk carries a `seen` set so
it can never recurse forever on a cycle.
Measured after the fix: no-root data **0 -> 4 nodes rendered**, all
hit-testable, and a real mouse click selects the node and updates the
inspector; cyclic + dangling data **4 -> 7 nodes**.
Ruled out by measurement rather than assumed: no overlay captures clicks (the
real `IndexWorkspace` was instantiated with real jQuery and mocked endpoints -
every node hit-tests to itself, a real click works, no JS errors), and
`.formula-surface`'s centred grid does not cut content off above the scroll
box. It was never node_canvas.js either - the workbench does not use it.

**Also fixed in passing:** three hand-rolled pane headers (Objectives
"Mapping", Metrics "Source questions", Indices "Formula"/"Calculate"/
"Results") still used a bare `<span>`, so they rendered 10px muted from
`.pane-head span` instead of the 12px `var(--text)` that `pane()`/`inspector()`
have emitted since round 2's Item E. Now `<strong>`, consistent everywhere.

**Verification:** all 21 pure suites and all 20 check_repo.sh guard groups
green; every prior round's regression check re-run and still passing. Items
3-9 were verified by instantiating the REAL `SurveyWorkspace` and
`IndexWorkspace` classes from `ucc_workbench.js` with real jQuery, real
bundled CSS and mocked endpoints, then measuring geometry and clicking with a
real mouse - much closer to the bench than component snippets, but still not
the bench. Confirm on ucc-sms-v2.orb.local.

## Round-5 QA on ucc-workbench (verify live, v0.16.0)

**ITEM 8 FIRST, because it changes how to read this whole report: the round-4
fix was never deployed.** Felix tested v0.14.4. The Item 9 formula fix exists
only in commit 2b59350 = **v0.15.0**, which is one release later - confirmed
with `git log -S"orphans"` and by reading `__init__.py` at each commit. So this
is the "undeployed fix" case, NOT a wrong diagnosis; nothing about the original
root cause needs redoing. It also means round 4's Items 1-7 (canvas-help
escaping its pane, popover anchoring, drag-to-resize, the source-row width, the
page-head gap) were all absent from what Felix tested, so some round-5 symptoms
may already be fixed in v0.15.0. **Deploy v0.16.0 and re-test before filing
round 6.**

**ITEM 1 - Frappe Desk was leaking INTO our markup.** Every icon+text control
rendered as "+        Add page". `frappe/public/scss/common/icons.scss`
(v15.83.0) declares a global `.icon { ... margin: 0 auto; ... }`, and our icons
carry `class="icon"` too. In a flex container auto left AND right margins absorb
every pixel of free space, pushing icon and label to opposite ends - which is
why one rule fixes every button and why the gap scaled with button width.
Fixed with `margin: 0` on `.ucc-mo svg.icon`. Measured with Frappe's real rule
loaded first: **51px / 320px / 80px before, 6px / 6px / 7px after** (removing
our line reproduces the break, so the check is real). This file's own header
warns that `.icon` is a name Frappe already uses; scoping stopped us leaking
OUT and nothing had stopped Frappe leaking IN. Its other declarations
(width/height/display/stroke/fill) were already overridden at higher
specificity - margin was the only gap.
Verify: Add page, Add another question, Apply changes, Save metric all read as
"+ Label", and check one OTHER Desk page still looks normal.

**ITEM 2 - Theme Settings tab added, but read the scope note.** New local tab
between Build and Preview. Every control, option list and default is rendered
from what `api/theme.get_theme` returns, which reads the pure `theme` module the
respondent stylesheet is itself built from - no colour or option literal is
duplicated in the browser. Two new whitelisted endpoints (`get_theme`,
`save_theme`); `save_theme` is `frappe.only_for("System Manager")`, validates
every colour through `theme.normalise_colour` and every Select against
`theme.SELECT_CHOICES`, ignores unknown field names, and clears only that one
Single's document cache (never a site-wide wipe).
**It is SITE-WIDE, not per-survey.** `UCC Survey Theme` is a Single DocType -
one theme for the whole bench. Felix asked for it "scoped to whichever survey/
version is currently open"; that is a schema change (an override on UCC Survey
Version), so it is flagged rather than faked, and the tab says so on screen:
"These settings apply to EVERY survey on this site." Say the word if the
per-survey override is wanted and it becomes a data-model decision entry.
Verify: colours and sizing load with current values; saving as System Manager
persists and the respondent page picks up the change; saving as a non-System
Manager is refused by the server, not the browser.

**ITEM 3 - the outline label collided with the prototype's own `.page-title`.**
Our inline label used `class="page-title"`, which in the prototype is a
CONTAINER rule (`display:flex; justify-content:space-between; margin-bottom:8px`).
Applied to a label inside `.page-item-btn`'s own space-between row, the 8px
bottom margin pushed the text off the count badge's centre line. Renamed to
`.page-name` with its own rule so the collision cannot return. Measured:
vertical misalignment **4px -> 0px**, display flex -> block, margin-bottom
8px -> 0.

**ITEM 4 - a regression I introduced in round 4.** Making `.question-list` a
12-column grid (Item 7's width port) turned the empty state into a grid item
too, so it took ONE column - 63px of an 822px list - and the sentence wrapped
into four stacked lines. It is not a question and now spans the row. Measured:
width **63px -> 822px**, text height **75px -> 15px (one line)**. Fixed by
widening the container, not by shrinking the font.

**ITEM 5 - question label and status line were literally identical.**
`questionRow()` emits `<div class="question">` and `<div class="question-meta">
<span>`, but the prototype only ever styled `.question-copy strong` - so both
fell through to the inherited 13px/`var(--text)`, measured identical in size,
colour and weight. The status line is secondary and now says so. Measured:
question **12px navy**, meta **10px muted** - was 13px/navy for both.

**ITEM 6 - Objectives works with well-formed data; the empty state was lying.**
Instantiated the real `ObjectiveWorkspace` with real jQuery and endpoint shapes
taken from `api/mapping.py` itself: the queue lists both unmapped questions, the
canvas renders the question node and its linked objective node, no JS errors.
So no functional break reproduced - and note Felix is on v0.14.4, so this may
also be round-4 fallout.
What I DID find, by first mocking the shape wrongly: when `get_mapping_overview`
returns no questions, the queue rendered "Questions 0" and the empty state read
**"Nothing needs attention. Every question has an objective."** - a success
message that is indistinguishable from a failed load, and exactly the kind of
thing that makes a workspace read as broken. It now distinguishes the two: a
version with no questions says so and points at the Surveys workspace.
Verify on the bench: if Objectives still misbehaves on v0.16.0, capture what
`api.mapping.get_mapping_overview` actually returns for that version - the
renderer is fine, so the answer will be in the payload.

**ITEM 7 - the green number was an unlabelled source count.** It rendered as
`3 ▸` - the metric's source-question count plus a stray glyph, with nothing
saying what it counted. Now `"3 sources"` with a link icon, so it explains
itself without a tooltip.

**ITEM 10 - demo dataset: SHAPE ONLY, not built.** Felix asked for the planned
shape before anything is generated, so nothing was written this round. The
proposal is in the report accompanying this release; `demo_data.py` is
unchanged.

**Verification:** all 21 pure suites and all 20 check_repo.sh guard groups green
(now 94 Desk-page calls and 66 whitelisted methods, both resolving after the two
new theme endpoints); every prior round's regression check re-run and passing.
Items 1/3/4/5 were measured against the real bundled CSS **with Frappe's own
`.icon` rule loaded first**, and Item 1's check was confirmed to fail without
the fix. Still not a live bench - deploy and confirm.
