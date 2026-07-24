"""Bench-free unit check for answer-value helpers.
Run: `python test_submission_utils.py`
"""

from submission_utils import has_value, to_text


def test_has_value():
	assert not has_value(None)
	assert not has_value("")
	assert not has_value("   ")
	assert not has_value([])
	assert has_value("x")
	assert has_value(0)          # a numeric 0 is a real answer
	assert has_value(["a"])


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


if __name__ == "__main__":
	test_has_value()
	test_to_text()
	print("submission utils: all checks passed")
