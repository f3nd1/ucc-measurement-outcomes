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
"""

import frappe

DOCTYPE = "UCC Standard"


def execute():
	if not frappe.db.exists("DocType", DOCTYPE):
		return

	# Report before deleting. A site that turns out to hold real standards is a
	# fact worth seeing in the migrate log rather than discovering afterwards.
	rows = frappe.get_all(DOCTYPE, pluck="name")
	if rows:
		print(f"drop_ucc_standard: removing {len(rows)} {DOCTYPE} row(s): {', '.join(sorted(rows)[:10])}")

	# force=True: UCC Question Mapping.standard is gone from the model in this
	# same release, but a site mid-migrate may still hold link rows pointing here.
	# Those values are being discarded deliberately, so a link check would only
	# block a decided removal.
	for name in rows:
		frappe.delete_doc(DOCTYPE, name, force=True, ignore_permissions=True)
	frappe.delete_doc("DocType", DOCTYPE, force=True, ignore_missing=True)
	frappe.db.commit()
	print(f"drop_ucc_standard: {DOCTYPE} removed.")
