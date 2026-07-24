# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from ucc_measurement_outcomes.versioning import (
	assert_doc_version_editable,
	assert_version_editable,
)


class UCCSurveySection(Document):
	def validate(self):
		# A section may not be created or edited under a frozen version, nor
		# re-parented OUT of one (the doc-level guard checks old + new version).
		assert_doc_version_editable(self)

	def on_trash(self):
		assert_version_editable(self.survey_version)
