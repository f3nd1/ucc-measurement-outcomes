"""Pure answer-value helpers for the public submission endpoint.

Frappe-free so they can be unit-tested without a bench (test_submission_utils.py).
"""

import json
import re
from datetime import date

# Types whose answer must be one of the configured choices.
SINGLE_CHOICE_TYPES = frozenset({"Rating", "Single Choice", "Dropdown", "Yes / No"})
GRID_TYPES = frozenset({"Likert Matrix", "Multiple Choice Grid", "Checkbox Grid"})
MULTI_GRID_TYPES = frozenset({"Checkbox Grid"})
# Fixed scales, not configurable: both are rendered from hard-coded bounds in
# www/survey.html (an 0-10 NPS button row, a 0-100 range input), so the bounds
# live here rather than in the schema. If either ever becomes configurable this
# table is the one place to replace.
NUMERIC_RANGES = {"NPS": (0, 10), "Slider": (0, 100)}
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_ROW_KEY = re.compile(r"^row_(\d+)$")


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


def allowed_choice_values(choices):
	"""The set of values a choice question will accept, in configured order.

	Mirrors the public form exactly: it puts choice_value in the input's value
	attribute and falls back to choice_label when choice_value is blank, so the
	server must accept the same thing the browser was told to send. Everything is
	compared as text because that is all an HTTP form field can carry."""
	out = []
	for c in choices or []:
		v = c.get("choice_value")
		if v is None or str(v).strip() == "":
			v = c.get("choice_label")
		if v is not None and str(v).strip() != "":
			out.append(str(v))
	return out


def matrix_row_count(matrix_rows):
	"""Rows in a grid question: one non-blank line of matrix_rows each."""
	return len([r for r in (matrix_rows or "").split("\n") if r.strip()])


def _number(v):
	try:
		return float(str(v).strip())
	except (TypeError, ValueError):
		return None


def value_allowed(question_type, value, choices, matrix_rows=None):
	"""Is this a value the question could legitimately have produced?

	Returns None when the value is allowed, otherwise a short reason suitable
	for showing to the respondent. (Reason-or-None, not a bool: "not one of the
	available options" and "outside the 0-10 range" are different problems and a
	respondent who hits one deserves to be told which.)

	This exists because nothing was checking. The browser widgets cannot produce
	an invalid value, but the endpoint is public and unauthenticated, so a
	hand-made POST could: a crafted 999 on a 1-5 Likert question normalised to
	100 and inflated the metric it fed, and a crafted -50 normalised to 0.
	Reject rather than clamp - a clamped answer is a fabricated one, and the
	product rule is that every score traces back to a real submitted answer.

	Emptiness is allowed here; whether a question MAY be left empty is
	has_value()'s job, checked separately against is_required.

	One quirk deliberately preserved: when a choice question has no choices
	configured (or a grid has no rows), the public form degrades to a plain text
	box rather than stranding the respondent with nothing to click. Text is
	therefore the correct answer shape for those, and this accepts it."""
	if value is None:
		return None
	if isinstance(value, str) and value.strip() == "":
		return None
	if isinstance(value, (list, tuple, dict)) and not value:
		return None

	allowed = allowed_choice_values(choices)

	if question_type in GRID_TYPES:
		rows = matrix_row_count(matrix_rows)
		if not allowed or (matrix_rows is not None and not rows):
			return _free_text(value)
		if not isinstance(value, dict):
			return "expected one answer per grid row"
		multi = question_type in MULTI_GRID_TYPES
		for key, row_value in value.items():
			m = _ROW_KEY.match(str(key))
			if not m or (rows and int(m.group(1)) >= rows):
				return "answer given for a row that is not in this question"
			if row_value is None or (isinstance(row_value, str) and not row_value.strip()):
				continue  # a row left blank; completeness is has_value()'s job
			if multi:
				if not isinstance(row_value, (list, tuple)):
					return "expected a list of selections for each grid row"
				picked = [str(v) for v in row_value]
				if len(set(picked)) != len(picked):
					return "the same option was selected twice in one grid row"
			else:
				if isinstance(row_value, (list, tuple, dict)):
					return "only one option may be selected per grid row"
				picked = [str(row_value)]
			if any(v not in allowed for v in picked):
				return "not one of the available options"
		return None

	if question_type == "Ranking":
		if not allowed:
			return _free_text(value)
		if not isinstance(value, (list, tuple)):
			return "expected a ranked list of options"
		# The order is the answer, so a ranking is only meaningful when it is a
		# permutation: every option exactly once, nothing extra, nothing dropped.
		if sorted(str(v) for v in value) != sorted(allowed):
			return "a ranking must contain every option exactly once"
		return None

	if question_type == "Multiple Choice":
		if not allowed:
			return _free_text(value)
		if not isinstance(value, (list, tuple)):
			return "expected a list of selected options"
		picked = [str(v) for v in value]
		if len(set(picked)) != len(picked):
			return "the same option was selected twice"
		if any(v not in allowed for v in picked):
			return "not one of the available options"
		return None

	if question_type in SINGLE_CHOICE_TYPES:
		if not allowed:
			return _free_text(value)
		if isinstance(value, (list, tuple, dict)):
			return "expected a single option"
		if str(value) not in allowed:
			return "not one of the available options"
		return None

	if question_type in NUMERIC_RANGES:
		lo, hi = NUMERIC_RANGES[question_type]
		n = _number(value)
		if n is None:
			return "expected a number"
		if n < lo or n > hi:
			return "outside the {0}-{1} range".format(lo, hi)
		return None

	if question_type == "Number":
		return None if _number(value) is not None else "expected a number"

	if question_type == "Date":
		try:
			date.fromisoformat(str(value).strip())
		except ValueError:
			return "expected a date in YYYY-MM-DD format"
		return None

	if question_type == "Email":
		return None if EMAIL_RE.match(str(value).strip()) else "expected an email address"

	# Short Text, Paragraph, File Upload (the honest placeholder textarea) and
	# anything added to the Select later: free text, but still scalar - a list or
	# dict here would be a JSON blob landing in a field nothing downstream parses.
	return _free_text(value)


def _free_text(value):
	return "expected a single text answer" if isinstance(value, (list, tuple, dict)) else None
