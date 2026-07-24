"""Pure answer-value helpers for the public submission endpoint.

Frappe-free so they can be unit-tested without a bench (test_submission_utils.py).
"""


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
	Multi-select answers are joined with commas."""
	if v is None:
		return None
	if isinstance(v, (list, tuple)):
		return ", ".join(str(x) for x in v)
	return str(v)
