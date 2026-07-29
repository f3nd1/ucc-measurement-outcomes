# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Site-wide theme for the respondent survey form.

A thin wrapper, as everything in this app is: the rules live in the pure
theme.py, which is where the validation that protects the guest page is tested.
"""

import frappe
from frappe import _
from frappe.model.document import Document

from ucc_measurement_outcomes.theme import COLOUR_FIELDS, normalise_colour


class UCCSurveyTheme(Document):
	def validate(self):
		# Reject at the door as well as at render time. build_theme_css() drops
		# an invalid value silently - correct there, because a bad row must never
		# take the public page down - but someone editing the form deserves to be
		# told rather than watching their input vanish on the next save.
		for field in COLOUR_FIELDS:
			fieldname = "ucc_" + field
			value = self.get(fieldname)
			if value and not normalise_colour(value):
				frappe.throw(
					_("{0} must be a colour like #003a70.").format(
						self.meta.get_label(fieldname)
					)
				)
			if value:
				self.set(fieldname, normalise_colour(value))

	# There is deliberately NO on_update cache-clearing hook. It was written on
	# the assumption that a saved change would be invisible until some cache
	# turned over; checked against Frappe v15.83.0's source, nothing needs
	# clearing, and the call it used (frappe.clear_website_cache) does not exist
	# at all - hence the AttributeError on every save.
	#
	#   * The page is never cached. www/survey.py sets context.no_cache = 1, and
	#     website.utils.cache_html only writes the page cache when
	#     can_cache(context.no_cache) is true. Nothing is stored, so nothing is
	#     stale.
	#   * The document cache invalidates itself. survey.py reads this Single with
	#     frappe.get_cached_doc, and Document.run_post_save_methods() calls
	#     self.clear_cache() -> frappe.clear_document_cache(doctype, name) on
	#     every save. For a Single, name == doctype, so the key is the one being
	#     read.
	#
	# A saved colour therefore shows on the very next request, with no hook.
	#
	# If a future change ever DOES need one, it is
	# frappe.website.utils.clear_website_cache(path) - scoped to a path. Never
	# frappe.clear_cache(), which with no arguments deletes every cache key for
	# the whole site.


@frappe.whitelist()
def reset(fieldname=None):
	"""Clear one variable, or all of them. Empty means "use the built-in
	default" everywhere - there is no separate default to restore."""
	doc = frappe.get_single("UCC Survey Theme")
	fields = ["ucc_" + f for f in COLOUR_FIELDS] + ["ucc_font"]
	if fieldname:
		if fieldname not in fields:
			frappe.throw(_("Unknown theme field {0}").format(fieldname))
		fields = [fieldname]
	for f in fields:
		doc.set(f, "Site Default" if f == "ucc_font" else None)
	doc.save()
	return True
