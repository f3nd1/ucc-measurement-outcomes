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
from ucc_measurement_outcomes.map_graph import build_map_graph, connection_pair

QUESTION = "UCC Survey Question"
MAPPING = "UCC Question Mapping"
METRIC = "UCC Metric Definition"
# educ_sg's objective register - 97 real records, each already linked to
# Policies And Standards Management. This app reads it and never writes to it.
OBJECTIVE = "Survey Objective"

# Fields worth showing in the objective panel, IF this site's Survey Objective
# has them. Resolved against the real meta rather than assumed: the only two
# confirmed by inspection are clause_or_criterion and status, and a hardcoded
# fieldname that does not exist is how three earlier assumptions on this project
# died. Anything missing is simply not shown.
OBJECTIVE_DETAIL = ("objective_name", "objective", "description", "objective_description",
					"clause_or_criterion", "status")


VERSION = "UCC Survey Version"


def _objective_fields():
	real = {df.fieldname for df in frappe.get_meta(OBJECTIVE).fields}
	return ["name"] + [f for f in OBJECTIVE_DETAIL if f in real]


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
		fields=["question", "objective", "primary_clause", "related_clauses"],
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
		q["primary_clause"] = m.get("primary_clause")
		q["related_clauses"] = m.get("related_clauses")
		q["objectives"] = [r["objective"] for r in rows if r.get("objective")]
		q["metrics"] = metric_by_question.get(q["name"], [])
	return {"survey_version": survey_version, "questions": questions}


def _writable_question(question):
	"""The version a question belongs to, once write permission on it is proven.
	Shared by every mapping write so there is one gate, not three."""
	survey_version = frappe.db.get_value(QUESTION, question, "survey_version")
	if not survey_version:
		frappe.throw(_("Question not found."))
	_require(survey_version, "write")
	return survey_version


@frappe.whitelist()
def upsert_question_mapping(question, objective, primary_clause=None, related_clauses=None):
	"""Create or update this question's objective mapping.

	The unique constraint on `question` was removed once real data showed
	questions carrying two and three objectives. This endpoint still edits ONE
	row, because the inspector it serves has one objective field - so when a
	question already has several it refuses rather than picking one of them at
	random and overwriting it."""
	_writable_question(question)
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
	doc.primary_clause = primary_clause
	doc.related_clauses = related_clauses
	doc.save()
	return doc.name


@frappe.whitelist()
def add_question_mapping(question, objective):
	"""Add ONE question -> objective mapping, leaving any others alone.

	Not a variant of upsert_question_mapping and not a second write path: they
	are different VERBS on the same document. upsert serves a form with one
	objective field, so it edits one row and refuses when there are several -
	correct there, wrong for a canvas, where dragging a second line means "and
	also this", never "instead of that". Both go through _writable_question, so
	there is still one permission gate.

	Idempotent: dropping a line onto an objective that is already connected is a
	no-op rather than a duplicate row.
	"""
	_writable_question(question)
	if not objective:
		frappe.throw(_("No objective given."))
	if frappe.db.exists(MAPPING, {"question": question, "objective": objective}):
		return None
	# survey_version is not set here on purpose: the field carries
	# fetch_from question.survey_version, so Frappe fills it on save and there is
	# one source of truth for which version a mapping belongs to.
	return frappe.get_doc({
		"doctype": MAPPING, "question": question, "objective": objective,
	}).insert().name


@frappe.whitelist()
def remove_question_mapping(question, objective):
	"""Delete the question -> objective mapping(s) for exactly this pair.

	Returns how many rows went, so the caller can say "nothing to remove"
	instead of claiming a success it did not have. This DOES discard whatever
	clause and notes that row carried - the caller confirms first.
	"""
	_writable_question(question)
	names = frappe.get_all(
		MAPPING, filters={"question": question, "objective": objective}, pluck="name")
	for name in names:
		frappe.delete_doc(MAPPING, name)
	return len(names)


@frappe.whitelist()
def mapping_canvas(survey_version, unmapped_only=1, all_objectives=0):
	"""Nodes + edges for Mapping Studio's canvas.

	Built HERE rather than in the browser so the layout, the id scheme and the
	gap flags come from the same place the writes are validated against - the
	canvas is a write surface, and a client that invents its own node ids is a
	client that can post a pair the server never offered. Permission comes from
	the two methods this delegates to.

	all_objectives=0 (the default) shows only the objectives THIS SURVEY VERSION
	already uses. The register holds 97, and rendering all of them made a canvas
	where a handful of real edges sat among 97 unconnected boxes - which reads as
	"everything is linked to everything" even though every link is correct. The
	mappings were never wrong; the column was. Pass 1 to browse the whole
	register and connect an objective this survey has not used yet.
	"""
	overview = get_mapping_overview(survey_version)
	cov = mapping_coverage(survey_version)
	if frappe.utils.cint(all_objectives):
		objectives = frappe.get_all(OBJECTIVE, fields=["name"], order_by="name asc")
	else:
		used = sorted({o for q in overview["questions"] for o in (q.get("objectives") or [])})
		objectives = [{"name": o} for o in used]
	nodes, edges = build_map_graph(
		overview["questions"],
		objectives,
		unmapped_only=bool(frappe.utils.cint(unmapped_only)),
		unmapped=cov["questions_without_objective"],
	)
	return {
		"nodes": nodes, "edges": edges,
		# So the UI can say "12 of 97" rather than implying the register is small.
		"objectives_shown": len(objectives),
		"objectives_total": frappe.db.count(OBJECTIVE),
	}


def _pair(a, b):
	pair = connection_pair(a, b)
	if not pair:
		frappe.throw(_("A mapping joins a question to an objective. Drag from a "
					   "question's dot onto an objective, or the other way round."))
	return pair


@frappe.whitelist()
def connect_nodes(a, b):
	"""A connection drawn on the canvas becomes a real mapping."""
	return add_question_mapping(*_pair(a, b))


@frappe.whitelist()
def disconnect_nodes(a, b):
	"""...and clicking it removes one."""
	return remove_question_mapping(*_pair(a, b))


@frappe.whitelist()
def set_question_metric(question, metric_code, normalisation=None):
	"""Add the question as a source of the given metric (metric mapping).

	Creates the metric definition if it does not exist yet. Idempotent: a
	question is not added twice to the same metric.
	"""
	_writable_question(question)
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
	# Objectives in scope = the whole register. This used to be the 7 rows of a
	# parallel UCC Objective table, which made "all in use" a statement about
	# almost nothing; against the real 97 it answers the question Criterion 7.1.1
	# actually asks - which of the institution's objectives does this survey not
	# reach.
	objectives = frappe.get_all(OBJECTIVE, pluck="name")
	summary = coverage_summary(questions, mappings, objectives)
	# Attach question text so the UI can label the gap lists + flag canvas nodes.
	summary["question_text"] = {q["name"]: q["question_text"] for q in questions}
	return summary


@frappe.whitelist()
def objective_usage():
	"""Every question -> objective mapping in the app, grouped by objective.

	Coverage's drill-down asks the one thing no per-version endpoint can answer:
	which questions reach this objective, and from which surveys. Both
	`mapping_coverage` and `get_mapping_overview` are scoped to a single
	survey_version by design, so "reached by another survey" is invisible to
	them - and an objective the Coverage tab calls unreached may well be carried
	by a different instrument.

	One pass over the mapping table, not one call per objective: the payload is
	bounded by the number of mappings that exist, not by the 97-row register.
	"""
	# Cross-version by definition, so the gate is the DocType-level read right
	# rather than one document's. Rows are lineage metadata (question text and
	# survey title), never answers.
	if not frappe.has_permission(VERSION, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	rows = frappe.get_all(MAPPING, fields=["question", "objective", "survey_version"],
						  order_by="creation asc")
	q_text = {q["name"]: q["question_text"] for q in frappe.get_all(
		QUESTION, filters={"name": ["in", [r["question"] for r in rows] or [""]]},
		fields=["name", "question_text"])}
	versions = {v["name"]: v for v in frappe.get_all(
		VERSION, filters={"name": ["in", [r["survey_version"] for r in rows] or [""]]},
		fields=["name", "survey", "version_number"])}
	titles = {s["name"]: s["title"] for s in frappe.get_all(
		"UCC Survey", filters={"name": ["in", [v["survey"] for v in versions.values()] or [""]]},
		fields=["name", "title"])}

	usage = {}
	for r in rows:
		if not r.get("objective"):
			continue
		v = versions.get(r["survey_version"], {})
		usage.setdefault(r["objective"], []).append({
			"question": r["question"],
			"question_text": q_text.get(r["question"], r["question"]),
			"survey_version": r["survey_version"],
			"survey": v.get("survey"),
			"survey_title": titles.get(v.get("survey")) or v.get("survey") or "",
			"version_number": v.get("version_number"),
		})
	return {"usage": usage}


@frappe.whitelist()
def mapping_masters():
	"""Dropdown data for the mapping inspector."""
	return {
		# Whatever detail fields this site's Survey Objective actually has come
		# along for the canvas's objective panel - one wider query on a list that
		# was already being fetched beats a round trip per node click.
		"objectives": frappe.get_all(OBJECTIVE, fields=_objective_fields(), order_by="name"),
		"metrics": frappe.get_all(METRIC, fields=["name", "metric_name"], order_by="name"),
	}
