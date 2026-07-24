# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from ucc_measurement_outcomes.versioning import assert_version_editable


class UCCSurveySection(Document):
	def validate(self):
		# A section may not be created or edited under a frozen (published/closed) version.
		assert_version_editable(self.survey_version)

	def on_trash(self):
		assert_version_editable(self.survey_version)
