"""Bench-free unit checks for the index scoring engine.
Run: `python test_index_engine.py`
"""

from index_engine import compute_index, normalise, weighted_score, weights_valid


def test_normalise():
	assert normalise(1, "Likert 1-5 to 0-100") == 0
	assert normalise(3, "Likert 1-5 to 0-100") == 50
	assert normalise(5, "Likert 1-5 to 0-100") == 100
	assert normalise(6, "Likert 1-5 to 0-100") == 100        # clamped
	assert normalise(5, "Likert 1-5 to 0-100", reverse=True) == 0
	assert normalise(1, "Yes/No to 100/0") == 100
	assert normalise(0, "Yes/No to 100/0") == 0
	assert normalise(30, "Reverse 0-100") == 70
	assert normalise(0.8, "Ratio to Percentage") == 80
	assert normalise(7, "Hours") == 7                         # raw, not scored
	assert normalise("x", "Category Only (No Score)") is None
	assert normalise(None, "Likert 1-5 to 0-100") is None


def test_weighted_score():
	assert weighted_score([{"value": 100, "weight": 50}, {"value": 50, "weight": 50}]) == 75
	# missing component is ignored, weight re-based on what is present
	assert weighted_score([{"value": None, "weight": 50}, {"value": 80, "weight": 50}]) == 80
	assert weighted_score([{"value": None, "weight": 50}]) is None


def test_weights_valid():
	assert weights_valid([20, 15, 20, 15, 15, 15])
	assert not weights_valid([50, 40])


def test_compute_index():
	# metric -> dimension -> index tree (3 levels), with known expected score.
	nodes = [
		{"key": "seqi", "type": "Index", "label": "SEQI", "parent_key": None},
		{"key": "rel", "type": "Dimension", "label": "Reliability", "parent_key": "seqi", "weight": 60},
		{"key": "ass", "type": "Dimension", "label": "Assurance", "parent_key": "seqi", "weight": 40},
		{"key": "m1", "type": "Metric", "parent_key": "rel", "weight": 50, "source_metric": "M1", "normalisation": "Likert 1-5 to 0-100"},
		{"key": "m2", "type": "Metric", "parent_key": "rel", "weight": 50, "source_metric": "M2", "normalisation": "Likert 1-5 to 0-100"},
		{"key": "m3", "type": "Metric", "parent_key": "ass", "weight": 100, "source_metric": "M3", "normalisation": "Yes/No to 100/0"},
	]
	# M1=5->100, M2=3->50  => rel = (100*50 + 50*50)/100 = 75
	# M3=1->100            => ass = 100
	# seqi = (75*60 + 100*40)/100 = 85
	out = compute_index(nodes, {"M1": 5, "M2": 3, "M3": 1})
	assert out["value"] == 85, out["value"]

	by_key = {b["key"]: b for b in out["breakdown"]}
	assert by_key["m1"]["raw_value"] == 5 and by_key["m1"]["value"] == 100
	assert by_key["rel"]["value"] == 75
	# rel contributes 75 * 60/100 = 45 toward SEQI
	assert abs(by_key["rel"]["contribution"] - 45) < 1e-9


def test_partial_coverage():
	# One metric missing: dimension still scores on the present one.
	nodes = [
		{"key": "idx", "type": "Index", "parent_key": None},
		{"key": "m1", "type": "Metric", "parent_key": "idx", "weight": 50, "source_metric": "A", "normalisation": "Likert 1-5 to 0-100"},
		{"key": "m2", "type": "Metric", "parent_key": "idx", "weight": 50, "source_metric": "B", "normalisation": "Likert 1-5 to 0-100"},
	]
	out = compute_index(nodes, {"A": 5})  # B missing
	assert out["value"] == 100  # only A present -> 100


if __name__ == "__main__":
	test_normalise()
	test_weighted_score()
	test_weights_valid()
	test_compute_index()
	test_partial_coverage()
	print("index engine: all checks passed")
