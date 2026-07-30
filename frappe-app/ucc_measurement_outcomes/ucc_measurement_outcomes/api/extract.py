# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""One-time extraction from educ_sg's question master into our own model.

D1 keeps Survey Management as a REFERENCE. This is the deliberate, reviewable
import it enables - not a sync. Nothing here runs on a schedule, on a hook, or
in the background; a user picks a source, reads what would be created, and
presses commit.

It copies QUESTION DESIGN only - question text, its objectives, its clause. It
never touches Survey Response: historical responses are reference-only because
47% of them cannot be attributed to a question at all.

Reads educ_sg, writes only our own DocTypes.
"""

import frappe
from frappe import _

from ucc_measurement_outcomes.extraction import build_plan

QITEM = "Survey Question Item"
QUESTION = "UCC Survey Question"
OBJECTIVE = "Survey Objective"
MAPPING = "UCC Question Mapping"
VERSION = "UCC Survey Version"

# Every DocType this endpoint may create. Extraction reads educ_sg - including
# Survey Objective, the objective register - but never writes to it.
WRITES = {QUESTION, MAPPING}


def _resolve(doctype, *candidates):
	"""educ_sg fieldnames are not ours to assume. Two probes on this project
	died on a column spelled differently than expected, so resolve against the
	real meta and say what the fields actually are."""
	real = {df.fieldname for df in frappe.get_meta(doctype).fields}
	for c in candidates:
		if c in real:
			return c
	frappe.throw(
		_("{0} has none of the expected fields {1}. Its fields are: {2}").format(
			doctype, ", ".join(candidates), ", ".join(sorted(real))
		)
	)


def _source_rows(survey_management=None):
	"""(question, objective, clause) triples from the master, field-resolved."""
	q = _resolve(QITEM, "question", "survey_question", "question_text")
	obj = _resolve(QITEM, "objective", "survey_objective", "objective_id")
	# The clause column is genuinely optional - 191 of 318 rows carry one.
	clause = None
	real = {df.fieldname for df in frappe.get_meta(QITEM).fields}
	for c in ("related_clause", "clause", "clause_or_criterion", "primary_clause"):
		if c in real:
			clause = c
			break

	fields = ["parent", q, obj] + ([clause] if clause else [])
	filters = {"parent": survey_management} if survey_management else {}
	rows = frappe.get_all(QITEM, filters=filters, fields=fields, order_by="idx asc")
	return [
		{"question": r.get(q), "objective": r.get(obj),
		 "clause": r.get(clause) if clause else None}
		for r in rows
	], {"question": q, "objective": obj, "clause": clause}


def _plan_for(survey_version, survey_management=None):
	if not frappe.has_permission(VERSION, "write", doc=survey_version):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if frappe.db.get_value(VERSION, survey_version, "status") != "Draft":
		frappe.throw(
			_("Version {0} is not Draft. A published version is frozen and cannot "
			  "receive extracted questions.").format(survey_version)
		)
	rows, resolved = _source_rows(survey_management)
	plan = build_plan(
		rows,
		# The institution's register, read-only. Extraction checks against it and
		# never adds to it.
		known_objectives=frappe.get_all(OBJECTIVE, pluck="name"),
		existing_questions=frappe.get_all(
			QUESTION, filters={"survey_version": survey_version}, pluck="question_text"),
	)
	plan["resolved_fields"] = resolved
	plan["survey_version"] = survey_version
	plan["survey_management"] = survey_management
	return plan


@frappe.whitelist()
def list_sources():
	"""Survey Management records that actually have question-master rows."""
	parents = frappe.get_all(QITEM, pluck="parent")
	seen = {}
	for p in parents:
		seen[p] = seen.get(p, 0) + 1
	return [{"name": p, "rows": n} for p, n in sorted(seen.items(), key=lambda kv: -kv[1])]


@frappe.whitelist()
def preview_extraction(survey_version, survey_management=None):
	"""What WOULD be created. Writes nothing - this is the before half of the
	before/after the user is entitled to see."""
	return _plan_for(survey_version, survey_management)


@frappe.whitelist()
def commit_extraction(survey_version, survey_management=None):
	"""Apply the plan. Re-derived here rather than accepting one from the
	browser: a plan posted back could have been edited, and a stale one could
	write something the user never reviewed."""
	plan = _plan_for(survey_version, survey_management)

	# No objective creation. build_plan has already dropped every row pointing at
	# something the register does not have, and listed them in
	# plan["unknown_objectives"] for the user to take to whoever owns the
	# register. Inventing one here would put an objective nobody approved into
	# the institutional record this app exists to produce evidence from.

	created_q = created_m = 0
	base = frappe.db.count(QUESTION, {"survey_version": survey_version})
	for q in plan["questions"]:
		if q["exists"]:
			name = frappe.db.get_value(
				QUESTION, {"survey_version": survey_version, "question_text": q["question_text"]},
				"name")
		else:
			doc = frappe.get_doc({
				"doctype": QUESTION, "survey_version": survey_version,
				"question_type": q["question_type"], "question_text": q["question_text"],
				"sequence": base + created_q,
			}).insert()
			name = doc.name
			created_q += 1
		for obj in q["objectives"]:
			# A question may carry several objectives (checkpoint A). Skip only
			# the exact pair, so re-running adds nothing and loses nothing.
			if frappe.db.exists(MAPPING, {"question": name, "objective": obj["code"]}):
				continue
			frappe.get_doc({
				"doctype": MAPPING, "question": name, "objective": obj["code"],
				"primary_clause": q["primary_clause"],
				"related_clauses": q["related_clauses"],
			}).insert()
			created_m += 1

	frappe.db.commit()
	return {
		"questions_created": created_q,
		"mappings_created": created_m,
		"unknown_objectives": plan["unknown_objectives"],
		"counts": plan["counts"],
	}
