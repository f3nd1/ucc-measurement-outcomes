# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from ucc_measurement_outcomes.versioning import (
	version_is_frozen,
	version_transition_blocked,
)


def _formula_signature(nodes):
	"""The calculation-relevant content of the node graph. pos_x/pos_y are
	deliberately excluded: canvas layout is not part of the official formula.
	Sorted by node_key so child-row reordering alone is not a content change."""
	return sorted(
		(
			n.node_key,
			n.node_type,
			n.label or None,
			n.parent_key or None,
			n.source_metric or None,
			float(n.weight or 0),
			n.normalisation or None,
			int(n.reverse_scored or 0),
		)
		for n in nodes
	)


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
		# A frozen version's FORMULA must not change either: a Published->Published
		# save passes the transition guard, so without this check save_nodes could
		# silently rewrite the formula behind already-calculated results.
		if before and version_is_frozen(before.status):
			changed = [f for f in ("index", "version_number")
					   if (self.get(f) or None) != (before.get(f) or None)]
			if changed or _formula_signature(self.nodes) != _formula_signature(before.nodes):
				frappe.throw(
					_("Index version {0} is {1}; its formula and identity are frozen.").format(
						self.name, before.status
					)
				)

	def before_save(self):
		before = self.get_doc_before_save()
		if self.status == "Published" and (not before or before.status != "Published"):
			self.published_on = frappe.utils.now()
			self.published_by = frappe.session.user
			self.is_immutable = 1
