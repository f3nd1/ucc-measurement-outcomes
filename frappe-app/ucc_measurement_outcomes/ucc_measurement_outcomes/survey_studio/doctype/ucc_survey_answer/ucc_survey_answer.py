# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class UCCSurveyAnswer(Document):
	def before_insert(self):
		# Denormalise version + type from the question so answer rows are
		# self-sufficient for Data Explorer / drill-down queries later.
		if self.question:
			if not self.survey_version:
				self.survey_version = frappe.db.get_value(
					"UCC Survey Question", self.question, "survey_version"
				)
			if not self.question_type:
				self.question_type = frappe.db.get_value(
					"UCC Survey Question", self.question, "question_type"
				)
