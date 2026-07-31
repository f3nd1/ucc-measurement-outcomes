app_name = "ucc_measurement_outcomes"
app_title = "UCC Measurement Outcomes"
app_publisher = "United Ceres College"
app_description = (
	"Survey design, mapping, index calculation and Criterion 7.1.1 outcomes "
	"for United Ceres College."
)
app_email = "felix@unitedceres.edu.sg"
app_license = "mit"

# TODO: bench-verify - confirm the target Frappe version (assumed v15). DocType JSON
# keys and controller hooks below follow v15 conventions.

# Shared front-end components reused across Studio pages.
# Shared front-end components, loaded as ONE esbuild bundle so the filename
# carries a content hash (…bundle.<hash>.js) and the one-year asset cache can
# never serve a stale copy. Listing the raw files here instead pinned them at
# fixed urls for a year — see public/js/ucc_measurement_outcomes.bundle.js.
app_include_js = ["ucc_measurement_outcomes.bundle.js"]
# The respondent form's stylesheet, so Preview in the Survey Builder is styled
# by the SAME sheet the respondent gets rather than a .ucc-sb-* lookalike.
app_include_css = ["ucc_survey_form.bundle.css", "ucc_mo.bundle.css"]

# D2: Survey Tracking (educ_sg) becomes the campaign. The fields it lacks are
# added as Custom Fields owned by THIS app and shipped as fixtures, so educ_sg's
# own DocType JSON is never edited and stays upgradeable. Every field is
# `ucc_`-prefixed, which is also what this filter exports - a plain
# {"dt": "Custom Field"} would drag every unrelated customisation on the site
# into our fixtures.
fixtures = [
	{"dt": "Custom Field", "filters": [["name", "like", "Survey Tracking-ucc_%"]]},
]

# A Custom Field cannot generate a token or validate across fields, so the two
# fields that need behaviour get it here rather than in educ_sg.
doc_events = {
	"Survey Tracking": {
		"validate": "ucc_measurement_outcomes.survey_tracking_hooks.validate",
	},
}

# Later phases register: fixtures (roles/workspaces), scheduler events for index
# calculation jobs, and website routes for the public survey endpoint.
