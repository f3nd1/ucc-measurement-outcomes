"""The seven institutional index templates, transcribed from the governing document.

SOURCE OF TRUTH: `reference-documents/01-criterion-7-1-1-measurement-outcomes-workflow.pdf`,
the "Data Source / Performance Outcome Name / Indicator Metrics" tables
(pp. 205-210). Every component label, weight, clause and total score below is
that document's, not a plausible-looking invention. Before this, only SEQI and
SAPI matched it; ESI, TEI, FSI, QIPI and API had made-up components
("Reaction / Learning / Behaviour / Results" for TEI, "Revenue Growth" for FSI)
that exist nowhere in UCC's quality framework.

The PDFs ARE text-extractable (`pip install pymupdf`; see the transcription note
in docs/09-decision-log.md) - the long-standing "image-based, needs OCR" note in
CLAUDE.md was wrong, and it is what let the invented versions stand.

Each template is a root Index node plus weighted component children (weights
total 100 per parent - the weights are shares of the index, independent of the
scale the index is READ on). Metric-style leaves carry a placeholder
source_metric code to hint the intended wiring; they are deliberately left
unlinked at creation when the metric does not exist yet. Frappe-free so the
weight totals are unit-tested (test_index_templates.py); instantiated into real
Draft records by api/index_studio.create_index_from_template.
"""

# The scale the institution READS the index on ("Total Score" in the document).
# It is NOT a benchmark target and must never be written into
# UCC Index Definition.target, which is what the previous version did with
# invented numbers (SEQI 4.2, everything else 75). The app always calculates
# 0-100; this is the number a reader converts to.
SCALES = {"API": 100, "SAPI": 100, "SEQI": 5, "FSI": 5, "QIPI": 100, "ESI": 5, "TEI": 5}

# code -> (name, clause, component node type, [(label, weight, source_metric)])
_T = {
	# p.205 - all data from the Balanced Scorecard, hence perspectives not metrics.
	"API": ("Aggregated Performance Index", "GD4 7.1.1", "Dimension", [
		("Financial Perspective", 22, None),
		("Customer Perspective", 22, None),
		("Internal Processes Perspective", 22, None),
		("Innovation and Learning Perspective", 22, None),
		("CSR Impact Perspective", 6, None),
		("Risk Management Perspective", 6, None),
	]),
	# p.206 - Assessment Plan / Assessment Result / Quality Meeting counts.
	"SAPI": ("Student Academic Performance Index (Overall)", "GD4 7.2.1", "Metric", [
		("Attrition Rate", 30, "SAPI_ATTRITION"),
		("Passing Rate", 30, "SAPI_PASSING"),
		("Quality of Passes", 20, "SAPI_QUALITY"),
		("Graduation Rate", 20, "SAPI_GRADUATION"),
	]),
	# p.206 - End of Course / End of Module / HD Ticket / Module Review, all
	# 5-point Likert. Dimensions, because each is mapped from several questions.
	"SEQI": ("Student Experience Quality Index", "GD4 7.2.2", "Dimension", [
		("Reliability", 20, None),
		("Assurance", 15, None),
		("Tangibles", 20, None),
		("Empathy", 15, None),
		("Responsiveness", 15, None),
		("Outcome Alignment", 15, None),
	]),
	# p.207 - Audited Financial Statements (Ratio) + Credit Rating Report (Score).
	"FSI": ("Financial Sustainability Index", "GD4 7.2.3", "Metric", [
		("Liquidity Ratio", 35, "FSI_LIQUIDITY"),
		("Debt-Equity Ratio", 35, "FSI_DEBT_EQUITY"),
		("Credit Rating", 30, "FSI_CREDIT_RATING"),
	]),
	# p.207 - a single component at 100%, sourced from Quality Action. Not an
	# oversight in the transcription: the document really does define it that way.
	"QIPI": ("Quality & Innovation Performance Index", "GD4 6.3.1/7.2.3", "Metric", [
		("QIPI", 100, "QIPI_SCORE"),
	]),
	# p.208 - Staff Onboarding / Staff Survey / Exit Interview, 5-point Likert.
	"ESI": ("Employee Satisfaction Index", "GD4 7.2.4", "Dimension", [
		("Staff Satisfaction Index", 20, None),
		("HR Policy Effectiveness Index", 15, None),
		("Professional Development Impact Index", 15, None),
		("Resource and Facility Adequacy Index", 10, None),
		("Staff Engagement Index", 15, None),
		("Staff Turnover Index", 10, None),
		("Communication Effectiveness Index", 10, None),
		("Teaching and Learning Resources Index", 3, None),
		("Assessment Strategies and Alignment Index", 2, None),
	]),
	# p.209 - Training Hours / Staff Survey / TNA % / Exit Interview / Training
	# Feedback / Appraisal. "ROE" is the document's own abbreviation.
	"TEI": ("Training Effectiveness Index", "GD4 7.2.4", "Metric", [
		("Training Needs Alignment", 10, "TEI_NEEDS_ALIGNMENT"),
		("Training Participation Score", 15, "TEI_PARTICIPATION"),
		("Training Satisfaction Score", 15, "TEI_SATISFACTION"),
		("Knowledge Retention Rate", 20, "TEI_RETENTION"),
		("Application of Skills", 25, "TEI_APPLICATION"),
		("Training ROE", 15, "TEI_ROE"),
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
	name, _clause, comp_type, components = _T[code]
	root = code.lower()
	nodes = [{"node_key": root, "node_type": "Index", "label": name,
			  "parent_key": None, "weight": 0, "source_metric": None}]
	for i, (label, weight, metric) in enumerate(components):
		nodes.append({
			"node_key": f"{root}_{i}", "node_type": comp_type, "label": label,
			"parent_key": root, "weight": weight, "source_metric": metric,
		})
	return nodes


def template_description(code):
	"""What goes on the Index Definition: provenance, clause and how to read the
	score. No target - the document states a SCALE, and a benchmark nobody set is
	not ours to write onto an EduTrust evidence record."""
	name, clause, _t, components = _T[code]
	scale = SCALES[code]
	how = ("Calculated 0-100. The institutional scale is 0-{0}; the {0}-point "
	       "equivalent is 1 + score/25.".format(scale) if scale == 5
	       else "Calculated 0-100, matching the institutional scale.")
	return ("{0}. Clause {1}, {2} weighted components. {3} "
	        "Structure from the Criterion 7.1.1 measurement outcomes workflow "
	        "document; weights are the institution's.").format(
		name, clause, len(components), how)


def template_clause(code):
	return _T[code][1]
