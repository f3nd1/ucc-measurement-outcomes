# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Bench-free checks for the lineage report. Run: `python3 test_lineage.py`"""

try:
	from ucc_measurement_outcomes.lineage import build_report
except ImportError:
	from lineage import build_report

RESULT = {
	"index": "SEQI", "index_version": "SEQI-V03", "period": "2026 S1",
	"value": 76.25, "target": 75, "calculation_date": "2026-07-24 09:00:00",
}
# Root and dimension carry no metric; the two leaves do. SEQI_EMP traces to two
# objectives - the real multi-objective case.
BREAKDOWN = [
	{"component_key": "seqi", "component_label": "SEQI", "source_metric": None,
	 "normalised_value": 76.25, "weight": 0, "contribution": 0},
	{"component_key": "rel", "component_label": "Reliability", "source_metric": "SEQI_REL",
	 "normalised_value": 75.0, "weight": 20, "contribution": 15.0,
	 "lineage_objectives": "OBJ-0406", "lineage_clauses": "GD4_4.5.1.1",
	 "lineage_questions": "q3"},
	{"component_key": "emp", "component_label": "Empathy", "source_metric": "SEQI_EMP",
	 "normalised_value": 80.0, "weight": 15, "contribution": 12.0,
	 "lineage_objectives": "OBJ-0406, OBJ-0412", "lineage_clauses": "GD4_4.2.1.1",
	 "lineage_questions": "q4"},
	{"component_key": "tan", "component_label": "Tangibles", "source_metric": "SEQI_TAN",
	 "normalised_value": 65.0, "weight": 20, "contribution": 13.0,
	 "lineage_objectives": "", "lineage_clauses": "", "lineage_questions": ""},
]
TEXT = {"q3": "I could access support services", "q4": "Staff understood my needs"}


def test_a_shared_component_is_never_split():
	r = build_report(RESULT, BREAKDOWN, TEXT)
	rows = {o["code"]: o["rows"] for o in r["objectives"]}
	emp_in_406 = next(x for x in rows["OBJ-0406"] if x["component"]["key"] == "emp")
	emp_in_412 = next(x for x in rows["OBJ-0412"] if x["component"]["key"] == "emp")
	# Same full number under both, never halved.
	assert emp_in_406["component"]["contribution"] == 12.0
	assert emp_in_412["component"]["contribution"] == 12.0
	assert emp_in_406["shared_with"] == ["OBJ-0412"]
	assert "shared" in emp_in_406["note"] and "OBJ-0412" in emp_in_406["note"]


def test_an_unshared_component_carries_no_note():
	r = build_report(RESULT, BREAKDOWN, TEXT)
	rel = next(x for o in r["objectives"] if o["code"] == "OBJ-0406"
			   for x in o["rows"] if x["component"]["key"] == "rel")
	assert rel["shared_with"] == [] and rel["note"] is None


def test_objectives_expose_no_total():
	# Any per-objective sum would double-count the shared component or require
	# splitting a number nobody calculated.
	for o in build_report(RESULT, BREAKDOWN, TEXT)["objectives"]:
		assert "total" not in o and "contribution" not in o, o.keys()


def test_untraceable_components_are_reported_with_a_reason():
	r = build_report(RESULT, BREAKDOWN, TEXT)
	assert len(r["untraceable"]) == 1
	u = r["untraceable"][0]
	assert u["component"]["key"] == "tan"
	assert u["component"]["contribution"] == 13.0, "the number must still be shown"
	assert u["reason"] == "metric has no source questions"


def test_a_metric_with_questions_but_no_objective_says_which():
	bd = [dict(BREAKDOWN[3], lineage_questions="q9")]
	u = build_report(RESULT, bd)["untraceable"][0]
	assert u["reason"] == "source questions map to no objective"


def test_structural_nodes_are_not_treated_as_gaps():
	# The index root has no metric by design; it is not an untraceable leaf.
	r = build_report(RESULT, BREAKDOWN, TEXT)
	assert all(u["component"]["key"] != "seqi" for u in r["untraceable"])


def test_question_text_is_resolved_but_never_changes_structure():
	r = build_report(RESULT, BREAKDOWN, TEXT)
	rel = next(x for o in r["objectives"] if o["code"] == "OBJ-0406"
			   for x in o["rows"] if x["component"]["key"] == "rel")
	assert rel["questions"] == [{"name": "q3", "text": "I could access support services"}]
	# Missing text falls back to the name rather than dropping the row.
	r2 = build_report(RESULT, BREAKDOWN, {})
	rel2 = next(x for o in r2["objectives"] if o["code"] == "OBJ-0406"
				for x in o["rows"] if x["component"]["key"] == "rel")
	assert rel2["questions"] == [{"name": "q3", "text": "q3"}]


def test_pre_snapshot_results_are_flagged_not_shown_as_empty():
	# Results calculated before the snapshot fields existed carry no lineage.
	# That is "never recorded", not "nothing traces" - the report must not
	# present the two identically.
	old = [{"component_key": "rel", "source_metric": "SEQI_REL",
			"normalised_value": 75.0, "weight": 20, "contribution": 15.0}]
	assert build_report(RESULT, old)["snapshot_complete"] is False
	assert build_report(RESULT, BREAKDOWN, TEXT)["snapshot_complete"] is False  # tan has none
	full = [b for b in BREAKDOWN if b["component_key"] != "tan"]
	assert build_report(RESULT, full, TEXT)["snapshot_complete"] is True


def test_header_carries_the_calculation_date():
	# The report is part snapshot, part display lookup; the date is what tells a
	# reader which moment the numbers belong to.
	h = build_report(RESULT, BREAKDOWN, TEXT)["header"]
	assert h["calculation_date"] == "2026-07-24 09:00:00"
	assert h["value"] == 76.25 and h["target"] == 75


if __name__ == "__main__":
	for name, fn in sorted(globals().items()):
		if name.startswith("test_") and callable(fn):
			fn()
	print("lineage: all checks passed")
