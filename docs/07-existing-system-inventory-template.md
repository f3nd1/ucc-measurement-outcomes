# Existing SMS Inventory Template

Complete this before creating new DocTypes.

## Discovery session status

**Blocked — not completed.** This session (and the prior study-only session)
ran in an isolated container holding only a git checkout of this repository.
Verified directly: no `bench` or `frappe` binary on `PATH`, no bench directory
found anywhere on disk, `python3 -c "import frappe"` fails, no
`apps.txt` / `site_config.json` / `common_site_config.json` found anywhere on
disk, and no other UCC custom app (GD4 simulator, Marketing OS, Intelligence
Platform, etc.) present in this environment. `redis-cli` is installed but
there is no Frappe app or site to pair it with, so it was not queried.

None of the read-only `bench`/`frappe console` commands in the discovery
prompt could be run. Every row below is marked **Unconfirmed — no bench/site
access from this session** rather than guessed, per instruction. This table
must be completed by someone running the same read-only commands from a
session with real bench access, then this file updated with the actual
output.

## Environment

| Item | Value |
|---|---|
| Frappe version | Unconfirmed — no bench/site access from this session |
| ERPNext version | Unconfirmed — no bench/site access from this session |
| Bench version | Unconfirmed — no bench/site access from this session |
| Python version | Unconfirmed — no bench/site access from this session |
| Node version | Unconfirmed — no bench/site access from this session |
| Development site | Unconfirmed — no bench/site access from this session |
| Staging site | Unconfirmed — no bench/site access from this session |

## Relevant existing apps

| App | Version | Relevant functions |
|---|---|---|
| Unconfirmed — no bench/site access from this session | | |

## Relevant existing DocTypes

| DocType | Reuse, extend or replace? | Relevant fields | Notes |
|---|---|---|---|
| Quality Performance Outcomes | Unconfirmed | Unconfirmed — no bench/site access from this session | Field list, owning app, and whether it already has a result-linking field are all unknown |
| Quality Action | Unconfirmed | Unconfirmed — no bench/site access from this session | |
| Quality Meeting | Unconfirmed | Unconfirmed — no bench/site access from this session | |
| Student | Unconfirmed | Unconfirmed — no bench/site access from this session | |
| Student Applicant | Unconfirmed | Unconfirmed — no bench/site access from this session | |
| Instructor | Unconfirmed | Unconfirmed — no bench/site access from this session | |
| Programme or Course | Unconfirmed | Unconfirmed — no bench/site access from this session | Real DocType name (Program vs Programme vs Course) not confirmed |

## Existing survey/feedback infrastructure

Unconfirmed — no bench/site access from this session. Not searched for
DocTypes matching `survey`, `question`, `response`, `questionnaire`, or
`feedback` because no site was reachable.

## SAPI source field confirmation

Unconfirmed — no bench/site access from this session. The following field
paths are assumed by the draft SAPI index definition and reference document
04, but have **not** been verified to exist:

- `Assessment Result.grade`
- `Assessment Result.status`
- `Student Admission.status`
- `Student.completion_status`

SAPI cannot be built until these (or their real equivalents) are confirmed.

## Existing canvas/diagram library search

Unconfirmed — no bench/site access from this session. No other UCC custom
app (GD4 simulator, Marketing OS, Intelligence Platform, or similar) is
present in this container, so no search for an existing drag-and-drop
node-canvas component could be performed.

## Which app owns the three Quality DocTypes

Unconfirmed — no bench/site access from this session.

## Existing public and internal pages

| Page or route | Purpose | Keep or replace? |
|---|---|---|
| Unconfirmed — no bench/site access from this session | | |

## Constraints

- Hosting and deployment access: Unconfirmed — no bench/site access from this session
- Permission to install custom apps: Unconfirmed — no bench/site access from this session
- Email delivery method: Unconfirmed — no bench/site access from this session
- Background worker availability: Unconfirmed — no bench/site access from this session
- Existing D3 or diagram library: Unconfirmed — no bench/site access from this session
- Existing automation through n8n: Unconfirmed — no bench/site access from this session
