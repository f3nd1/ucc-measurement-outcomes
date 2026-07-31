# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Whitelisted endpoints for the Metrics workspace.

THE GAP THIS FILLS. The data model has always been able to build a metric from
questions spanning several surveys - UCC Metric Source is a child table whose
source_question is a plain Link to any UCC Survey Question, with no version
scope, and metric_calc filters answers by QUESTION only. So the cross-survey
index in the brief computes correctly today. What did not exist was any way for
a human to assemble one: it meant hand-editing a child table on a Desk form.

NOTHING HERE TOUCHES SCORING. aggregate_metric is unchanged, weight_within_metric
is not written, and preview() calls the same pure engine metric_calc calls -
it just does not persist a UCC Metric Result. The aggregation rule (mean of
answers / mean of sources / explicit weights) is an open decision, and a UI that
quietly picked one would be deciding it by accident.
"""

import frappe
from frappe import _

from ucc_measurement_outcomes.metric_engine import aggregate_metric, contributing_versions

METRIC = "UCC Metric Definition"
SOURCE = "UCC Metric Source"
QUESTION = "UCC Survey Question"
VERSION = "UCC Survey Version"
ANSWER = "UCC Survey Answer"
NODE = "UCC Index Node"


def _require(ptype):
	if not frappe.has_permission(METRIC, ptype):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


@frappe.whitelist()
def list_metrics():
	"""Every metric with the two facts the list pane shows: how many source
	questions it has, and whether it is usable at all.

	`sourceless` is the validation state that matters. A metric with no survey
	questions scores nothing, so an index node pointing at it contributes
	nothing - silently, because compute_index treats a missing value as absent
	rather than as an error.
	"""
	_require("read")
	rows = frappe.get_all(METRIC, fields=["name", "metric_name", "default_normalisation"],
						  order_by="name asc")
	counts = {}
	for s in frappe.get_all(SOURCE, fields=["parent", "source_question"]):
		if s.source_question:
			counts[s.parent] = counts.get(s.parent, 0) + 1
	used = {}
	for n in frappe.get_all(NODE, filters={"source_metric": ["is", "set"]},
							fields=["source_metric", "parent"]):
		used.setdefault(n.source_metric, set()).add(n.parent)
	for r in rows:
		r["sources"] = counts.get(r.name, 0)
		r["used_by"] = len(used.get(r.name, ()))
		r["sourceless"] = not r["sources"]
	return rows


def _source_detail(metric):
	"""Source rows enriched with what the centre pane must show: the question's
	wording, and WHICH SURVEY it comes from. The survey is the point - a metric
	drawing on one survey when you meant three is invisible without it."""
	names = [s.source_question for s in metric.sources if s.source_question]
	q = {r["name"]: r for r in frappe.get_all(
		QUESTION, filters={"name": ["in", names or [""]]},
		fields=["name", "question_text", "question_type", "survey_version"])}
	versions = {r["name"]: r for r in frappe.get_all(
		VERSION, filters={"name": ["in", [x["survey_version"] for x in q.values()] or [""]]},
		fields=["name", "survey", "version_number", "status"])}
	out = []
	for s in metric.sources:
		if not s.source_question:
			# Operational Field sources are declared but never read by
			# metric_calc (their external DocTypes are unconfirmed). Show them as
			# what they are rather than dropping them from a list of "sources".
			out.append({"kind": "operational", "reference": s.source_reference,
						"normalisation": s.normalisation, "weight": s.weight_within_metric})
			continue
		detail = q.get(s.source_question, {})
		v = versions.get(detail.get("survey_version"), {})
		out.append({
			"kind": "question",
			"question": s.source_question,
			"text": detail.get("question_text") or s.source_question,
			"question_type": detail.get("question_type"),
			"survey_version": detail.get("survey_version"),
			"survey": v.get("survey"),
			"version_number": v.get("version_number"),
			"version_status": v.get("status"),
			"normalisation": s.normalisation,
			"weight": s.weight_within_metric,
			"answers": frappe.db.count(ANSWER, {"question": s.source_question}),
		})
	return out


@frappe.whitelist()
def get_metric(metric_code):
	_require("read")
	doc = frappe.get_doc(METRIC, metric_code)
	sources = _source_detail(doc)
	surveys = sorted({s.get("survey_version") for s in sources if s.get("survey_version")})
	return {
		"name": doc.name,
		"metric_name": doc.metric_name,
		"default_normalisation": doc.default_normalisation,
		"description": doc.description,
		"sources": sources,
		# The headline the workspace exists to make visible.
		"survey_count": len(surveys),
		"survey_versions": surveys,
		"used_by": frappe.get_all(NODE, filters={"source_metric": metric_code},
								  fields=["parent", "label", "weight"]),
	}


@frappe.whitelist()
def search_questions(query=None, limit=40, exclude_metric=None):
	"""Questions across EVERY survey, for building a cross-survey metric.

	Deliberately not scoped to one survey version: that scoping is exactly what
	the Metrics workspace exists to escape. Read permission on the question's
	version is enforced by frappe.get_all's own permission layer.
	"""
	_require("read")
	filters = {}
	if query:
		filters["question_text"] = ["like", "%" + query + "%"]
	rows = frappe.get_all(
		QUESTION, filters=filters,
		fields=["name", "question_text", "question_type", "survey_version"],
		order_by="modified desc", limit=int(limit))
	if exclude_metric:
		taken = set(frappe.get_all(SOURCE, filters={"parent": exclude_metric},
								   pluck="source_question"))
		rows = [r for r in rows if r["name"] not in taken]
	versions = {r["name"]: r for r in frappe.get_all(
		VERSION, filters={"name": ["in", [r["survey_version"] for r in rows] or [""]]},
		fields=["name", "survey", "version_number", "status"])}
	for r in rows:
		v = versions.get(r["survey_version"], {})
		r["survey"] = v.get("survey")
		r["version_number"] = v.get("version_number")
		r["version_status"] = v.get("status")
	return rows


@frappe.whitelist()
def new_metric(metric_code, metric_name=None, default_normalisation=None):
	_require("create")
	code = (metric_code or "").strip()
	if not code:
		frappe.throw(_("A metric needs a code."))
	if frappe.db.exists(METRIC, code):
		frappe.throw(_("Metric {0} already exists.").format(code))
	return frappe.get_doc({
		"doctype": METRIC, "metric_code": code, "metric_name": metric_name or code,
		"default_normalisation": default_normalisation or "Likert 1-5 to 0-100",
	}).insert().name


@frappe.whitelist()
def save_metric(metric_code, metric_name=None, default_normalisation=None, description=None):
	"""Header fields only. Sources are added and removed one at a time, so a
	stale browser cannot post a whole source list back and silently drop a row
	somebody else added while it was open."""
	_require("write")
	doc = frappe.get_doc(METRIC, metric_code)
	if metric_name is not None:
		doc.metric_name = metric_name
	if default_normalisation:
		doc.default_normalisation = default_normalisation
	if description is not None:
		doc.description = description
	doc.save()
	return doc.name


@frappe.whitelist()
def add_metric_source(metric_code, question, normalisation=None):
	"""Add one question as a source. Idempotent.

	Deliberately the same shape as api.mapping.set_question_metric, which does
	this from the Mapping Studio side - but that one CREATES the metric when it
	is missing, which is right when you are mapping a question and wrong here,
	where a typo'd code would silently mint a metric nobody meant to define.
	"""
	_require("write")
	if not frappe.db.exists(METRIC, metric_code):
		frappe.throw(_("Metric {0} does not exist. Create it first.").format(metric_code))
	if not frappe.db.exists(QUESTION, question):
		frappe.throw(_("Question not found."))
	metric = frappe.get_doc(METRIC, metric_code)
	if any(s.source_question == question for s in metric.sources):
		return None
	metric.append("sources", {
		"source_type": "Survey Question",
		"source_question": question,
		"normalisation": normalisation or metric.default_normalisation,
	})
	metric.save()
	return metric.name


@frappe.whitelist()
def remove_metric_source(metric_code, question):
	_require("write")
	metric = frappe.get_doc(METRIC, metric_code)
	keep = [s for s in metric.sources if s.source_question != question]
	if len(keep) == len(metric.sources):
		return 0
	metric.set("sources", [])
	for s in keep:
		metric.append("sources", {
			"source_type": s.source_type, "source_question": s.source_question,
			"source_reference": s.source_reference, "normalisation": s.normalisation,
			"reverse_scored": s.reverse_scored, "weight_within_metric": s.weight_within_metric,
		})
	metric.save()
	return 1


@frappe.whitelist()
def set_source_normalisation(metric_code, question, normalisation):
	"""The one per-source setting that DOES reach a score today. Weight does not
	- weight_within_metric is stored and read by nothing, which is why this
	workspace shows it as recorded-but-not-applied rather than offering a
	control that silently does nothing."""
	_require("write")
	metric = frappe.get_doc(METRIC, metric_code)
	hit = [s for s in metric.sources if s.source_question == question]
	if not hit:
		frappe.throw(_("That question is not a source of this metric."))
	hit[0].normalisation = normalisation
	metric.save()
	return True


@frappe.whitelist()
def preview_metric(metric_code):
	"""What this metric WOULD score, without writing a UCC Metric Result.

	The same aggregate_metric metric_calc uses, over the same rows, so a
	normalisation rule that drops every answer is visible here rather than after
	it has poisoned an index. `unscoreable` is the number that matters: a metric
	reading 0 of 240 answers is broken in a way its value alone will not show.
	"""
	_require("read")
	metric = frappe.get_doc(METRIC, metric_code)
	rows = []
	for src in metric.sources:
		if src.source_type != "Survey Question" or not src.source_question:
			continue
		norm = src.normalisation or metric.default_normalisation
		for a in frappe.get_all(ANSWER, filters={"question": src.source_question},
								fields=["name", "answer_value", "survey_version"]):
			rows.append((a["name"], a["answer_value"], norm, bool(src.reverse_scored),
						 a["survey_version"]))
	result = aggregate_metric(
		[{"value": v, "normalisation": n, "reverse": r} for (_a, v, n, r, _s) in rows])
	return {
		"value": result["value"],
		"response_count": result["response_count"],
		"scored_count": result["scored_count"],
		"unscoreable": result["response_count"] - result["scored_count"],
		"source_versions": contributing_versions(rows),
	}
