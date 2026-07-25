# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Proves demo_data's two safety guards WITHOUT a bench:

    python3 test_demo_data.py

These are the guards that stand between a demo cleanup and real UCC quality
data, so they are tested before the seed is ever run. Run this first; the
remove path is only as safe as these assertions.
"""

import sys
import types
import unittest

# demo_data imports frappe at module level for its seed/remove halves. The
# guards themselves are pure, so a stub is enough to import them here.
sys.modules.setdefault("frappe", types.ModuleType("frappe"))

try:
	from ucc_measurement_outcomes.demo_data import (
		DEMO_PREFIX, OWNED, assert_demo, assert_owned,
	)
except ImportError:
	from demo_data import DEMO_PREFIX, OWNED, assert_demo, assert_owned


class TestOwnership(unittest.TestCase):
	def test_refuses_doctypes_this_app_does_not_own(self):
		for foreign in ("Quality Action", "Quality Meeting",
						"Quality Performance Outcomes", "User", "Student", "File"):
			with self.assertRaises(PermissionError, msg=foreign):
				assert_owned(foreign)

	def test_allows_every_doctype_this_app_owns(self):
		for dt in OWNED:
			self.assertEqual(assert_owned(dt), dt)

	def test_the_forbidden_three_are_not_in_the_allowlist(self):
		# The constraint is structural, not a naming convention: these cannot be
		# reached even if a future caller passes them in by mistake.
		self.assertTrue(OWNED.isdisjoint(
			{"Quality Action", "Quality Meeting", "Quality Performance Outcomes"}))


	def test_allowlist_matches_the_doctypes_on_disk(self):
		# A typo in OWNED would reject a legitimate write at seed time, and a
		# newly added DocType would silently fall outside the cleanup.
		import glob
		import json
		import os
		root = os.path.dirname(os.path.abspath(__file__))
		on_disk = {json.load(open(p))["name"]
				   for p in glob.glob(os.path.join(root, "*", "doctype", "*", "*.json"))
				   if os.path.basename(p) == os.path.basename(os.path.dirname(p)) + ".json"}
		self.assertEqual(on_disk, set(OWNED))


class TestDeletionGuard(unittest.TestCase):
	def test_refuses_real_records(self):
		# The live site already holds a real SEQI index and real surveys.
		for dt, name in (("UCC Index Definition", "SEQI"),
						 ("UCC Index Definition", "SAPI"),
						 ("UCC Survey", "SRV-00001"),
						 ("UCC Metric Definition", "SAPI_PASSING")):
			with self.assertRaises(PermissionError, msg=name):
				assert_demo(dt, name)

	def test_allows_prefixed_names(self):
		self.assertEqual(assert_demo("UCC Index Definition", "DEMO-SEQI"), "DEMO-SEQI")
		self.assertEqual(assert_demo("UCC Index Version", "DEMO-SAPI-V01"), "DEMO-SAPI-V01")

	def test_hash_named_row_needs_a_demo_root(self):
		# A hash name can never carry the prefix, so it lives or dies by `via`.
		h = "a1b2c3d4e5"
		with self.assertRaises(PermissionError):
			assert_demo("UCC Survey Answer", h)
		with self.assertRaises(PermissionError):
			assert_demo("UCC Survey Answer", h, via=None)
		self.assertEqual(assert_demo("UCC Survey Answer", h, via="DEMO- Student Experience Survey"), h)

	def test_via_must_itself_be_demo_marked(self):
		# The hole this closes: a caller asserting "trust me, it's demo" with a
		# truthy value that points at a real record.
		for bad_via in (True, 1, "SRV-00001", "Real Student Survey", "demo-lowercase"):
			with self.assertRaises(PermissionError, msg=repr(bad_via)):
				assert_demo("UCC Survey Answer", "a1b2c3d4e5", via=bad_via)

	def test_guard_applies_to_foreign_doctypes_first(self):
		# Even a perfectly DEMO-named row in someone else's DocType is refused.
		with self.assertRaises(PermissionError):
			assert_demo("Quality Action", DEMO_PREFIX + "ANYTHING")


if __name__ == "__main__":
	unittest.main(verbosity=2)
