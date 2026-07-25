# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Read-only whitelisted endpoints for UCC Dashboard Studio.

Reads only this app's own result DocTypes (UCC Index Result + Score Breakdown),
so it is bench-safe. Simple KPI tiles could later move to native Frappe Number
Cards; the contribution / target-vs-actual views stay custom.
"""

import frappe
from frappe import _

RESULT = "UCC Index Result"


def _require_read():
	if not frappe.has_permission(RESULT, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


def _latest_per_index(results):
	seen = {}
	for r in results:  # results are newest-first
		if r["index"] in seen:
			continue
		delta = None
		if r["value"] is not None and r["target"] is not None:
			delta = round(r["value"] - r["target"], 2)
		seen[r["index"]] = {
			"index": r["index"], "value": r["value"], "target": r["target"],
			"delta": delta, "period": r["period"], "entity": r["entity"],
			# Finding 4: the exact published formula behind this number, so the
			# UI can trace back to it instead of guessing a link.
			"index_version": r["index_version"],
		}
	return list(seen.values())


def _trend(results, index):
	rows = [r for r in results if not index or r["index"] == index]
	# TODO: bench-verify - period is free-text Data; sorted lexicographically for
	# now. Sort by a real period order once the period structure is confirmed.
	rows = sorted(rows, key=lambda r: (r["period"] or ""))
	return [{"period": r["period"], "value": r["value"], "target": r["target"]} for r in rows]


def _contribution(results):
	if not results:
		return []
	latest = results[0]
	rows = frappe.get_all(
		"UCC Score Breakdown",
		filters={"parent": latest["name"], "parenttype": RESULT},
		fields=["component_key", "component_label", "normalised_value", "weight", "contribution"],
		order_by="idx asc",
	)
	# Finding 4: component_key is the index node key; pair it with the version it
	# was calculated from so a trace link points at a real node, not a guess.
	for r in rows:
		r["index_version"] = latest["index_version"]
	return rows


def _comparison(results, index):
	rows = [r for r in results if not index or r["index"] == index]
	seen = {}
	for r in rows:  # newest-first: keep latest per entity
		key = r["entity"] or "—"
		if key not in seen:
			seen[key] = {"entity": key, "value": r["value"], "period": r["period"]}
	return list(seen.values())


# Weak-area threshold: a normalised component below this is flagged (0-100).
WEAK_THRESHOLD = 60

# Named dimensions from the brief. They map onto the generic entity_type field.
# TODO: bench-verify - true simultaneous multi-dimensional filtering (programme
# AND teacher AND intake) needs results dimensioned by real Student/Programme/
# Module/Instructor DocTypes; here they are single-dimension via entity_type.
NAMED_DIMENSIONS = ["Programme", "Intake", "Module", "Teacher", "Department", "Student Type"]


def _weak_areas(kpis, contribution):
	weak_indices = [k for k in kpis if k["delta"] is not None and k["delta"] < 0]
	weak_components = [
		c for c in contribution
		if c.get("normalised_value") is not None and c["normalised_value"] < WEAK_THRESHOLD
	]
	return {"indices": weak_indices, "components": weak_components, "threshold": WEAK_THRESHOLD}


@frappe.whitelist()
def get_dashboard_data(index=None, index_version=None, period=None, entity_type=None, entity=None):
	_require_read()
	filters = {}
	for k, v in (("index", index), ("index_version", index_version), ("period", period),
				 ("entity_type", entity_type), ("entity", entity)):
		if v:
			filters[k] = v
	results = frappe.get_all(
		RESULT,
		filters=filters,
		fields=["name", "index", "index_version", "period", "entity", "entity_type",
				"value", "target", "calculation_date"],
		order_by="calculation_date desc",
	)
	kpis = _latest_per_index(results)
	contribution = _contribution(results)
	return {
		"kpis": kpis,
		"trend": _trend(results, index),
		"contribution": contribution,
		"comparison": _comparison(results, index),
		"weak_areas": _weak_areas(kpis, contribution),
		"result_count": len(results),
	}


@frappe.whitelist()
def dashboard_filters():
	_require_read()

	def distinct(field):
		return sorted({r[field] for r in frappe.get_all(RESULT, fields=[field]) if r.get(field)})

	# Surface the brief's named dimensions alongside any entity_types present in data.
	entity_types = sorted(set(NAMED_DIMENSIONS) | set(distinct("entity_type")))
	return {
		"indexes": distinct("index"),
		"index_versions": distinct("index_version"),
		"periods": distinct("period"),
		"entity_types": entity_types,
		"entities": distinct("entity"),
	}
