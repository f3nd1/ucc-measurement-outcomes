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

# A grid needs BOTH halves seeded, or dragging it from the palette produces the
# fallback textarea both renderers use when rows or columns are missing - which
# is what "Multiple Choice Grid renders as a big empty box" actually was.
import ast

builder = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes"
                       "/api/builder.py").read_text()
tables = {
	n.targets[0].id: ast.literal_eval(n.value)
	for n in ast.parse(builder).body
	if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
	and n.targets[0].id in ("CHOICE_DEFAULTS", "MATRIX_ROW_DEFAULTS")
}
# MATRIX_TYPES is a one-liner, so block() - which looks for a closing "\n];" -
# cannot read it. Matched directly instead.
grids = re.findall(r'"([^"]+)"',
                   re.search(r'const MATRIX_TYPES = new Set\(\[(.*?)\]\)', src).group(1))
short = [g for g in grids
         if not tables.get("CHOICE_DEFAULTS", {}).get(g)
         or not tables.get("MATRIX_ROW_DEFAULTS", {}).get(g)]
if short:
	print("Grid types seeded with only half a grid (need columns AND rows): %s"
	      % ", ".join(short), file=sys.stderr)
	sys.exit(1)
print("All %d grid types are seeded with both rows and columns." % len(grids))
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

# The theme must reach the guest page only through theme.build_theme_css.
#
# www/survey.html is the one guest-reachable page in this app. The standing
# decision is that no staff-editable free text may be rendered into it: theme.py
# emits `--<known-name>:#rrggbb;` and font stacks from a hard-coded table, and
# nothing else. That guarantee is worth exactly as much as the rule that no
# other value may be interpolated into a <style> block.
python3 - <<'PY'
import json, re, sys, pathlib

app = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes")
problems = []

py = (app / "www/survey.py").read_text()
if "build_theme_css" in py:
	for m in re.finditer(r"context\.theme_css\s*=\s*(.+)", py):
		if "build_theme_css" not in m.group(1) and m.group(1).strip() not in ('""', "''"):
			problems.append("www/survey.py sets theme_css from %s - it must come from "
			                "theme.build_theme_css or be empty" % m.group(1).strip())

html = (app / "www/survey.html").read_text()
for m in re.finditer(r"<style>(.*?)</style>", html, re.S):
	inner = m.group(1).strip()
	if inner and inner != "{{ theme_css }}":
		problems.append("survey.html renders something other than theme_css inside "
		                "<style>: %r" % inner[:60])

# The validator itself must stay strict: anchored, lowercase, exactly six digits.
theme = (app / "theme.py").read_text()
if 'HEX = re.compile(r"^#[0-9a-f]{6}$")' not in theme:
	problems.append("theme.py's colour pattern changed - it must stay anchored and "
	                "exactly ^#[0-9a-f]{6}$")
if "FONT_STACKS" not in theme or "settings.get(\"ucc_font\")" not in theme:
	problems.append("theme.py no longer maps the stored font through a fixed table")

# build_theme_css emits :root variables plus exactly ONE fixed rule (the page
# background, which cannot live in the static stylesheet without changing the
# default for every site). That is the whole widening; a second appended rule
# means the output is drifting towards free-form CSS one literal at a time.
if theme.count("css +=") > 1:
	problems.append("theme.py appends more than one rule to build_theme_css's output - "
	                "the :root block plus PAGE_BG_RULE is the entire contract")
import re as _re
m = _re.search(r'PAGE_BG_RULE = "([^"]*)"', theme)
if not m:
	problems.append("theme.py no longer defines PAGE_BG_RULE as a fixed literal")
elif "#" in m.group(1) or "{{" in m.group(1) or "%" in m.group(1):
	problems.append("PAGE_BG_RULE is no longer a fixed literal - it must reference the "
	                "already-validated variable, never carry a stored value: %r" % m.group(1))

# Every Select-backed theme field must offer EXACTLY the keys of its lookup
# table. An option with no table entry silently does nothing when picked; a
# table entry with no option is unreachable. Both are invisible until someone
# tries the one setting that turns out to be dead.
#
# theme.py is imported for this rather than pattern-matched: it is deliberately
# Frappe-free, so it imports here with no bench, and reading the real dicts
# beats guessing at their source.
sys.path.insert(0, str(app))
try:
	import theme as _theme
	doctype = json.loads((app / "survey_studio/doctype/ucc_survey_theme"
						  "/ucc_survey_theme.json").read_text())
	offered = {f["fieldname"]: f["options"].split("\n")
			   for f in doctype["fields"] if f["fieldtype"] == "Select"}
	for field, expected in _theme.SELECT_CHOICES.items():
		if offered.get(field) != expected:
			problems.append("UCC Survey Theme.%s offers %s but theme.py's table has %s"
							% (field, offered.get(field), expected))
	for field in offered:
		if field not in _theme.SELECT_CHOICES:
			problems.append("UCC Survey Theme.%s is a Select with no lookup table in "
							"theme.py - its value would reach the page unvalidated" % field)
except Exception as e:
	problems.append("could not compare theme Selects against theme.py: %s: %s"
					% (type(e).__name__, e))

if problems:
	print("Theme rendering boundary:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	sys.exit(1)
print("Theme reaches the guest page only through validated variables.")
PY

# No app controller may wipe the whole site's cache.
#
# frappe.clear_cache() with NO arguments deletes every cache key for the site
# (verified in v15.83.0: "Delete ALL keys associated with this site"). An app
# saving one settings record has no business doing that. The scoped calls are
# frappe.clear_cache(doctype=…) / (user=…) and
# frappe.website.utils.clear_website_cache(path).
#
# Also catches frappe.clear_website_cache, which simply does not exist - it was
# assumed, and every save of UCC Survey Theme died on the AttributeError.
python3 - <<'PY'
import io, re, sys, tokenize, pathlib

app = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes")
problems = []


def code_only(src):
	"""Comments and docstrings are prose. The controller that carries this rule
	explains it by NAMING both calls, and the first run of this check flagged
	that explanation - the same way the bundle check flagged its own header.
	A guard that cries wolf gets switched off, so strip them properly: tokenize
	rather than a regex, because a # inside a string is not a comment."""
	out = []
	try:
		for tok in tokenize.generate_tokens(io.StringIO(src).readline):
			if tok.type in (tokenize.COMMENT, tokenize.STRING):
				continue
			out.append(tok.string)
	except tokenize.TokenError:
		return src            # unparseable: scan it raw rather than skip it
	return " ".join(out)


for path in app.rglob("*.py"):
	src = code_only(path.read_text())
	if re.search(r"frappe\s*\.\s*clear_cache\s*\(\s*\)", src):
		problems.append("%s calls frappe.clear_cache() with no arguments - that wipes "
		                "the entire site's cache" % path)
	if re.search(r"frappe\s*\.\s*clear_website_cache", src):
		problems.append("%s calls frappe.clear_website_cache - no such attribute on "
		                "frappe; it lives in frappe.website.utils" % path)

if problems:
	print("Cache clearing:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	sys.exit(1)
print("No site-wide cache wipes in app code.")
PY

# Chrome suppression must stay scoped to the survey page.
#
# /survey overrides base.html's navbar and footer blocks so the site's bars are
# never rendered there. That is safe precisely because it lives in ONE template;
# the same override in a shared template, or a matching display:none in the
# stylesheet the Desk also loads, would strip the navbar off the whole site.
python3 - <<'PY'
import re, sys, pathlib

app = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes")
problems = []

survey = (app / "www/survey.html").read_text()
# Built by concatenation, not %-formatting: the pattern is full of literal % and
# { characters, and the first version of this check died on "unsupported format
# character" rather than checking anything.
for blk in ("navbar", "footer"):
	pattern = r"\{%-?\s*block\s+" + blk + r"\s*-?%\}\s*\{%-?\s*endblock"
	if not re.search(pattern, survey):
		problems.append("www/survey.html no longer overrides the " + blk + " block")

# Nowhere else may do it, and no stylesheet may hide the bars - a rule in
# ucc_survey_form.bundle.css would also load into the Desk via app_include_css.
for path in list(app.rglob("*.html")) + list(app.rglob("*.css")):
	if path.name == "survey.html":
		continue
	text = path.read_text()
	if re.search(r"\{%-?\s*block\s+(?:navbar|footer)\s*-?%\}", text):
		problems.append("%s overrides the navbar/footer block - suppression must stay "
		                "on the survey page alone" % path)
	if re.search(r"\.(?:navbar|web-footer)[^{]*{[^}]*display\s*:\s*none", text):
		problems.append("%s hides the site navbar/footer in CSS - that stylesheet is "
		                "loaded into the Desk too" % path)

if problems:
	print("Site chrome suppression:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	sys.exit(1)
print("Navbar/footer suppression is scoped to the survey page.")
PY

# No developer scaffolding in text a user reads.
#
# A DocType field's `description` is rendered under the input on the real form.
# Seven of them shipped carrying "TODO: bench-verify - …" notes, including one on
# the New Survey form that a first-time user hit immediately. Bench-dependent
# uncertainty belongs in frappe-app/BENCH_VERIFY.md; the form says what the field
# is for.
python3 - <<'PY'
import json, sys, pathlib

app = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes")
LEAKS = ("TODO", "bench-verify", "FIXME", "XXX", "HACK")
problems = []
for path in app.rglob("*/doctype/*/*.json"):
	if path.stem != path.parent.name:
		continue
	doc = json.loads(path.read_text())
	texts = [("description", f.get("description"), f.get("fieldname"))
	         for f in doc.get("fields", [])]
	texts += [("label", f.get("label"), f.get("fieldname")) for f in doc.get("fields", [])]
	texts += [("options (HTML)", f.get("options") if f.get("fieldtype") == "HTML" else None,
	           f.get("fieldname")) for f in doc.get("fields", [])]
	for kind, text, fieldname in texts:
		if not text:
			continue
		hit = [w for w in LEAKS if w in text]
		if hit:
			problems.append("%s.%s %s contains %s" % (doc["name"], fieldname, kind, "/".join(hit)))

if problems:
	print("Developer notes visible in the UI:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	print("  Put bench-dependent uncertainty in BENCH_VERIFY.md; the form text is "
	      "for the person filling it in.", file=sys.stderr)
	sys.exit(1)
print("No developer scaffolding in user-visible DocType text.")
PY

# Every server method a Desk page calls must exist AND be @frappe.whitelist()'d.
#
# "UIs call only whitelisted api/* methods, never raw DocType REST" is a stated
# trust boundary, and a typo'd or renamed method breaks it in the least useful
# way: the call 404s at runtime, on a click nobody may make for weeks. Same
# class as the hooks.py guard above — a reference pointing at something that
# isn't there — so it is checked the same way, with ast, never by importing.
#
# Covers the two shapes this app actually uses: `PREFIX + "method"` (and its
# template-literal twin), and `this._call("method")` in the one page that wraps
# frappe.call — the wrapper's own prefix is read out of its body rather than
# assumed, so moving it to a different constant does not silently disable this.
python3 - <<'PY'
import ast, re, sys, pathlib

APP = "ucc_measurement_outcomes"
root = pathlib.Path("frappe-app") / APP / APP

PREFIX = re.compile(r'const\s+(\w+)\s*=\s*"(' + APP + r'\.[\w.]+\.)"')
WRAPPER = re.compile(r'_call\(method,\s*\w+\)\s*\{[^}]*?(\w+)\s*\+\s*method')


def whitelisted(path):
	"""Top-level function names carrying @frappe.whitelist() — not every def."""
	out = set()
	for node in ast.parse(path.read_text()).body:
		if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
			continue
		for d in node.decorator_list:
			f = d.func if isinstance(d, ast.Call) else d
			if isinstance(f, ast.Attribute) and f.attr == "whitelist":
				out.add(node.name)
	return out


problems = []
checked = 0
for js in sorted(root.rglob("*.js")):
	src = js.read_text()
	prefixes = dict(PREFIX.findall(src))
	if not prefixes:
		continue
	refs = set()
	for const, dotted in prefixes.items():
		for m in re.finditer(r'\b%s\s*\+\s*"(\w+)"' % const, src):
			refs.add((dotted, m.group(1)))
		for m in re.finditer(r'\$\{%s\}(\w+)' % const, src):
			refs.add((dotted, m.group(1)))
	w = WRAPPER.search(src)
	if w and w.group(1) in prefixes:
		for m in re.finditer(r'_call\(\s*"(\w+)"', src):
			refs.add((prefixes[w.group(1)], m.group(1)))
	for dotted, method in sorted(refs):
		checked += 1
		mod = root.joinpath(*dotted.strip(".").split(".")[1:]).with_suffix(".py")
		if not mod.exists():
			problems.append("%s: %s%s -> no module %s" % (js.name, dotted, method, mod))
		elif method not in whitelisted(mod):
			problems.append("%s: %s%s -> not a @frappe.whitelist() method in %s"
							% (js.name, dotted, method, mod.name))

if not checked:
	# The regexes found nothing at all, which means they stopped matching this
	# codebase rather than that the codebase became clean.
	print("No server calls found in any Desk page - this check has gone blind.", file=sys.stderr)
	sys.exit(1)
if problems:
	print("A Desk page calls a server method that is not there:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	print("  (UIs call only whitelisted api/* methods - see the trust boundary in "
	      "CLAUDE.md; on a bench this is a 404 on click, not a startup error)", file=sys.stderr)
	sys.exit(1)
print("All %d Desk-page server calls resolve to whitelisted methods." % checked)
PY

# Every patch named in patches.txt must exist and define execute().
#
# Same class as the hooks.py guard, with the widest blast radius in the app: a
# patch reference that does not resolve does not break a page, it breaks
# `bench migrate` for the whole SITE, including every other app on it.
python3 - <<'PY'
import ast, pathlib, sys

APP = "ucc_measurement_outcomes"
root = pathlib.Path("frappe-app") / APP / APP

refs = [
	line.strip() for line in (root / "patches.txt").read_text().splitlines()
	if line.strip() and not line.strip().startswith(("#", "["))
]

problems = []
for ref in refs:
	path = root.joinpath(*ref.split(".")[1:]).with_suffix(".py")
	if not path.exists():
		problems.append("%s -> no module at %s" % (ref, path))
		continue
	names = {n.name for n in ast.parse(path.read_text()).body
			 if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
	if "execute" not in names:
		problems.append("%s -> %s defines no execute()" % (ref, path.name))
	pkg = path.parent / "__init__.py"
	if not pkg.exists():
		problems.append("%s -> %s is not a package (no __init__.py)" % (ref, path.parent))

if problems:
	print("patches.txt references something that does not exist:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	print("  (this breaks bench migrate for the whole site, not just this app)", file=sys.stderr)
	sys.exit(1)
print("All %d patches.txt references resolve." % len(refs))
PY

# UCC Objective is gone. Nothing may link to it or query it again.
#
# It was a parallel copy of educ_sg's Survey Objective register, keyed on a slug
# of the real docname, so the 97 institutional objectives could never be joined
# to this app's 7. Removing the DocType folder does not stop code referring to
# it - a Link whose options name a missing DocType fails only when someone opens
# the field. Fail here instead.
python3 - <<'PY'
import pathlib, sys

app = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes")
DEAD = '"UCC Objective"'
# The migration and its test necessarily name the thing they are removing, and
# prose explaining the change is not a reference.
ALLOW = {"objective_migration.py", "test_objective_migration.py",
         "link_objectives_to_register.py"}

problems = []
for path in sorted(list(app.rglob("*.py")) + list(app.rglob("*.js")) + list(app.rglob("*.json"))):
	if path.name in ALLOW or "__pycache__" in path.parts:
		continue
	for n, line in enumerate(path.read_text().splitlines(), 1):
		stripped = line.strip()
		if stripped.startswith(("#", "//", "*")):
			continue                       # prose about the removal
		if DEAD in line or "'UCC Objective'" in line:
			problems.append("%s:%d  %s" % (path.relative_to(app), n, stripped[:90]))

if problems:
	print("Code still references the removed UCC Objective DocType:", file=sys.stderr)
	for p in problems:
		print("  - " + p, file=sys.stderr)
	print("  (mappings link to Survey Objective now - see docs/09-decision-log.md)",
	      file=sys.stderr)
	sys.exit(1)
if (app / "mapping_studio" / "doctype" / "ucc_objective").exists():
	print("mapping_studio/doctype/ucc_objective still exists on disk.", file=sys.stderr)
	sys.exit(1)
print("No live references to the removed UCC Objective DocType.")
PY

# The two post-publish exemptions must stay disjoint, and small.
#
# PRESENTATION_FIELDS is silent; CORRECTABLE_FIELDS demands a reason and shows a
# marker where the evidence is read. A field in both would take whichever branch
# ran first in assert_doc_version_editable, so one of its two rules would
# silently stop applying - and the one that stops applying is the audited one.
python3 - <<'PY'
import ast, pathlib, sys

src = pathlib.Path("frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes/versioning.py")
tree = ast.parse(src.read_text())
sets = {}
for node in tree.body:
	if not isinstance(node, ast.Assign):
		continue
	name = node.targets[0].id if isinstance(node.targets[0], ast.Name) else None
	if name in ("PRESENTATION_FIELDS", "CORRECTABLE_FIELDS"):
		# frozenset({...}) - read the literal without importing anything.
		sets[name] = {e.value for e in node.value.args[0].elts}

missing = {"PRESENTATION_FIELDS", "CORRECTABLE_FIELDS"} - set(sets)
if missing:
	print("versioning.py no longer defines %s as a frozenset literal."
	      % ", ".join(sorted(missing)), file=sys.stderr)
	sys.exit(1)

overlap = sets["PRESENTATION_FIELDS"] & sets["CORRECTABLE_FIELDS"]
if overlap:
	print("A field is in BOTH post-publish exemptions: %s" % ", ".join(sorted(overlap)),
	      file=sys.stderr)
	print("  (one of its two rules would silently stop applying)", file=sys.stderr)
	sys.exit(1)

# Anything that can change what counts as a valid answer must never appear.
FORBIDDEN = {"question_type", "choices", "is_required", "matrix_rows",
             "display_logic", "display_logic_config", "survey_version", "sequence"}
leaked = FORBIDDEN & (sets["PRESENTATION_FIELDS"] | sets["CORRECTABLE_FIELDS"])
if leaked:
	print("Answer-determining field(s) exempted from the freeze: %s"
	      % ", ".join(sorted(leaked)), file=sys.stderr)
	print("  (a published score would stop being reproducible)", file=sys.stderr)
	sys.exit(1)
print("Post-publish exemptions are disjoint and answer-safe (%d + %d fields)."
      % (len(sets["PRESENTATION_FIELDS"]), len(sets["CORRECTABLE_FIELDS"])))
PY
