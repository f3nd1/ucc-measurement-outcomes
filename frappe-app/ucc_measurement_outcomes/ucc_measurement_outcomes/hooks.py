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
app_include_js = [
	"/assets/ucc_measurement_outcomes/js/node_canvas.js",
	"/assets/ucc_measurement_outcomes/js/filter_bar.js",
	"/assets/ucc_measurement_outcomes/js/empty_state.js",
	"/assets/ucc_measurement_outcomes/js/trail.js",
]

# Later phases register: fixtures (roles/workspaces), scheduler events for index
# calculation jobs, and website routes for the public survey endpoint.
