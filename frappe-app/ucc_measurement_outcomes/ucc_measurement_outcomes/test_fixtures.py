# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Checks the Custom Field fixtures WITHOUT a bench:

    python3 test_fixtures.py

These are the fields this app bolts onto educ_sg's Survey Tracking. A wrong
`name`, a `dt` pointing at the wrong DocType, or an `insert_after` naming a
field that does not exist in the fixture chain all fail at `bench migrate` on a
shared site - which is the worst place to find out.
"""

import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixtures", "custom_field.json")
HOOKS = os.path.join(HERE, "hooks.py")

with open(FIXTURE) as fh:
	FIELDS = json.load(fh)


class TestCustomFieldFixtures(unittest.TestCase):
	def test_name_matches_frappe_convention(self):
		# Frappe names a Custom Field "{dt}-{fieldname}". Get this wrong and
		# migrate creates a duplicate field instead of updating the existing one.
		for f in FIELDS:
			self.assertEqual(f["name"], f"{f['dt']}-{f['fieldname']}", f)

	def test_every_field_targets_survey_tracking(self):
		for f in FIELDS:
			self.assertEqual(f["dt"], "Survey Tracking", f)
			self.assertEqual(f["doctype"], "Custom Field", f)

	def test_every_fieldname_is_ucc_prefixed(self):
		# Ownership marker AND collision guard: educ_sg may add its own fields.
		for f in FIELDS:
			self.assertTrue(f["fieldname"].startswith("ucc_"), f["fieldname"])

	def test_insert_after_only_references_our_own_fields(self):
		# Chaining off educ_sg fieldnames we cannot verify from here would break
		# on any Survey Tracking layout change. Each field hangs off the previous
		# one of ours; only the section break floats.
		ours = {f["fieldname"] for f in FIELDS}
		for f in FIELDS:
			after = f.get("insert_after")
			if after is not None:
				self.assertIn(after, ours, f"{f['fieldname']} chains off {after!r}")

	def test_insert_after_chain_has_no_cycle_and_one_root(self):
		roots = [f for f in FIELDS if not f.get("insert_after")]
		self.assertEqual(len(roots), 1, "exactly one field should float")
		seen, node = set(), roots[0]["fieldname"]
		by_after = {f["insert_after"]: f for f in FIELDS if f.get("insert_after")}
		while node in by_after:
			self.assertNotIn(node, seen, "cycle in insert_after chain")
			seen.add(node)
			node = by_after[node]["fieldname"]
		self.assertEqual(len(seen) + 1, len(FIELDS), "every field must be in the chain")

	def test_select_options_lead_with_a_blank(self):
		# A Select whose options do not start with "" forces the first value onto
		# every existing row. Historical Survey Tracking rows are consolidation
		# records, not campaigns - they must stay blank.
		for f in FIELDS:
			if f["fieldtype"] == "Select":
				self.assertTrue(f["options"].startswith("\n"), f["fieldname"])

	def test_hooks_filter_matches_these_names(self):
		# The fixtures filter is a `like` on the name prefix; if it stops matching,
		# bench export-fixtures silently drops our fields.
		with open(HOOKS) as fh:
			hooks_src = fh.read()
		self.assertIn('["name", "like", "Survey Tracking-ucc_%"]', hooks_src)
		for f in FIELDS:
			self.assertTrue(f["name"].startswith("Survey Tracking-ucc_"), f["name"])

	def test_public_token_is_not_user_writable(self):
		token = next(f for f in FIELDS if f["fieldname"] == "ucc_public_token")
		self.assertEqual(token.get("read_only"), 1)
		self.assertEqual(token.get("unique"), 1)
		self.assertEqual(token.get("no_copy"), 1)


if __name__ == "__main__":
	unittest.main(verbosity=2)
