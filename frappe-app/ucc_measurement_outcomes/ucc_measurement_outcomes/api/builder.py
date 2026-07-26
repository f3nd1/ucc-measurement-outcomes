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

from ucc_measurement_outcomes.bulk_parse import parse_bulk_questions
from ucc_measurement_outcomes.versioning import next_version_number

QUESTION = "UCC Survey Question"
VERSION = "UCC Survey Version"
CAMPAIGN = "UCC Survey Campaign"

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


def _resequence(survey_version, make_room_at=None):
	"""Renumber a version's questions densely (0..n-1), optionally leaving a gap
	at make_room_at for an insert. Returns the question count after renumbering.

	Root cause of the Pass 2 ordering bugs: deletions left sequences sparse, but
	every insert path assumed position == sequence (drop-at-position collided
	with an existing sequence and, on the creation-date tiebreak, landed one slot
	late). Dense sequences restore that invariant everywhere. Only ever called
	inside an already-guarded write (insert/delete on a frozen version throws and
	rolls the whole request back, so these set_values cannot survive alone)."""
	names = frappe.get_all(
		QUESTION,
		filters={"survey_version": survey_version},
		order_by="sequence asc, creation asc",
		pluck="name",
	)
	seq = 0
	for name in names:
		if make_room_at is not None and seq == make_room_at:
			seq += 1
		frappe.db.set_value(QUESTION, name, "sequence", seq, update_modified=False)
		seq += 1
	return len(names)


def _require(survey_version, ptype):
	if not frappe.has_permission(VERSION, ptype, doc=survey_version):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


@frappe.whitelist()
def list_versions(limit=100):
	"""Versions for the picker, newest-modified first. Read-only, so this is one
	permission check rather than a filter per row: any version the caller could
	not read is simply not fetched.

	Not scoped to a single survey — Felix's reference (Dashboard Studio's
	picker) shows a flat list across all dashboards, and this page has never had
	a separate "pick a survey first" step, so the same flat shape is used here.
	"""
	if not frappe.has_permission(VERSION, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	rows = frappe.get_all(
		VERSION,
		fields=["name", "survey", "version_number", "status", "modified"],
		order_by="modified desc",
		limit=int(limit),
	)
	titles = {
		s.name: s.title
		for s in frappe.get_all("UCC Survey", filters={"name": ["in", [r.survey for r in rows] or [""]]},
								fields=["name", "title"])
	}
	for r in rows:
		r["survey_title"] = titles.get(r.survey) or r.survey
	return rows


@frappe.whitelist()
def new_version(survey):
	"""Create a blank Draft version of `survey` at the next free version number.

	Deliberately blank, not a copy of the latest version's questions: this page
	already has an explicit "Copy to version..." action for bringing questions
	across, and auto-copying here would duplicate content the user did not ask
	to duplicate.
	"""
	if not frappe.has_permission(VERSION, "create"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not frappe.db.exists("UCC Survey", survey):
		frappe.throw(_("Survey {0} not found").format(survey))
	count = frappe.db.count(VERSION, {"survey": survey})
	n = next_version_number(count, lambda n: frappe.db.exists(VERSION, f"{survey}-V{n:02d}"))
	doc = frappe.get_doc({
		"doctype": VERSION, "survey": survey,
		"version_number": f"{n:02d}", "status": "Draft",
	}).insert()
	return doc.name


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
			"sequence", "display_logic", "display_logic_config", "matrix_rows",
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
def add_question(survey_version, question_type="Short Text", sequence=None):
	"""Insert a new question at the given position (defaults to the end)."""
	doc = frappe.new_doc(QUESTION)
	doc.survey_version = survey_version
	doc.question_type = question_type
	doc.question_text = _("Enter your question")
	if sequence is None:
		doc.sequence = _resequence(survey_version)  # append after the last
	else:
		doc.sequence = int(sequence)
		_resequence(survey_version, make_room_at=doc.sequence)
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
		"display_logic", "display_logic_config", "sequence", "matrix_rows",
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
	_resequence(src.survey_version, make_room_at=dup.sequence)
	dup.insert()
	return dup.name


@frappe.whitelist()
def delete_question(question):
	survey_version = frappe.db.get_value(QUESTION, question, "survey_version")
	frappe.delete_doc(QUESTION, question)
	if survey_version:
		_resequence(survey_version)  # keep sequences dense after deletion
	return True


# --- editorial conveniences (checkpoint 12) ---

def _choices_from_options(options):
	return [
		{"choice_label": c.strip(), "sequence": i}
		for i, c in enumerate((options or "").split(",")) if c.strip()
	]


@frappe.whitelist()
def bulk_paste_questions(survey_version, text):
	"""Create many questions from `question | type | options` lines."""
	_require(survey_version, "write")
	start = _resequence(survey_version)  # dense append base, not raw count
	created = []
	for i, q in enumerate(parse_bulk_questions(text)):
		doc = frappe.new_doc(QUESTION)
		doc.survey_version = survey_version
		doc.question_type = q["question_type"]
		doc.question_text = q["question_text"]
		doc.sequence = start + i
		for ch in _choices_from_options(q["options"]):
			doc.append("choices", ch)
		doc.insert()
		created.append(doc.name)
	return created


@frappe.whitelist()
def create_question(survey_version, payload):
	"""Create one question from a full field payload (used by undo-of-delete)."""
	_require(survey_version, "write")
	data = _loads(payload)
	doc = frappe.new_doc(QUESTION)
	doc.survey_version = survey_version
	for field in ("question_text", "question_type", "help_text", "is_required",
				  "display_logic", "display_logic_config", "sequence", "matrix_rows"):
		if field in data:
			doc.set(field, data[field])
	for c in data.get("choices", []):
		doc.append("choices", {
			"choice_label": c.get("choice_label", ""),
			"choice_value": c.get("choice_value"),
			"sequence": c.get("sequence", 0),
		})
	doc.insert()
	return doc.name


@frappe.whitelist()
def bulk_delete_questions(names):
	versions = set()
	for name in _loads(names):
		versions.add(frappe.db.get_value(QUESTION, name, "survey_version"))
		frappe.delete_doc(QUESTION, name)
	for version in filter(None, versions):
		_resequence(version)  # keep sequences dense after deletion
	return True


@frappe.whitelist()
def copy_questions_to_version(names, target_version):
	"""Copy selected questions (with choices) into another version — the basis
	for copying content between surveys."""
	_require(target_version, "write")
	base = _resequence(target_version)  # dense append base, not raw count
	created = []
	for i, name in enumerate(_loads(names)):
		dup = frappe.copy_doc(frappe.get_doc(QUESTION, name))
		dup.survey_version = target_version
		dup.sequence = base + i
		dup.insert()
		created.append(dup.name)
	return created


# Decision V5: sectioning is consolidated on the "Section Heading" question
# type (the only mechanism the builder UI and public form ever supported). The
# UCC Survey Section doctype and its duplicate_section API were removed —
# copy-between-surveys is covered by copy_questions_to_version, which carries
# Section Heading rows like any other question.


@frappe.whitelist()
def campaign_qr(campaign):
	"""SVG QR code for a campaign's public survey link."""
	if not frappe.has_permission(CAMPAIGN, "read", doc=campaign):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	token = frappe.db.get_value(CAMPAIGN, campaign, "public_token")
	if not token:
		frappe.throw(_("Campaign has no public token."))
	url = frappe.utils.get_url("/survey?token=" + token)
	# TODO: bench-verify - needs the `qrcode` package (added to pyproject
	# dependencies); confirm it is installed in the bench environment.
	import io

	import qrcode
	import qrcode.image.svg

	img = qrcode.make(url, image_factory=qrcode.image.svg.SvgImage)
	buf = io.BytesIO()
	img.save(buf)
	return {"url": url, "svg": buf.getvalue().decode("utf-8")}
