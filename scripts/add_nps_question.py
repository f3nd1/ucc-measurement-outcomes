#!/usr/bin/env python
"""Add one NPS question to the PROBE test survey.

Why this exists: probe_submit_validation.py has a fourth case ("NPS value of
47") that it SKIPS whenever the target version holds no NPS question, and it
has been skipping it. This adds the one question that case needs.

Run from the site directory (frappe.init defaults sites_path to "."):

    cd ~/ucc-sms-v2/sites
    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/add_nps_question.py ucc-sms-v2.orb.local

It targets the throwaway PROBE- survey and nothing else. Pass a version
explicitly only if you mean to act on a different one:

    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/add_nps_question.py ucc-sms-v2.orb.local <survey_version>

IT REFUSES ON A PUBLISHED VERSION, and that is the point rather than a
limitation. A published version's answer-determining content is frozen -
`UCCSurveyQuestion.validate` calls `assert_doc_version_editable`, so the insert
would be rejected anyway - and adding a question to a version people are already
answering would change the instrument mid-collection. If the target is
published, this prints the two legitimate routes and changes nothing; choosing
between them is not a script's decision.

Writes with an explicit frappe.db.commit() - a bench script gets no autocommit.
Idempotent: a version that already has an NPS question is left alone.
"""

import sys

import frappe

SITE = sys.argv[1] if len(sys.argv) > 1 else "ucc-sms-v2.orb.local"
VERSION_ARG = sys.argv[2] if len(sys.argv) > 2 else None

QUESTION = "How likely are you to recommend United Ceres College to a friend or colleague?"

frappe.init(site=SITE)
frappe.connect()

PROBE_PREFIX = "PROBE-"


def probe_campaign():
	"""The throwaway probe campaign, or None. NEVER a live one.

	Decided 2026-08-02 (route 2): these probes run against a survey built for
	them by scripts/setup_probe_survey.py, not against whatever campaign happens
	to be open. Ownership is proven by the link chain - Survey Tracking ->
	version -> survey whose title carries PROBE- - because a Survey Tracking row
	carries no title of ours to check.
	"""
	surveys = frappe.get_all("UCC Survey", filters={"title": ["like", PROBE_PREFIX + "%"]},
							 pluck="name")
	if not surveys:
		return None
	versions = frappe.get_all("UCC Survey Version", filters={"survey": ["in", surveys]},
							  pluck="name")
	if not versions:
		return None
	rows = frappe.get_all(
		"Survey Tracking",
		filters={"ucc_survey_version": ["in", versions], "ucc_public_token": ["!=", ""],
				 "ucc_collection_status": "Open"},
		fields=["ucc_public_token", "ucc_survey_version"])
	return rows[0] if rows else None


def no_probe_survey(site):
	print("No open PROBE- campaign on this site.")
	print("These probes deliberately do NOT fall back to a live campaign - that is")
	print("what route 2 was decided to avoid. Build the throwaway survey first:\n")
	print("    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/"
		  "setup_probe_survey.py %s <planning_record>" % site)
	print("\n(Run it with no planning record to see which ones exist.)")


def target_version():
	if VERSION_ARG:
		return VERSION_ARG
	probe = probe_campaign()
	if not probe:
		no_probe_survey(SITE)
		sys.exit(1)
	return probe.ucc_survey_version


version = target_version()
status = frappe.db.get_value("UCC Survey Version", version, "status")
print("site    : %s" % frappe.utils.get_url())
print("version : %s (%s)" % (version, status))

existing = frappe.get_all(
	"UCC Survey Question",
	filters={"survey_version": version, "question_type": "NPS"},
	fields=["name", "question_text"],
)
if existing:
	print("\nAlready has an NPS question: %s" % existing[0].name)
	print("  %s" % existing[0].question_text)
	print("Nothing to do - probe_submit_validation.py can run its NPS case.")
	frappe.destroy()
	sys.exit(0)

if status != "Draft":
	print("\nREFUSED: this version is %s, so its content is frozen." % status)
	print("Adding a question here would change the instrument people are already")
	print("answering, and the DocType would reject the insert anyway.")
	print("\nTwo legitimate routes, both a decision for Felix, not this script:")
	print("  1. New version:  duplicate this version, add NPS to the DRAFT copy,")
	print("     publish it and point a new campaign at it. Existing responses keep")
	print("     their own version and stay reportable.")
	print("  2. Separate test survey: build a throwaway Draft survey carrying one")
	print("     NPS question, publish it, open a campaign, and point the probe at")
	print("     that token instead. Nothing real is touched.")
	print("\nRoute 2 is the smaller one if the goal is only probe coverage.")
	frappe.destroy()
	sys.exit(2)

# Dense sequence: land after the last question rather than colliding with it.
last = frappe.get_all("UCC Survey Question", filters={"survey_version": version},
					  fields=["sequence"], order_by="sequence desc", limit_page_length=1)
sequence = (last[0].sequence or 0) + 1 if last else 0

doc = frappe.get_doc({
	"doctype": "UCC Survey Question",
	"survey_version": version,
	"question_type": "NPS",
	"question_text": QUESTION,
	"sequence": sequence,
	"is_required": 0,
}).insert()
frappe.db.commit()

print("\nAdded %s at sequence %d." % (doc.name, sequence))
print("  %s" % QUESTION)
print("\nNow re-run the validation probe; its NPS case will no longer skip:")
print("  ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/probe_submit_validation.py %s" % SITE)

frappe.destroy()
