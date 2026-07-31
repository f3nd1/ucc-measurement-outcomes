"""Bench-free unit check for the metric aggregation.
Run: `python test_metric_engine.py`
"""

try:
	from metric_engine import aggregate_metric
except ImportError:  # pragma: no cover
	from ucc_measurement_outcomes.metric_engine import aggregate_metric

LIKERT = "Likert 1-5 to 0-100"


def test_mean_of_normalised():
	entries = [
		{"value": 5, "normalisation": LIKERT},   # -> 100
		{"value": 3, "normalisation": LIKERT},   # -> 50
		{"value": 4, "normalisation": LIKERT},   # -> 75
	]
	r = aggregate_metric(entries)
	assert r["value"] == 75            # (100+50+75)/3
	assert r["response_count"] == 3
	assert r["scored_count"] == 3
	assert r["normalised"] == [100, 50, 75]


def test_unscoreable_ignored():
	# A worded answer with no numeric value can't be scored; it's ignored in the
	# mean but still counted as a response.
	r = aggregate_metric([
		{"value": "Strongly Agree", "normalisation": LIKERT},
		{"value": 5, "normalisation": LIKERT},
	])
	assert r["value"] == 100
	assert r["response_count"] == 2
	assert r["scored_count"] == 1


def test_empty():
	r = aggregate_metric([])
	assert r["value"] is None
	assert r["response_count"] == 0


def test_contributing_versions():
	from metric_engine import contributing_versions
	R = lambda v: ("ans", "4", "Likert 1-5 to 0-100", False, v)
	# The bug this replaced: source_version took answer_rows[0][4] - one
	# arbitrary version - on a metric whose whole purpose is spanning surveys.
	assert contributing_versions([R("EOM-V01"), R("ONB-V01"), R("EOM-V01")]) == "EOM-V01, ONB-V01"
	assert contributing_versions([R("A-V01")]) == "A-V01"
	assert contributing_versions([]) == ""
	# A row with no version must not become an empty entry in the list.
	assert contributing_versions([R(None), R(""), R("A-V01")]) == "A-V01"
	assert contributing_versions([R(None)]) == ""
	# Sorted, so re-running the same metric writes the same string - a provenance
	# field that reorders itself reads as a change that never happened.
	assert contributing_versions([R("C"), R("A"), R("B")]) == "A, B, C"


if __name__ == "__main__":
	test_mean_of_normalised()
	test_unscoreable_ignored()
	test_empty()
	print("metric engine: all checks passed")
