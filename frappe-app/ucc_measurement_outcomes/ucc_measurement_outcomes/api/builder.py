# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Whitelisted endpoints for the Survey Builder Desk Page.

The builder UI talks only to these methods, never to raw DocType REST. Each
method runs as the logged-in user, so the standard DocType permission checks
and the version-immutability guard (see versioning.py) both apply automatically
on insert/save/delete.
"""

import json

import frappe
from frappe import _

QUESTION = "UCC Survey Question"
VERSION = "UCC Survey Version"

# Types that carry a choice list, and the defaults to seed when one is added.
CHOICE_DEFAULTS = {
	"Single Choice": ["Option 1", "Option 2", "Option 3"],
	"Multiple Choice": ["Option 1", "Option 2", "Option 3"],
	"Dropdown": ["Option 1", "Option 2", "Option 3"],
	"Rating": ["1", "2", "3", "4", "5"],
	"Yes / No": ["Yes", "No"],
}


def _loads(value):
	return json.loads(value) if isinstance(value, str) else value


def _require(survey_version, ptype):
	if not frappe.has_permission(VERSION, ptype, doc=survey_version):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


@frappe.whitelist()
def get_survey_builder(survey_version):
	"""Return the version header plus its ordered questions (with choices)."""
	_require(survey_version, "read")
	version = frappe.db.get_value(
		VERSION,
		survey_version,
		["name", "survey", "version_number", "status", "is_immutable", "title_snapshot"],
		as_dict=True,
	)
	if not version:
		frappe.throw(_("Survey Version {0} not found").format(survey_version))
	version["survey_title"] = frappe.db.get_value("UCC Survey", version.survey, "title")

	questions = frappe.get_all(
		QUESTION,
		filters={"survey_version": survey_version},
		fields=[
			"name", "question_text", "question_type", "help_text", "is_required",
			"sequence", "section", "display_logic", "display_logic_config",
		],
		order_by="sequence asc, creation asc",
	)
	for q in questions:
		q["choices"] = frappe.get_all(
			"UCC Survey Question Choice",
			filters={"parent": q["name"], "parenttype": QUESTION},
			fields=["choice_label", "choice_value", "sequence"],
			order_by="idx asc",
		)
	return {"version": version, "questions": questions, "editable": not version["is_immutable"]}


@frappe.whitelist()
def add_question(survey_version, question_type="Short Text", section=None, sequence=None):
	"""Insert a new question at the given position (defaults to the end)."""
	doc = frappe.new_doc(QUESTION)
	doc.survey_version = survey_version
	doc.question_type = question_type
	doc.question_text = _("Enter your question")
	if section:
		doc.section = section
	doc.sequence = (
		frappe.db.count(QUESTION, {"survey_version": survey_version})
		if sequence is None
		else int(sequence)
	)
	for i, label in enumerate(CHOICE_DEFAULTS.get(question_type, [])):
		doc.append("choices", {"choice_label": label, "sequence": i})
	doc.insert()
	return doc.name


@frappe.whitelist()
def update_question(question, payload):
	"""Apply inspector edits to one question (wording, type, flags, choices)."""
	data = _loads(payload)
	doc = frappe.get_doc(QUESTION, question)
	for field in (
		"question_text", "question_type", "help_text", "is_required",
		"display_logic", "display_logic_config", "section", "sequence",
	):
		if field in data:
			doc.set(field, data[field])
	if "choices" in data:
		doc.set("choices", [])
		for i, c in enumerate(data["choices"]):
			doc.append("choices", {
				"choice_label": c.get("choice_label", ""),
				"choice_value": c.get("choice_value"),
				"sequence": c.get("sequence", i),
			})
	doc.save()
	return doc.name


@frappe.whitelist()
def reorder_questions(survey_version, ordered):
	"""Persist a new question order. Full saves so the immutability guard runs."""
	_require(survey_version, "write")
	names = _loads(ordered)
	for seq, name in enumerate(names):
		if frappe.db.get_value(QUESTION, name, "survey_version") != survey_version:
			frappe.throw(_("Question {0} is not part of this version.").format(name))
		doc = frappe.get_doc(QUESTION, name)
		doc.sequence = seq
		doc.save()
	# ponytail: N saves per reorder; fine for realistic question counts. Batch if a
	# survey ever grows into the hundreds of questions.
	return True


@frappe.whitelist()
def duplicate_question(question):
	src = frappe.get_doc(QUESTION, question)
	dup = frappe.copy_doc(src)
	dup.question_text = (src.question_text or "") + " (Copy)"
	dup.sequence = (src.sequence or 0) + 1
	dup.insert()
	return dup.name


@frappe.whitelist()
def delete_question(question):
	frappe.delete_doc(QUESTION, question)
	return True
