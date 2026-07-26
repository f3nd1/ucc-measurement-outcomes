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
	"""True if an answer counts as provided (used for required-question checks).

	A grid answer (Likert Matrix / Multiple Choice Grid / Checkbox Grid) is a
	dict keyed by row. It only counts as provided when EVERY row does - Google
	Forms' own semantics for a required grid, which Felix's grid-type request
	was modelled on: a grid with three of four rows answered is not a complete
	response, the same way a required text field is not "provided" when blank.
	Recurses into has_value so a row's own value (a plain string for a single-
	select row, a list for a checkbox row) is checked by the same rule."""
	if v is None:
		return False
	if isinstance(v, str):
		return v.strip() != ""
	if isinstance(v, (list, tuple)):
		return len(v) > 0
	if isinstance(v, dict):
		return bool(v) and all(has_value(row) for row in v.values())
	return True


def to_text(v):
	"""Flatten a submitted answer to the text stored in one reportable row.

	Decision V7: multi-select answers are stored as a JSON array, not
	comma-joined — a comma inside a choice label made the old format
	irrecoverable. Grid answers are a dict keyed by row (e.g. {"row_0": "col_a",
	"row_1": ["col_a","col_b"]}) and need the identical treatment: without this
	branch, a dict fell through to str(v), Python's repr - single-quoted, not
	valid JSON, silently corrupting the stored answer on the first grid
	question anyone ever submitted."""
	if v is None:
		return None
	if isinstance(v, (list, tuple)):
		return json.dumps(list(v), ensure_ascii=False)
	if isinstance(v, dict):
		return json.dumps(v, ensure_ascii=False)
	return str(v)
