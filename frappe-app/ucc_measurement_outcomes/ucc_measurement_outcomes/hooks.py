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

# Later phases register: fixtures (roles/workspaces), scheduler events for index
# calculation jobs, and website routes for the public survey endpoint.
