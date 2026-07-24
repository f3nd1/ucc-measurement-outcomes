# Bench-verify registry

Phase 1 was authored **without a live Frappe bench**. Every assumption that
depends on the real UCC system is listed here and also carries an inline
`TODO: bench-verify` token. Find them all with:

```bash
grep -rn "TODO: bench-verify" frappe-app/
```

The bench-connected (OrbStack) session must resolve each before install/migrate.

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

## Not yet built (later checkpoints, not assumptions)

- Mapping + Metric DocTypes and node canvas (checkpoint 4)
- Index DocTypes, scoring/normalisation, results (checkpoint 5)
