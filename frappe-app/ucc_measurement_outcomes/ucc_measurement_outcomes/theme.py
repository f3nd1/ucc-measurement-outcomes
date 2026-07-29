# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""The respondent form's theme: validated values in, a fixed CSS block out.

Frappe-free so it can be unit-tested without a bench (test_theme.py).

THE SECURITY BOUNDARY LIVES HERE. www/survey.html is the only guest-reachable
page in this app, and this module builds the one thing that page renders from
stored settings. The standing decision against a free-form HTML/CSS editor is
unchanged - this is its opposite: a closed set of variable names, values that
must match ^#[0-9a-f]{6}$, and a font that is a KEY into a table of hard-coded
stacks rather than a string that reaches the output.

So the emitted CSS can only ever be `--<known-name>:#rrggbb;` or
`--ucc-font:<one of our own literals>;`. No stored text is echoed, which is why
no `</style>` can be smuggled and no CSS function (`url()`, attribute selectors)
can be introduced. Anything that fails validation is DROPPED, not sanitised and
not passed through: the stylesheet's own fallback then applies, so a bad value
costs the default colour rather than the page.

The picker in the Desk form makes the UI honest; this makes it safe. Both are
needed - a Single can be written through the REST API, frappe.client.set_value
or the console, none of which involve a picker.
"""

import re

HEX = re.compile(r"^#[0-9a-f]{6}$")

# The variables the stylesheet actually reads, with the same fallbacks it
# declares. Anything not in this dict can never be emitted, whatever is stored.
COLOUR_FIELDS = {
	"accent": "#4a63e7",
	"star": "#e0a832",
	"required": "#b94848",
	"muted": "#8b95a5",
	"border": "#e2e6ea",
	"border_strong": "#d9d9d9",
	"border_soft": "#eef2f7",
	"surface": "#f7f9fc",
}

# A closed list: the stored value is a KEY, and only these literals are ever
# written into the page. "Site Default" emits nothing, so the form keeps
# inheriting the Website Theme's font - which is the right default for an
# institutional portal and why it is first.
FONT_STACKS = {
	"Site Default": None,
	"System": "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	"Serif": "Georgia, 'Times New Roman', serif",
	"Humanist Sans": "'Segoe UI', Tahoma, Verdana, sans-serif",
	"Monospace": "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
}

FONT_CHOICES = list(FONT_STACKS)


def normalise_colour(value):
	"""A usable #rrggbb, or None. Uppercase in, lowercase out - a colour picker
	may hand back either, and the regex is deliberately not case-insensitive so
	that what is emitted is exactly one shape."""
	if not value:
		return None
	value = str(value).strip().lower()
	return value if HEX.match(value) else None


def theme_variables(settings):
	"""{css-variable-name: value} for everything validly set.

	`settings` is anything with .get() - a Frappe Single doc or a plain dict,
	which is what makes this testable without a bench. Keys are the DocType
	fieldnames (ucc_accent, ucc_font, …).

	A variable whose stored value fails validation is omitted entirely rather
	than corrected, so the CSS fallback applies and the form still renders.
	"""
	out = {}
	for field, _default in COLOUR_FIELDS.items():
		colour = normalise_colour(settings.get("ucc_" + field))
		if colour:
			out["--ucc-" + field.replace("_", "-")] = colour
	stack = FONT_STACKS.get(settings.get("ucc_font"))
	if stack:
		out["--ucc-font"] = stack
	return out


def build_theme_css(settings):
	"""The `:root{…}` block for the public page, or "" when nothing is set.

	Returns the INNER CSS only; survey.html wraps it in <style>. Empty means the
	page emits no style block at all, which is the state every existing site is
	in today and must keep working.
	"""
	variables = theme_variables(settings)
	if not variables:
		return ""
	return ":root{%s}" % "".join("%s:%s;" % kv for kv in variables.items())


def is_default(settings):
	"""True when nothing is customised - used to label the reset control."""
	return not theme_variables(settings)
