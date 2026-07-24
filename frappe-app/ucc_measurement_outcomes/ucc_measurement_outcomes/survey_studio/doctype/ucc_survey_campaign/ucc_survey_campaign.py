# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class UCCSurveyCampaign(Document):
	def before_insert(self):
		if not self.public_token:
			self.public_token = frappe.generate_hash(length=24)

	def validate(self):
		if self.opens_on and self.closes_on and frappe.utils.getdate(self.closes_on) < frappe.utils.getdate(self.opens_on):
			frappe.throw(_("Closes On cannot be before Opens On."))
		# TODO: bench-verify - a Campaign should only open against a Published version;
		# add that guard once the real publish workflow is confirmed on the bench.

	def is_open(self):
		"""True if the campaign accepts responses right now."""
		if self.status != "Open":
			return False
		today = frappe.utils.getdate()
		if self.opens_on and frappe.utils.getdate(self.opens_on) > today:
			return False
		if self.closes_on and frappe.utils.getdate(self.closes_on) < today:
			return False
		return True
