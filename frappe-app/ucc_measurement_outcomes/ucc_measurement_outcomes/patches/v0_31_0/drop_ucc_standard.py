# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Delete the invented UCC Standard DocType and the mapping field that used it.

Decided 2026-08-02 (derive-and-drop). The probe settled it: ONE row on the live
site, and it was the demo record. Real mapping practice uses the free-text
`primary_clause` on UCC Question Mapping - which stays exactly as it is - and
every objective already links to the institution's own Policies And Standards
Management register through Survey Objective, so the standard was derivable from
the objective anyway.

Nothing in the calculation chain read it: `index_calc`, `metric_engine` and
`index_engine` contain no reference to `UCC Question Mapping.standard`, so no
published score can move. That is why this is a delete rather than a migration -
there is no value to carry anywhere.

The FIELD is removed by the DocType JSON this release ships; bench migrate drops
the column. This patch only removes the DocType and its rows, which a JSON change
cannot do.

WHY THE ROWS GO OUT BY RAW SQL, not frappe.delete_doc
-----------------------------------------------------
v0.31.0's first attempt used `frappe.delete_doc(DOCTYPE, name)` on the rows and
crashed live during `bench migrate`:

    ModuleNotFoundError: ucc_measurement_outcomes.mapping_studio.doctype
                         .ucc_standard.ucc_standard

`delete_doc` on a normal row calls `frappe.get_doc(doctype, name)`, which imports
the DocType's controller class - and this same release deletes that file. The
patch runs under [post_model_sync], i.e. AFTER the model sync that removed it, so
the class is already gone by the time the patch executes. **A patch that removes
a DocType can never load one of that DocType's rows as a document.**

`frappe.db.delete` is a plain DELETE query (`frappe/database/database.py`
v15.83.0 builds a query and runs it - no document layer), and raw SQL for the
read is plainer still. Nothing here depends on a controller that no longer exists.

Deleting the DOCTYPE is a different path and is safe: `delete_doc("DocType", ...)`
loads the *DocType* document, whose controller is Frappe's own, and its
`delete_controllers` step is skipped during migrate (`frappe/model/delete_doc.py`
v15.83.0). `force=True` is needed because a non-custom DocType is otherwise
refused with "Standard DocType can not be deleted".

RE-RUNNABLE, and it has to be. A patch that raises is rolled back and NOT written
to the Patch Log - `patch_handler.execute_patch` calls `update_patch_log` only
after the patch returns, and rolls back on exception - so the failed v0.31.0
attempt runs again on the next migrate with DEMO-STD-C7 still present, because
the rollback undid deletes that were never committed. Every step below checks its
own precondition, so it is equally correct on a site where it already finished.
"""

import frappe

DOCTYPE = "UCC Standard"
TABLE = "tab" + DOCTYPE


def execute():
	# cached=False: the table list is cached per request, and this patch runs in
	# the same process as the model sync that just changed the schema.
	table_there = frappe.db.table_exists(DOCTYPE, cached=False)
	doctype_there = bool(frappe.db.exists("DocType", DOCTYPE))
	if not table_there and not doctype_there:
		print("drop_ucc_standard: already removed, nothing to do.")
		return

	# --- rows, without the document layer ---------------------------------
	if table_there:
		# Raw SQL on purpose: frappe.get_all builds its query from the DocType's
		# meta, which is gone the moment the DocType row is deleted - and this
		# patch has to stay correct when re-run in exactly that state.
		rows = [r[0] for r in frappe.db.sql("select `name` from `%s`" % TABLE)]
		if rows:
			# Report before deleting. A site that turns out to hold real
			# standards is a fact worth seeing in the migrate log rather than
			# discovering afterwards.
			print("drop_ucc_standard: removing %d %s row(s): %s"
				  % (len(rows), DOCTYPE, ", ".join(sorted(rows)[:10])))
			frappe.db.delete(DOCTYPE)
		else:
			print("drop_ucc_standard: no %s rows to remove." % DOCTYPE)

	# --- the DocType itself ------------------------------------------------
	if doctype_there:
		# force=True: UCC Question Mapping.standard is gone from the model in
		# this same release, but a site mid-migrate may still hold link rows
		# pointing here. Those values are being discarded deliberately, so a link
		# check would only block a decided removal.
		frappe.delete_doc("DocType", DOCTYPE, force=True, ignore_missing=True,
						  ignore_permissions=True)
		print("drop_ucc_standard: %s DocType removed." % DOCTYPE)

	frappe.db.commit()
	# `tab{DOCTYPE}` itself is left in place. Frappe does not drop the physical
	# table when a DocType is deleted (delete_from_table only clears rows), and a
	# patch issuing DROP TABLE is a destructive step nobody asked for. It is an
	# empty orphan; drop it by hand if the space matters.
