# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""UCC Survey.owner_department: free text -> Link to Department.

Run the REPORT first, on the real site, before migrating:

    bench --site <site> execute \\
        ucc_measurement_outcomes.patches.v0_8_0.link_owner_department.report

It writes nothing. It prints every distinct value in the column, what it would
become, and what it cannot match — which is the decision this migration is not
entitled to make on its own.

NOTHING IS DROPPED. A value that cannot be matched to exactly one Department is
moved to owner_department_legacy (read-only, hidden when empty) and the link is
left blank. The two alternatives were both rejected:

  - Leave the unmatched text in the Link column. Frappe's _validate_links()
    throws on the NEXT save of that survey, so it is a landmine that fires
    weeks later on an unrelated edit.
  - Blank it. Silent loss of something a human typed.

The rewrite rule itself lives in department_match.py with its own bench-free
test, because a patch that rewrites a column is the last place to discover the
matching rule was wrong.
"""

import frappe

from ucc_measurement_outcomes.department_match import plan

SURVEY = "UCC Survey"
DEPARTMENT = "Department"


def _departments():
	"""Every Department, or None when the DocType is not installed at all.

	Department is ERPNext's (erpnext/setup/doctype/department), NOT core
	Frappe's — verified against source. On a Frappe-only site it does not exist,
	and this patch must say so rather than throw a confusing SQL error in the
	middle of bench migrate.
	"""
	if not frappe.db.table_exists(DEPARTMENT):
		return None
	return frappe.get_all(DEPARTMENT, fields=["name", "department_name"])


def _current():
	"""Surveys with something in owner_department, read straight from the DB.

	get_all, never get_doc: the column is mid-conversion, so loading these as
	documents would run Link validation against the very values this patch
	exists to fix, and the patch would die on the first bad row.

	Filtered in Python rather than in the query — "" and NULL in one filter needs
	an operator whose exact behaviour I cannot check without a bench, and there
	are tens of surveys, not millions.
	"""
	rows = frappe.get_all(SURVEY, fields=["name", "owner_department"])
	return [r for r in rows if (r.owner_department or "").strip()]


def _analyse():
	departments = _departments()
	rows = _current()
	if departments is None:
		return None, rows, {}
	return departments, rows, plan([r.owner_department for r in rows], departments)


def report():
	"""Read-only. Safe to run any number of times, before or after migrating."""
	departments, rows, mapping = _analyse()
	print("UCC Survey.owner_department -> Department")
	if departments is None:
		print("  Department is NOT installed on this site (no table). The field will")
		print("  be a Link pointing at a DocType that does not exist. Install ERPNext")
		print("  or revert the field to Data before migrating.")
		return
	print("  %d Department records, %d surveys with a value set." % (len(departments), len(rows)))
	if not rows:
		print("  Nothing to migrate.")
		return
	counts = {}
	for r in rows:
		counts[r.owner_department] = counts.get(r.owner_department, 0) + 1
	for value in sorted(counts):
		name, reason = mapping[value]
		print("  %-40s x%-3d %s" % (
			repr(value), counts[value],
			("-> " + name) if name else ("UNMATCHED (%s)" % reason)))
	unmatched = sum(counts[v] for v in counts if not mapping[v][0])
	print("  %d surveys will be linked, %d moved to owner_department_legacy."
		  % (len(rows) - unmatched, unmatched))


def execute():
	departments, rows, mapping = _analyse()
	if departments is None:
		# Loudly, and without touching anything. A silent skip here would leave a
		# Link field pointing at a DocType that is not there, looking migrated.
		frappe.log_error(
			title="UCC: owner_department not migrated",
			message="Department is not installed on this site, so UCC Survey."
					"owner_department was left as it is. Install ERPNext or revert "
					"the field to Data.",
		)
		print("Department not installed — owner_department left untouched.")
		return
	if not rows:
		print("owner_department: nothing to migrate.")
		return

	linked = moved = 0
	for r in rows:
		name, reason = mapping[r.owner_department]
		if name == r.owner_department:
			continue                       # already a real docname; re-run no-op
		if name:
			frappe.db.set_value(SURVEY, r.name, "owner_department", name,
								update_modified=False)
			linked += 1
		else:
			# Both writes together, so the text is never in neither column.
			frappe.db.set_value(SURVEY, r.name, {
				"owner_department_legacy": r.owner_department,
				"owner_department": None,
			}, update_modified=False)
			moved += 1

	print("owner_department: %d linked, %d moved to owner_department_legacy." % (linked, moved))
	if moved:
		stuck = sorted({r.owner_department for r in rows if not mapping[r.owner_department][0]})
		frappe.log_error(
			title="UCC: owner_department values with no Department",
			message="These values could not be matched and are now in "
					"owner_department_legacy on their surveys:\n\n" + "\n".join(
						"%s  (%s)" % (v, mapping[v][1]) for v in stuck),
		)
