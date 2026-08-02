#!/usr/bin/env python
"""READ-ONLY. Is there a real standards register that UCC Standard duplicates?

    cd ~/ucc-sms-v2/sites
    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/probe_standards_register.py ucc-sms-v2.orb.local

This writes NOTHING and decides NOTHING. It answers the four counting questions
that docs/13-ucc-standard-findings.md could not answer without a bench, which is
the same shape of probe that settled the UCC Objective question (7 invented rows
against 97 real ones).

Nothing here migrates, removes or modifies. That call is Felix's.
"""

import sys

import frappe

SITE = sys.argv[1] if len(sys.argv) > 1 else "ucc-sms-v2.orb.local"

frappe.init(site=SITE)
frappe.connect()

REGISTER = "Policies And Standards Management"


def line(label, value):
	print("  %-52s %s" % (label, value))


print("site: %s\n" % frappe.utils.get_url())

# --- 1. what does this app's own DocType hold? ---------------------------
print("1. UCC Standard (this app's invented DocType)")
ours = frappe.get_all("UCC Standard", fields=["name", "standard_code", "standard_name"])
line("rows", len(ours))
line("of which DEMO-", sum(1 for r in ours if str(r.name).startswith("DEMO-")))
for r in ours[:15]:
	line("   %s" % r.name, r.standard_name or "")

# --- 2. does the institutional register exist, and how big is it? --------
print("\n2. %s (the candidate real register)" % REGISTER)
if not frappe.db.exists("DocType", REGISTER):
	line("exists", "NO - the register named in api/mapping.py is not on this site")
	line("meaning", "UCC Standard may be the only standards list here; findings change")
else:
	line("exists", "yes")
	line("rows", frappe.db.count(REGISTER))
	meta = frappe.get_meta(REGISTER)
	line("fields", ", ".join(sorted(f.fieldname for f in meta.fields))[:200])
	for r in frappe.get_all(REGISTER, fields=["name"], limit_page_length=10):
		line("   %s" % r.name, "")

# --- 3. do objectives already carry the link? ----------------------------
print("\n3. Survey Objective -> the register")
if frappe.db.exists("DocType", "Survey Objective"):
	meta = frappe.get_meta("Survey Objective")
	links = [f.fieldname for f in meta.fields if f.fieldtype == "Link"]
	line("objectives", frappe.db.count("Survey Objective"))
	line("Link fields", ", ".join(links) or "(none)")
	to_register = [f.fieldname for f in meta.fields
				   if f.fieldtype == "Link" and f.options == REGISTER]
	line("links to the register via", ", ".join(to_register) or "(none found)")
	for fieldname in to_register:
		filled = frappe.db.count("Survey Objective", {fieldname: ["is", "set"]})
		line("   %s populated on" % fieldname, "%d objective(s)" % filled)
else:
	line("Survey Objective", "not on this site")

# --- 4. is our field even used, and does it agree with the objective? ----
print("\n4. UCC Question Mapping.standard - is it carrying anything?")
total = frappe.db.count("UCC Question Mapping")
with_standard = frappe.db.count("UCC Question Mapping", {"standard": ["is", "set"]})
with_clause = frappe.db.count("UCC Question Mapping", {"primary_clause": ["is", "set"]})
line("mapping rows", total)
line("with .standard set", with_standard)
line("with .primary_clause set (free text)", with_clause)
line("nothing in the calculation chain reads .standard", "index_calc reads objective + primary_clause only")

print("\nRead-only probe complete. Nothing was written.")
frappe.destroy()
