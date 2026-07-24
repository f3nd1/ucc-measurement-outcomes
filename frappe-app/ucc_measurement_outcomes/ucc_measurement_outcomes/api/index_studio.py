# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Whitelisted endpoints for Index Studio (builder, validation, calculation)."""

import json

import frappe
from frappe import _

from ucc_measurement_outcomes.index_engine import structural_issues, weights_valid
from ucc_measurement_outcomes import index_templates

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
	return {
		"name": version.name, "index": version.index, "status": version.status,
		"editable": not version.is_immutable, "nodes": nodes,
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
	issues = list(structural_issues(
		[{"key": n.node_key, "parent_key": n.parent_key, "weight": n.weight}
		 for n in version.nodes]
	))
	groups = {}
	for n in version.nodes:
		groups.setdefault(n.parent_key or "__root__", []).append(n.weight or 0)
	for parent, weights in groups.items():
		if parent == "__root__":
			continue  # the root index node has no siblings to total
		if not weights_valid(weights):
			issues.append(_("Weights under '{0}' total {1}%, expected 100%.").format(parent, round(sum(weights), 2)))
	return {"valid": not issues, "issues": issues}


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
	"""Enqueue a background calculation. Returns immediately."""
	_require(index_version, "read")
	if isinstance(metric_values, str):
		metric_values = json.loads(metric_values)
	# TODO: bench-verify - confirm the queue name / worker availability on the bench.
	frappe.enqueue(
		"ucc_measurement_outcomes.index_calc.calculate_index",
		queue="short",
		index_version=index_version,
		period=period,
		entity_type=entity_type,
		entity=entity,
		metric_values=metric_values,
	)
	return {"queued": True}


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
