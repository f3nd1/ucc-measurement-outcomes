# Copyright (c) 2026, United Ceres College and contributors
#
# Can this survey question actually feed this metric?
#
# The Add-source drawer used to label EVERY question "Compatible" - Email, Page
# Break, Short Text and all - which was a client-side literal with nothing
# behind it. This module is the something behind it, and it is deliberately a
# pure function so the rule is testable without a bench and identical wherever
# it is asked.
#
# THE RULE COMES FROM THE ENGINE, NOT FROM TASTE. index_engine.normalise() is
# what actually scores an answer, and the first thing it does with a value is
# float(it). Anything that cannot produce a number is unscoreable no matter how
# the UI labels it - that is the whole of "compatible" here.
#
# Compatibility and response data are SEPARATE verdicts. A compatible question
# with no answers is still compatible; it just contributes nothing yet. Callers
# render those differently (green vs amber) and must not collapse them.

# Layout markers. Not questions, never sources - display_logic.MARKER_TYPES
# groups them for the same reason.
STRUCTURAL = ("Section Heading", "Page Break")

# Stored as a number the engine can read directly.
NUMERIC = ("Rating", "NPS", "Slider", "Number", "Likert Matrix")
# Stored as 1/0.
BINARY = ("Yes / No",)
# Free text, files, dates, orderings: float() fails, so normalise() returns
# None and the answer is silently dropped from the mean. Listing them is how
# the UI can say WHY rather than just refusing.
UNSCOREABLE = ("Short Text", "Paragraph", "Email", "Date", "File Upload", "Ranking")
# Choice types are scoreable ONLY when their choices carry numeric values
# (UCC Survey Question Choice.choice_value). Label-only choices are text.
CHOICE = ("Single Choice", "Multiple Choice", "Dropdown",
          "Multiple Choice Grid", "Checkbox Grid")

# What each normalisation rule can actually convert, derived from
# index_engine.normalise()'s own branches.
_ACCEPTS = {
	"Likert 1-5 to 0-100": NUMERIC,
	"Yes/No to 100/0": BINARY + ("Rating", "Number"),
	"Reverse 0-100": ("Number", "Rating", "Slider"),
	"Ratio to Percentage": ("Number",),
	"Count": ("Number",),
	"Hours": ("Number",),
}

# Best rule for a type that does not fit the metric's current one, so the UI can
# say "use X instead" rather than only "no".
_SUGGESTS = {
	"Rating": "Likert 1-5 to 0-100",
	"Likert Matrix": "Likert 1-5 to 0-100",
	"Slider": "Likert 1-5 to 0-100",
	"NPS": "Likert 1-5 to 0-100",
	"Yes / No": "Yes/No to 100/0",
	"Number": "Ratio to Percentage",
}


def verdict(question_type, normalisation, answers=0, already=False, numeric_choices=False):
	"""Decide whether one question can be a source for one metric.

	Returns {eligible, state, reason, suggested_normalisation}. `state` is what
	the UI colours on: structural / already_connected / incompatible /
	no_response_data / eligible.
	"""
	qt = (question_type or "").strip()
	rule = (normalisation or "").strip()

	if qt in STRUCTURAL:
		return _no("structural", "{0} is a layout marker, not an answerable question.".format(qt or "This field"))

	if already:
		# Still a valid source - just already on this metric. Not an error.
		return {"eligible": False, "state": "already_connected",
		        "reason": "Already a source of this metric.", "suggested_normalisation": None}

	if rule == "Category Only (No Score)":
		return _no("incompatible",
		           "This metric records a category and produces no score, so it takes no scoreable sources.")

	if not rule:
		return _no("incompatible", "This metric has no normalisation, so no answer can be converted to a score.")

	accepts = _ACCEPTS.get(rule)
	if accepts is None:
		return _no("incompatible", "Unknown normalisation '{0}'.".format(rule))

	ok = qt in accepts or (qt in CHOICE and numeric_choices and qt not in STRUCTURAL)
	if not ok:
		if qt in UNSCOREABLE:
			why = "{0} answers are not numeric, so they cannot be normalised at all.".format(qt)
		elif qt in CHOICE:
			why = "{0} choices have no numeric values, so there is nothing to score.".format(qt)
		else:
			why = "{0} cannot be normalised using '{1}'.".format(qt or "This question", rule)
		return _no("incompatible", why, _SUGGESTS.get(qt))

	if not answers:
		# Compatible, just empty. Amber, not red - it contributes nothing YET.
		return {"eligible": True, "state": "no_response_data",
		        "reason": "Compatible, but no answers submitted yet.", "suggested_normalisation": None}

	return {"eligible": True, "state": "eligible", "reason": None, "suggested_normalisation": None}


def _no(state, reason, suggest=None):
	return {"eligible": False, "state": state, "reason": reason, "suggested_normalisation": suggest}


def is_structural(question_type):
	return (question_type or "").strip() in STRUCTURAL
