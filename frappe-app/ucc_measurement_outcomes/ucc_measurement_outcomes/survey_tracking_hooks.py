# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Behaviour behind the Custom Fields this app adds to educ_sg's Survey Tracking.

D2 makes Survey Tracking the campaign. The FIELDS ship as Custom Field fixtures,
but two of them need code, and a Custom Field cannot carry code - so it lives
here, wired via doc_events in hooks.py. Nothing in educ_sg is modified: this app
owns the fields (all `ucc_`-prefixed) and owns their behaviour.

Deliberately NOT here yet: the is_open() collection window that gates the public
endpoint. That moves when the endpoint itself moves off UCC Survey Campaign;
adding it now would be a second implementation of a rule that still lives on the
Campaign controller.
"""

import frappe
from frappe import _

from ucc_measurement_outcomes.submission_utils import should_mint_token

TOKEN_LENGTH = 24


def validate(doc, method=None):
	if not doc.get("ucc_collection_status"):
		return
	# Minting runs HERE, not in before_insert, and the rule itself is pure so it
	# can be tested without a bench - see should_mint_token's docstring for what
	# went wrong when it was before_insert-only.
	#
	# NOTE for anyone moving this again: hooks.py must be changed in the same
	# commit, and a bench needs `clear-cache` as well as `restart` afterwards -
	# app hooks are cached, so a stale doc_events map keeps calling a function
	# that no longer exists and fails with AttributeError on every save.
	if should_mint_token(doc.get("ucc_collection_status"), doc.get("ucc_public_token")):
		doc.ucc_public_token = frappe.generate_hash(length=TOKEN_LENGTH)
	if not doc.get("ucc_survey_version"):
		frappe.throw(
			_("A Survey Tracking record used for collection needs a UCC Survey Version - "
			  "without it the responses cannot be tied to the exact questions asked.")
		)
	# TODO: bench-verify - confirm the real fieldnames for the tracking window.
	# Felix's description gives "date start/end"; the guard is skipped rather than
	# guessed if they are absent.
	start, end = doc.get("date_start"), doc.get("date_end")
	if start and end and frappe.utils.getdate(end) < frappe.utils.getdate(start):
		frappe.throw(_("End date cannot be before start date."))
