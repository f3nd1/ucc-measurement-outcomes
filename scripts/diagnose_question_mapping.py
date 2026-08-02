#!/usr/bin/env python
"""READ-ONLY. Did the objective mapping save, or is the canvas not refreshing?

    cd ~/ucc-sms-v2/sites
    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/diagnose_question_mapping.py ucc-sms-v2.orb.local
    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/diagnose_question_mapping.py ucc-sms-v2.orb.local <survey_version>

Writes nothing. It answers the one question that cannot be answered by reading
code: is there a UCC Question Mapping row for this survey version, and if so why
does get_mapping_overview not return it.

The two endpoints the Objectives workspace reads - `get_mapping_overview` and
`mapping_coverage` - BOTH filter mappings on `survey_version`. So a row whose
`survey_version` is empty exists in the database and is invisible in the UI:
saved AND not shown, at the same time. That is the state this checks for, and it
is the only one that produces "0 mapped" next to a row that really is there.

(`survey_version` carries `fetch_from = question.survey_version`, and Frappe DOES
apply that server-side - `get_invalid_links` in frappe/model/base_document.py
v15.83.0, called from insert() and _save(). So a row created today should have
it. A row created BEFORE that field existed never gets backfilled.)
"""

import sys

import frappe

SITE = sys.argv[1] if len(sys.argv) > 1 else "ucc-sms-v2.orb.local"
VERSION_ARG = sys.argv[2] if len(sys.argv) > 2 else None

frappe.init(site=SITE)
frappe.connect()

MAPPING = "UCC Question Mapping"


def line(label, value):
	print("  %-46s %s" % (label, value))


print("site: %s\n" % frappe.utils.get_url())

# --- every mapping row on the site, regardless of version -----------------
all_rows = frappe.get_all(
	MAPPING, fields=["name", "question", "survey_version", "objective", "primary_clause", "creation"],
	order_by="creation desc")
print("1. UCC Question Mapping - every row on this site")
line("rows total", len(all_rows))
orphaned = [r for r in all_rows if not r.survey_version]
line("rows with NO survey_version (invisible in the UI)", len(orphaned))
for r in all_rows[:10]:
	print("   %-14s q=%-12s ver=%-16s obj=%-12s %s"
		  % (r.name[:14], str(r.question)[:12], str(r.survey_version or "(EMPTY)")[:16],
			 str(r.objective)[:12], r.creation))

if orphaned:
	print("\n   >>> THIS IS THE BUG: those rows SAVED but no view can find them.")
	print("   >>> Each one's question knows the right version; the row does not.")
	for r in orphaned[:10]:
		should = frappe.db.get_value("UCC Survey Question", r.question, "survey_version")
		print("       %s  should be survey_version=%s" % (r.name, should))

# --- the version the workspace is actually looking at ---------------------
version = VERSION_ARG
if not version:
	versions = frappe.get_all("UCC Survey Version", fields=["name", "survey", "status"],
							  order_by="modified desc", limit_page_length=5)
	print("\n2. Recent survey versions (pass one as argv[2] to pin this)")
	for v in versions:
		qn = frappe.db.count("UCC Survey Question", {"survey_version": v.name})
		mp = frappe.db.count(MAPPING, {"survey_version": v.name})
		line("%s (%s)" % (v.name, v.status), "%d question(s), %d mapping(s)" % (qn, mp))
	version = versions[0].name if versions else None

if not version:
	print("\nNo survey version to inspect.")
	frappe.destroy()
	sys.exit(1)

print("\n3. What the workspace sees for %s" % version)
questions = frappe.get_all("UCC Survey Question", filters={"survey_version": version},
						   fields=["name", "question_type", "question_text"])
mapped = frappe.get_all(MAPPING, filters={"survey_version": version},
						fields=["question", "objective"])
line("questions", len(questions))
line("mappings found by the UI's filter", len(mapped))
# The same filter the UI does NOT use - by question rather than by version.
by_question = frappe.get_all(MAPPING, filters={"question": ["in", [q.name for q in questions] or [""]]},
							 fields=["name", "question", "survey_version", "objective"])
line("mappings found by QUESTION instead", len(by_question))
if len(by_question) > len(mapped):
	print("\n   >>> SAVED BUT INVISIBLE. %d row(s) point at this version's questions"
		  % (len(by_question) - len(mapped)))
	print("   >>> but do not carry survey_version, so both endpoints skip them.")
elif not by_question:
	print("\n   >>> NOTHING SAVED. No mapping row references any question in this")
	print("   >>> version, so this is a write failure, not a refresh failure.")
	print("   >>> Check the browser console and Error Log for the failed call.")
else:
	print("\n   >>> ROWS ARE PRESENT AND VISIBLE to both endpoints. If the UI still")
	print("   >>> shows 0 mapped, it is a front-end refresh problem - reload the")
	print("   >>> page; if the count is then correct, the re-render is at fault.")

print("\n4. Recent server errors mentioning mapping")
for e in frappe.get_all("Error Log", filters={"error": ["like", "%question_mapping%"]},
						fields=["creation", "method"], order_by="creation desc",
						limit_page_length=5):
	line(str(e.creation), e.method)

print("\nRead-only diagnostic complete. Nothing was written.")
frappe.destroy()
