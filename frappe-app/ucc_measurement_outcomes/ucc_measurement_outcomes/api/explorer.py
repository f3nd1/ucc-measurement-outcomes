# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Data Explorer API — an APPROVED DATASET CATALOGUE, never arbitrary SQL.

Every request is validated against DATASETS: only whitelisted doctypes,
dimensions, measures and filter fields are accepted. Rows are fetched with
frappe.get_all (parameterised) and pivoted by the pure explorer_agg module.
Nothing the caller sends is ever interpolated into a query.
"""

import json

import frappe
from frappe import _

from ucc_measurement_outcomes.explorer_agg import aggregate, to_csv

# measure name -> (aggregation, measured field or None for count)
DATASETS = {
	"Survey Answers": {
		"doctype": "UCC Survey Answer",
		"dimensions": ["survey_version", "question", "question_type"],
		"measures": {
			"Response Count": ("count", None),
			"Average Score": ("avg", "answer_numeric"),
		},
		"filters": ["survey_version", "question_type"],
	},
	"Metric Results": {
		"doctype": "UCC Metric Result",
		"dimensions": ["metric", "period", "entity_type", "entity"],
		"measures": {
			"Average Value": ("avg", "value"),
			"Total Responses": ("sum", "response_count"),
			"Average Coverage": ("avg", "coverage"),
			"Row Count": ("count", None),
		},
		"filters": ["metric", "period", "entity_type", "entity"],
	},
	"Index Results": {
		"doctype": "UCC Index Result",
		"dimensions": ["index", "period", "entity_type", "entity"],
		"measures": {
			"Average Value": ("avg", "value"),
			"Row Count": ("count", None),
		},
		"filters": ["index", "period", "entity_type", "entity"],
	},
	"Objective Mapping": {
		"doctype": "UCC Question Mapping",
		"dimensions": ["objective", "standard", "survey_version"],
		"measures": {"Row Count": ("count", None)},
		"filters": ["objective", "standard", "survey_version"],
	},
}


@frappe.whitelist()
def list_datasets():
	"""Catalogue metadata for the Explorer UI. Exposes only field names of our
	own DocTypes — safe."""
	return {
		name: {
			"dimensions": spec["dimensions"],
			"measures": list(spec["measures"].keys()),
			"filters": spec["filters"],
		}
		for name, spec in DATASETS.items()
	}


def _compute(dataset, measure, row=None, column=None, filters=None):
	spec = DATASETS.get(dataset)
	if not spec:
		frappe.throw(_("Unknown dataset."))
	if not frappe.has_permission(spec["doctype"], "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if measure not in spec["measures"]:
		frappe.throw(_("Unknown measure."))
	for dim in (row, column):
		if dim and dim not in spec["dimensions"]:
			frappe.throw(_("Dimension not allowed: {0}").format(dim))

	filters = json.loads(filters) if isinstance(filters, str) else (filters or {})
	safe_filters = {}
	for k, v in filters.items():
		if k not in spec["filters"]:
			frappe.throw(_("Filter not allowed: {0}").format(k))
		if v not in (None, ""):
			safe_filters[k] = v

	agg, field = spec["measures"][measure]
	fetch = set(f for f in (row, column, field) if f)
	rows = frappe.get_all(
		spec["doctype"],
		filters=safe_filters,
		fields=list(fetch) or ["name"],
		limit_page_length=0,
	)
	table = aggregate(rows, row, column, agg, field)
	return spec, table


@frappe.whitelist()
def run_analysis(dataset, measure, row=None, column=None, filters=None):
	_spec, table = _compute(dataset, measure, row, column, filters)
	return {"table": table, "row_label": row or dataset, "measure": measure}


@frappe.whitelist()
def export_analysis(dataset, measure, row=None, column=None, filters=None, fmt="csv"):
	"""Server-side, permission-checked export of the same analysis."""
	_spec, table = _compute(dataset, measure, row, column, filters)
	if fmt == "json":
		return {"filename": f"{dataset}.json", "content": frappe.as_json(table)}
	return {"filename": f"{dataset}.csv", "content": to_csv(table, row or "Row")}
