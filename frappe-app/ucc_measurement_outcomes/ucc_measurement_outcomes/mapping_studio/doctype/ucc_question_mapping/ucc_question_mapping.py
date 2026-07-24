# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class UCCQuestionMapping(Document):
	# Objective + clause mapping for one question. Intentionally separate from
	# metric mapping (UCC Metric Definition sources) so the two governance
	# questions stay independent.
	pass
