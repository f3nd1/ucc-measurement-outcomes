# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class UCCMetricResult(Document):
	def before_insert(self):
		if not self.calculation_date:
			self.calculation_date = frappe.utils.now()
	# TODO: bench-verify - result immutability (no silent overwrite of a published
	# score) is enforced by the calculation engine in checkpoint 5, not here.
