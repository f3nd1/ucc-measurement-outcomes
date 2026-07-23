# UCC Measurement Outcomes

An ERPNext/Frappe application for United Ceres College to design and publish surveys, collect responses, map questions to objectives, clauses and reusable metrics, calculate institutional performance indices, and present Criterion 7.1.1 outcomes through interactive dashboards and a data explorer.

## Current status

This repository is a **project starter pack**, not yet an installable Frappe application.

It contains:

- A standalone interactive HTML prototype
- UCC reference documents
- Confirmed functional requirements
- Proposed data model and architecture
- Phased implementation plan
- Acceptance criteria
- Instructions for Claude Code

## Product workspaces

1. **Survey Studio**
   - Survey library and versions
   - Drag-and-drop survey builder
   - Campaign distribution and response tracking
   - Public survey submission
   - Automatic question-level charts

2. **Mapping Studio**
   - Objective-question mapping
   - Clause and standard mapping
   - Reusable metric mapping
   - Coverage and gap analysis

3. **Index Studio**
   - D3 node builder
   - Normalisation and weighted calculations
   - SEQI, SAPI and other institutional indices
   - Validation, versioning and score explanation

4. **Dashboard Studio**
   - KPI cards, trends and contribution analysis
   - Programme, intake, teacher and period filters
   - Quality Action and Quality Meeting linkage

5. **Data Explorer**
   - Raw answer, metric and index datasets
   - Table, pivot and chart outputs
   - CSV and JSON export

## Start here

1. Open `prototype/ucc_measurement_outcomes_studio.html` in a browser.
2. Read `CLAUDE.md` before asking Claude Code to make changes.
3. Review `docs/01-product-scope.md` and `docs/05-implementation-plan.md`.
4. Do not connect Claude Code directly to the live SMS during the first build phase.
5. Build and test the Frappe app on a development or staging site first.

## Intended implementation

The permanent system should be a separate Frappe application installed inside the existing SMS. It should reuse existing UCC Quality Performance Outcomes, Quality Action and Quality Meeting records where possible.

The HTML prototype is for validating the experience. It is not the final production architecture.
