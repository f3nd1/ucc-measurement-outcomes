# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Public (unauthenticated) survey endpoints.

This module is the ONLY guest-reachable surface. Guests have no direct DocType
access; these methods validate everything themselves and then write with
ignore_permissions inside the trust boundary. Only published survey content is
ever exposed, and only raw answers are accepted — never a browser-supplied score.
"""

import json

import frappe
from frappe import _

from ucc_measurement_outcomes.submission_utils import has_value, to_text

CAMPAIGN = "UCC Survey Campaign"
QUESTION = "UCC Survey Question"
VERSION = "UCC Survey Version"

# TODO: bench-verify - rate-limit values are a guess. Confirm acceptable limits
# with UCC (per-token and per-IP) against real traffic + the Frappe version's
# frappe.rate_limit signature.
RATE_LIMIT = {"limit": 20, "seconds": 3600}


def _get_open_campaign(token, for_update=False):
	if not token:
		frappe.throw(_("Survey not found."), frappe.DoesNotExistError)
	name = frappe.db.get_value(CAMPAIGN, {"public_token": token}, "name")
	if not name:
		# Generic message: never confirm/deny a token to an anonymous caller.
		frappe.throw(_("Survey not found."), frappe.DoesNotExistError)
	# for_update: the submit path locks the campaign row so the one-response
	# check-then-insert cannot race with a concurrent submit for this campaign.
	# ponytail: serialises submissions per campaign; per-respondent locking if
	# a single campaign ever needs high submit throughput.
	# TODO: bench-verify - confirm frappe.get_doc(..., for_update=True) row
	# locking on the target Frappe version.
	campaign = frappe.get_doc(CAMPAIGN, name, for_update=for_update)
	if not campaign.is_open():
		frappe.throw(_("This survey is not currently open."))
	return campaign


def _published_questions(survey_version, fields):
	return frappe.get_all(
		QUESTION,
		filters={"survey_version": survey_version},
		fields=fields,
		order_by="sequence asc, creation asc",
	)


def public_survey_payload(token):
	"""Core: published questions for a campaign token. Plain function (no rate
	limit / whitelist) so the public web page can render it server-side without
	going through the API layer."""
	campaign = _get_open_campaign(token)
	version = campaign.survey_version
	header = frappe.db.get_value(
		VERSION, version, ["title_snapshot", "version_number"], as_dict=True
	)
	questions = _published_questions(
		version,
		["name", "question_text", "question_type", "help_text", "is_required", "sequence"],
	)
	for q in questions:
		q["choices"] = frappe.get_all(
			"UCC Survey Question Choice",
			filters={"parent": q["name"], "parenttype": QUESTION},
			fields=["choice_label", "choice_value", "sequence"],
			order_by="idx asc",
		)
	return {
		"title": header.title_snapshot if header else None,
		"version_number": header.version_number if header else None,
		"questions": questions,
	}


@frappe.whitelist(allow_guest=True)
@frappe.rate_limit(key="token", **RATE_LIMIT)
def get_public_survey(token):
	"""Return published questions for rendering the public form. Read-only."""
	return public_survey_payload(token)


@frappe.whitelist(allow_guest=True)
@frappe.rate_limit(key="token", **RATE_LIMIT)
def submit_survey(token, answers, respondent_key=None):
	"""Validate and atomically persist one Submission + one Answer per question.

	answers: JSON list of {"question": <question name>, "value": <str|list>}.
	Any exception rolls back the whole request transaction, so a Submission is
	never left without its Answers.
	"""
	campaign = _get_open_campaign(token, for_update=True)
	version = campaign.survey_version
	answers = json.loads(answers) if isinstance(answers, str) else answers
	if not isinstance(answers, list) or not all(isinstance(a, dict) for a in answers):
		frappe.throw(_("Invalid submission."))

	# One response per respondent, unless the campaign explicitly allows more.
	if respondent_key and not campaign.allow_multiple_responses:
		if frappe.db.exists(
			"UCC Survey Submission",
			{"campaign": campaign.name, "respondent_key": respondent_key, "status": "Completed"},
		):
			frappe.throw(_("A response has already been recorded for you."))

	# Only accept answers to questions that belong to this published version.
	valid = {
		q["name"]: q
		for q in _published_questions(version, ["name", "question_type", "is_required"])
	}
	provided = {}
	for a in answers:
		qid = a.get("question")
		if qid not in valid:
			frappe.throw(_("Unknown question in submission."))
		provided[qid] = a.get("value")

	missing = [qid for qid, q in valid.items() if q["is_required"] and not has_value(provided.get(qid))]
	if missing:
		frappe.throw(_("Please answer all required questions."))

	submission = frappe.get_doc({
		"doctype": "UCC Survey Submission",
		"campaign": campaign.name,
		"survey_version": version,
		"status": "Completed",
		"respondent_key": respondent_key,
		"source": "public",
		"respondent_ip": getattr(frappe.local, "request_ip", None),
	})
	submission.insert(ignore_permissions=True)

	for qid, value in provided.items():
		frappe.get_doc({
			"doctype": "UCC Survey Answer",
			"submission": submission.name,
			"question": qid,
			"survey_version": version,
			"question_type": valid[qid]["question_type"],
			"answer_value": to_text(value),
		}).insert(ignore_permissions=True)

	return {"submission": submission.name, "status": "Completed"}
