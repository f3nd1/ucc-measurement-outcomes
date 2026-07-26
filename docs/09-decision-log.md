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
| 2026-07-26 | Finding A: a campaign requires an existing Survey Management record (option 2) | educ_sg makes Survey Tracking.survey_name mandatory. Auto-creating a stub would put planning documents nobody planned into the institutional register that this app exists to produce evidence from; relaxing the field via a Property Setter would weaken a constraint educ_sg's own code may rely on. D1 bends: Survey Management stays reference-only for AUTHORING, but is a prerequisite for COLLECTING. | Auto-create a stub; relax survey_name; keep two campaign types | Already enforced by educ_sg + survey_tracking_hooks; the work was making it legible in the UI |
