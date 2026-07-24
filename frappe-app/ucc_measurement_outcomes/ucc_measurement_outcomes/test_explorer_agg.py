"""Bench-free unit check for the Data Explorer aggregation.
Run: `python test_explorer_agg.py`
"""

from explorer_agg import aggregate, to_csv

ROWS = [
	{"prog": "AI", "term": "T1", "score": 80},
	{"prog": "AI", "term": "T1", "score": 90},
	{"prog": "AI", "term": "T2", "score": 70},
	{"prog": "Biz", "term": "T1", "score": 60},
]


def test_avg_pivot():
	t = aggregate(ROWS, "prog", "term", "avg", "score")
	assert t["columns"] == ["T1", "T2"]
	cells = {r["row"]: r["cells"] for r in t["rows"]}
	assert cells["AI"]["T1"] == 85            # (80+90)/2
	assert cells["AI"]["T2"] == 70
	assert cells["Biz"]["T1"] == 60
	assert cells["Biz"]["T2"] is None         # no Biz/T2 rows


def test_count_no_column():
	t = aggregate(ROWS, "prog", None, "count", None)
	assert t["columns"] == ["Total"]
	cells = {r["row"]: r["cells"] for r in t["rows"]}
	assert cells["AI"]["Total"] == 3
	assert cells["Biz"]["Total"] == 1


def test_csv():
	t = aggregate(ROWS, "prog", "term", "avg", "score")
	csv_text = to_csv(t, "Programme")
	lines = csv_text.strip().splitlines()
	assert lines[0] == "Programme,T1,T2"
	assert lines[1] == "AI,85.0,70.0"        # avg returns floats


if __name__ == "__main__":
	test_avg_pivot()
	test_count_no_column()
	test_csv()
	print("explorer agg: all checks passed")
