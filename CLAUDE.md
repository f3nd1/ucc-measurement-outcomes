# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

UCC Measurement Outcomes for United Ceres College, Singapore.

## Repository status

This repository is a **project starter pack**, not yet an installable Frappe application. It contains documentation, reference PDFs, and a standalone HTML prototype — no application code. `frappe-app/` is a placeholder; generate the actual app there only after environment discovery (Frappe/ERPNext versions, bench location, dev site, existing UCC DocTypes) confirms the details. There is no build, lint, or test tooling yet.

The only runnable command is a starter-file presence check:

```bash
bash scripts/check_repo.sh
```

The prototype (`prototype/ucc_measurement_outcomes_studio.html`) opens directly in a browser. It validates the intended UX only — it is not the production architecture.

## Repository layout

- `docs/` — numbered design docs, read in order: `00-start-here.md`, `01-product-scope.md`, `02-user-flows.md`, `03-data-model.md` (proposed DocTypes), `04-architecture.md` (responsibility split and security principles), `05-implementation-plan.md` (milestones 0–5 with verification steps), `06-acceptance-criteria.md`, `07-existing-system-inventory-template.md`, `08-open-questions.md`, `09-decision-log.md`, `10-github-issues.md`
- `reference-documents/` — UCC PDFs: Criterion 7.1.1 workflow, objective-question mappings, SEQI/SAPI definitions, and real survey instruments
- `claude-prompts/` — prepared prompts for environment discovery and first-milestone planning
- `prototype/` — standalone interactive HTML prototype
- `frappe-app/` — placeholder for the future Frappe app

## First task

Do not build the entire product immediately. Milestone 0 is discovery: inspect the local Frappe environment, inventory existing UCC apps/DocTypes (especially Quality Performance Outcomes, Quality Action and Quality Meeting), confirm a development site, and propose the smallest complete first milestone. See `docs/00-start-here.md` and `docs/05-implementation-plan.md`.

## Proposed data model (summary)

Three record families, detailed in `docs/03-data-model.md`:

1. **Survey**: UCC Survey → Version (immutable once published) → Section → Question → Option, plus Campaign → Invitation → Submission → Answer (one row per question per submission)
2. **Mapping**: Measurement Objective, Objective Question Mapping, Metric, Metric Mapping — objective mapping and metric mapping are separate
3. **Index/analytics**: Index Definition → Component (weights as normal fields/child rows, never D3 JSON), Metric Result, Index Result, Calculation Log — results carry period, entity, version, coverage and calculation date

## Goal

Build a separate Frappe/ERPNext application that supports the complete measurement-outcomes workflow:

```text
Survey design
→ Distribution and data collection
→ Objective and clause mapping
→ Metric mapping and normalisation
→ Index calculation
→ Dashboard and data exploration
→ Quality Action
→ Quality Meeting
→ Effectiveness verification
```

## Required workspaces

1. Survey Studio
2. Mapping Studio
3. Index Studio
4. Dashboard Studio
5. Data Explorer

## Important product rules

- The application must feel like one integrated product.
- The interface must be usable by non-technical staff.
- Prefer drag-and-drop, visual mapping and clear drill-downs.
- Survey questions map to objectives and clauses.
- Questions then map to stable reusable metrics.
- Indices consume mapped metrics, not raw question wording.
- D3 is for diagrams and visualisation only.
- Official validation, scoring and calculations must run on the server.
- Each answer must be stored as a reportable row.
- Published survey and index versions must not be silently overwritten.
- Every score must be traceable back to its source question or operational record.
- Weak results must be linkable to Quality Actions and Quality Meetings.
- Do not create duplicate replacements for existing UCC DocTypes without first checking the current system.

## Development rules

- Inspect the repository and reference documents before coding.
- State material assumptions before major implementation work.
- Build the minimum complete vertical slice first.
- Do not build every feature simultaneously.
- Keep changes focused and reviewable.
- Add tests for scoring, weight validation, versioning and public submission.
- Never use production credentials or real personal data in fixtures.
- Do not give Guest access to internal APIs.
- Do not accept calculated scores from the browser as authoritative.
- Do not allow arbitrary SQL from Data Explorer requests.
- Keep a decision log in `docs/09-decision-log.md`.

## Build order

### Phase 1: Foundation

- Confirm Frappe and ERPNext versions
- Inventory existing UCC DocTypes and fields
- Create the application shell and permissions
- Create the minimum survey data model

### Phase 2: First complete survey flow

- Create survey
- Add and reorder questions
- Save draft
- Publish one version
- Open public link
- Submit one response
- Store one Submission record and one Answer record per question

### Phase 3: Mapping and calculation

- Objective and clause mapping
- Metric mapping
- Five-point and Yes/No normalisation
- One SEQI dimension
- One complete index calculation
- Explain-score drill-down

### Phase 4: Analytics

- Dashboard filters and charts
- Student-level drill-down
- Data Explorer
- CSV and JSON exports

### Phase 5: Improvement loop

- Quality Performance Outcomes linkage
- Quality Action creation
- Quality Meeting linkage
- Effectiveness verification
- Criterion 7 evidence pack

## Definition of done for each feature

Every completed feature must include:

1. Observable user behaviour
2. Permission checks
3. Server-side validation
4. Error and empty states
5. Focused tests
6. Documentation update
7. Verification notes

## Primary references

Read these first:

- `reference-documents/01-criterion-7-1-1-measurement-outcomes-workflow.pdf`
- `reference-documents/02-survey-objective-question-mapping-v02.pdf`
- `reference-documents/03-quality-performance-outcomes-survey-mapping-seqi.pdf`
- `reference-documents/04-student-academic-performance-index-sapi.pdf`

The remaining Survey Management PDFs provide real question types, objectives, clauses, response options, distribution methods, targets and rationale.
