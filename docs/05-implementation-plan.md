# Implementation Plan

## Milestone 0: Discovery

Deliverables:

- Confirm Frappe and ERPNext versions
- Inventory existing apps, DocTypes and custom fields
- Identify records to reuse
- Confirm development and staging environments
- Confirm app package and module names

Verification:

- Written inventory committed to the repository
- No naming conflicts remain unresolved

## Milestone 1: First survey vertical slice

Deliverables:

- Survey, version, section, question, campaign, submission and answer records
- Basic drag-and-drop builder
- Draft and publish workflow
- Public survey renderer
- Public response submission

Verification:

```text
Create survey
→ publish version
→ open public link
→ submit response
→ confirm one Submission
→ confirm one Answer per question
```

## Milestone 2: Mapping

Deliverables:

- Objective and clause mapping
- Metric catalogue and question mapping
- Five-point and Yes/No normalisation
- Mapping coverage report

Verification:

- Every sample question shows its objective, clauses and metric
- Normalised scores match expected values

## Milestone 3: First index

Deliverables:

- D3 index canvas
- Metric, dimension and index nodes
- Weight editing and validation
- Server-side calculation
- Result snapshot and explanation view

Verification:

- Index weights must total 100%
- Known fixture inputs produce a known expected score
- Score can be traced to individual answer rows

## Milestone 4: Dashboard and explorer

Deliverables:

- Collection dashboard
- Index dashboard
- Programme and period filters
- Student drill-down
- Data Explorer with approved datasets
- CSV and JSON export

Verification:

- Dashboard totals equal underlying records
- Filters are consistent across widgets

## Milestone 5: Improvement loop

Deliverables:

- Quality Performance Outcomes linkage
- Quality Action creation
- Quality Meeting linkage
- Effectiveness-verification record
- Criterion 7 evidence export

Verification:

- One low result can be followed from source answer to verified action closure
