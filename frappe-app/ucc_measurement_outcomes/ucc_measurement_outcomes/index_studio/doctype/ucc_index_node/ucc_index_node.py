# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class UCCIndexNode(Document):
	# Child of UCC Index Version. Weights are real fields (never D3 JSON);
	# pos_x/pos_y are canvas layout only.
	pass
