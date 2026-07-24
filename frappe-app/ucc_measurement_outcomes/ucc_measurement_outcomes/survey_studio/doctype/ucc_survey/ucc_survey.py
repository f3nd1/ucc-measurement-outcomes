# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class UCCSurvey(Document):
	# Survey identity and lifecycle. Content lives on versions, not here, so this
	# controller stays thin. Permissions default to System Manager only for now.
	# TODO: bench-verify - add Survey Manager / Survey Author roles + row-level
	# rules once the real UCC role set is confirmed on the bench.
	pass
