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
VERSION = "UCC Survey Version"

# educ_sg's mandatory planning link on Survey Tracking. Decision 2026-07-26
# (docs/09-decision-log.md, Finding A) settled that it stays mandatory: this app
# will not auto-create stub planning records into the institutional register, and
# will not relax someone else's constraint with a Property Setter. So collecting
# needs a real planning record — the work below is making that the ONLY thing
# asked for, instead of a raw Desk form full of fields nobody here owns.
PLANNING_FIELD = "survey_name"


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


@frappe.whitelist()
def collection_setup(survey_version):
	"""What the Builder's "Start collecting" dialog must ask the user for.

	Exactly one field, and it is not ours. survey_name is educ_sg's, and while
	the FIELDNAME is known the DocType it links to has never been dumped on this
	project — so it is read off the real meta rather than hardcoded, the same
	rule api/extract._resolve() follows and for the same reason (two probes here
	have already died on a column spelled differently than expected).

	Everything else a campaign needs — the survey version, the collection status,
	the public token — is set server-side and never shown.
	"""
	if not frappe.has_permission(VERSION, "read", doc=survey_version):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not frappe.has_permission(TRACKING, "create"):
		frappe.throw(
			_("You do not have permission to create a campaign."), frappe.PermissionError
		)
	df = frappe.get_meta(TRACKING).get_field(PLANNING_FIELD)
	if not df:
		# Loudly, not with a fallback: a campaign created without the planning
		# link would fail educ_sg's own mandatory check anyway, and a silent
		# workaround here is how three earlier unverified assumptions stayed
		# hidden. Name the fix.
		frappe.throw(
			_("Survey Tracking has no {0} field on this site, so this app cannot tell "
			  "what its planning record is called. Fix PLANNING_FIELD in "
			  "api/campaign.py against the real DocType.").format(PLANNING_FIELD)
		)
	return {
		# Data, not Link, when the field is not a Link on this site — better a
		# plain box than a Link control pointed at nothing.
		"fieldtype": "Link" if df.fieldtype == "Link" and df.options else "Data",
		"options": df.options,
		"label": df.label or PLANNING_FIELD,
	}


@frappe.whitelist()
def start_collecting(survey_version, planning_record):
	"""Create the Survey Tracking row that turns a published version into a live
	campaign, and let survey_tracking_hooks mint its token.

	Refuses rather than guesses in three places, because this is the record the
	public endpoint reads to decide whether to accept a stranger's response:

	  - not Published  → a campaign on a Draft would collect answers against
	                     questions that can still change, so the responses would
	                     not be reproducible against anything.
	  - already exists → a second campaign on one version silently splits its
	                     responses in two. Say which one is already there.
	  - no planning record → educ_sg's own mandatory check, surfaced with our
	                     wording instead of a raw form error.

	Deliberately does NOT set the collection window. Its fieldnames on Survey
	Tracking are still unverified (see survey_tracking_hooks.validate) and this
	is a write path — an unbounded window is correct and honest, a guessed
	fieldname would silently write nothing. Set dates on the campaign itself.
	"""
	if not frappe.has_permission(VERSION, "read", doc=survey_version):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not frappe.has_permission(TRACKING, "create"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	if not planning_record:
		frappe.throw(_("Pick the planning record this collection belongs to."))

	status = frappe.db.get_value(VERSION, survey_version, "status")
	if status != "Published":
		frappe.throw(
			_("Version {0} is {1}. Publish it before collecting responses.").format(
				survey_version, _(status or "Draft")
			)
		)
	existing = frappe.get_all(
		TRACKING, filters={"ucc_survey_version": survey_version}, pluck="name", limit=1
	)
	if existing:
		frappe.throw(
			_("Campaign {0} already points at this version. Open it to change its "
			  "collection status rather than creating a second one.").format(existing[0])
		)

	doc = frappe.get_doc({
		"doctype": TRACKING,
		PLANNING_FIELD: planning_record,
		"ucc_survey_version": survey_version,
		# The token is NOT set here: survey_tracking_hooks.validate mints it the
		# moment a collection status appears, so there is one place that decides
		# what a public token is.
		"ucc_collection_status": "Open",
	}).insert()
	return {"campaign": doc.name, "token": doc.get("ucc_public_token")}


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
