# Proposed Data Model

This is a starting proposal. Claude Code must inspect the existing SMS before finalising names or creating records.

## Survey records

| Proposed DocType | Purpose |
|---|---|
| UCC Survey | Survey identity, owner and lifecycle |
| UCC Survey Version | Immutable version header and publication status |
| UCC Survey Section | Section structure and order |
| UCC Survey Question | Stable question record |
| UCC Survey Question Option | Choice and matrix options |
| UCC Survey Campaign | Distribution period and response target |
| UCC Survey Invitation | Respondent token and delivery status |
| UCC Survey Submission | One partial or completed response |
| UCC Survey Answer | One answer per question per submission |

## Mapping records

| Proposed DocType | Purpose |
|---|---|
| UCC Measurement Objective | Reusable survey objective |
| UCC Objective Question Mapping | Question, objective and clause relationship |
| UCC Metric | Stable reusable metric definition |
| UCC Metric Mapping | Source question or field to metric |

## Index and analytics records

| Proposed DocType | Purpose |
|---|---|
| UCC Index Definition | Index identity, version, target and formula |
| UCC Index Component | Metric or dimension and weight |
| UCC Metric Result | Calculated metric result by entity and period |
| UCC Index Result | Calculated dimension or index snapshot |
| UCC Analytics Diagram | D3 node positions and display configuration |
| UCC Dashboard | Dashboard definition |
| UCC Dashboard Widget | Widget configuration |
| UCC Saved Analysis | Saved Data Explorer view |
| UCC Calculation Log | Calculation run, errors and record counts |

## Key design rules

- Question identity must remain stable across reporting references.
- Published versions must be immutable.
- Answer rows must be queryable individually.
- Objective mapping and metric mapping must be separate.
- D3 graph JSON is a visual layout, not the official calculation definition.
- Official index components and weights must be stored as normal fields or child rows.
- Calculated results must include period, entity, version, coverage and calculation date.
