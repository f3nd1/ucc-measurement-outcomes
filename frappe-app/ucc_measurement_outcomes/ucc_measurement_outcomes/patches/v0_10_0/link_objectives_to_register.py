# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""UCC Question Mapping.objective: UCC Objective -> Survey Objective.

Run the REPORT first, on the real site, before migrating:

    bench --site <site> execute \\
        ucc_measurement_outcomes.patches.v0_10_0.link_objectives_to_register.report

It writes nothing. It prints every UCC Objective row, what its mappings would
become, and anything it refuses to decide.

Then `bench migrate` runs execute(), which:
  1. re-points mappings whose objective resolves to a real Survey Objective,
  2. deletes DEMO- seeded mappings (demo_data.py recreates them; a dangling Link
     would throw on the next save of that row),
  3. refuses to touch anything else and logs it,
  4. drops the UCC Objective DocType - but ONLY if nothing is left pointing at
     it. A half-migrated site keeps its old table and says why.

The decision rule is objective_migration.py, with its own bench-free test. The
join key is objective_name, not name; see that module for why.
"""

import frappe

from ucc_measurement_outcomes.objective_migration import (
	DROP,
	RELINK,
	REPORT,
	plan_relink,
	summarise,
)

OLD = "UCC Objective"
REGISTER = "Survey Objective"
MAPPING = "UCC Question Mapping"


def _analyse():
	if not frappe.db.table_exists(OLD):
		return None, None
	rows = frappe.get_all(OLD, fields=["name", "objective_name"])
	register = frappe.get_all(REGISTER, pluck="name") if frappe.db.table_exists(REGISTER) else []
	return rows, plan_relink(rows, register)


def _users(objective):
	return frappe.get_all(MAPPING, filters={"objective": objective}, pluck="name")


def report():
	"""Read-only. Safe before or after migrating."""
	rows, plan = _analyse()
	print("UCC Question Mapping.objective -> %s" % REGISTER)
	if rows is None:
		print("  UCC Objective is already gone - nothing to migrate.")
		return
	if not frappe.db.table_exists(REGISTER):
		print("  %s does not exist on this site. This app now links mappings to it,"
			  % REGISTER)
		print("  so the migration cannot run and the field would point at nothing.")
		return
	print("  %d UCC Objective rows, %d records in the register."
		  % (len(rows), frappe.db.count(REGISTER)))
	for name, (action, detail) in sorted(plan.items()):
		print("  %-8s %-32s %-3d mapping(s)  %s"
			  % (action, name, len(_users(name)), detail))
	s = summarise(plan)
	print("  %d relink, %d drop, %d need a human."
		  % (len(s[RELINK]), len(s[DROP]), len(s[REPORT])))


def execute():
	rows, plan = _analyse()
	if rows is None:
		return
	if not frappe.db.table_exists(REGISTER):
		# Loudly, and without touching anything: silently skipping would leave
		# the field pointing at a DocType that is not there while looking done.
		frappe.log_error(
			title="UCC: objectives not migrated",
			message="%s does not exist on this site, so UCC Question Mapping.objective "
					"was left alone. Install the app that provides it, or revert the "
					"field's options to UCC Objective." % REGISTER,
		)
		print("%s missing - objectives left untouched." % REGISTER)
		return

	relinked = dropped = 0
	for name, (action, _detail) in sorted(plan.items()):
		if action == RELINK:
			for mapping in _users(name):
				frappe.db.set_value(MAPPING, mapping, "objective", _detail,
									update_modified=False)
				relinked += 1
		elif action == DROP:
			for mapping in _users(name):
				frappe.delete_doc(MAPPING, mapping, force=True, ignore_permissions=True)
				dropped += 1

	stuck = summarise(plan)[REPORT]
	print("objectives: %d mapping(s) relinked, %d demo mapping(s) deleted." % (relinked, dropped))

	remaining = {name for name in plan if _users(name)}
	if remaining or stuck:
		frappe.log_error(
			title="UCC: UCC Objective kept, migration incomplete",
			message="These UCC Objective rows could not be resolved to a %s and still "
					"have mappings pointing at them:\n\n%s\n\nRun the patch's report() "
					"for detail. The UCC Objective DocType has been LEFT IN PLACE."
					% (REGISTER, "\n".join(sorted(remaining | set(stuck))) or "(none)"),
		)
		print("  UCC Objective kept: %d row(s) unresolved." % len(remaining | set(stuck)))
		return

	# Nothing points at it any more, so the DocType and its table go. Removing
	# the folder from the app is not enough - Frappe leaves an orphaned DocType
	# behind on migrate, and it would keep appearing in link pickers.
	frappe.delete_doc("DocType", OLD, force=True, ignore_permissions=True)
	print("  UCC Objective DocType removed.")
