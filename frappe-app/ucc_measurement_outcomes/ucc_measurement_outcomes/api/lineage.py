# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Lineage report: Index -> Objective -> Question -> Result. Read-only.

A query over links that already exist - no new DocType, no recomputation. The
component numbers come from UCC Score Breakdown exactly as calculated, and so
does the objective/question lineage (snapshotted at calculation time), so the
report reflects what was actually scored rather than what the formula and the
mapping happen to say today.
"""

import frappe
from frappe import _

from ucc_measurement_outcomes.lineage import build_report

RESULT = "UCC Index Result"


@frappe.whitelist()
def list_results(index=None, limit=50):
	"""Published results available to report on, newest first."""
	if not frappe.has_permission(RESULT, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	return frappe.get_all(
		RESULT,
		filters={"index": index} if index else None,
		fields=["name", "index", "index_version", "period", "entity", "value",
				"calculation_date"],
		order_by="calculation_date desc, creation desc",
		limit=int(limit),
	)


@frappe.whitelist()
def get_lineage(index_result):
	if not frappe.has_permission(RESULT, "read", doc=index_result):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	doc = frappe.get_doc(RESULT, index_result)
	breakdown = [
		{
			"component_key": b.component_key,
			"component_label": b.component_label,
			"source_metric": b.source_metric,
			"raw_value": b.raw_value,
			"normalised_value": b.normalised_value,
			"weight": b.weight,
			"contribution": b.contribution,
			"lineage_objectives": b.get("lineage_objectives"),
			"lineage_clauses": b.get("lineage_clauses"),
			"lineage_questions": b.get("lineage_questions"),
		}
		for b in doc.breakdown
	]

	# Display lookups only - these never change the report's structure, which
	# comes entirely from the snapshot. Question text is read LIVE, and since
	# 2026-07-29 a published question's wording can be corrected - so the
	# correction reason is read alongside it and travels into the report. A
	# corrected question that looks identical to an uncorrected one would make
	# this report quietly assert wording nobody was shown.
	names = sorted({q.strip() for b in breakdown
					for q in (b["lineage_questions"] or "").split(",") if q.strip()})
	question_text = {}
	corrections = {}
	if names:
		rows = frappe.get_all("UCC Survey Question",
							  filters={"name": ["in", names]},
							  fields=["name", "question_text", "correction_reason"])
		question_text = {q["name"]: q["question_text"] for q in rows}
		corrections = {q["name"]: q["correction_reason"] for q in rows
					   if (q["correction_reason"] or "").strip()}
	codes = sorted({c.strip() for b in breakdown
					for c in (b["lineage_objectives"] or "").split(",") if c.strip()})
	objective_names = {}
	if codes:
		# Survey Objective docnames ARE the label - the register names its own
		# records, so there is no separate title field to fall back through.
		objective_names = {
			o: o for o in frappe.get_all(
				"Survey Objective", filters={"name": ["in", codes]}, pluck="name")
		}

	return build_report(
		{
			"index": doc.index, "index_version": doc.index_version,
			"period": doc.period, "entity_type": doc.entity_type,
			"entity": doc.entity, "value": doc.value, "target": doc.target,
			"calculation_date": doc.calculation_date,
		},
		breakdown,
		question_text,
		objective_names,
		corrections,
	)
