# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from ucc_measurement_outcomes.versioning import version_transition_blocked


class UCCIndexVersion(Document):
	def validate(self):
		# Same immutability rule as survey versions: once Published, only -> Closed.
		before = self.get_doc_before_save()
		if before and version_transition_blocked(before.status, self.status):
			frappe.throw(
				_("Index version {0} is {1}; the only permitted change is moving to Closed.").format(
					self.name, before.status
				)
			)

	def before_save(self):
		before = self.get_doc_before_save()
		if self.status == "Published" and (not before or before.status != "Published"):
			self.published_on = frappe.utils.now()
			self.published_by = frappe.session.user
			self.is_immutable = 1
