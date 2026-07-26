"""Pure answer-value helpers for the public submission endpoint.

Frappe-free so they can be unit-tested without a bench (test_submission_utils.py).
"""

import json


def campaign_window_open(status, opens_on, closes_on, today):
	"""Is a campaign accepting responses right now?

	Survey Tracking is educ_sg's DocType, so it has no controller of ours to
	carry an is_open() the way UCC Survey Campaign did. The rule moves here as a
	pure function instead - the caller passes already-read values, and this is
	testable without a bench. Dates are compared as date objects by the caller;
	a missing bound means unbounded on that side.
	"""
	if status != "Open":
		return False
	if opens_on and opens_on > today:
		return False
	if closes_on and closes_on < today:
		return False
	return True


def has_value(v):
	"""True if an answer counts as provided (used for required-question checks)."""
	if v is None:
		return False
	if isinstance(v, str):
		return v.strip() != ""
	if isinstance(v, (list, tuple)):
		return len(v) > 0
	return True


def to_text(v):
	"""Flatten a submitted answer to the text stored in one reportable row.

	Decision V7: multi-select answers are stored as a JSON array, not
	comma-joined — a comma inside a choice label made the old format
	irrecoverable."""
	if v is None:
		return None
	if isinstance(v, (list, tuple)):
		return json.dumps(list(v), ensure_ascii=False)
	return str(v)
