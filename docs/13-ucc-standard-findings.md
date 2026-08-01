# UCC Standard — findings only, no action taken

Asked: is `UCC Standard` an invented local copy of a register the institution
already maintains, the same way `UCC Objective` was?

**Short answer: yes, and this app's own code already names the real register.**
Nothing here has been migrated, removed or modified. Two counts still need a
bench; `scripts/probe_standards_register.py` fetches them read-only.

---

## 1. It is invented, with no provenance

`mapping_studio/doctype/ucc_standard/ucc_standard.json` holds three fields —
`standard_code`, `standard_name`, `description` — autonamed on `standard_code`.
There is no import path, no sync, no extraction rule and no source document
reference anywhere in the app. The only writer in the entire repository is
`demo_data._demo_standard()`, which creates one row, `DEMO-STD-C7`.

## 2. The real register is already named in this app's source

`api/mapping.py:20-22`:

> educ_sg's objective register — 97 real records, each already linked to
> **Policies And Standards Management**. This app reads it and never writes to it.

So the institution maintains a standards register, and every `Survey Objective`
already points into it. `UCC Standard` is a second, unlinked list of the same
thing.

## 3. This was predicted and left open on purpose

`docs/09-decision-log.md`, 2026-07-29, the entry that deleted `UCC Objective`,
ends with:

> `UCC Standard` is untouched and still invented — a smaller version of the same
> question, left open deliberately.

That prediction now has the evidence behind it. Note what the same entry says
about how `UCC Objective` went wrong: this app "had built a weaker parallel model
of a relationship the institution already maintains properly, and attached it to
the wrong entity." That sentence describes `UCC Standard` without modification.

## 4. It is not just duplicated — it is redundant, and it can disagree

A `UCC Question Mapping` row carries **both**:

- `objective` → `Survey Objective` → (already linked to) Policies And Standards Management
- `standard` → `UCC Standard`, set by hand through `upsert_question_mapping`

The second is derivable from the first. Nothing validates that they agree, so a
mapping can claim a standard its own objective contradicts, and no check anywhere
would notice. That is strictly worse than the duplication itself: a duplicate is
stale, a contradiction is wrong.

`primary_clause` sits beside it as **free text**, and it — not `standard` — is
what actually reaches the evidence: `index_calc._lineage_snapshot` reads
`objective` and `primary_clause`, writes them into `UCC Score Breakdown`. The
2026-07-29 decision called this weaker parallel model out by name; only the
`objective` half was fixed.

## 5. The blast radius is small, and no score would move

`UCC Standard` is read in exactly three places:

| where | what it does |
|---|---|
| `api/mapping.py:287` | supplies the picker list in `mapping_overview` |
| `mapping_studio.js:778, 825` | renders and submits the field |
| `api/explorer.py:58-60` | one dimension + one filter in the mappings dataset |

**The calculation chain never touches it.** `metric_engine`, `index_engine` and
`index_calc` contain no reference to `standard` or to `UCC Standard`. So whatever
is decided, no published score changes — the same "timing makes it cheap"
argument that made the Objective migration near-free, and it will not get cheaper
than it is now.

## 6. What a bench still has to answer

`scripts/probe_standards_register.py` (read-only) returns:

1. How many `UCC Standard` rows exist, and how many are `DEMO-`.
2. Whether `Policies And Standards Management` exists on this site and how many
   records it holds — the number that settled the Objective question.
3. Which `Survey Objective` Link field points at it, and how many objectives have
   it populated. **If that is sparse, the derivation in §4 does not hold and
   `standard` is carrying information the register does not**, which would change
   the conclusion.
4. How many `UCC Question Mapping` rows actually set `standard` versus
   `primary_clause`.

## 7. Options, unranked — none of these is being taken

- **Repoint** `UCC Question Mapping.standard` at `Policies And Standards
  Management`, mirroring the Objective fix. Cheapest if the register is populated.
- **Derive and drop** the field, reading the standard through the objective. Only
  safe if §6.3 comes back dense.
- **Keep it**, if the register turns out to be sparse or scoped differently — in
  which case that fact belongs in the decision log so the question stops
  reopening.

Recommendation withheld until the counts exist. Guessing here is precisely what
produced the `UCC Objective` slug bug.
