"""Bench-free check that every index template is structurally sound.
Run: `python test_index_templates.py`
"""

try:
	from index_templates import build_nodes, template_codes
	from index_engine import weights_valid
except ImportError:  # pragma: no cover
	from ucc_measurement_outcomes.index_templates import build_nodes, template_codes
	from ucc_measurement_outcomes.index_engine import weights_valid

EXPECTED = {"SEQI", "SAPI", "ESI", "TEI", "FSI", "QIPI", "API"}


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
