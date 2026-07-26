# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Whitelisted endpoints for Mapping Studio.

Objective mapping (UCC Question Mapping) and metric mapping (UCC Metric
Definition sources) are edited through separate methods, keeping the two
governance concerns independent.
"""

import frappe
from frappe import _

from ucc_measurement_outcomes.coverage import coverage_summary

QUESTION = "UCC Survey Question"
MAPPING = "UCC Question Mapping"
METRIC = "UCC Metric Definition"
VERSION = "UCC Survey Version"


def _require(survey_version, ptype):
	if not frappe.has_permission(VERSION, ptype, doc=survey_version):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


@frappe.whitelist()
def get_mapping_overview(survey_version):
	"""Questions of a version with their current objective + metric mapping."""
	_require(survey_version, "read")
	questions = frappe.get_all(
		QUESTION,
		filters={"survey_version": survey_version},
		fields=["name", "question_text", "question_type", "sequence"],
		order_by="sequence asc, creation asc",
	)
	# A question may carry more than one objective mapping (real UCC data has
	# questions on two and three objectives). Keying a dict on question silently
	# kept whichever row came back last, so the UI showed one of three objectives
	# with no sign the others existed.
	mappings = {}
	for m in frappe.get_all(
		MAPPING,
		filters={"survey_version": survey_version},
		fields=["question", "objective", "standard", "primary_clause", "related_clauses"],
		order_by="creation asc",
	):
		mappings.setdefault(m["question"], []).append(m)
	# Metric mapping: which metric(s) name this question as a source.
	metric_by_question = {}
	for ms in frappe.get_all(
		"UCC Metric Source",
		filters={"source_question": ["in", [q["name"] for q in questions] or [""]]},
		fields=["parent", "source_question"],
	):
		metric_by_question.setdefault(ms["source_question"], []).append(ms["parent"])

	for q in questions:
		rows = mappings.get(q["name"], [])
		m = rows[0] if rows else {}
		# The single-value fields stay for the existing inspector; `objectives`
		# carries the full truth so nothing is hidden.
		q["objective"] = m.get("objective")
		q["standard"] = m.get("standard")
		q["primary_clause"] = m.get("primary_clause")
		q["related_clauses"] = m.get("related_clauses")
		q["objectives"] = [r["objective"] for r in rows if r.get("objective")]
		q["metrics"] = metric_by_question.get(q["name"], [])
	return {"survey_version": survey_version, "questions": questions}


@frappe.whitelist()
def upsert_question_mapping(question, objective, standard=None, primary_clause=None, related_clauses=None):
	"""Create or update this question's objective mapping.

	The unique constraint on `question` was removed once real data showed
	questions carrying two and three objectives. This endpoint still edits ONE
	row, because the inspector it serves has one objective field - so when a
	question already has several it refuses rather than picking one of them at
	random and overwriting it."""
	survey_version = frappe.db.get_value(QUESTION, question, "survey_version")
	if not survey_version:
		frappe.throw(_("Question not found."))
	_require(survey_version, "write")
	names = frappe.get_all(MAPPING, filters={"question": question},
						   order_by="creation asc", pluck="name")
	if len(names) > 1:
		frappe.throw(
			_("This question has {0} objective mappings. Editing it through the "
			  "single-objective field would overwrite one of them - open the "
			  "question's mapping list instead.").format(len(names))
		)
	doc = frappe.get_doc(MAPPING, names[0]) if names else frappe.new_doc(MAPPING)
	doc.question = question
	doc.objective = objective
	doc.standard = standard
	doc.primary_clause = primary_clause
	doc.related_clauses = related_clauses
	doc.save()
	return doc.name


@frappe.whitelist()
def set_question_metric(question, metric_code, normalisation=None):
	"""Add the question as a source of the given metric (metric mapping).

	Creates the metric definition if it does not exist yet. Idempotent: a
	question is not added twice to the same metric.
	"""
	survey_version = frappe.db.get_value(QUESTION, question, "survey_version")
	if not survey_version:
		frappe.throw(_("Question not found."))
	_require(survey_version, "write")

	metric = (
		frappe.get_doc(METRIC, metric_code)
		if frappe.db.exists(METRIC, metric_code)
		else frappe.get_doc({"doctype": METRIC, "metric_code": metric_code, "metric_name": metric_code})
	)
	if not any(s.source_question == question for s in metric.get("sources", [])):
		metric.append("sources", {
			"source_type": "Survey Question",
			"source_question": question,
			"normalisation": normalisation or metric.default_normalisation or "Likert 1-5 to 0-100",
		})
	metric.save()
	return metric.name


@frappe.whitelist()
def mapping_coverage(survey_version):
	"""Gap / coverage analysis for one version: unmapped questions, questions
	without a clause, unused objectives, and duplicate questions."""
	_require(survey_version, "read")
	questions = frappe.get_all(
		QUESTION, filters={"survey_version": survey_version},
		# question_type lets coverage skip layout-only rows (Section Heading).
		fields=["name", "question_text", "question_type"],
	)
	mappings = frappe.get_all(
		MAPPING, filters={"survey_version": survey_version},
		fields=["question", "objective", "primary_clause"],
	)
	# Objectives in scope = every defined objective (which ones this survey misses).
	objectives = frappe.get_all("UCC Objective", pluck="name")
	summary = coverage_summary(questions, mappings, objectives)
	# Attach question text so the UI can label the gap lists + flag canvas nodes.
	summary["question_text"] = {q["name"]: q["question_text"] for q in questions}
	return summary


@frappe.whitelist()
def mapping_masters():
	"""Dropdown data for the mapping inspector."""
	return {
		"objectives": frappe.get_all("UCC Objective", fields=["name", "objective_name"], order_by="name"),
		"standards": frappe.get_all("UCC Standard", fields=["name", "standard_name"], order_by="name"),
		"metrics": frappe.get_all(METRIC, fields=["name", "metric_name"], order_by="name"),
	}
