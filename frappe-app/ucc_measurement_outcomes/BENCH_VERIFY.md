
## Per-page assets on /survey (`www/survey.py`)

The respondent form's JS/CSS moved out of the template into
`public/js/survey_form.js` + `public/css/survey.css`, loaded through
`context.include_js` / `context.include_css` with **bundle** names
(`ucc_survey_form.bundle.js` / `.css`) rather than raw `/assets/…` paths —
raw paths are served with a one-year cache, which already caused a real
stale-asset bug in this app (see the comment in
`public/js/ucc_measurement_outcomes.bundle.js`).

**Verify:** `bench build --app ucc_measurement_outcomes && bench restart`, then
open `/survey?token=…` and confirm the form renders styled. The page fails
loudly rather than silently if the JS did not load — it replaces itself with
"This survey could not be loaded" and logs the build command to the console.

If `templates/web.html` on this Frappe version does not render
`context.include_js`/`include_css` for a **www** page (it does for Web Page),
the fallback is explicit `<script>`/`<link>` tags in `survey.html` pointing at
the same bundles. Load order is safe either way: the page bootstraps on
`DOMContentLoaded`, which fires after every non-deferred script has run.

Also unverified without a bench: `frappe.utils.quoted` (used by
`api.builder.preview_link`) and `frappe.utils.copy_to_clipboard` (used by both
link controls).
