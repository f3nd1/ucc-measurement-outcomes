"""Starter index templates (structure / node graph only — no real data wiring).

Each template is a root Index node plus weighted component children (weights
total 100 per parent). Metric-style leaves carry a placeholder source_metric
code to hint the intended wiring; dimension leaves are attached to metrics later
in Index Studio. Frappe-free so the weight totals are unit-tested
(test_index_templates.py); instantiated into real Draft records by
api/index_studio.create_index_from_template.
"""

# code -> {name, target, components:[(label, weight, source_metric or None, node_type)]}
_T = {
	"SEQI": ("Student Experience Quality Index", 4.2, "Dimension", [
		("Reliability", 20, None), ("Assurance", 15, None), ("Tangibles", 20, None),
		("Empathy", 15, None), ("Responsiveness", 15, None), ("Outcome Alignment", 15, None),
	]),
	"SAPI": ("Student Academic Performance Index", 75, "Metric", [
		("Attrition Rate (reverse)", 30, "SAPI_ATTRITION"), ("Passing Rate", 30, "SAPI_PASSING"),
		("Quality of Passes", 20, "SAPI_QUALITY"), ("Graduation Rate", 20, "SAPI_GRADUATION"),
	]),
	"ESI": ("Employee Satisfaction Index", 75, "Metric", [
		("Engagement", 25, "ESI_ENGAGEMENT"), ("Compensation & Benefits", 20, "ESI_COMPENSATION"),
		("Work Environment", 20, "ESI_ENVIRONMENT"), ("Management Support", 20, "ESI_MANAGEMENT"),
		("Growth & Development", 15, "ESI_GROWTH"),
	]),
	"TEI": ("Training Effectiveness Index", 75, "Metric", [
		("Reaction", 20, "TEI_REACTION"), ("Learning", 30, "TEI_LEARNING"),
		("Behaviour", 30, "TEI_BEHAVIOUR"), ("Results", 20, "TEI_RESULTS"),
	]),
	"FSI": ("Financial Sustainability Index", 75, "Metric", [
		("Revenue Growth", 30, "FSI_REVENUE"), ("Surplus Margin", 30, "FSI_SURPLUS"),
		("Liquidity", 20, "FSI_LIQUIDITY"), ("Cost Efficiency", 20, "FSI_COST"),
	]),
	"QIPI": ("Quality and Innovation Performance Index", 75, "Metric", [
		("Quality Compliance", 30, "QIPI_COMPLIANCE"), ("Innovation Output", 25, "QIPI_INNOVATION"),
		("Process Improvement", 25, "QIPI_PROCESS"), ("Stakeholder Satisfaction", 20, "QIPI_STAKEHOLDER"),
	]),
	# Aggregated Performance Index rolls up the tactical indices. Components point
	# at index codes as placeholder metrics; feeding index results into an index is
	# real wiring to confirm later.
	"API": ("Aggregated Performance Index", 75, "Metric", [
		("Student Experience (SEQI)", 30, "SEQI"), ("Student Academic (SAPI)", 30, "SAPI"),
		("Employee Satisfaction (ESI)", 15, "ESI"), ("Training Effectiveness (TEI)", 10, "TEI"),
		("Financial Sustainability (FSI)", 10, "FSI"), ("Quality & Innovation (QIPI)", 5, "QIPI"),
	]),
}


def template_codes():
	return list(_T.keys())


def template_meta():
	"""(code, name) pairs for a UI picker."""
	return [{"code": c, "name": _T[c][0]} for c in _T]


def build_nodes(code):
	"""Return node dicts ready to append to a UCC Index Version.
	Root index node (key = code lowercased) + weighted component children."""
	if code not in _T:
		raise KeyError(code)
	name, _target, comp_type, components = _T[code]
	root = code.lower()
	nodes = [{"node_key": root, "node_type": "Index", "label": name,
			  "parent_key": None, "weight": 0, "source_metric": None}]
	for i, (label, weight, metric) in enumerate(components):
		nodes.append({
			"node_key": f"{root}_{i}", "node_type": comp_type, "label": label,
			"parent_key": root, "weight": weight, "source_metric": metric,
		})
	return nodes


def template_target(code):
	return _T[code][1]
