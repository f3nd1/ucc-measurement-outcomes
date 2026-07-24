"""Pure answer-value helpers for the public submission endpoint.

Frappe-free so they can be unit-tested without a bench (test_submission_utils.py).
"""

import json


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
