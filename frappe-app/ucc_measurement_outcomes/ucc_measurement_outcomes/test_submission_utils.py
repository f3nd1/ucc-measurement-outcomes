"""Bench-free unit check for answer-value helpers.
Run: `python test_submission_utils.py`
"""

from submission_utils import campaign_window_open, has_value, to_text


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


if __name__ == "__main__":
	test_has_value()
	test_has_value_on_grid_answers()
	test_to_text()
	test_to_text_on_grid_answers()
	test_campaign_window_open()
	print("submission utils: all checks passed")
