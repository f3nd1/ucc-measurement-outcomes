# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class UCCIndexResult(Document):
	def validate(self):
		# Results are immutable snapshots. A formula edit must produce a NEW index
		# version and NEW results, never silently change a published score.
		if self.get_doc_before_save() is not None:
			frappe.throw(_("Index results are immutable and cannot be edited after calculation."))

	def before_insert(self):
		if not self.calculation_date:
			self.calculation_date = frappe.utils.now()
