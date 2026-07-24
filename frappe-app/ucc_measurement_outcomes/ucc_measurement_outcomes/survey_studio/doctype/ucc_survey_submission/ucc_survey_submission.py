# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class UCCSurveySubmission(Document):
	def before_save(self):
		if self.status == "Completed" and not self.submitted_on:
			self.submitted_on = frappe.utils.now()
