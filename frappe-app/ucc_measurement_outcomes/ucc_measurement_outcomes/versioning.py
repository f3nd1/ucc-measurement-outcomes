"""Version lifecycle rules for UCC survey DocTypes.

The pure functions here encode immutability and are unit-tested WITHOUT a Frappe
bench (see test_versioning_logic.py). Keep this module free of a top-level
`import frappe` so the pure test can import it directly; the one Frappe-aware
helper imports frappe lazily inside the function body.
"""

# A frozen version's identity and content must never change silently, so that a
# previously published/reported score can always be reproduced.
FROZEN_STATUSES = {"Published", "Closed"}


def version_is_frozen(status):
	"""True if a version in this status must not have its content edited."""
	return status in FROZEN_STATUSES


def version_transition_blocked(old_status, new_status):
	"""True if moving a version old_status -> new_status is not allowed.

	Once Published, the only permitted move is Published -> Closed. Closed is
	terminal. Any other move out of a frozen status is blocked.
	"""
	if old_status == new_status:
		return False
	if old_status == "Published" and new_status == "Closed":
		return False
	if old_status in FROZEN_STATUSES:
		return True
	return False


def assert_version_editable(version_name):
	"""Throw if the linked UCC Survey Version is frozen. Called by child records
	(sections, questions) before they are created, modified or deleted."""
	if not version_name:
		return
	import frappe
	from frappe import _

	status = frappe.db.get_value("UCC Survey Version", version_name, "status")
	if status and version_is_frozen(status):
		frappe.throw(
			_("Survey Version {0} is {1} and cannot be modified.").format(version_name, status)
		)
