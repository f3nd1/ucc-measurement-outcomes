"""Bench-free check that every index template is structurally sound.
Run: `python test_index_templates.py`
"""

try:
	from index_templates import (
		SCALES, build_nodes, template_clause, template_codes, template_description,
	)
	from index_engine import weights_valid
except ImportError:  # pragma: no cover
	from ucc_measurement_outcomes.index_templates import (
		SCALES, build_nodes, template_clause, template_codes, template_description,
	)
	from ucc_measurement_outcomes.index_engine import weights_valid

EXPECTED = {"SEQI", "SAPI", "ESI", "TEI", "FSI", "QIPI", "API"}

# Transcribed from reference-documents/01-...-workflow.pdf pp. 205-210. Asserted
# here so a future edit to _T that drifts from the governing document fails,
# rather than quietly shipping a second set of invented weights.
FROM_THE_DOCUMENT = {
	"API": [("Financial Perspective", 22), ("Customer Perspective", 22),
	        ("Internal Processes Perspective", 22),
	        ("Innovation and Learning Perspective", 22),
	        ("CSR Impact Perspective", 6), ("Risk Management Perspective", 6)],
	"SAPI": [("Attrition Rate", 30), ("Passing Rate", 30),
	         ("Quality of Passes", 20), ("Graduation Rate", 20)],
	"SEQI": [("Reliability", 20), ("Assurance", 15), ("Tangibles", 20),
	         ("Empathy", 15), ("Responsiveness", 15), ("Outcome Alignment", 15)],
	"FSI": [("Liquidity Ratio", 35), ("Debt-Equity Ratio", 35), ("Credit Rating", 30)],
	"QIPI": [("QIPI", 100)],
	"ESI": [("Staff Satisfaction Index", 20), ("HR Policy Effectiveness Index", 15),
	        ("Professional Development Impact Index", 15),
	        ("Resource and Facility Adequacy Index", 10),
	        ("Staff Engagement Index", 15), ("Staff Turnover Index", 10),
	        ("Communication Effectiveness Index", 10),
	        ("Teaching and Learning Resources Index", 3),
	        ("Assessment Strategies and Alignment Index", 2)],
	"TEI": [("Training Needs Alignment", 10), ("Training Participation Score", 15),
	        ("Training Satisfaction Score", 15), ("Knowledge Retention Rate", 20),
	        ("Application of Skills", 25), ("Training ROE", 15)],
}
CLAUSES = {"API": "GD4 7.1.1", "SAPI": "GD4 7.2.1", "SEQI": "GD4 7.2.2",
           "FSI": "GD4 7.2.3", "QIPI": "GD4 6.3.1/7.2.3",
           "ESI": "GD4 7.2.4", "TEI": "GD4 7.2.4"}


def test_matches_the_governing_document():
	for code, expected in FROM_THE_DOCUMENT.items():
		got = [(n["label"], n["weight"]) for n in build_nodes(code) if n["parent_key"]]
		assert got == expected, (code, got)
		assert template_clause(code) == CLAUSES[code], code
	assert set(SCALES) == EXPECTED
	# The three read on a 0-5 scale must say so; the app still calculates 0-100.
	for code in ("SEQI", "FSI", "ESI", "TEI"):
		assert "0-5" in template_description(code), code
		assert "1 + score/25" in template_description(code), code
	assert "0-5" not in template_description("SAPI")


def test_all_templates_present():
	assert set(template_codes()) == EXPECTED


def test_each_template_wellformed():
	for code in template_codes():
		nodes = build_nodes(code)
		roots = [n for n in nodes if not n["parent_key"]]
		assert len(roots) == 1, code                         # exactly one root
		assert roots[0]["node_type"] == "Index", code
		# every non-root node's parent exists
		keys = {n["node_key"] for n in nodes}
		for n in nodes:
			if n["parent_key"]:
				assert n["parent_key"] in keys, (code, n["node_key"])
		# children weights total 100 per parent
		by_parent = {}
		for n in nodes:
			if n["parent_key"]:
				by_parent.setdefault(n["parent_key"], []).append(n["weight"])
		for parent, weights in by_parent.items():
			assert weights_valid(weights), (code, parent, sum(weights))


if __name__ == "__main__":
	test_all_templates_present()
	test_each_template_wellformed()
	print("index templates: all checks passed")
