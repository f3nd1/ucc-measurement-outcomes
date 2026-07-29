"""Bench-free unit check for the respondent form's theme.
Run: `python test_theme.py`

Most of this is the security boundary, not the feature: www/survey.html is the
only guest-reachable page in the app, and these are the tests that say what can
and cannot reach it.
"""

from theme import (
	COLOUR_FIELDS,
	FONT_CHOICES,
	SCALES,
	SELECT_CHOICES,
	build_theme_css,
	is_default,
	normalise_colour,
	theme_variables,
)


def test_normalise_colour():
	assert normalise_colour("#4a63e7") == "#4a63e7"
	assert normalise_colour("#4A63E7") == "#4a63e7"      # a picker may send either case
	assert normalise_colour("  #4a63e7  ") == "#4a63e7"
	# Everything else is None. Three-digit hex is valid CSS but is not what a
	# colour input emits, so it is not what this accepts - one shape only.
	for bad in (None, "", "   ", "4a63e7", "#4a63e", "#4a63e77", "#zzzzzz",
				"red", "rgb(1,2,3)", 0, "#4a63e7;"):
		assert normalise_colour(bad) is None, bad


def test_nothing_set_emits_nothing():
	# Every site today is in this state and must keep rendering exactly as it
	# does: no style block at all, so the stylesheet's own fallbacks apply.
	assert build_theme_css({}) == ""
	assert build_theme_css({"ucc_accent": "", "ucc_font": "Site Default"}) == ""
	assert is_default({})


def test_valid_values_are_emitted():
	css = build_theme_css({"ucc_accent": "#003a70", "ucc_star": "#c8a02e"})
	assert css.startswith(":root{") and css.endswith("}")
	assert "--ucc-accent:#003a70;" in css
	assert "--ucc-star:#c8a02e;" in css
	assert not is_default({"ucc_accent": "#003a70"})
	# Underscored fieldnames become hyphenated CSS variables.
	assert "--ucc-border-strong:#111111;" in build_theme_css({"ucc_border_strong": "#111111"})


def test_invalid_values_are_dropped_not_sanitised():
	# A bad value costs the default colour, never the page.
	assert build_theme_css({"ucc_accent": "red"}) == ""
	css = build_theme_css({"ucc_accent": "#003a70", "ucc_star": "not a colour"})
	assert css == ":root{--ucc-accent:#003a70;}"


def test_nothing_stored_can_escape_the_style_block():
	# The whole reason this module exists. Whatever is stored - by the REST API,
	# frappe.client.set_value or the console, none of which involve a picker -
	# the output is only ever `--<known-name>:#rrggbb;`.
	attacks = [
		"</style><script>alert(1)</script>",
		"#000;} body{display:none} .x{color:#000",
		"url(https://evil.example/steal)",
		"#000000; background-image:url(//evil)",
		"expression(alert(1))",
		"var(--secret)",
	]
	for payload in attacks:
		assert build_theme_css({"ucc_accent": payload}) == "", payload
		# ...and it cannot ride along beside a valid value either.
		css = build_theme_css({"ucc_accent": "#003a70", "ucc_muted": payload})
		assert css == ":root{--ucc-accent:#003a70;}", payload
		assert "<" not in css and "}" not in css[:-1]


def test_unknown_fields_are_ignored():
	# The variable NAMES are a closed list too - a stored field nobody declared
	# cannot invent a CSS property.
	assert build_theme_css({"ucc_evil": "#000000"}) == ""
	assert build_theme_css({"font-family": "x", "ucc_": "#000000"}) == ""


def test_font_is_a_key_never_a_value():
	# The stored value selects a hard-coded stack; it never reaches the output.
	assert "--ucc-font:Georgia" in build_theme_css({"ucc_font": "Serif"})
	# Site Default is the no-op: the form keeps inheriting the Website Theme.
	assert build_theme_css({"ucc_font": "Site Default"}) == ""
	# Anything not on the list emits nothing at all - no passthrough.
	for bad in ("Comic Sans", "'; }", None, "", "serif"):
		assert build_theme_css({"ucc_font": bad}) == "", bad
	assert FONT_CHOICES[0] == "Site Default"      # first = the default in the Select


def test_sizing_selects_are_keys_never_values():
	# Same rule as the font: the stored value selects a hard-coded literal and
	# never reaches the page itself.
	assert build_theme_css({"ucc_star_size": "Large"}) == ":root{--ucc-star-size:44px;}"
	assert build_theme_css({"ucc_question_spacing": "Compact"}) == ":root{--ucc-q-gap:8px;}"
	assert build_theme_css({"ucc_font_size": "Small"}) == ":root{--ucc-font-size:0.9em;}"


def test_every_middle_option_emits_nothing():
	# The load-bearing property: an untouched site, a field left at its default
	# and a garbage stored value all render EXACTLY as the app rendered before
	# these controls existed. Nothing is emitted, so the stylesheet's own value
	# applies.
	assert build_theme_css({
		"ucc_star_size": "Medium", "ucc_font_size": "Medium",
		"ucc_radius": "Rounded", "ucc_question_spacing": "Comfortable",
		"ucc_font": "Site Default",
	}) == ""


def test_one_select_drives_both_radius_variables():
	# Today's radii differ (ranking list 8px, NPS buttons 6px), so one variable
	# would change the NPS buttons at the DEFAULT setting. Two variables, one
	# control - and ucc_radius_sm is never stored or offered.
	assert build_theme_css({"ucc_radius": "Sharp"}) == ":root{--ucc-radius:0;--ucc-radius-sm:0;}"
	assert build_theme_css({"ucc_radius": "Pill"}) == ":root{--ucc-radius:18px;--ucc-radius-sm:999px;}"
	assert "ucc_radius_sm" not in SELECT_CHOICES
	# Storing it directly does nothing - the value comes from ucc_radius alone.
	assert build_theme_css({"ucc_radius_sm": "Pill"}) == ""


def test_no_sizing_value_can_escape():
	# Every payload the colour fields are tested against, through every sizing
	# lookup. A key that is not in the table produces nothing at all - there is
	# no passthrough to sanitise or escape.
	attacks = [
		"</style><script>alert(1)</script>",
		"0;} body{display:none} .x{padding:0",
		"999px;background-image:url(//evil)",
		"expression(alert(1))",
		"var(--secret)",
		"Large; --ucc-accent:#000000",
		"", None, 0, "large", "LARGE", "medium ",
	]
	for field in SELECT_CHOICES:
		for payload in attacks:
			assert build_theme_css({field: payload}) == "", (field, payload)
			# ...and not beside a valid value either.
			css = build_theme_css({"ucc_accent": "#003a70", field: payload})
			assert css == ":root{--ucc-accent:#003a70;}", (field, payload)


def test_select_options_match_their_lookup_tables():
	# The failure this pattern invites: an option with no table entry silently
	# does nothing, and a table entry with no option is unreachable. check_repo.sh
	# asserts the same thing against the DocType JSON; this asserts the map the
	# check reads is actually derived from the tables.
	for field, (_variable, table) in SCALES.items():
		if field == "ucc_radius_sm":
			continue
		assert SELECT_CHOICES[field] == list(table), field
	assert SELECT_CHOICES["ucc_font"] == FONT_CHOICES


def test_every_colour_field_round_trips():
	# Guards the DocType against drift: if a field is added here it must be
	# emittable, and the fieldname/variable mapping must hold for all of them.
	settings = {"ucc_" + f: "#010203" for f in COLOUR_FIELDS}
	css = build_theme_css(settings)
	for field in COLOUR_FIELDS:
		assert "--ucc-%s:#010203;" % field.replace("_", "-") in css, field


if __name__ == "__main__":
	test_normalise_colour()
	test_nothing_set_emits_nothing()
	test_valid_values_are_emitted()
	test_invalid_values_are_dropped_not_sanitised()
	test_nothing_stored_can_escape_the_style_block()
	test_unknown_fields_are_ignored()
	test_font_is_a_key_never_a_value()
	test_every_colour_field_round_trips()
	test_sizing_selects_are_keys_never_values()
	test_every_middle_option_emits_nothing()
	test_one_select_drives_both_radius_variables()
	test_no_sizing_value_can_escape()
	test_select_options_match_their_lookup_tables()
	print("theme: all checks passed")
