# Copyright (c) 2026, United Ceres College and contributors
#
# Whitelisted read/write for the survey theme, so the Measurement Outcomes
# workbench can offer a Theme Settings tab without the UI touching DocType REST
# (the trust boundary in CLAUDE.md: UIs call only api/* methods).
#
# SCOPE, STATED PLAINLY: "UCC Survey Theme" is a SINGLE DocType - one theme for
# the whole site, not one per survey or per version. Editing it here changes
# every survey's respondent page. Making the theme per-survey is a data-model
# change (a link or override table on UCC Survey Version), not something this
# module can fake, so it is NOT done silently here - see the 2026-08-01 entry in
# docs/09-decision-log.md.
#
# All vocabulary and validation comes from the pure `theme` module, which already
# owns it and is tested without a bench (test_theme.py). Nothing here re-states a
# colour default or a Select's options - a second copy is how the form and the
# stylesheet drift apart.

import frappe

try:
	from ucc_measurement_outcomes.theme import (
		COLOUR_FIELDS,
		SELECT_CHOICES,
		is_default,
		normalise_colour,
	)
except ImportError:  # standalone import for the bench-free tests
	from theme import COLOUR_FIELDS, SELECT_CHOICES, is_default, normalise_colour

THEME = "UCC Survey Theme"

# The DocType stores colours as ucc_<key>; the pure module keys them without the
# prefix. One place that knows about the prefix, rather than every caller.
def _colour_field(key):
	return "ucc_" + key


@frappe.whitelist()
def get_theme():
	"""Current theme values plus the vocabulary the UI renders controls from.

	Read-only, so plain read permission on the Single is enough - Frappe's own
	get_single_value path already enforces it.
	"""
	doc = frappe.get_cached_doc(THEME)
	colours = {k: (doc.get(_colour_field(k)) or "") for k in COLOUR_FIELDS}
	selects = {f: (doc.get(f) or "") for f in SELECT_CHOICES}
	return {
		"colours": colours,
		"selects": selects,
		# Sent so the browser never hard-codes a palette or an option list of its
		# own - it renders whatever the pure module says exists today.
		"colour_defaults": COLOUR_FIELDS,
		"select_choices": SELECT_CHOICES,
		"is_default": is_default(doc),
		# The UI states this; it is not a detail to discover after saving.
		"site_wide": True,
	}


@frappe.whitelist()
def save_theme(payload):
	"""Write validated theme values. Site configuration, so System Manager only.

	Every value is checked against the pure module before it is stored: colours
	must pass normalise_colour (a #rrggbb literal or empty), and a Select must be
	one of its own declared choices. An unknown field name is ignored rather than
	written - this is a settings form, not a generic document writer.
	"""
	frappe.only_for("System Manager")
	data = frappe.parse_json(payload) or {}
	doc = frappe.get_doc(THEME)

	for key in COLOUR_FIELDS:
		if key not in data:
			continue
		raw = (data.get(key) or "").strip()
		# Empty is meaningful: it means "emit no rule", which is exactly how
		# page_bg and label already default. normalise_colour returns None for
		# anything it does not recognise, so a bad value clears rather than
		# storing junk that would reach the stylesheet.
		doc.set(_colour_field(key), normalise_colour(raw) or "")

	for field, choices in SELECT_CHOICES.items():
		if field not in data:
			continue
		value = (data.get(field) or "").strip()
		if value and value not in choices:
			frappe.throw(
				frappe._("{0} is not a valid option for {1}").format(value, field),
				title=frappe._("Invalid theme setting"),
			)
		doc.set(field, value)

	doc.save()
	# The respondent page reads the theme through frappe.get_cached_doc, so the
	# cache has to go or the next survey load serves the old colours. Scoped to
	# this one Single - never a site-wide cache wipe (check_repo.sh guards that).
	frappe.clear_document_cache(THEME, THEME)
	return {"ok": True, "is_default": is_default(doc)}
