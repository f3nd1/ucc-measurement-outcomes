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

REFERENCE_NOTE = (
	"Historical data collected before this app existed. Reference only - it is "
	"never read into a Metric Result or an Index Result, because 47% of its rows "
	"cannot be attributed to a specific question."
)

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
	"Survey Campaigns": {
		"doctype": "UCC Survey Campaign",
		"dimensions": ["survey_version", "status", "access_mode"],
		"measures": {
			"Row Count": ("count", None),
			"Target Responses": ("sum", "target_responses"),
		},
		"filters": ["survey_version", "status", "access_mode"],
	},
	"Submissions": {
		"doctype": "UCC Survey Submission",
		"dimensions": ["campaign", "survey_version", "status", "source"],
		"measures": {"Row Count": ("count", None)},
		"filters": ["campaign", "survey_version", "status", "source"],
	},
	# Historical educ_sg collection. VISIBLE FOR CONTEXT, NEVER SCOREABLE.
	# 1,104 of 2,339 rows (47%) cannot be attributed to a specific question by
	# any method tested - text matching, qn_no, or row position - so these
	# responses can be looked at but can never produce a Metric Result or an
	# Index Result. The enforcement lives in metric_calc.py; the flag here is
	# what makes the UI say so out loud.
	"Survey Responses (historical)": {
		"doctype": "Survey Response",
		"external": True,
		"reference": True,
		"note": REFERENCE_NOTE,
		# TODO: bench-verify - these come from Felix's field list, not from a
		# schema dump. `external` makes _compute check them against the real meta
		# before querying, so a wrong name is a legible error, not a 500.
		"dimensions": ["program", "course", "frequency"],
		"measures": {"Row Count": ("count", None)},
		"filters": ["program", "course", "frequency"],
	},
}

# Datasets from the brief that would read EXTERNAL DocTypes not yet confirmed on
# the bench. Listed so the UI shows them, but NOT queryable until wired.
# TODO: bench-verify - confirm each real DocType/field, then move into DATASETS.
PENDING_DATASETS = {
	"Student Records": {"doctype": "Student",
						"note": "Needs the real Student DocType (name + fields) confirmed on the bench."},
	"Programme Records": {"doctype": "Programme",
						  "note": "Needs the real Programme/Program DocType confirmed on the bench."},
	"Assessment Results": {"doctype": "Assessment Result",
						   "note": "Needs Assessment Result + grade/status fields confirmed."},
	"Graduate Outcomes": {"doctype": "(unconfirmed)",
						  "note": "No confirmed source yet; likely graduate/alumni answers plus an outcomes record."},
}


@frappe.whitelist()
def list_datasets():
	"""Catalogue metadata for the Explorer UI. Exposes only field names of our
	own DocTypes — safe. Pending datasets are listed but not queryable."""
	return {
		"datasets": {
			name: {
				"dimensions": spec["dimensions"],
				"measures": list(spec["measures"].keys()),
				"filters": spec["filters"],
				# Reference datasets are queryable but must be labelled as such,
				# so nobody reads a pivot of them as a score.
				"reference": bool(spec.get("reference")),
				"note": spec.get("note"),
			}
			for name, spec in DATASETS.items()
		},
		"pending": [
			{"name": n, "doctype": d["doctype"], "note": d["note"]}
			for n, d in PENDING_DATASETS.items()
		],
	}


def _assert_external_fields(spec):
	"""Datasets over DocTypes this app does not own are declared from a field
	list, not a schema dump. Two probes on this project have already died on a
	fieldname that turned out to be spelled differently, so check against the
	real meta and name the actual fields instead of failing inside a query."""
	real = {df.fieldname for df in frappe.get_meta(spec["doctype"]).fields}
	real.update({"name", "owner", "creation", "modified"})
	declared = set(spec["dimensions"]) | set(spec["filters"])
	declared.update(f for _agg, f in spec["measures"].values() if f)
	missing = sorted(declared - real)
	if missing:
		frappe.throw(
			_("Dataset '{0}' names fields that {1} does not have: {2}. Real fields: {3}").format(
				spec["doctype"], spec["doctype"], ", ".join(missing), ", ".join(sorted(real))
			)
		)


def _compute(dataset, measure, row=None, column=None, filters=None):
	if dataset in PENDING_DATASETS:
		frappe.throw(_("Dataset '{0}' needs its external DocType confirmed on the bench first.").format(dataset))
	spec = DATASETS.get(dataset)
	if not spec:
		frappe.throw(_("Unknown dataset."))
	if not frappe.has_permission(spec["doctype"], "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if spec.get("external"):
		_assert_external_fields(spec)
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
		if v in (None, ""):
			continue
		# Catalogue contract is simple equality filters. A list/dict value would
		# smuggle a frappe filter OPERATOR (like/in/between/…) past the catalogue.
		if not isinstance(v, (str, int, float)) or isinstance(v, bool):
			frappe.throw(_("Invalid filter value for {0}.").format(k))
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
