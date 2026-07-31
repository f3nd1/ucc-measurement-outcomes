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
