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

# Frappe exposes the decorator at frappe.rate_limiter.rate_limit, NOT as
# frappe.rate_limit — the latter never existed and raised AttributeError at
# import time on v15.83.0, taking the whole module (and its tests) with it.
#
# Deliberately imported directly, with no try/except fallback: this is the rate
# limit on the only guest-reachable write path, and a module that imports
# cleanly while silently dropping its protection is far worse than one that
# refuses to load.
from frappe.rate_limiter import rate_limit

from ucc_measurement_outcomes.submission_utils import (
	campaign_window_open,
	has_value,
	to_text,
)

CAMPAIGN = "UCC Survey Campaign"
# D2: Survey Tracking IS the campaign. Token resolution now points here.
TRACKING = "Survey Tracking"
QUESTION = "UCC Survey Question"
VERSION = "UCC Survey Version"

# Decorator location/signature now confirmed against Frappe v15.83.0.
# TODO: bench-verify - the VALUES remain a guess: agree acceptable limits with
# UCC (20 submissions per token per hour) against expected real traffic.
RATE_LIMIT = {"limit": 20, "seconds": 3600}

# IMPORTANT for verification: frappe's rate_limit wrapper begins with
# `if not frappe.request: return fun(...)`, so it is a no-op when called
# in-process (bench console, unit tests). It can only be proven over real HTTP.
# See BENCH_VERIFY.md "Rate limiting" for the curl check that actually exercises it.


def _tracking_date_fields():
	"""Survey Tracking is educ_sg's; its window fieldnames are theirs, not ours.
	Felix's description gives "date start/end" but the real spelling has never
	been dumped, and two probes on this project already died on a guessed
	column. Resolve from the meta and treat an unresolved bound as unbounded."""
	real = {df.fieldname for df in frappe.get_meta(TRACKING).fields}
	start = next((f for f in ("date_start", "start_date", "opens_on", "from_date") if f in real), None)
	end = next((f for f in ("date_end", "end_date", "closes_on", "to_date") if f in real), None)
	return start, end


def _get_open_campaign(token, for_update=False):
	"""Resolve a public token to the Survey Tracking record acting as its
	campaign, or refuse. D2 made Survey Tracking the campaign; token resolution
	still pointed at the retired UCC Survey Campaign, which is why a genuinely
	minted token returned "Survey not found"."""
	if not token:
		frappe.throw(_("Survey not found."), frappe.DoesNotExistError)
	name = frappe.db.get_value(TRACKING, {"ucc_public_token": token}, "name")
	if not name:
		# Generic message: never confirm/deny a token to an anonymous caller.
		frappe.throw(_("Survey not found."), frappe.DoesNotExistError)
	# for_update: the submit path locks the campaign row so the one-response
	# check-then-insert cannot race with a concurrent submit for this campaign.
	# ponytail: serialises submissions per campaign; per-respondent locking if
	# a single campaign ever needs high submit throughput.
	campaign = frappe.get_doc(TRACKING, name, for_update=for_update)

	start_f, end_f = _tracking_date_fields()
	as_date = frappe.utils.getdate
	if not campaign_window_open(
		campaign.get("ucc_collection_status"),
		as_date(campaign.get(start_f)) if start_f and campaign.get(start_f) else None,
		as_date(campaign.get(end_f)) if end_f and campaign.get(end_f) else None,
		as_date(),
	):
		# Covers the historical Survey Tracking rows too: they are post-hoc
		# consolidation records with no collection status, so they can never be
		# opened by a token even if one were somehow set on them.
		frappe.throw(_("This survey is not currently open."))

	version = campaign.get("ucc_survey_version")
	if not version:
		frappe.throw(_("This survey is not currently open."))
	# Decision V2: the campaign window is not the only gate. The version must be
	# Published (which also blocks Draft/In Review — previously a campaign could
	# serve unpublished content, violating the only-published-content principle —
	# and blocks Closed), and an Archived survey stops collecting.
	version_status, survey = frappe.db.get_value(
		VERSION, version, ["status", "survey"]
	)
	if version_status != "Published" or frappe.db.get_value(
		"UCC Survey", survey, "status"
	) == "Archived":
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
	version = campaign.get("ucc_survey_version")
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
@rate_limit(key="token", **RATE_LIMIT)
def get_public_survey(token):
	"""Return published questions for rendering the public form. Read-only."""
	return public_survey_payload(token)


@frappe.whitelist(allow_guest=True)
@rate_limit(key="token", **RATE_LIMIT)
def submit_survey(token, answers, respondent_key=None):
	"""Validate and atomically persist one Submission + one Answer per question.

	answers: JSON list of {"question": <question name>, "value": <str|list>}.
	Any exception rolls back the whole request transaction, so a Submission is
	never left without its Answers.
	"""
	campaign = _get_open_campaign(token, for_update=True)
	version = campaign.get("ucc_survey_version")
	answers = json.loads(answers) if isinstance(answers, str) else answers
	if not isinstance(answers, list) or not all(isinstance(a, dict) for a in answers):
		frappe.throw(_("Invalid submission."))

	# One response per respondent, unless the campaign explicitly allows more.
	if respondent_key and not campaign.get("ucc_allow_multiple_responses"):
		if frappe.db.exists(
			"UCC Survey Submission",
			{"survey_tracking": campaign.name, "respondent_key": respondent_key, "status": "Completed"},
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
		"survey_tracking": campaign.name,
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
