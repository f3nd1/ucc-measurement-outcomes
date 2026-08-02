#!/usr/bin/env python
"""Build the throwaway survey the probes run against, so they never touch a live one.

    cd ~/ucc-sms-v2/sites
    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/setup_probe_survey.py ucc-sms-v2.orb.local <planning_record>
    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/setup_probe_survey.py ucc-sms-v2.orb.local --remove

Route 2, decided 2026-08-02. Two probes had nowhere safe to run:

  * probe_submit_validation.py skips its "NPS value of 47" case whenever the
    target version holds no NPS question, and it has been skipping it since
    round 10.
  * probe_guest_csrf.py needs a scale question to submit a VALID answer with,
    and exits "nothing valid to submit" without one.

So this survey carries both: one Rating and one NPS. Everything it creates is
named PROBE- and nothing here writes to an existing survey, version, campaign or
question.

WHY IT ASKS FOR A PLANNING RECORD. A campaign is a `Survey Tracking` row and
educ_sg makes its `survey_name` (Survey Management) mandatory. The standing
decision (2026-07-26, reaffirmed 2026-07-29) is that this app does NOT create
stub planning records - that would put documents nobody planned into the
institutional register this app exists to produce evidence from. So you name an
existing one and this attaches to it; it is never invented and never guessed.

It goes through api.campaign.start_collecting rather than inserting Survey
Tracking directly, so the token is minted by survey_tracking_hooks - the one
place that decides what a public token is - and the same three refusals apply.

Idempotent: re-running finds what exists instead of building a second copy.
Explicit frappe.db.commit(); a bench script gets no autocommit.
"""

import sys

import frappe

SITE = sys.argv[1] if len(sys.argv) > 1 else "ucc-sms-v2.orb.local"
ARG = sys.argv[2] if len(sys.argv) > 2 else None

PREFIX = "PROBE-"
TITLE = PREFIX + " Probe test survey (safe to delete)"
DESCRIPTION = ("Automated test target for scripts/probe_submit_validation.py and "
               "scripts/probe_guest_csrf.py. Not a real survey. Safe to delete.")
RATING_Q = "PROBE: rate this test question from 1 to 5"
NPS_Q = "PROBE: how likely are you to recommend this test survey?"

TRACKING = "Survey Tracking"
PLANNING_FIELD = "survey_name"

frappe.init(site=SITE)
frappe.connect()


def line(label, value):
	print("  %-26s %s" % (label, value))


# --------------------------------------------------------------- teardown ---
def remove():
	"""Delete the probe survey and everything hanging off it. PROBE- only."""
	surveys = frappe.get_all("UCC Survey", filters={"title": ["like", PREFIX + "%"]},
							 fields=["name", "title"])
	if not surveys:
		print("No PROBE- survey on this site. Nothing to remove.")
		return 0

	total = 0
	for s in surveys:
		versions = frappe.get_all("UCC Survey Version", filters={"survey": s.name}, pluck="name")
		# The campaign is educ_sg's Survey Tracking. Only rows pointing at a
		# PROBE version are touched - the link is what proves ownership, since a
		# Survey Tracking row carries no title of ours to prefix.
		campaigns = frappe.get_all(TRACKING, filters={"ucc_survey_version": ["in", versions or [""]]},
								   pluck="name") if versions else []
		subs = frappe.get_all("UCC Survey Submission",
							  filters={"survey_version": ["in", versions or [""]]},
							  pluck="name") if versions else []
		answers = frappe.get_all("UCC Survey Answer",
								 filters={"submission": ["in", subs or [""]]},
								 pluck="name") if subs else []
		questions = frappe.get_all("UCC Survey Question",
								   filters={"survey_version": ["in", versions or [""]]},
								   pluck="name") if versions else []
		plan = [("UCC Survey Answer", answers), ("UCC Survey Submission", subs),
				(TRACKING, campaigns), ("UCC Survey Question", questions),
				("UCC Survey Version", versions), ("UCC Survey", [s.name])]
		for doctype, names in plan:
			for name in names:
				if doctype == "UCC Survey Version":
					frappe.db.set_value("UCC Survey", s.name, "current_version", None)
				frappe.delete_doc(doctype, name, ignore_permissions=True, force=True)
				total += 1
	frappe.db.commit()
	print("Removed %d record(s) belonging to the probe survey." % total)
	return total


if ARG == "--remove":
	remove()
	frappe.destroy()
	sys.exit(0)


# --------------------------------------------------------------- planning ---
if not ARG:
	print("This needs the planning record the campaign will attach to.\n")
	print("A campaign is a Survey Tracking row and educ_sg makes its %s mandatory."
		  % PLANNING_FIELD)
	print("This script does not invent one - pick an existing record:\n")
	meta_field = frappe.get_meta(TRACKING).get_field(PLANNING_FIELD)
	target = meta_field.options if meta_field else None
	if target:
		rows = frappe.get_all(target, fields=["name"], order_by="modified desc",
							  limit_page_length=15)
		for r in rows:
			print("    %s" % r.name)
		if not rows:
			print("    (none exist on this site - create one in %s first)" % target)
	print("\nThen re-run:")
	print("    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/"
		  "setup_probe_survey.py %s <planning_record>" % SITE)
	frappe.destroy()
	sys.exit(1)

planning = ARG
meta_field = frappe.get_meta(TRACKING).get_field(PLANNING_FIELD)
planning_doctype = meta_field.options if meta_field else None
if planning_doctype and not frappe.db.exists(planning_doctype, planning):
	print("No %s named %r on this site. Nothing was created." % (planning_doctype, planning))
	frappe.destroy()
	sys.exit(1)

print("site            : %s" % frappe.utils.get_url())
line("planning record", "%s %s" % (planning_doctype or "?", planning))

# --------------------------------------------------------------- build ------
existing = frappe.get_all("UCC Survey", filters={"title": TITLE}, pluck="name")
if existing:
	survey_name = existing[0]
	print("\nProbe survey already exists: %s" % survey_name)
else:
	survey_name = frappe.get_doc({
		"doctype": "UCC Survey", "title": TITLE, "status": "Active",
		"description": DESCRIPTION,
	}).insert().name
	print("\nCreated survey %s" % survey_name)

versions = frappe.get_all("UCC Survey Version", filters={"survey": survey_name},
						  fields=["name", "status"], order_by="creation asc")
if versions:
	version = versions[0].name
	line("version", "%s (%s, reused)" % (version, versions[0].status))
else:
	doc = frappe.get_doc({"doctype": "UCC Survey Version", "survey": survey_name,
						  "version_number": "01", "status": "Draft"}).insert()
	version = doc.name
	line("version", "%s (created Draft)" % version)

have = {q.question_type for q in frappe.get_all(
	"UCC Survey Question", filters={"survey_version": version},
	fields=["question_type"])}

status = frappe.db.get_value("UCC Survey Version", version, "status")
if status == "Draft":
	seq = 0
	if "Rating" not in have:
		frappe.get_doc({
			"doctype": "UCC Survey Question", "survey_version": version,
			"question_type": "Rating", "question_text": RATING_Q, "sequence": seq,
			"choices": [{"choice_label": str(i), "choice_value": str(i)} for i in range(1, 6)],
		}).insert()
		line("added", "Rating question")
	seq += 1
	if "NPS" not in have:
		frappe.get_doc({
			"doctype": "UCC Survey Question", "survey_version": version,
			"question_type": "NPS", "question_text": NPS_Q, "sequence": seq,
		}).insert()
		line("added", "NPS question")
	version_doc = frappe.get_doc("UCC Survey Version", version)
	version_doc.status = "Published"
	version_doc.save()
	line("version status", "Published")
else:
	line("version status", "%s (already published, left alone)" % status)
	missing = {"Rating", "NPS"} - have
	if missing:
		print("\n!! The published probe version is missing: %s" % ", ".join(sorted(missing)))
		print("   A published version's content is frozen. Run --remove and re-run this")
		print("   script to rebuild it from scratch.")
		frappe.destroy()
		sys.exit(2)

# --------------------------------------------------------------- campaign ---
campaign = frappe.get_all(TRACKING, filters={"ucc_survey_version": version},
						  fields=["name", "ucc_public_token", "ucc_collection_status"])
if campaign:
	token = campaign[0].ucc_public_token
	line("campaign", "%s (%s, reused)" % (campaign[0].name, campaign[0].ucc_collection_status))
else:
	from ucc_measurement_outcomes.api.campaign import start_collecting
	# Same gate the UI uses: refuses on a non-Published version, on a version
	# that already has a campaign, and without a planning record. The token is
	# minted by survey_tracking_hooks, not here.
	result = start_collecting(version, planning)
	token = result["token"]
	line("campaign", "%s (created, Open)" % result["campaign"])

frappe.db.commit()

if not token:
	print("\n!! The campaign exists but carries no public token. survey_tracking_hooks")
	print("   mints one when a collection status appears - check that the row's")
	print("   ucc_collection_status is Open.")
	frappe.destroy()
	sys.exit(2)

line("public token", token)
print("\nBoth probes now find this survey automatically - it is the only PROBE- one:")
print("    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/add_nps_question.py %s" % SITE)
print("    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/probe_guest_csrf.py %s" % SITE)
print("    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/probe_submit_validation.py %s %s"
	  % (SITE, token))
print("\nWhen you are done with it:")
print("    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/setup_probe_survey.py %s --remove" % SITE)

frappe.destroy()
