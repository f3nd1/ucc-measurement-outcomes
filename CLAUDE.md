# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

UCC Measurement Outcomes for United Ceres College, Singapore — a Frappe/ERPNext application for survey design, question→objective/metric mapping, institutional index calculation (SEQI, SAPI, …) and Criterion 7.1.1 outcome reporting.

## Repository status

The application is **built but never bench-installed**. All five workspaces (Survey Studio, Mapping Studio, Index Studio, Dashboard Studio, Data Explorer) plus the public survey page exist and are merged to `main`, authored entirely **without a live Frappe bench** — via static analysis, pure-logic tests, and fixture-driven verification.

Consequences that shape all work here:

- **Nothing has run against a database.** Every bench-dependent assumption is tracked with an inline `# TODO: bench-verify` token and catalogued in `frappe-app/BENCH_VERIFY.md`. Find them all: `grep -rn "TODO: bench-verify" frappe-app/`.
- The remaining large pieces (Quality Action / Quality Meeting integration, effectiveness verification, real entity/period dimensioning) are **hard-blocked on bench discovery** — do not attempt them here.
- `prototype/ucc_measurement_outcomes_studio.html` is a UX reference only, not the architecture.

## Where the code lives

The Frappe app is nested under `frappe-app/`, not at the repo root:

- `frappe-app/ucc_measurement_outcomes/` — app root (`pyproject.toml`, dep: `qrcode`)
- `frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes/` — the Python package; the five `*_studio/` and `data_explorer/` dirs are the five modules (`modules.txt`)

## Commands

There is no bench in this environment. The real test tier is the **pure, Frappe-free suites** — run directly with Python, no database:

```bash
cd frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes
for t in test_versioning_logic test_submission_utils test_index_engine test_explorer_agg \
         test_metric_engine test_chain_contract test_coverage test_index_templates test_bulk_parse \
         test_display_logic test_dashboard_export test_theme; do
  python3 $t.py    # each is self-contained; run a single one the same way
done
```

Before committing, sanity-check the whole app:

```bash
# from frappe-app/
python3 -m py_compile $(find ucc_measurement_outcomes -name "*.py")   # all Python compiles
/opt/node22/bin/node --check <file.js>                                 # JS syntax (no JS test harness exists)
python3 -c "import json,sys; json.load(open(sys.argv[1]))" <file.json> # DocType JSON validity
find . -name __pycache__ -type d -prune -exec rm -rf {} +             # never commit .pyc
```

`bash scripts/check_repo.sh` still checks starter-file presence. **On a real bench**, integration tests run with:

```bash
bench --site <site> run-tests --module ucc_measurement_outcomes.test_integration_chain
```

`test_integration_chain.py` (and the bench parts of other suites) have been **compile-checked but never executed** — run them first when a bench is available.

## Architecture — the load-bearing patterns

**Pure-engine pattern (the signature decision).** All calculation, normalisation, validation and parsing logic lives in **Frappe-free modules at the package root** — `index_engine.py`, `metric_engine.py`, `explorer_agg.py`, `coverage.py`, `bulk_parse.py`, `versioning.py`, `submission_utils.py`, `index_templates.py` — each paired with a `test_*.py` runnable without a bench. The DocType controllers and `api/*.py` methods are **thin wrappers that delegate** to these. When adding logic, put it in a pure module with a test; do not embed arithmetic or rules in a controller. (Cross-imports among these use a `try: from ucc_measurement_outcomes.X … except ImportError: from X …` shim so the standalone tests still import.)

**The calculation chain — normalise exactly once.** Raw Answer → `metric_engine.aggregate_metric` normalises each answer to 0–100 and averages → `UCC Metric Result` → `index_engine.compute_index` applies **weights only, never re-normalising** → `UCC Index Result` (+ Score Breakdown) → Dashboard / Data Explorer. Normalisation is a metric-layer concern; the index node's normalisation field is informational. Re-normalising at the index would double-count 0–100 values. This is recorded in `docs/09-decision-log.md`; `test_chain_contract.py` proves the chain end to end (known inputs → 85).

**Immutability (`versioning.py`, shared by survey and index versions).** Once `Published`, a version's only permitted transition is `Published → Closed`, and its **answer-determining content is frozen too** (not just status — a `Published→Published` save must not rewrite it). Two narrow exemptions, each a whitelist in `versioning.py`: `PRESENTATION_FIELDS` (silent, currently `layout_width`) and `CORRECTABLE_FIELDS` (wording only, requires `correction_reason` and shows a marker wherever the evidence is read — see the 2026-07-29 decision). `UCC Index Result` rows are immutable snapshots tied to the exact published formula version. The product invariant behind all this: **every published score must be reproducible**. Editing a formula means a new version + new results, never a silent change.

**Trust boundaries.** UIs call **only whitelisted `api/*` methods**, never raw DocType REST. `api/public.py` is the single guest-reachable write path (token check, one-response enforcement with a campaign row lock, atomic Submission + one Answer per question); it exposes only Published, non-Archived survey content. `api/explorer.py` runs queries **only against the approved `DATASETS` catalogue** — filter values are scalars only, no arbitrary SQL or field names.

**Shared front-end components** load via `app_include_js`: `public/js/node_canvas.js` (`UCCNodeCanvas` — vanilla SVG, no D3) is reused by Mapping and Index Studio; `public/js/filter_bar.js` (`UCCFilterBar`) drives the Dashboard.

## Data model (as built)

18 DocTypes across the five modules. Key relationships and invariants:

- **Survey**: UCC Survey → UCC Survey Version (immutable once published) → UCC Survey Question (standalone; its `choices` are UCC Survey Question Choice child rows). Sectioning is the **"Section Heading" question type**, not a separate doctype (decision V5). Question order is a dense `sequence` kept via `api/builder._resequence`.
- **Collection**: UCC Survey Campaign (public token) → UCC Survey Submission → UCC Survey Answer — **one reportable Answer row per question per submission**. Multi-select answers are stored as a **JSON array** (decision V7). `answer_numeric` is populated server-side by metric calculation, never accepted from the browser.
- **Mapping**: UCC Standard, UCC Question Mapping (objective links to educ_sg's **Survey Objective** register — this app has no Objective DocType of its own, see the 2026-07-29 Gap 2 decision; **many per question**, one row per question→objective pair; the `unique` constraint on `question` was removed once real UCC data showed questions carrying two and three objectives, so anything reading these must handle a list — `get_mapping_overview` returns both `objective` (the first, for the single-field inspector) and `objectives` (all of them)), and UCC Metric Definition → UCC Metric Source (question→metric). Objective mapping and metric mapping are deliberately **separate** records.
- **Index/analytics**: UCC Index Definition → UCC Index Version → UCC Index Node (weights as real fields; `pos_x/pos_y` are canvas layout only) → UCC Index Result → UCC Score Breakdown. UCC Metric Result feeds the index.

## Product rules

- The application must feel like one integrated product, usable by non-technical staff; prefer drag-and-drop, visual mapping and clear drill-downs.
- Survey questions map to objectives and clauses; questions then map to stable reusable metrics; indices consume mapped metrics, not raw question wording.
- Official validation, scoring and calculation run on the **server**; never accept a browser-supplied score as authoritative.
- Each answer is a reportable row; every score is traceable to its source question or operational record.
- Published survey and index versions must not be silently overwritten.
- Weak results must be linkable to Quality Actions and Quality Meetings (bench-blocked).
- Do not create duplicate replacements for existing UCC DocTypes without checking the live system first.

## Working rules

- **Add logic as a pure module + test**, not in a controller (see the pure-engine pattern above).
- State material assumptions before major work; anything bench-dependent goes in `frappe-app/BENCH_VERIFY.md` with a `# TODO: bench-verify` marker, not a guess.
- Keep changes focused and reviewable; do not give Guest access to internal APIs; do not allow arbitrary SQL from Data Explorer.
- Record architecture/scope/data-model decisions in `docs/09-decision-log.md`.
- **Verify every Frappe symbol against the real source before using it** — there is no bench here, and five separate failures this session were unverified API guesses (`frappe.rate_limit`, `context.include_js` on a www page, `bundled_asset`'s argument shape, `frappe.utils.quoted`, `frappe.clear_website_cache`). The source is fetchable and definitive:
  ```bash
  curl -s https://raw.githubusercontent.com/frappe/frappe/v15.83.0/frappe/<path>.py | grep -n "def <name>"
  ```
  If a symbol cannot be verified, do not build a silent fallback around it — fail loudly and name the fix, because a fallback indistinguishable from success is how three of those five stayed hidden.
- **Bump `__version__` in `frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes/__init__.py` on every release or checkpoint batch**, so bench's Installed Applications list shows what is actually deployed instead of sitting at 0.0.1 forever. That file is the only place to edit: `pyproject.toml` declares `dynamic = ["version"]` and flit reads it from there.
- Every completed feature: observable behaviour, permission checks, server-side validation, error/empty states, a focused test, a docs update, verification notes.

## Documentation to read first

- `docs/11-deep-review-report.md` — the current state of truth: verified claims, bugs F1–F14, and the V1–V7 product decisions (display logic hidden, collection gating, sectioning, multi-select storage, …).
- `docs/09-decision-log.md` — architecture decisions (notably: normalise once at the metric layer).
- `frappe-app/BENCH_VERIFY.md` — every unresolved bench-dependent assumption.
- `docs/01-product-scope.md`, `docs/03-data-model.md`, `docs/04-architecture.md` — original scope/model/security intent.
- Reference PDFs (`reference-documents/`): Criterion 7.1.1 workflow (`01`), objective-question mapping (`02`), SEQI mapping (`03`), SAPI (`04`), plus the real survey instruments. **These carry a real text layer — read them, do not guess around them.** `pip install pymupdf`, then:
  ```python
  import fitz; print("\n".join(p.get_text() for p in fitz.open("reference-documents/01-....pdf")))
  ```
  (`pdftotext`/poppler is absent, and the Read tool's PDF path needs `pdftoppm`, which is why this was long believed to be image-only. It is not. Five of the seven index templates were invented while that note stood — see the 2026-08-01 decision-log entry.)
