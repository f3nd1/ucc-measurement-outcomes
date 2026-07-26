# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class UCCSurveyAnswer(Document):
	def validate(self):
		"""Checkpoint 3: an already-submitted answer may be corrected, but the
		correction has to be attributable and must not leave a stale score behind.

		Who/when/old/new come free from Frappe's version history (track_changes
		is now on for this DocType). What versioning cannot record is WHY, so a
		reason is required - and only on a real change, never on the first write
		or on an unrelated edit."""
		before = self.get_doc_before_save()
		if not before or (before.answer_value or "") == (self.answer_value or ""):
			return
		if not (self.correction_reason or "").strip():
			frappe.throw(
				_("Changing a submitted answer needs a correction reason. "
				  "The version history records who and when; this records why.")
			)
		# answer_numeric is the OLD value's normalised score, written by
		# metric_calc. Leaving it would make Data Explorer report the score of an
		# answer that no longer exists. Clearing it means the next metric
		# calculation recomputes it - which is also how a correction reaches the
		# indices: through the NEXT calculation, never by touching a published
		# UCC Index Result, which its own controller refuses to let anyone edit.
		self.answer_numeric = None

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
