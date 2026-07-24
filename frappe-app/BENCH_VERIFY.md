# Bench-verify registry

Phase 1 was authored **without a live Frappe bench**. Every assumption that
depends on the real UCC system is listed here and also carries an inline
`TODO: bench-verify` token. Find them all with:

```bash
grep -rn "TODO: bench-verify" frappe-app/
```

The bench-connected (OrbStack) session must resolve each before install/migrate.

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
| 4 | `owner_department` | `ucc_survey` | Real Department / Cost Center DocType name + key field |

Core Frappe DocTypes are safe to link and **are** linked: `User`
(`ucc_survey_version.published_by`).

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
Duplicate-question already existed from checkpoint 2. Copy/paste section is
available via `duplicate_section` (API).

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
