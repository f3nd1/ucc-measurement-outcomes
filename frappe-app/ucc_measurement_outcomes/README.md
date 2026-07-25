# UCC Measurement Outcomes (Frappe app)

Frappe/ERPNext app for United Ceres College: survey design, question→objective/clause
mapping, reusable metrics, index calculation (SEQI, SAPI) and Criterion 7.1.1 evidence.

## Status

**Phase 1 — code authored without a bench.** DocType JSON and controllers were
written in a sandbox with no live Frappe site. Every assumption that depends on the
real UCC system is marked with the greppable token `TODO: bench-verify`. Before
installing, run:

```bash
grep -rn "TODO: bench-verify" frappe-app/
```

and resolve each against the live bench. See `../BENCH_VERIFY.md` for the full registry.

## Install (bench-connected session only)

```bash
# from the frappe-bench directory
bench get-app /path/to/ucc-measurement-outcomes/frappe-app/ucc_measurement_outcomes
bench --site <dev-site> install-app ucc_measurement_outcomes
bench --site <dev-site> migrate
```

## Modules

- **Survey Studio** — surveys, versions, sections, questions, choices (Phase 1)
- Mapping Studio, Index Studio, UCC Dashboard Studio, Data Explorer — later phases
