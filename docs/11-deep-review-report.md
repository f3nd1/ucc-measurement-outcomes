# Deep Self-Review + Bug Hunt — Report

Adversarial review of everything built across the 13 checkpoints, run without a
bench: static analysis, pure-logic testing and fixture-driven verification.
Four passes: verify prior claims, fresh bug hunt, vague-spec areas, this report.

## 1. Prior sessions' claims — verified vs failed

| Claim | Verdict | Evidence |
|---|---|---|
| "Version immutability once Published" | **FAILED** — 3 holes (F1–F3) | The guard only blocked *status transitions*; `Published → Published` saves passed it. Published index **formulas were rewritable** via `save_nodes` (whose comment claimed otherwise); survey version headers/snapshots were editable; questions could be re-parented *out of* published versions. All fixed; adversarial tests committed. |
| "Guest endpoint: token / one-response / atomic" | Held, with 2 fixes | Token + atomicity confirmed by trace. One-response was a check-then-insert race (F4; campaign row now locked). Malformed payload items raised a 500 (F5; now clean validation). |
| "Integration audit: 0 field mismatches" | **Held** | Re-run fresh with stronger checks — 24 Links, 4 Table targets, `fetch_from`, full Explorer catalogue, API field refs: clean. |
| "Index Results are immutable snapshots" | Result row: yes; provenance: no | The formula behind a result was mutable (= F1). Fixed. Documented, unchanged: results are deletable, and `frappe.db.set_value` bypasses validate (framework-inherent). |
| "Explorer rejects anything off-catalogue" | Held, except filter values | List values smuggled frappe *operators* (`like`/`in`/`between`) past the equality-only contract (F6). Fixed to scalar-only. |
| "9 suites pass" | Pass — but see §4 | The versioning suite *asserted the F1 hole was fine*. Passing is not the same as testing the right thing. |

## 2. Bugs — 14 findings, 12 fixed, 2 documented

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | Published index formula silently rewritable | **High** | Fixed + bench test |
| F2 | Published survey version header/snapshots editable | High | Fixed + bench test |
| F3 | Question/section re-parentable out of a published version | High | Fixed + bench test |
| F4 | One-response check-then-insert race | Medium | Fixed (row lock; BENCH_VERIFY #47 confirms semantics) |
| F5 | Non-dict answer item → 500 | Low | Fixed + bench test |
| F6 | Filter-operator smuggling in Data Explorer | Medium | Fixed + bench test |
| F8 | "Latest" metric result was arbitrary (unordered pick) | Medium | Fixed |
| F9 | Cyclic / multi-root / dangling-parent formulas were publishable; `compute_index` silently ignores unreachable nodes (BENCH_VERIFY #22 had wrongly deferred this — it is pure logic) | Medium | Fixed + pure tests |
| F10 | Unknown normalisation rule clamped raw values into 0–100 (a Likert 4 with a lost rule became 4/100 — silent index poisoning) | **High** | Fixed + pure tests |
| F11 | Negative weights publishable (120 + −20 "= 100"; the sum-only check passed it) | Medium | Fixed + pure test |
| F12 | Sparse sequences after deletion broke every insert path (drop-at-position landed one slot late; duplicates misplaced) | Medium | Fixed at root (`_resequence`) + 3 bench tests |
| F13 | Template version numbering crashed (DuplicateEntry) after deleting an old version | Medium | Fixed + bench test |
| F14 | Filter bar filtered on a no-longer-existing option (stale tracked value) | Low-med | Fixed (inspection-verified; no JS harness exists) |
| #44 | Undo/redo desync | Medium | **Characterised, not fixed.** Boundary: any name-embedding history action (reorder list, bulk-delete list) replayed after a delete+undo pair recreated one of its names under a new id. The server rejects the dead name and the failed action is silently lost from both stacks (the `_call` wrapper only resolves on success). Fix = id-remapping table in all six action constructors — not surgical. Linear undo/redo without interleaved deletes is correct. |

Reported, deliberately untouched (working or latent-only): mixed-type sort
TypeError in `explorer_agg` (unreachable with today's all-string dimensions),
`bulk_parse` truncation after a third `|`, the quote-fragile `option:contains`
disable in the Explorer UI (server independently rejects), the builder's
one-modal-per-session. Removed: tracked `.DS_Store`. Unused-import sweep: clean.

## 3. Vague-spec interpretations needing decisions (V1–V7)

Full table in `frappe-app/BENCH_VERIFY.md` (Pass 3 section). Sharpest three:

- **V1 Display logic is inert** — stored and rendered in the inspector, consumed
  by nothing. Landmine: if a logic engine ever ships client-side only, a hidden
  *required* question makes submission impossible; the server's required check
  must become logic-aware in the same change.
- **V2 Archiving does not stop collection** — campaign status + dates are the
  only submission gate; Archived surveys and Closed versions still collect.
- **V7 Multi-select answers are comma-joined** — irrecoverable if a choice label
  contains a comma. Settle (with V6's hard 1:1 objective mapping) **before
  importing real UCC data**.

Others: V3 response rate never computed (no invited count exists), V4 no
scheduler events (calculation is on-demand only), V5 two rival sectioning
mechanisms (Section records unreachable from the UI), V6 objective mapping
hard-enforced 1:1.

## 4. Test coverage — honest assessment

- **37 test functions**: 25 pure (run in-session, all green) + 12 bench-run
  (compile-checked only — **they have never executed**; the first bench session
  must run `bench --site <site> run-tests --module
  ucc_measurement_outcomes.test_integration_chain` before trusting them).
- Pure suites genuinely cover: engine arithmetic, normalisation rules,
  structural formula validation, coverage/gap logic, parsers, version *rules*.
  They cannot cover: permissions, transactions, race behaviour, anything
  Frappe-runtime.
- **Zero JS coverage** — no harness exists for ~1,900 lines of
  builder/canvas/dashboard/explorer UI; F14's fix is inspection-verified only.
  Worth one decision: adopt a minimal harness on the bench (QUnit ships with
  Frappe).
- Recurring pattern behind the failed claims: the gap between a suite's *name*
  and its *assertions* — "versioning logic: all checks passed" while asserting
  the very hole F1 walked through.

## 5. BENCH_VERIFY state after this review

- Greppable `TODO: bench-verify` tokens: **27 across 20 files** (down from 46 at
  session start — several were resolved by fixing their code; #47/#48 added).
- New sections: Pass 1 claim-verification record, Pass 2 findings + the precise
  #44 characterisation, Pass 3 decision table (V1–V7).
- Still genuinely bench-blocked: Phase 0 discovery, Quality Action/Meeting
  integration, `for_update` locking semantics (#47), the rate-limit signature,
  and executing the 12 integration tests.

## Bottom line

The adversarial premise was justified: the headline architectural claim —
immutable published versions — did not survive contact with its own test
suite's blind spot, and the calculation chain had two silent-corruption paths
(F10, F8). All fixed with reproductions committed. Everything still open is
either bench-blocked or a genuine product decision (V1–V7).
