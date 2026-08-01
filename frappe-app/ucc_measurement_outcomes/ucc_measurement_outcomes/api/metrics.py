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

try:
	from ucc_measurement_outcomes import source_eligibility
except ImportError:
	import source_eligibility

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


# ===================================================== source drill-down ===
# Round-10 Item 3. The old drawer loaded every question in every survey into one
# flat list and labelled all of them "Compatible" - a client-side literal with
# nothing behind it. These three endpoints replace it with
# department -> survey version -> questions, loading each level only when asked,
# and with a real eligibility verdict from the pure source_eligibility module.
#
# GROUPING FIELD, stated plainly: UCC Survey.category exists but is Data (free
# text), so it would fragment on typos and casing. owner_department is a Link to
# Department - genuinely controlled - so it is what the first column groups by
# for now. It is organisational rather than thematic; a real category Select is
# a pending decision (see the 2026-08-01 entry in docs/09-decision-log.md).

SURVEY = "UCC Survey"
CHOICE = "UCC Survey Question Choice"


@frappe.whitelist()
def source_categories():
	"""First column: departments that own at least one survey, with counts."""
	_require("read")
	surveys = frappe.get_all(SURVEY, fields=["name", "owner_department"])
	by_dept = {}
	for s in surveys:
		by_dept.setdefault(s.get("owner_department") or "", []).append(s["name"])
	versions = frappe.get_all(VERSION, fields=["name", "survey"])
	vcount = {}
	for v in versions:
		vcount[v["survey"]] = vcount.get(v["survey"], 0) + 1
	out = []
	for dept, names in by_dept.items():
		out.append({
			"key": dept,
			"label": dept or _("No department"),
			"surveys": len(names),
			"versions": sum(vcount.get(n, 0) for n in names),
		})
	# Unassigned last: it is a fallback bucket, not a real department.
	return sorted(out, key=lambda r: (r["key"] == "", r["label"]))


@frappe.whitelist()
def source_versions(category=None):
	"""Second column: the survey VERSIONS in one department.

	Versions, never surveys - a source attaches to the frozen version, and
	"Student Experience V01" and "V02" are different evidence.
	"""
	_require("read")
	filters = {}
	if category:
		filters["owner_department"] = category
	else:
		filters["owner_department"] = ["in", ["", None]]
	surveys = {s["name"]: s for s in frappe.get_all(
		SURVEY, filters=filters, fields=["name", "title", "owner_department"])}
	if not surveys:
		return []
	rows = frappe.get_all(
		VERSION, filters={"survey": ["in", list(surveys)]},
		fields=["name", "survey", "version_number", "status"],
		order_by="survey asc, version_number desc")
	qcount, rcount = {}, {}
	for q in frappe.get_all(QUESTION, filters={"survey_version": ["in", [r["name"] for r in rows] or [""]]},
							fields=["survey_version", "question_type"]):
		# Layout markers are not questions; the count must not promise answers
		# that structural fields can never provide.
		if source_eligibility.is_structural(q.get("question_type")):
			continue
		qcount[q["survey_version"]] = qcount.get(q["survey_version"], 0) + 1
	for a in frappe.get_all(ANSWER, filters={"survey_version": ["in", [r["name"] for r in rows] or [""]]},
							fields=["survey_version"]):
		rcount[a["survey_version"]] = rcount.get(a["survey_version"], 0) + 1
	for r in rows:
		r["survey_title"] = surveys.get(r["survey"], {}).get("title") or r["survey"]
		r["question_count"] = qcount.get(r["name"], 0)
		r["answer_count"] = rcount.get(r["name"], 0)
	return rows


@frappe.whitelist()
def eligible_questions(metric_code, survey_version, search=None,
                       response_filter=None, show_incompatible=0):
	"""Third column: questions of ONE survey version, each with a real verdict.

	Never scoped to "all surveys" - that is the flat list this replaces. The
	verdict comes from source_eligibility, which derives its rule from
	index_engine.normalise(), so the label cannot drift from what actually
	scores.
	"""
	_require("read")
	metric = frappe.get_doc(METRIC, metric_code)
	rule = metric.default_normalisation
	# Duplicate detection by stable ID, never by wording: two surveys can hold
	# identical text and still be different evidence.
	taken = set(frappe.get_all(SOURCE, filters={"parent": metric_code}, pluck="source_question"))

	filters = {"survey_version": survey_version}
	if search:
		filters["question_text"] = ["like", "%" + search + "%"]
	rows = frappe.get_all(
		QUESTION, filters=filters,
		fields=["name", "question_text", "question_type", "sequence"],
		order_by="sequence asc, creation asc")
	if not rows:
		return []

	names = [r["name"] for r in rows]
	answers = {}
	for a in frappe.get_all(ANSWER, filters={"question": ["in", names]}, fields=["question"]):
		answers[a["question"]] = answers.get(a["question"], 0) + 1
	# A choice question is only scoreable when its choices carry numeric values.
	numeric_choice = set()
	for c in frappe.get_all(CHOICE, filters={"parent": ["in", names]},
							fields=["parent", "choice_value"]):
		v = c.get("choice_value")
		if v in (None, ""):
			continue
		try:
			float(v)
		except (TypeError, ValueError):
			continue
		numeric_choice.add(c["parent"])

	out = []
	for r in rows:
		n = answers.get(r["name"], 0)
		v = source_eligibility.verdict(
			r["question_type"], rule, answers=n,
			already=r["name"] in taken,
			numeric_choices=r["name"] in numeric_choice)
		r["answer_count"] = n
		r.update(v)
		out.append(r)

	if not int(show_incompatible or 0):
		# Structural fields stay hidden even when "show incompatible" is on for
		# the rest: they are not questions at all.
		out = [r for r in out if r["state"] not in ("incompatible", "structural")]
	else:
		out = [r for r in out if r["state"] != "structural"]

	if response_filter == "has":
		out = [r for r in out if r["answer_count"]]
	elif response_filter == "none":
		out = [r for r in out if not r["answer_count"]]
	elif response_filter == "added":
		out = [r for r in out if r["state"] == "already_connected"]
	return out


@frappe.whitelist()
def add_metric_sources(metric_code, questions):
	"""Add several sources in one call, reporting per-question failures.

	Wraps the existing add_metric_source rather than introducing a second
	linking model, so permissions and the duplicate guard stay in one place.
	"""
	names = frappe.parse_json(questions) or []
	added, failed = [], []
	for q in names:
		try:
			add_metric_source(metric_code, q)
			added.append(q)
		except Exception as e:
			# Keep going: one bad question must not lose the rest of a
			# cross-survey selection the user spent time building.
			failed.append({"question": q, "error": str(e)})
	return {"added": added, "failed": failed}
