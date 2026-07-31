# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Whitelisted endpoints for Index Studio (builder, validation, calculation)."""

import json

import frappe
from frappe import _

from ucc_measurement_outcomes.index_engine import (
	structural_issues,
	structural_warnings,
	weights_valid,
)
from ucc_measurement_outcomes import index_templates
from ucc_measurement_outcomes.index_calc import _lineage_snapshot, calculate_index

INDEX_VERSION = "UCC Index Version"
INDEX_DEF = "UCC Index Definition"


def _require(index_version, ptype):
	if not frappe.has_permission(INDEX_VERSION, ptype, doc=index_version):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


@frappe.whitelist()
def list_index_templates():
	return index_templates.template_meta()


@frappe.whitelist()
def create_index_from_template(template_code):
	"""Instantiate a starter index: ensure the Index Definition exists, then
	create a new Draft Version populated with the template's node graph."""
	if not frappe.has_permission(INDEX_VERSION, "create"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if template_code not in index_templates.template_codes():
		frappe.throw(_("Unknown template."))

	meta = {m["code"]: m["name"] for m in index_templates.template_meta()}
	if not frappe.db.exists(INDEX_DEF, template_code):
		frappe.get_doc({
			"doctype": INDEX_DEF, "index_code": template_code,
			"index_name": meta[template_code], "target": index_templates.template_target(template_code),
		}).insert()

	# Next free version number. count() alone collides after a deletion
	# (delete V01 of V01+V02 -> count 1 -> "next" V02 already exists ->
	# DuplicateEntry crash, Pass 2 finding). Probe until free.
	# ponytail: linear probe, fine at human version counts.
	n = frappe.db.count(INDEX_VERSION, {"index": template_code}) + 1
	while frappe.db.exists(INDEX_VERSION, f"{template_code}-V{n:02d}"):
		n += 1
	version = frappe.get_doc({
		"doctype": INDEX_VERSION, "index": template_code,
		"version_number": f"{n:02d}", "status": "Draft",
	})
	for n in index_templates.build_nodes(template_code):
		version.append("nodes", n)
	version.insert()
	return version.name


@frappe.whitelist()
def get_index_builder(index_version):
	_require(index_version, "read")
	version = frappe.get_doc(INDEX_VERSION, index_version)
	nodes = [
		{
			"node_key": n.node_key, "node_type": n.node_type, "label": n.label,
			"parent_key": n.parent_key, "source_metric": n.source_metric,
			"weight": n.weight, "normalisation": n.normalisation,
			"reverse_scored": n.reverse_scored, "pos_x": n.pos_x, "pos_y": n.pos_y,
		}
		for n in version.nodes
	]
	# Metric list for the inspector: source_metric was a free-text box, which made
	# a typo a silently unscored node. Also carries each metric's own
	# normalisation, because THAT is the rule that actually runs - the node's
	# normalisation field is informational (see docs/09-decision-log.md:
	# normalise once at the metric layer, the index applies weights only).
	metrics = frappe.get_all(
		"UCC Metric Definition",
		fields=["name", "metric_name", "default_normalisation"],
		order_by="name",
	)
	sources = frappe.get_all(
		"UCC Metric Source", fields=["parent", "normalisation"],
	)
	by_metric = {}
	for s in sources:
		by_metric.setdefault(s["parent"], set()).add(s["normalisation"] or None)
	for m in metrics:
		# A metric's sources may each override the default. One distinct rule =
		# that is the effective rule; several = the node cannot claim just one.
		rules = {r for r in by_metric.get(m["name"], set()) if r}
		m["effective_normalisation"] = (
			list(rules)[0] if len(rules) == 1 else (None if rules else m["default_normalisation"])
		)
		m["mixed_normalisation"] = len(rules) > 1
		m["source_count"] = len(by_metric.get(m["name"], set()))

	return {
		"name": version.name, "index": version.index, "status": version.status,
		"editable": not version.is_immutable, "nodes": nodes, "metrics": metrics,
	}


@frappe.whitelist()
def save_nodes(index_version, nodes):
	"""Replace the node set of a draft version (positions + weights + wiring)."""
	_require(index_version, "write")
	data = json.loads(nodes) if isinstance(nodes, str) else nodes
	version = frappe.get_doc(INDEX_VERSION, index_version)
	version.set("nodes", [])
	for n in data:
		version.append("nodes", {
			"node_key": n.get("node_key"),
			"node_type": n.get("node_type", "Metric"),
			"label": n.get("label"),
			"parent_key": n.get("parent_key"),
			"source_metric": n.get("source_metric"),
			"weight": n.get("weight") or 0,
			"normalisation": n.get("normalisation"),
			"reverse_scored": 1 if n.get("reverse_scored") else 0,
			"pos_x": n.get("pos_x") or 0,
			"pos_y": n.get("pos_y") or 0,
		})
	# Blocked by UCCIndexVersion.validate's frozen-formula guard when the version
	# is Published/Closed. (Before that guard existed, this comment was wrong and
	# a published formula WAS silently editable via this method.)
	version.save()
	return True


@frappe.whitelist()
def validate_index(index_version):
	"""Check formula structure (single root, no cycles, no dangling parents)
	and that each parent's child weights total 100%. publish_version calls
	this, so a structurally broken formula cannot be published."""
	_require(index_version, "read")
	version = frappe.get_doc(INDEX_VERSION, index_version)
	graph = [{"key": n.node_key, "parent_key": n.parent_key, "weight": n.weight,
			  "type": n.node_type, "source_metric": n.source_metric}
			 for n in version.nodes]
	issues = list(structural_issues(graph))
	# Warnings are reported but never block publish. A node added at 0% (which is
	# how nodes ARE added - we do not silently rebalance its siblings) is exactly
	# this case: harmless to the totals, contributing nothing, worth saying.
	warnings = list(structural_warnings(graph))
	groups = {}
	for n in version.nodes:
		groups.setdefault(n.parent_key or "__root__", []).append(n.weight or 0)
	for parent, weights in groups.items():
		if parent == "__root__":
			continue  # the root index node has no siblings to total
		if not weights_valid(weights):
			issues.append(_("Weights under '{0}' total {1}%, expected 100%.").format(parent, round(sum(weights), 2)))
	return {"valid": not issues, "issues": issues, "warnings": warnings}


@frappe.whitelist()
def publish_version(index_version):
	_require(index_version, "write")
	version = frappe.get_doc(INDEX_VERSION, index_version)
	check = validate_index(index_version)
	if not check["valid"]:
		frappe.throw(_("Cannot publish: {0}").format("; ".join(check["issues"])))
	version.status = "Published"
	version.save()
	return True


@frappe.whitelist()
def calculate(index_version, period=None, entity_type=None, entity=None, metric_values=None):
	"""Compute one result now and return its name.

	Synchronous, deliberately. It used to enqueue a background job and return
	{"queued": True} - which nothing could act on, which is part of why it had no
	caller for so long: a button that says "started something, somewhere" is not
	a button anyone can build a results panel around. The work is a handful of
	get_alls plus pure arithmetic, so there is nothing here worth a worker, and
	the queue itself was never bench-verified.

	Writes a UCC Index Result, so it needs create permission on that - read on
	the version is not enough to mint an immutable evidence record.
	"""
	_require(index_version, "read")
	if not frappe.has_permission("UCC Index Result", "create"):
		frappe.throw(_("You do not have permission to calculate results."), frappe.PermissionError)
	if isinstance(metric_values, str):
		metric_values = json.loads(metric_values)
	name = calculate_index(
		index_version=index_version, period=period, entity_type=entity_type,
		entity=entity, metric_values=metric_values,
	)
	return {"result": name}


@frappe.whitelist()
def list_results(index_version, limit=20):
	"""Calculation history for one version, newest first.

	`owner` and `creation` are Frappe's own - there is no separate log to invent,
	and a second record of who calculated what would be one more thing that can
	disagree with the framework.
	"""
	_require(index_version, "read")
	return frappe.get_all(
		"UCC Index Result",
		filters={"index_version": index_version},
		fields=["name", "period", "entity_type", "entity", "value", "target",
				"calculation_date", "owner", "creation"],
		order_by="creation desc",
		limit=int(limit),
	)


@frappe.whitelist()
def node_sources(index_version):
	"""{metric_code: {questions:[{name,text,survey_version}], objectives, clauses}}
	for every Metric node on this version.

	The lineage snapshot run FORWARD. Reuses index_calc._lineage_snapshot rather
	than re-walking metric -> question -> mapping, so what this panel shows and
	what gets frozen into UCC Score Breakdown at calculation time cannot drift
	apart - if they did, the panel would be quietly lying about the evidence.

	Live data, unlike the snapshot: this answers "what WOULD feed a calculation
	run now", which is the question you ask before pressing Calculate.
	"""
	_require(index_version, "read")
	version = frappe.get_doc(INDEX_VERSION, index_version)
	codes = {n.source_metric for n in version.nodes if n.source_metric}
	trace = _lineage_snapshot(codes)

	names = sorted({q for t in trace.values() for q in t["questions"]})
	detail = {
		q["name"]: q for q in frappe.get_all(
			"UCC Survey Question", filters={"name": ["in", names or [""]]},
			fields=["name", "question_text", "survey_version"])
	}
	out = {}
	for code, t in trace.items():
		out[code] = {
			"objectives": t["objectives"],
			"clauses": t["clauses"],
			"questions": [
				{"name": q, "text": (detail.get(q, {}).get("question_text") or q),
				 "survey_version": detail.get(q, {}).get("survey_version")}
				for q in t["questions"]
			],
		}
	# Named separately so a node pointing at a metric with no sources at all is
	# visible as such, rather than as an empty section that reads like a bug.
	return {"sources": out,
			"empty_metrics": sorted(c for c in codes if not trace.get(c, {}).get("questions"))}


@frappe.whitelist()
def get_result_breakdown(index_result):
	"""Explain-score drill-down for one result."""
	if not frappe.has_permission("UCC Index Result", "read", doc=index_result):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	doc = frappe.get_doc("UCC Index Result", index_result)
	return {
		"value": doc.value, "target": doc.target, "period": doc.period, "entity": doc.entity,
		"breakdown": [
			{
				"component_key": b.component_key, "component_label": b.component_label,
				"source_metric": b.source_metric, "raw_value": b.raw_value,
				"normalised_value": b.normalised_value, "weight": b.weight,
				"contribution": b.contribution,
			}
			for b in doc.breakdown
		],
	}
