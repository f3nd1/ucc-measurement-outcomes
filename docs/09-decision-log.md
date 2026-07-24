# Decision Log

Record decisions that change the architecture, scope or data model.

| Date | Decision | Reason | Alternatives considered | Approved by |
|---|---|---|---|---|
| | Build the permanent system as a separate Frappe app | Scale, auditability and maintainability | Permanent Custom HTML Block implementation | |
| | Keep objective mapping separate from metric mapping | They answer different governance and calculation questions | One combined mapping record | |
| | Store each answer as a reportable row | Supports filtering, drill-down and audits | One JSON response blob only | |
| | Perform official scoring on the server | Prevents tampering and ensures consistent calculations | Browser-only scoring | |
| 2026-07-24 | Normalise once at the metric layer; the index applies weights only | Prevents double-normalisation when real (already 0-100) Metric Results feed an index; keeps a single source of truth for scaling | Normalising again at each index node (found during the Step 1 integration audit to corrupt scores) | |
| 2026-07-24 | Add a metric-calculation step (answers → Metric Result) and backfill answer_numeric | The Survey→Index chain had no code turning answers into Metric Results; index only read them | Leaving Metric Results to be populated manually / externally | |
