# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Bench-free checks for dashboard export. Run: `python3 test_dashboard_export.py`"""

try:
	from ucc_measurement_outcomes.dashboard_export import (
		describe_filters, to_html, to_table,
	)
	from ucc_measurement_outcomes.explorer_agg import to_csv
except ImportError:
	from dashboard_export import describe_filters, to_html, to_table
	from explorer_agg import to_csv

DATA = {
	"kpis": [{"index": "SEQI", "index_version": "SEQI-V03", "period": "2026 S1",
			  "entity": None, "value": 76.253, "target": 75, "delta": 1.25}],
	"contribution": [
		{"component_key": "rel", "component_label": "Reliability", "index": "SEQI",
		 "source_metric": "SEQI_REL", "normalised_value": 75.0, "weight": 20, "contribution": 15.0},
		{"component_key": "tan", "component_label": "Tangibles", "index": "SEQI",
		 "source_metric": "SEQI_TAN", "normalised_value": 65.0, "weight": 20, "contribution": 13.0},
	],
	"trend": [{"period": "2025 S2", "value": 71.0, "target": 75},
			  {"period": "2026 S1", "value": 76.25, "target": 75}],
	"weak_areas": {"indices": [], "threshold": 70,
				   "components": [{"component_label": "Tangibles", "component_key": "tan",
								   "source_metric": "SEQI_TAN", "normalised_value": 65.0}]},
}


def test_the_csv_writer_is_the_existing_one():
	# to_table produces exactly the shape explorer_agg.to_csv consumes, so the
	# app has one CSV writer rather than a second implementation.
	text = to_csv(to_table(DATA, "kpis"), "Index")
	lines = text.strip().splitlines()
	assert lines[0] == "Index,Index Version,Period,Entity,Value,Target,Delta", lines[0]
	assert lines[1].startswith("SEQI,SEQI-V03,2026 S1,,76.25,75,1.25"), lines[1]


def test_each_section_keeps_one_meaning_per_column():
	# Stacking sections into one sheet would put four different meanings under
	# one header, so each is exported separately.
	assert to_table(DATA, "contribution")["columns"] == [
		"Index", "Metric", "Normalised", "Weight", "Contribution"]
	assert to_table(DATA, "trend")["columns"] == ["Value", "Target"]
	assert [r["row"] for r in to_table(DATA, "trend")["rows"]] == ["2025 S2", "2026 S1"]


def test_weak_areas_name_which_kind_of_weakness():
	rows = to_table(DATA, "weak")["rows"]
	assert len(rows) == 1
	assert rows[0]["row"] == "Tangibles"
	assert rows[0]["cells"]["Type"] == "Component below 70"


def test_floats_are_rounded_not_dumped_raw():
	assert to_table(DATA, "kpis")["rows"][0]["cells"]["Value"] == 76.25


def test_empty_dashboard_exports_headers_not_a_crash():
	empty = to_csv(to_table({"kpis": []}, "kpis"), "Index").strip().splitlines()
	assert len(empty) == 1 and empty[0].startswith("Index,")


def test_unknown_section_is_refused():
	try:
		to_table(DATA, "everything")
	except ValueError as e:
		assert "everything" in str(e)
	else:
		raise AssertionError("an unknown section must not silently export nothing")


def test_filters_are_described_in_words():
	# A report that does not say what it was filtered to is unreadable as
	# evidence: the same numbers mean different things per programme.
	assert describe_filters({}) .startswith("No filters applied")
	assert describe_filters({"index": "SEQI", "period": "2026 S1"}) == "Index: SEQI · Period: 2026 S1"
	assert "None" not in describe_filters({"index": "SEQI", "entity": None})


def test_html_is_a_report_not_a_dump():
	html = to_html(DATA, {"index": "SEQI"}, "26 Jul 2026")
	for expected in ("SEQI", "Index: SEQI", "26 Jul 2026", "Contribution by component",
					 "Trend by period", "Weak areas", "Reliability"):
		assert expected in html, expected
	# The visuals travel as CSS bars - no chart library, no screenshot.
	assert "<div class='bars'>" in html and "width:100%" in html


def test_html_states_that_historical_data_is_excluded():
	html = to_html(DATA, {}, "26 Jul 2026")
	assert "never included in a calculated result" in html


def test_html_escapes_content():
	evil = {"kpis": [{"index": "<script>x</script>", "value": 1, "target": 1}],
			"contribution": [], "trend": [], "weak_areas": {}}
	assert "<script>" not in to_html(evil, {}, "now")


if __name__ == "__main__":
	for name, fn in sorted(globals().items()):
		if name.startswith("test_") and callable(fn):
			fn()
	print("dashboard export: all checks passed")
