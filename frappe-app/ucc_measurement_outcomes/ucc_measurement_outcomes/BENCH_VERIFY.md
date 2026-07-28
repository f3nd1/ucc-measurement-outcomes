
## Workspace (`survey_studio/workspace/measurement_outcomes/`)

Written without a bench, so its shape is unverified. `Workspace` is a real
DocType and its JSON is imported by `bench migrate`; the fragile parts are
`content` (a JSON *string* of editor.js blocks) and the requirement that each
block's `card_name` exactly matches a `Card Break` label in `links`.

**Verify:** run `bench migrate`, open `/app/measurement-outcomes`, and confirm
both cards render with their links. If the page is blank, the usual cause is a
`content`/`card_name` mismatch — fix it in the UI (Edit Workspace) and re-export
with `bench export-fixtures` or by copying the record's JSON back into this file.

Until then, the fallback navigation is unchanged and already works: Frappe's
awesomebar indexes Page records, so typing "UCC Survey Builder" reaches it.
