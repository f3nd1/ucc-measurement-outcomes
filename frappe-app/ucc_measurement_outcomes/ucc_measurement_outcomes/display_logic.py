# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Conditional display: which questions a respondent actually has to answer.

Frappe-free so it can be unit-tested without a bench (test_display_logic.py).

Decision V1 left display_logic stored but executed nowhere, and recorded the
landmine that goes with it: if the logic ever ships client-side only, a hidden
*required* question makes submission impossible, and a crafted POST could dodge
a branch's required check simply by omitting it. So this is the shared rule, and
submit_survey recomputes visibility from the SUBMITTED answers - never from
anything the browser asserts about what it displayed. www/survey.html evaluates
the identical rule for show/hide; that copy is presentation, this one decides.

Rule shape, stored as JSON in display_logic_config (no new schema field):

    {"question": "<question name>", "operator": "equals", "value": "Yes"}

One rule, one controlling question, and the builder only offers questions
EARLIER in sequence - which makes a cycle structurally impossible rather than
something to detect.
"""

import json

try:
	from ucc_measurement_outcomes.submission_utils import has_value
except ImportError:  # standalone test run, no package on the path
	from submission_utils import has_value

ALWAYS = "Always Show"
CONDITIONAL = "Show If Previous Answer Matches"
OPERATORS = ("equals", "not equals", "contains")
# Markers, not questions: they have no answer, so a rule on one would have
# nothing to hide. They are always shown.
MARKER_TYPES = frozenset({"Section Heading", "Page Break"})


def parse_rule(config):
	"""The rule stored in display_logic_config, or None if there isn't a usable
	one. Unparseable is treated as absent, not as an error: a half-written rule
	must not be able to take a live survey down."""
	if not config:
		return None
	if isinstance(config, str):
		try:
			config = json.loads(config)
		except ValueError:
			return None
	if not isinstance(config, dict) or not config.get("question"):
		return None
	operator = config.get("operator") or "equals"
	return {
		"question": config["question"],
		"operator": operator if operator in OPERATORS else "equals",
		"value": config.get("value"),
	}


def _as_list(answer):
	"""Every answer shape flattened to a list of strings for comparison.

	A grid answer is a dict of rows; flattening it means "any cell in the grid"
	for `contains`, which is the only sensible reading of a grid controlling a
	branch, and stops a dict from silently comparing as False.
	"""
	if answer is None:
		return []
	if isinstance(answer, dict):
		out = []
		for row in answer.values():
			out.extend(_as_list(row))
		return out
	if isinstance(answer, (list, tuple)):
		return [str(v) for v in answer]
	return [str(answer)]


def matches(operator, answer, value):
	"""Does `answer` satisfy `operator value`?

	An unanswered controlling question NEVER satisfies a rule, whatever the
	operator - including "not equals". Otherwise every not-equals branch would
	be visible before the respondent has answered anything, which is not what
	"show this only if they said something else" means to anyone.
	"""
	if not has_value(answer):
		return False
	picked = _as_list(answer)
	want = "" if value is None else str(value)
	if operator == "contains":
		return want in picked
	if operator == "not equals":
		return picked != [want]
	return picked == [want]


def visible_questions(questions, answers):
	"""Names of the questions that are visible given `answers`.

	`questions` must be in sequence order (the order every read path already
	returns them in) and each is a dict with name/question_type/display_logic/
	display_logic_config. `answers` maps question name -> submitted value.

	Resolved in one pass because a rule may only point at an earlier question:
	by the time a question is reached, its controller's visibility is already
	decided. A rule whose controller is hidden hides this question too, so a
	whole branch collapses rather than leaving orphans behind.

	Fails CLOSED - a rule pointing at a question that no longer exists hides the
	question rather than showing it. A broken rule then costs one skipped
	required check; failing open would strand every respondent behind a required
	question that can never become answerable, which is decision V1's landmine
	in its worst form. www/survey.html makes the identical choice, so the two
	can never disagree.
	"""
	visible = set()
	for q in questions:
		if q.get("question_type") in MARKER_TYPES:
			visible.add(q["name"])
			continue
		if (q.get("display_logic") or ALWAYS) == ALWAYS:
			visible.add(q["name"])
			continue
		rule = parse_rule(q.get("display_logic_config"))
		if not rule or rule["question"] not in visible:
			continue
		if matches(rule["operator"], answers.get(rule["question"]), rule["value"]):
			visible.add(q["name"])
	return visible
