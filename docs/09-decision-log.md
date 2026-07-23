# Decision Log

Record decisions that change the architecture, scope or data model.

| Date | Decision | Reason | Alternatives considered | Approved by |
|---|---|---|---|---|
| | Build the permanent system as a separate Frappe app | Scale, auditability and maintainability | Permanent Custom HTML Block implementation | |
| | Keep objective mapping separate from metric mapping | They answer different governance and calculation questions | One combined mapping record | |
| | Store each answer as a reportable row | Supports filtering, drill-down and audits | One JSON response blob only | |
| | Perform official scoring on the server | Prevents tampering and ensures consistent calculations | Browser-only scoring | |
