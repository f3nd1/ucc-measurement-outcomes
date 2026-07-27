"""Bench-free unit check for answer-value helpers.
Run: `python test_submission_utils.py`
"""

from submission_utils import (
	allowed_choice_values,
	campaign_window_open,
	has_value,
	to_text,
	value_allowed,
)


def ch(*labels):
	return [{"choice_label": s, "choice_value": None} for s in labels]


def ok(*args, **kw):
	"""value_allowed returns None when the value is allowed, else a reason."""
	assert value_allowed(*args, **kw) is None, value_allowed(*args, **kw)


def bad(*args, **kw):
	assert value_allowed(*args, **kw) is not None


def test_has_value():
	assert not has_value(None)
	assert not has_value("")
	assert not has_value("   ")
	assert not has_value([])
	assert has_value("x")
	assert has_value(0)          # a numeric 0 is a real answer
	assert has_value(["a"])


def test_has_value_on_grid_answers():
	# A required grid needs EVERY row answered - Google Forms' own semantics,
	# which the grid-type request was modelled on. A dict with any row missing
	# (single-select: None/blank; checkbox: an empty list) is not complete.
	assert not has_value({})                                    # no rows at all
	assert not has_value({"row_0": None, "row_1": "col_a"})      # one row missing
	assert not has_value({"row_0": "col_a", "row_1": ""})        # blank counts as missing
	assert has_value({"row_0": "col_a", "row_1": "col_b"})       # single-select, complete
	assert not has_value({"row_0": ["col_a"], "row_1": []})      # checkbox: one row unchecked
	assert has_value({"row_0": ["col_a"], "row_1": ["col_b", "col_c"]})  # checkbox, complete


def test_to_text():
	assert to_text(None) is None
	assert to_text("hello") == "hello"
	assert to_text(4) == "4"
	# Decision V7: multi-select stored as JSON, not comma-joined — a comma
	# inside a choice label made the old format irrecoverable.
	assert to_text(["a", "b", "c"]) == '["a", "b", "c"]'
	assert to_text([]) == "[]"
	import json
	assert json.loads(to_text(["1,000 - 2,000", "Other"])) == ["1,000 - 2,000", "Other"]


def test_to_text_on_grid_answers():
	# Without this branch a dict fell through to str(v) - Python's repr,
	# single-quoted and not valid JSON, silently corrupting the stored answer.
	import json
	single = {"row_0": "col_a", "row_1": "col_b"}
	assert json.loads(to_text(single)) == single
	multi = {"row_0": ["col_a", "col_c"], "row_1": ["col_b"]}
	assert json.loads(to_text(multi)) == multi
	assert to_text({}) == "{}"


def test_campaign_window_open():
	from datetime import date
	today = date(2026, 7, 26)
	# Status is the first gate: a campaign that is not Open never collects,
	# whatever its dates say. Historical Survey Tracking rows have status blank,
	# which is exactly this case - they are consolidation records, not campaigns.
	assert not campaign_window_open("", None, None, today)
	assert not campaign_window_open("Draft", None, None, today)
	assert not campaign_window_open("Closed", None, None, today)
	# Open with no window at all = unbounded.
	assert campaign_window_open("Open", None, None, today)
	# Bounds are inclusive on both ends.
	assert campaign_window_open("Open", date(2026, 7, 26), date(2026, 7, 26), today)
	assert campaign_window_open("Open", date(2026, 7, 1), date(2026, 8, 1), today)
	# Not yet open / already closed.
	assert not campaign_window_open("Open", date(2026, 7, 27), None, today)
	assert not campaign_window_open("Open", None, date(2026, 7, 25), today)
	# One-sided windows.
	assert campaign_window_open("Open", date(2026, 7, 1), None, today)
	assert campaign_window_open("Open", None, date(2026, 8, 1), today)


def test_allowed_choice_values():
	# choice_value wins; blank choice_value falls back to the label - exactly
	# what the public form puts in the input's value attribute.
	assert allowed_choice_values(ch("Yes", "No")) == ["Yes", "No"]
	assert allowed_choice_values([{"choice_label": "Agree", "choice_value": "4"}]) == ["4"]
	assert allowed_choice_values([{"choice_label": "Agree", "choice_value": "  "}]) == ["Agree"]
	assert allowed_choice_values([{"choice_label": "", "choice_value": None}]) == []
	assert allowed_choice_values(None) == []


def test_value_allowed_empty_is_always_allowed():
	# Emptiness is has_value()'s job (checked against is_required), not this one.
	for empty in (None, "", "   ", [], {}):
		ok("Single Choice", empty, ch("A", "B"))
		ok("NPS", empty, [])
		ok("Email", empty, [])


def test_value_allowed_single_choice():
	for t in ("Single Choice", "Rating", "Dropdown", "Yes / No"):
		ok(t, "A", ch("A", "B"))
		bad(t, "C", ch("A", "B"))            # not on the list
		bad(t, ["A"], ch("A", "B"))          # one answer, not many
		bad(t, {"row_0": "A"}, ch("A", "B"))
	# The 999 that started this: a 1-5 Likert-style Rating normalised to 100.
	bad("Rating", "999", ch("1", "2", "3", "4", "5"))
	bad("Rating", "-50", ch("1", "2", "3", "4", "5"))
	ok("Rating", "5", ch("1", "2", "3", "4", "5"))


def test_value_allowed_multiple_choice():
	ok("Multiple Choice", ["A", "C"], ch("A", "B", "C"))
	bad("Multiple Choice", ["A", "Z"], ch("A", "B", "C"))
	bad("Multiple Choice", ["A", "A"], ch("A", "B", "C"))   # double-counted
	bad("Multiple Choice", "A", ch("A", "B", "C"))          # must be a list


def test_value_allowed_ranking():
	# The order is the answer, so only a full permutation means anything.
	ok("Ranking", ["C", "A", "B"], ch("A", "B", "C"))
	bad("Ranking", ["A", "B"], ch("A", "B", "C"))           # dropped one
	bad("Ranking", ["A", "B", "B"], ch("A", "B", "C"))      # duplicated one
	bad("Ranking", ["A", "B", "C", "D"], ch("A", "B", "C"))  # invented one


def test_value_allowed_numeric_ranges():
	ok("NPS", "0", [])
	ok("NPS", "10", [])
	ok("NPS", 7, [])
	bad("NPS", "11", [])
	bad("NPS", "-1", [])
	bad("NPS", "eight", [])
	ok("Slider", "100", [])
	bad("Slider", "101", [])
	bad("Slider", "-0.5", [])


def test_value_allowed_scalar_types():
	ok("Number", "3.5", [])
	ok("Number", "-2", [])
	bad("Number", "3.5kg", [])
	ok("Date", "2026-07-27", [])
	bad("Date", "27/07/2026", [])
	bad("Date", "2026-13-01", [])
	ok("Email", "felix@unitedceres.edu.sg", [])
	bad("Email", "felix@", [])
	bad("Email", "not an email", [])
	# Free text stays free - but scalar, so a JSON blob cannot land in a field
	# nothing downstream parses.
	ok("Short Text", "anything at all", [])
	ok("Paragraph", "line\nline", [])
	ok("File Upload", "a scan of my transcript", [])
	bad("Short Text", ["a", "b"], [])
	bad("Paragraph", {"row_0": "a"}, [])


def test_value_allowed_grids():
	cols = ch("col_a", "col_b")
	rows = "Teaching\nFacilities\nSupport"
	ok("Likert Matrix", {"row_0": "col_a", "row_2": "col_b"}, cols, rows)
	ok("Likert Matrix", {"row_0": None, "row_1": "col_a"}, cols, rows)  # partial is fine here
	bad("Likert Matrix", {"row_0": "col_z"}, cols, rows)                # unknown column
	bad("Likert Matrix", {"row_3": "col_a"}, cols, rows)                # row beyond the grid
	bad("Likert Matrix", {"nope": "col_a"}, cols, rows)                 # not a row key
	bad("Likert Matrix", {"row_0": ["col_a", "col_b"]}, cols, rows)     # single-select
	bad("Likert Matrix", "col_a", cols, rows)                           # wrong shape entirely
	# Checkbox Grid rows are lists.
	ok("Checkbox Grid", {"row_0": ["col_a", "col_b"], "row_1": []}, cols, rows)
	bad("Checkbox Grid", {"row_0": ["col_a", "col_a"]}, cols, rows)     # double-counted
	bad("Checkbox Grid", {"row_0": ["col_z"]}, cols, rows)
	bad("Checkbox Grid", {"row_0": "col_a"}, cols, rows)                # must be a list
	# Row index is only bounded when the caller passes matrix_rows.
	ok("Multiple Choice Grid", {"row_9": "col_a"}, cols)


def test_value_allowed_unconfigured_questions_degrade_to_text():
	# The public form renders a plain text box when a choice question has no
	# choices (or a grid has no rows) rather than stranding the respondent, so
	# text is the correct answer shape for those and must not be rejected.
	ok("Single Choice", "typed instead", [])
	ok("Ranking", "typed instead", [])
	ok("Multiple Choice", "typed instead", [])
	ok("Checkbox Grid", "typed instead", [], "")
	ok("Likert Matrix", "typed instead", ch("col_a"), "")
	# ...but a structured answer to an unconfigured question is still nonsense.
	bad("Single Choice", ["a", "b"], [])
	bad("Checkbox Grid", {"row_0": ["col_a"]}, [], "")


if __name__ == "__main__":
	test_has_value()
	test_has_value_on_grid_answers()
	test_to_text()
	test_to_text_on_grid_answers()
	test_campaign_window_open()
	test_allowed_choice_values()
	test_value_allowed_empty_is_always_allowed()
	test_value_allowed_single_choice()
	test_value_allowed_multiple_choice()
	test_value_allowed_ranking()
	test_value_allowed_numeric_ranges()
	test_value_allowed_scalar_types()
	test_value_allowed_grids()
	test_value_allowed_unconfigured_questions_degrade_to_text()
	print("submission utils: all checks passed")
