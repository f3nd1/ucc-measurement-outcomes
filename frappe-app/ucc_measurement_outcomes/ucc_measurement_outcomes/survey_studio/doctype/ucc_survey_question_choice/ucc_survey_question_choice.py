# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class UCCSurveyQuestionChoice(Document):
	# Child of UCC Survey Question. Editability is enforced by the parent question's
	# version guard, so no separate check is needed here.
	pass
