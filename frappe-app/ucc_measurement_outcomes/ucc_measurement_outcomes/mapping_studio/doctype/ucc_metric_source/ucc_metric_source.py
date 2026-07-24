# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class UCCMetricSource(Document):
	# Child of UCC Metric Definition: one question or operational field feeding a
	# reusable metric. Multiple sources let one metric span surveys/versions.
	pass
