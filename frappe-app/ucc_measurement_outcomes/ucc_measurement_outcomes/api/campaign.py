# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Per-campaign staff analytics (1b). Read-only.

A campaign is a Survey Tracking record with ucc_collection_status set (D2).
Scoped strictly to the one campaign asked for, behind normal Frappe permission
checks - this shows real respondent data, so it is not guest-reachable and does
not use ignore_permissions anywhere.

Reads only this app's Submissions and Answers plus the Survey Tracking header.
Historical Survey Response data is never touched here: it is reference-only.
"""

import frappe
from frappe import _

from ucc_measurement_outcomes.campaign_stats import summarise

TRACKING = "Survey Tracking"
SUBMISSION = "UCC Survey Submission"
ANSWER = "UCC Survey Answer"
QUESTION = "UCC Survey Question"


def _require(name):
	if not frappe.has_permission(TRACKING, "read", doc=name):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


@frappe.whitelist()
def list_campaigns():
	"""Survey Tracking rows being used as campaigns. The ~200 historical rows
	have no collection status and are not campaigns, so they are excluded."""
	if not frappe.has_permission(TRACKING, "read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	return frappe.get_all(
		TRACKING,
		filters={"ucc_collection_status": ["!=", ""]},
		fields=["name", "ucc_collection_status", "ucc_survey_version"],
		order_by="modified desc",
		limit=100,
	)


def _target(doc):
	"""Expected respondent count, if the campaign records one. Field names are
	educ_sg's and have never been dumped, so resolve rather than guess - an
	unresolved target means no response rate, not a made-up one."""
	real = {df.fieldname for df in frappe.get_meta(TRACKING).fields}
	for f in ("no_of_respondents_distributed", "distributed", "target_responses",
			  "total_distributed", "no_of_distributed"):
		if f in real and doc.get(f):
			try:
				return int(doc.get(f))
			except (TypeError, ValueError):
				return None
	return None


@frappe.whitelist()
def campaign_analytics(survey_tracking):
	"""Response rate, trend and per-question distribution for ONE campaign."""
	_require(survey_tracking)
	doc = frappe.get_doc(TRACKING, survey_tracking)
	version = doc.get("ucc_survey_version")

	submissions = frappe.get_all(
		SUBMISSION,
		filters={"survey_tracking": survey_tracking},
		fields=["name", "status", "submitted_on", "creation", "source"],
	)
	for s in submissions:
		# submitted_on is optional; creation is always there and is what the
		# trend needs. Falling back keeps a campaign's early rows on the chart.
		s["submitted_on"] = s.get("submitted_on") or s.get("creation")

	answers = []
	if submissions:
		answers = frappe.get_all(
			ANSWER,
			filters={"submission": ["in", [s["name"] for s in submissions]]},
			fields=["question", "answer_value"],
		)
		texts = {
			q["name"]: q["question_text"]
			for q in frappe.get_all(
				QUESTION, filters={"survey_version": version},
				fields=["name", "question_text"]
			)
		} if version else {}
		for a in answers:
			a["question_text"] = texts.get(a["question"], a["question"])

	out = summarise(submissions, answers, target=_target(doc))
	out["campaign"] = survey_tracking
	out["survey_version"] = version
	out["status"] = doc.get("ucc_collection_status")
	return out
