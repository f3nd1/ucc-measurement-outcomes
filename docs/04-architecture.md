# Proposed Architecture

## Final production direction

Build a separate Frappe application installed inside the existing SMS.

```text
Internal Frappe workspace
    Survey Studio
    Mapping Studio
    Index Studio
    Dashboard Studio
    Data Explorer

Public survey pages
    Anonymous or secure-token access

Server-side services
    Validation
    Permissions
    Normalisation
    Metric and index calculations
    Exports

ERPNext/Frappe records
    Surveys
    Questions
    Campaigns
    Submissions
    Answers
    Mappings
    Indices
    Results
```

## Responsibility split

| Layer | Responsibility |
|---|---|
| Browser interface | Editing, drag-and-drop, diagrams and charts |
| Server | Validation, permissions, scoring and calculation |
| Database records | Authoritative survey, mapping, answer and result data |
| D3 | Node diagrams and visualisations only |

## Security principles

- Public survey endpoints expose only published survey content.
- Secure tokens identify invitations without exposing internal record names.
- Guest endpoints must be rate-limited and narrowly scoped.
- The browser submits raw answers, not trusted calculated scores.
- Data Explorer uses an approved dataset catalogue, not arbitrary SQL.
- Personal data access follows role permissions and audit logging.

## Development environment

- Use a local or staging Frappe bench.
- Do not test public submission against the live SMS first.
- Use synthetic fixtures only.
- Keep migrations and fixtures in source control.
