"""Bench-free unit check for conditional display.
Run: `python test_display_logic.py`
"""

import json

from display_logic import matches, parse_rule, visible_questions


def q(name, logic=None, rule=None, qtype="Short Text"):
	return {
		"name": name,
		"question_type": qtype,
		"display_logic": logic,
		"display_logic_config": json.dumps(rule) if rule else None,
	}


def test_parse_rule():
	assert parse_rule(None) is None
	assert parse_rule("") is None
	assert parse_rule("not json") is None          # half-written rule != outage
	assert parse_rule("[1,2]") is None
	assert parse_rule('{"operator":"equals"}') is None  # no controlling question
	assert parse_rule('{"question":"Q1","operator":"equals","value":"Yes"}') == {
		"question": "Q1", "operator": "equals", "value": "Yes",
	}
	# Unknown operator degrades to equals rather than erroring.
	assert parse_rule('{"question":"Q1","operator":"regex"}')["operator"] == "equals"
	assert parse_rule({"question": "Q1"}) == {"question": "Q1", "operator": "equals", "value": None}


def test_matches():
	assert matches("equals", "Yes", "Yes")
	assert not matches("equals", "No", "Yes")
	assert matches("not equals", "No", "Yes")
	assert matches("contains", ["A", "B"], "B")
	assert not matches("contains", ["A", "B"], "C")
	# A multi-select equals only when it is exactly that one selection.
	assert matches("equals", ["Yes"], "Yes")
	assert not matches("equals", ["Yes", "No"], "Yes")
	# Numbers arrive as text off a form; compare as text.
	assert matches("equals", 5, "5")
	# Grid answers flatten, so "contains" reads as "any cell in the grid".
	assert matches("contains", {"row_0": ["A"], "row_1": ["C"]}, "C")
	# An unanswered controller never satisfies a rule - not even not-equals,
	# which would otherwise show every negative branch on a blank form.
	assert not matches("equals", None, "Yes")
	assert not matches("not equals", None, "Yes")
	assert not matches("not equals", "", "Yes")


def test_visible_unconditional():
	qs = [q("Q1"), q("Q2", "Always Show")]
	assert visible_questions(qs, {}) == {"Q1", "Q2"}


def test_visible_conditional():
	qs = [q("Q1"), q("Q2", "Show If Previous Answer Matches", {"question": "Q1", "value": "Yes"})]
	assert visible_questions(qs, {"Q1": "Yes"}) == {"Q1", "Q2"}
	assert visible_questions(qs, {"Q1": "No"}) == {"Q1"}
	assert visible_questions(qs, {}) == {"Q1"}


def test_visible_chain_collapses():
	# B depends on A, C depends on B. Answering A "No" must take C with it,
	# even though C's own rule looks satisfied by the submitted answers.
	qs = [
		q("A"),
		q("B", "Show If Previous Answer Matches", {"question": "A", "value": "Yes"}),
		q("C", "Show If Previous Answer Matches", {"question": "B", "value": "Yes"}),
	]
	assert visible_questions(qs, {"A": "Yes", "B": "Yes"}) == {"A", "B", "C"}
	assert visible_questions(qs, {"A": "No", "B": "Yes"}) == {"A"}


def test_visible_fails_closed():
	# Controller deleted / never existed: hide, do not show. Showing would
	# strand every respondent behind a required question nothing can satisfy.
	qs = [q("Q2", "Show If Previous Answer Matches", {"question": "gone", "value": "Yes"})]
	assert visible_questions(qs, {"gone": "Yes"}) == set()
	# Same for a rule that will not parse.
	qs = [q("Q1"), {"name": "Q2", "question_type": "Short Text",
					"display_logic": "Show If Previous Answer Matches",
					"display_logic_config": "{broken"}]
	assert visible_questions(qs, {}) == {"Q1"}


def test_markers_ignore_logic():
	qs = [q("S1", qtype="Section Heading"), q("P1", qtype="Page Break")]
	assert visible_questions(qs, {}) == {"S1", "P1"}


if __name__ == "__main__":
	test_parse_rule()
	test_matches()
	test_visible_unconditional()
	test_visible_conditional()
	test_visible_chain_collapses()
	test_visible_fails_closed()
	test_markers_ignore_logic()
	print("display logic: all checks passed")
