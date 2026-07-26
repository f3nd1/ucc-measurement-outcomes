# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Frappe-side index calculation service.

All arithmetic is delegated to the pure, unit-tested index_engine. This module
only loads nodes + metric values and writes an immutable UCC Index Result with
its score breakdown. Intended to run as a background job.
"""

import frappe
from frappe import _

from ucc_measurement_outcomes.index_engine import compute_index

INDEX_VERSION = "UCC Index Version"


def _node_dict(n):
	return {
		"key": n.node_key,
		"type": n.node_type,
		"label": n.label or n.node_key,
		"parent_key": n.parent_key or None,
		"weight": n.weight or 0,
		"source_metric": n.source_metric,
		"normalisation": n.normalisation,
		"reverse": bool(n.reverse_scored),
	}


def _load_metric_values(nodes, period, entity):
	# TODO: bench-verify - entity resolution depends on confirmed DocTypes.
	values = {}
	for n in nodes:
		if n["type"] != "Metric" or not n["source_metric"]:
			continue
		filters = {"metric": n["source_metric"]}
		if period:
			filters["period"] = period
		if entity:
			filters["entity"] = entity
		# Explicit order: "latest" must mean latest. A bare get_value has no
		# guaranteed ordering, so which of several results fed the index was
		# previously arbitrary (Pass 1 review finding).
		rows = frappe.get_all(
			"UCC Metric Result",
			filters=filters,
			fields=["value"],
			order_by="calculation_date desc",
			limit_page_length=1,
		)
		if rows and rows[0].value is not None:
			values[n["source_metric"]] = rows[0].value
	return values


def _lineage_snapshot(metric_codes):
	"""metric_code -> {objectives, clauses, questions} as they stand right now.

	Walks metric -> its source questions -> their objective mapping. A question
	can carry several objectives (5 of 265 in real data), so these are sets, and
	a metric spanning several objectives keeps all of them.
	"""
	codes = sorted(c for c in metric_codes if c)
	if not codes:
		return {}
	questions_by_metric = {}
	for src in frappe.get_all(
		"UCC Metric Source",
		filters={"parent": ["in", codes], "source_question": ["is", "set"]},
		fields=["parent", "source_question"],
	):
		questions_by_metric.setdefault(src["parent"], set()).add(src["source_question"])

	all_questions = sorted({q for qs in questions_by_metric.values() for q in qs})
	mapping = {}
	if all_questions:
		for m in frappe.get_all(
			"UCC Question Mapping",
			filters={"question": ["in", all_questions]},
			fields=["question", "objective", "primary_clause"],
		):
			entry = mapping.setdefault(m["question"], {"objectives": set(), "clauses": set()})
			if m.get("objective"):
				entry["objectives"].add(m["objective"])
			if m.get("primary_clause"):
				entry["clauses"].add(m["primary_clause"])

	out = {}
	for code in codes:
		questions = questions_by_metric.get(code, set())
		objectives, clauses = set(), set()
		for q in questions:
			hit = mapping.get(q)
			if hit:
				objectives |= hit["objectives"]
				clauses |= hit["clauses"]
		out[code] = {
			"objectives": sorted(objectives),
			"clauses": sorted(clauses),
			"questions": sorted(questions),
		}
	return out


def calculate_index(index_version, period=None, entity_type=None, entity=None, metric_values=None):
	"""Compute one immutable index result. metric_values may be supplied
	directly (e.g. for tests / fixtures); otherwise they are read from
	UCC Metric Result."""
	version = frappe.get_doc(INDEX_VERSION, index_version)
	if version.status != "Published":
		frappe.throw(_("Only Published index versions can be calculated (results tie to a frozen formula)."))

	nodes = [_node_dict(n) for n in version.nodes]
	if metric_values is None:
		metric_values = _load_metric_values(nodes, period, entity)

	result = compute_index(nodes, metric_values)

	doc = frappe.get_doc({
		"doctype": "UCC Index Result",
		"index": version.index,
		"index_version": version.name,
		"period": period,
		"entity_type": entity_type,
		"entity": entity,
		"value": result["value"],
		"target": frappe.db.get_value("UCC Index Definition", version.index, "target"),
	})
	lineage = _lineage_snapshot({b.get("source_metric") for b in result["breakdown"]})
	for b in result["breakdown"]:
		trace = lineage.get(b.get("source_metric"), {})
		doc.append("breakdown", {
			"component_key": b["key"],
			"component_label": b["label"],
			"source_metric": b.get("source_metric"),
			"raw_value": b["raw_value"],
			"normalised_value": b["value"],
			"weight": b["weight"],
			"contribution": b["contribution"],
			# Snapshotted with the numbers, not read live at report time. Question
			# Mapping keeps changing; without this an old result's lineage report
			# would reshape under it while its scores stayed fixed - and this
			# report is Criterion 7.1.1 evidence.
			"lineage_objectives": ", ".join(trace.get("objectives", [])),
			"lineage_clauses": ", ".join(trace.get("clauses", [])),
			"lineage_questions": ", ".join(trace.get("questions", [])),
		})
	doc.insert()
	return doc.name
