# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from ucc_measurement_outcomes.versioning import (
	assert_frozen_content_unchanged,
	version_transition_blocked,
)

# Fields frozen once the version is Published/Closed. Section/question content is
# guarded by those doctypes' own controllers; this covers the version header.
FROZEN_FIELDS = ("survey", "version_number", "title_snapshot", "description_snapshot")


class UCCSurveyVersion(Document):
	def validate(self):
		self._guard_transition()
		assert_frozen_content_unchanged(
			self, self.get_doc_before_save(), FROZEN_FIELDS, "Survey Version"
		)

	def _guard_transition(self):
		before = self.get_doc_before_save()
		if not before:
			return
		if version_transition_blocked(before.status, self.status):
			frappe.throw(
				_("Version {0} is {1}; the only permitted change is moving to Closed.").format(
					self.name, before.status
				)
			)

	def before_save(self):
		before = self.get_doc_before_save()
		became_published = self.status == "Published" and (not before or before.status != "Published")
		if became_published:
			self.published_on = frappe.utils.now()
			self.published_by = frappe.session.user
			self.is_immutable = 1
			self.title_snapshot = frappe.db.get_value("UCC Survey", self.survey, "title")
			self.description_snapshot = frappe.db.get_value("UCC Survey", self.survey, "description")
			# TODO: bench-verify - snapshot any additional survey-level fields the
			# reporting layer must freeze at publish (e.g. owning department once linked).

	def on_update(self):
		if self.status == "Published":
			frappe.db.set_value("UCC Survey", self.survey, "current_version", self.name)
