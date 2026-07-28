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

# Every file a bundle entry point references must exist on disk AND be tracked
# in git, and every bundle name referenced from hooks.py / a www controller must
# exist as a real entry point.
#
# This is the check that was missing when ucc_survey_form.bundle.css did
# @import "./survey.css": Frappe's postcss step could not resolve it and exited
# non-zero, so sites/assets/assets.json was never regenerated. The JS bundles had
# already built, but assets.json still named the previous hash - so every asset
# 404'd, no UCC* global was defined, and the first symptom was a Desk page dying
# on "window.UCCVersionPicker is not a constructor", four steps from the cause.
# A broken asset reference takes the whole app down and says nothing useful.
python3 - <<'PY'
import re, subprocess, sys, pathlib

app = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes")
tracked = set(subprocess.run(["git", "ls-files"], capture_output=True, text=True,
                             check=True).stdout.split("\n"))
problems = []

entries = sorted(app.glob("public/**/*.bundle.js")) + sorted(app.glob("public/**/*.bundle.css"))
if not entries:
	problems.append("no bundle entry points found at all - did public/ move?")

def code_only(text):
	"""Comments are prose, not directives. This file's own header explains the
	@import that broke the build by quoting it - the first run of this check
	flagged that quote, which is exactly how a guard earns a reputation for
	crying wolf and gets switched off."""
	text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
	return re.sub(r"^\s*//.*$", "", text, flags=re.M)


for entry in entries:
	src = code_only(entry.read_text())
	refs = re.findall(r'(?:^|\s)import\s+["\']([^"\']+)["\']', src)
	refs += re.findall(r'@import\s+["\']([^"\']+)["\']', src)
	for ref in refs:
		if not ref.startswith("."):
			continue          # a package import, not a file in this repo
		target = (entry.parent / ref).resolve()
		rel = target.relative_to(pathlib.Path.cwd())
		if not target.exists():
			problems.append("%s references %s, which does not exist" % (entry, ref))
		elif str(rel) not in tracked:
			problems.append("%s references %s, which exists but is NOT tracked in git "
			                "(it would be missing on every other machine)" % (entry, ref))

# Bundle names referenced from Python must resolve to an entry point.
names = {e.name for e in entries}
for py in (pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes/hooks.py"),
           app / "www/survey.py"):
	for name in re.findall(r'["\']([\w.]+\.bundle\.(?:js|css))["\']', py.read_text()):
		if name not in names:
			problems.append("%s references bundle %s, which has no entry point in public/"
			                % (py, name))

if problems:
	print("Broken asset references:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	sys.exit(1)
print("All %d bundle entry points resolve, and every referenced file is tracked." % len(entries))
PY

# /survey's two branches (?token= and ?preview=) must serve the SAME assets.
# Guaranteed structurally rather than by comparing two lists: the assets are set
# once, before any branch can return. When survey_form.js failed to load on the
# preview route this was already true — both branches were equally broken, the
# preview one was just opened first — and the fix would be worthless if a later
# edit moved the assignment inside a branch.
python3 - <<'PY'
import re, sys, pathlib

src = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes"
                   "/www/survey.py").read_text()
body = src[src.index("def get_context(context):"):]
lines = body.split("\n")


def first(pattern):
	for i, line in enumerate(lines):
		if re.search(pattern, line):
			return i
	return None


assets = [first(r"context\.survey_js\s*="), first(r"context\.survey_css\s*=")]
ret = first(r"^\t(?:return|if)\b")          # the first branch or early return
problems = []
if None in assets:
	problems.append("get_context no longer sets context.survey_js / survey_css")
elif ret is not None and max(assets) > ret:
	problems.append("assets are set AFTER the first branch, so one route renders "
	                "without them - set them before any branch can return")

# Both must actually reach the template.
tpl = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes"
                   "/www/survey.html").read_text()
for var in ("survey_css", "survey_js"):
	if "{{ %s }}" % var not in tpl:
		problems.append("survey.html does not render %s" % var)

if problems:
	print("Asset wiring on /survey:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	sys.exit(1)
print("Both /survey branches serve the same assets.")
PY

# Every dotted path in hooks.py must resolve to something that exists.
#
# Generic on purpose. This is the third "a reference points at something that
# isn't there" failure in one session — a CSS @import to a missing file, a
# bundle name with no entry point, and a doc_events hook naming a function that
# had been moved. Each one only surfaced on a live bench, and each looked like a
# different bug (broken build, dead Desk page, AttributeError on save). One
# check for the whole class, rather than a patch per instance.
#
# Parsed with ast, never imported: this repo has no bench, so importing hooks.py
# or anything it names would fail on `import frappe` long before the reference
# could be checked.
python3 - <<'PY'
import ast, sys, pathlib

APP = "ucc_measurement_outcomes"
root = pathlib.Path("frappe-app") / APP / APP
tree = ast.parse((root / "hooks.py").read_text())

# Every string constant anywhere in hooks.py that names something in this app.
refs = sorted({
	n.value for n in ast.walk(tree)
	if isinstance(n, ast.Constant) and isinstance(n.value, str)
	and n.value.startswith(APP + ".") and " " not in n.value
	and not n.value.endswith((".js", ".css"))          # bundles: checked above
})


def defined_names(path):
	out = set()
	for node in ast.parse(path.read_text()).body:
		if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
			out.add(node.name)
		elif isinstance(node, ast.Assign):
			out.update(t.id for t in node.targets if isinstance(t, ast.Name))
	return out


def module_path(dotted):
	rel = pathlib.Path(*dotted.split(".")[1:])          # drop the app prefix
	for candidate in (root / rel.with_suffix(".py"), root / rel / "__init__.py"):
		if candidate.exists():
			return candidate
	return None


problems = []
for ref in refs:
	if module_path(ref):
		continue                                        # a module, not an attribute
	mod, _, attr = ref.rpartition(".")
	path = module_path(mod)
	if not path:
		problems.append("%s -> no module %s" % (ref, mod))
	elif attr not in defined_names(path):
		problems.append("%s -> %s has no %s" % (ref, path, attr))

if problems:
	print("hooks.py references something that does not exist:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	print("  (on a bench this surfaces as AttributeError on save, and survives a "
	      "restart: app hooks are cached, so it needs bench clear-cache too)", file=sys.stderr)
	sys.exit(1)
print("All %d hooks.py references resolve." % len(refs))
PY

# No code may construct an asset URL pointing at the app's public/ SOURCE.
#
# /assets/<app>/ is the app's public/ directory — raw esbuild input, `import`
# statements and all. Serving it hands the browser a module as a classic script:
# "SyntaxError: Cannot use import statement outside a module", and the survey
# page dies. Built output only ever lives at /assets/<app>/dist/…, under a
# content-hashed name that cannot be written by hand — so the only correct way
# to reference a bundle is to resolve it through assets.json, and a "fallback"
# to the plain path is not a degraded mode, it is a broken one.
python3 - <<'PY'
import re, sys, pathlib

app = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes")
# The dot must be in the character class: every real bundle is named
# <thing>.bundle.js, and a pattern of [\w/]* could not reach past the first dot -
# so the first version of this check passed cleanly while looking straight at the
# source path it exists to reject.
bad_url = re.compile(r'["\']/assets/ucc_measurement_outcomes/(?!dist/)[\w/.]*\.(?:js|css)')
problems = []
for path in list(app.rglob("*.py")) + list(app.rglob("*.html")) + list(app.rglob("*.js")):
	if "/public/" in str(path) and path.suffix == ".js":
		continue                      # bundle sources, not URL builders
	for m in bad_url.finditer(path.read_text()):
		problems.append("%s builds an asset URL from the source path: %s" % (path, m.group(0)))

# The resolver must verify what it got back, not just that a call returned.
survey_py = (app / "www/survey.py").read_text()
if "def _bundle_url" in survey_py and '"/dist/" in url' not in survey_py:
	problems.append("www/survey.py:_bundle_url no longer checks that the resolved "
	                "URL is a built (dist/) asset - bundled_asset returns its input "
	                "unchanged when handed a path, which is how raw source shipped")

if problems:
	print("Asset URLs must point at built output:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	sys.exit(1)
print("No asset URL is built from the public/ source path.")
PY
