#!/usr/bin/env python
"""Add one NPS question to the survey version an open campaign points at.

Why this exists: probe_submit_validation.py has a fourth case ("NPS value of
47") that it SKIPS whenever the target version holds no NPS question, and it
has been skipping it. This adds the one question that case needs.

Run from the bench directory:

    cd ~/frappe-bench
    env/bin/python apps/ucc_measurement_outcomes/scripts/add_nps_question.py ucc-sms-v2.orb.local

Pass a version explicitly if the site has more than one open campaign:

    env/bin/python apps/.../add_nps_question.py ucc-sms-v2.orb.local <survey_version>

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


def target_version():
	if VERSION_ARG:
		return VERSION_ARG
	# Same discovery the validation probe uses, so both act on the same version.
	rows = frappe.get_all(
		"Survey Tracking",
		filters={"ucc_public_token": ["!=", ""], "ucc_collection_status": "Open"},
		fields=["name", "ucc_survey_version"],
	)
	if not rows:
		print("No open campaign with a public token. Pass a survey version as argv[2].")
		sys.exit(1)
	if len(rows) > 1:
		print("More than one open campaign; using the first. Pass a version to choose:")
		for r in rows:
			print("   %s  version=%s" % (r.name, r.ucc_survey_version))
	return rows[0].ucc_survey_version


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
print("  env/bin/python apps/ucc_measurement_outcomes/scripts/probe_submit_validation.py %s" % SITE)

frappe.destroy()
