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
	for b in result["breakdown"]:
		doc.append("breakdown", {
			"component_key": b["key"],
			"component_label": b["label"],
			"source_metric": b.get("source_metric"),
			"raw_value": b["raw_value"],
			"normalised_value": b["value"],
			"weight": b["weight"],
			"contribution": b["contribution"],
		})
	doc.insert()
	return doc.name
