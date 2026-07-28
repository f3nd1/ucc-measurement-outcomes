// Website-side bundle for the respondent survey form.
//
// Separate from ucc_measurement_outcomes.bundle.js on purpose: that one is
// app_include_js and loads on every Desk page, while this loads only on
// /survey. Both exist for the same reason - esbuild only hashes *.bundle.js,
// and a raw /assets/… path is served with a ONE YEAR cache, which already
// caused a real bug here (a stale node_canvas.js without setEmpty()). A stale
// copy of this file would break the page that collects real responses.
import "./survey_form.js";
