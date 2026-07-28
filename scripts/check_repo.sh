#!/usr/bin/env bash
set -euo pipefail

required=(
  "README.md"
  "CLAUDE.md"
  "prototype/ucc_measurement_outcomes_studio.html"
  "docs/01-product-scope.md"
  "docs/03-data-model.md"
  "docs/05-implementation-plan.md"
  "reference-documents/01-criterion-7-1-1-measurement-outcomes-workflow.pdf"
  "reference-documents/02-survey-objective-question-mapping-v02.pdf"
)

for file in "${required[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

echo "Repository starter files are present."

# Regression guard for the index-studio TypeError: Validate and Publish were
# live before any version had loaded, so frappe.call sent {} (it drops undefined
# args) and validate_index/publish_version raised a missing-argument TypeError.
# There is no JS test harness in this repo, so this asserts the guard is still
# in the source. It fails the moment someone removes it.
# python3, not grep: grep -F treats a newline in the pattern as a SECOND pattern
# (an OR), so a two-line "method + its guard" assertion silently passes on the
# method line alone. Found by deleting the guard and watching the check stay
# green - a check that cannot fail is worse than no check.
python3 - <<'PY'
import sys, pathlib

path = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes"
                    "/index_studio/page/index_studio/index_studio.js")
src = path.read_text()
# Regression guard for the index-studio TypeError: Validate and Publish were
# live before any version had loaded, so frappe.call sent {} (it drops undefined
# args) and validate_index/publish_version raised a missing-argument TypeError.
# No JS test harness exists in this repo, so this asserts the guard is still in
# the source; it fails the moment someone removes it.
required = {
	"Validate button must be born disabled":
		'<button class="btn btn-default btn-sm" disabled>${__("Validate")}',
	"Publish button must be born disabled":
		'<button class="btn btn-primary btn-sm" disabled>${__("Publish Version")}',
	"_validate() must check for a loaded version":
		"\t_validate() {\n\t\tif (!this._needVersion()) return;",
	"_publish() must check for a loaded version":
		"\t_publish() {\n\t\tif (!this._needVersion()) return;",
	"load() must re-enable Validate":
		"this.$validate.prop(\"disabled\", false);",
}
missing = [why for why, snippet in required.items() if snippet not in src]
if missing:
	print("Guard missing in %s:" % path, file=sys.stderr)
	for why in missing:
		print("  - " + why, file=sys.stderr)
	sys.exit(1)
print("Version-scoped action guards are in place.")
PY

# Every question type must have a palette icon. Adding a type and forgetting its
# icon is the exact regression this catches, and the map is plain-enough JS to
# read without a JS engine.
python3 - <<'PY'
import ast, re, sys, pathlib

src = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes"
                   "/survey_studio/page/ucc_survey_builder/ucc_survey_builder.js").read_text()


def block(start):
	i = src.index(start)
	return src[i + len(start): src.index("\n};" if start.endswith("{") else "\n];", i)]


types = re.findall(r'"([^"]+)"', block("const QUESTION_TYPES = ["))
icons = re.findall(r'\n\t"([^"]+)":', block("const TYPE_ICON = {"))
missing = [t for t in types if t not in icons]
extra = [i for i in icons if i not in types]
if missing or extra:
	if missing:
		print("Question types with no palette icon: %s" % ", ".join(missing), file=sys.stderr)
	if extra:
		print("Palette icons for types that no longer exist: %s" % ", ".join(extra), file=sys.stderr)
	sys.exit(1)
print("Palette icons cover all %d question types." % len(types))
PY

# submit_survey must never learn about preview. The preview route deliberately
# renders with an empty token so a previewed form has nothing to submit with;
# that guarantee evaporates the moment the endpoint grows a preview branch.
python3 - <<'PY'
import sys, pathlib

src = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes"
                   "/api/public.py").read_text()
submit = src[src.index("def submit_survey("):]
bad = [w for w in ("preview", "is_preview", "dry_run") if w in submit]
if bad:
	print("submit_survey mentions %s - the write path must know nothing about "
		  "preview (see www/survey.py's module docstring)." % ", ".join(bad), file=sys.stderr)
	sys.exit(1)
# The two payload gates must stay two FUNCTIONS, not one with a flag.
for fn in ("def public_survey_payload(token):", "def preview_payload(survey_version):"):
	if fn not in src:
		print("Missing payload gate: %s" % fn, file=sys.stderr)
		sys.exit(1)
print("submit_survey has no preview branch; both payload gates are separate.")
PY

# UCCEmptyState must never put .ucc-empty on the element it was handed.
# That class carries display:flex, and callers clear with .empty() — which
# removes children but not classes — so a container that once showed an empty
# state kept flex forever and silently beat its own layout. It cost the Survey
# Builder its 12-column Questions grid: every card stacked full width while the
# width classes were perfectly correct.
python3 - <<'PY'
import re, sys, pathlib

src = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes"
                   "/public/js/empty_state.js").read_text()
if re.search(r'addClass\(\s*["\']ucc-empty', src):
	print("empty_state.js puts .ucc-empty on the caller's element again - render it "
		  "as a CHILD so .empty() removes it with the content.", file=sys.stderr)
	sys.exit(1)
if '$(\'<div class="ucc-empty"></div>\')' not in src:
	print("empty_state.js no longer creates its own .ucc-empty child.", file=sys.stderr)
	sys.exit(1)

# And the layout that bug broke must still be declared.
builder = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes"
                       "/survey_studio/page/ucc_survey_builder/ucc_survey_builder.js").read_text()
if "grid-template-columns:repeat(12,1fr)" not in builder.split(".ucc-sb-list{")[1][:200]:
	print("The Questions panel is no longer a 12-column grid.", file=sys.stderr)
	sys.exit(1)
print("Empty state cannot override a container's layout.")
PY
