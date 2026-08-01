"""Bench-free unit checks for the index scoring engine.
Run: `python test_index_engine.py`
"""

from index_engine import (
	compute_index,
	normalise,
	structural_issues,
	structural_warnings,
	weighted_score,
	weights_valid,
)


def test_normalise():
	assert normalise(1, "Likert 1-5 to 0-100") == 0
	assert normalise(3, "Likert 1-5 to 0-100") == 50
	assert normalise(5, "Likert 1-5 to 0-100") == 100
	assert normalise(6, "Likert 1-5 to 0-100") == 100        # clamped
	assert normalise(5, "Likert 1-5 to 0-100", reverse=True) == 0
	assert normalise(1, "Yes/No to 100/0") == 100
	assert normalise(0, "Yes/No to 100/0") == 0
	# The builder stores the WORD for a Yes / No question, not a digit.
	for yes in ("Yes", "yes", " YES ", "true", "Y"):
		assert normalise(yes, "Yes/No to 100/0") == 100, yes
	for no in ("No", "no", "false", "N"):
		assert normalise(no, "Yes/No to 100/0") == 0, no
	assert normalise("Yes", "Yes/No to 100/0", reverse=True) == 0
	# Anything outside the vocabulary still refuses to score rather than guessing.
	assert normalise("Maybe", "Yes/No to 100/0") is None
	assert normalise(30, "Reverse 0-100") == 70
	assert normalise(0.8, "Ratio to Percentage") == 80
	assert normalise(7, "Hours") == 7                         # raw, not scored
	assert normalise("x", "Category Only (No Score)") is None
	assert normalise(None, "Likert 1-5 to 0-100") is None
	# Unknown/missing rule must refuse to score, not clamp raw into 0-100
	# (a Likert 4 with a lost rule used to become 4/100 — Pass 2 finding).
	assert normalise(4, None) is None
	assert normalise(4, "") is None
	assert normalise(4, "Some Future Rule") is None


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
	# Metric values are ALREADY normalised to 0-100 (index weights only).
	nodes = [
		{"key": "seqi", "type": "Index", "label": "SEQI", "parent_key": None},
		{"key": "rel", "type": "Dimension", "label": "Reliability", "parent_key": "seqi", "weight": 60},
		{"key": "ass", "type": "Dimension", "label": "Assurance", "parent_key": "seqi", "weight": 40},
		{"key": "m1", "type": "Metric", "parent_key": "rel", "weight": 50, "source_metric": "M1"},
		{"key": "m2", "type": "Metric", "parent_key": "rel", "weight": 50, "source_metric": "M2"},
		{"key": "m3", "type": "Metric", "parent_key": "ass", "weight": 100, "source_metric": "M3"},
	]
	# M1=100, M2=50  => rel = (100*50 + 50*50)/100 = 75
	# M3=100         => ass = 100
	# seqi = (75*60 + 100*40)/100 = 85
	out = compute_index(nodes, {"M1": 100, "M2": 50, "M3": 100})
	assert out["value"] == 85, out["value"]

	by_key = {b["key"]: b for b in out["breakdown"]}
	assert by_key["m1"]["raw_value"] == 100 and by_key["m1"]["value"] == 100
	assert by_key["rel"]["value"] == 75
	# rel contributes 75 * 60/100 = 45 toward SEQI
	assert abs(by_key["rel"]["contribution"] - 45) < 1e-9


def test_partial_coverage():
	# One metric missing: dimension still scores on the present one.
	nodes = [
		{"key": "idx", "type": "Index", "parent_key": None},
		{"key": "m1", "type": "Metric", "parent_key": "idx", "weight": 50, "source_metric": "A"},
		{"key": "m2", "type": "Metric", "parent_key": "idx", "weight": 50, "source_metric": "B"},
	]
	out = compute_index(nodes, {"A": 100})  # B missing
	assert out["value"] == 100  # only A present -> 100


def test_structural_issues():
	ok = [
		{"key": "idx", "parent_key": None},
		{"key": "a", "parent_key": "idx"},
		{"key": "b", "parent_key": "idx"},
	]
	assert structural_issues(ok) == []
	assert structural_issues([]) == ["Formula has no nodes."]
	# multiple roots: compute_index would silently score only the first
	two_roots = ok + [{"key": "idx2", "parent_key": None}]
	assert any("multiple root" in i for i in structural_issues(two_roots))
	# dangling parent: node would be silently excluded from the score
	dangling = ok + [{"key": "lost", "parent_key": "nowhere"}]
	assert any("missing parent" in i for i in structural_issues(dangling))
	# duplicate keys collapse in the children map
	dupes = ok + [{"key": "a", "parent_key": "idx"}]
	assert any("Duplicate node keys" in i for i in structural_issues(dupes))
	# cycle: unreachable from the root, silently ignored by compute_index
	cycle = ok + [{"key": "x", "parent_key": "y"}, {"key": "y", "parent_key": "x"}]
	assert any("Circular reference" in i for i in structural_issues(cycle))
	# self-parent is the smallest cycle
	selfp = ok + [{"key": "s", "parent_key": "s"}]
	assert any("Circular reference" in i for i in structural_issues(selfp))
	# no root at all (every node claims a parent)
	no_root = [{"key": "a", "parent_key": "b"}, {"key": "b", "parent_key": "a"}]
	issues = structural_issues(no_root)
	assert any("no root" in i for i in issues)
	# negative weights: weights_valid only checks the SUM, so 120 + (-20)
	# would otherwise publish as a "valid" 100 (Pass 2 finding)
	neg = [
		{"key": "idx", "parent_key": None},
		{"key": "a", "parent_key": "idx", "weight": 120},
		{"key": "b", "parent_key": "idx", "weight": -20},
	]
	assert any("Negative weights" in i for i in structural_issues(neg))
	assert weights_valid([120, -20])  # documents WHY the structural check exists


def test_structural_warnings():
	# A freshly added node sits at 0% - it must be reported but must NOT block
	# publishing, so it is a warning and structural_issues stays silent on it.
	nodes = [
		{"key": "idx", "parent_key": None, "type": "Index"},
		{"key": "a", "parent_key": "idx", "weight": 100, "type": "Metric",
		 "source_metric": "M1"},
		{"key": "new", "parent_key": "idx", "weight": 0, "type": "Metric"},
	]
	warnings = structural_warnings(nodes)
	assert any("0%" in w and "new" in w for w in warnings), warnings
	assert any("no source metric" in w and "new" in w for w in warnings), warnings
	# The blocking checks stay clean: 100 + 0 still totals 100.
	assert not structural_issues(nodes), structural_issues(nodes)
	assert weights_valid([100, 0])

	# The root is never flagged for having no weight - it has no siblings.
	assert not any("idx" in w for w in structural_warnings(
		[{"key": "idx", "parent_key": None, "weight": 0, "type": "Index"}]))

	# A fully wired formula warns about nothing.
	assert structural_warnings([
		{"key": "idx", "parent_key": None, "type": "Index"},
		{"key": "a", "parent_key": "idx", "weight": 100, "type": "Metric",
		 "source_metric": "M1"},
	]) == []


if __name__ == "__main__":
	test_normalise()
	test_weighted_score()
	test_weights_valid()
	test_compute_index()
	test_partial_coverage()
	test_structural_issues()
	test_structural_warnings()
	print("index engine: all checks passed")
