"""Bench-free END-TO-END contract walkthrough.

Proves the five workspaces connect as ONE system at the data/logic level, using
the real pure engines: raw survey answers -> metric value -> index score ->
explorer aggregate -> traceable breakdown back to the metric. This runs now
(no bench). The DB-level version is test_integration_chain.py (bench-run).

Run: `python test_chain_contract.py`
"""


def _imp(mod, name):
	try:
		return getattr(__import__(mod, fromlist=[name]), name)
	except ImportError:  # pragma: no cover
		return getattr(__import__("ucc_measurement_outcomes." + mod, fromlist=[name]), name)


aggregate_metric = _imp("metric_engine", "aggregate_metric")
compute_index = _imp("index_engine", "compute_index")
aggregate = _imp("explorer_agg", "aggregate")

LIKERT = "Likert 1-5 to 0-100"


def test_end_to_end():
	# 1) Survey Studio: three raw Likert answers to question Q_TEACH_CLARITY.
	answers = [
		{"value": 5, "normalisation": LIKERT},
		{"value": 3, "normalisation": LIKERT},
		{"value": 4, "normalisation": LIKERT},
	]
	# 2) Mapping Studio: Q_TEACH_CLARITY is a source of metric TEACHING_CLARITY.
	metric = aggregate_metric(answers)
	assert metric["value"] == 75           # (100+50+75)/3  -- normalised ONCE, here
	assert metric["response_count"] == 3

	# 3) Index Studio: SEQI weights the metric value (no re-normalisation).
	nodes = [
		{"key": "seqi", "type": "Index", "label": "SEQI", "parent_key": None},
		{"key": "tc", "type": "Metric", "label": "Teaching Clarity",
		 "parent_key": "seqi", "weight": 100, "source_metric": "TEACHING_CLARITY"},
	]
	index = compute_index(nodes, {"TEACHING_CLARITY": metric["value"]})
	assert index["value"] == 75            # weight-only; matches the metric value

	# 4) Dashboard/Explorer: aggregate the index result across entities.
	index_result_rows = [{"index": "SEQI", "value": index["value"]}]
	table = aggregate(index_result_rows, "index", None, "avg", "value")
	assert table["rows"][0]["cells"]["Total"] == 75

	# 5) Traceability: the index breakdown names the source metric and its value,
	#    so a dashboard drill-down leads straight back to TEACHING_CLARITY (75),
	#    which is the mean of the three answers above.
	leaf = [b for b in index["breakdown"] if b["key"] == "tc"][0]
	assert leaf["source_metric"] == "TEACHING_CLARITY"
	assert leaf["value"] == 75


if __name__ == "__main__":
	test_end_to_end()
	print("chain contract: end-to-end (answer -> metric -> index -> explorer -> trace) passed")
