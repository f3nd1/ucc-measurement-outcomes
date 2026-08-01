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
		DEMO_PREFIX, OWNED, SEQI_METRICS, SET_A, SURVEYS_A,
		assert_demo, assert_owned, audience,
	)
	from ucc_measurement_outcomes.index_engine import compute_index
	from ucc_measurement_outcomes.metric_engine import aggregate_metric
except ImportError:
	from demo_data import (
		DEMO_PREFIX, OWNED, SEQI_METRICS, SET_A, SURVEYS_A,
		assert_demo, assert_owned, audience,
	)
	from index_engine import compute_index
	from metric_engine import aggregate_metric


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
		# Singles are excluded: OWNED is an allowlist for RECORDS, and a Single
		# has none - nothing to seed, nothing to delete. UCC Survey Theme is
		# site-wide settings, and demo data must never touch those: seeding would
		# recolour every survey on the site and teardown would wipe a real
		# configuration nobody asked it to.
		on_disk = set()
		for p in glob.glob(os.path.join(root, "*", "doctype", "*", "*.json")):
			if os.path.basename(p) != os.path.basename(os.path.dirname(p)) + ".json":
				continue
			doc = json.load(open(p))
			if not doc.get("issingle"):
				on_disk.add(doc["name"])
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


class TestSetAShape(unittest.TestCase):
	"""The demo's advertised shape and score, checked against the REAL engines.

	The seed builds distributions, not samples, so the SEQI score it produces is a
	fixed number. Asserting it here means a change to a distribution, a weight or
	a normalisation rule fails in CI rather than quietly moving the number the
	sign-off demo is described by.
	"""

	def test_advertised_survey_shape(self):
		types = [q[1] for q in SET_A["questions"]]
		self.assertEqual(len(types), 12)
		self.assertEqual(types.count("Page Break"), 2)
		self.assertEqual(types.count("Section Heading"), 1)
		self.assertEqual(len([t for t in types if t not in ("Page Break", "Section Heading")]), 9)
		self.assertEqual(SET_A["responses"], 60)
		# ~95% completion.
		self.assertEqual(SET_A["responses"] - SET_A["abandoned"], 57)

	def test_no_question_has_more_answers_than_respondents(self):
		# Counts above the audience would be invented respondents.
		for spec in SURVEYS_A.values():
			for key, _t, _text, dist in spec["questions"]:
				if not dist:
					continue
				given = sum(c for _v, c in dist)
				self.assertLessEqual(given, len(audience(spec, key)), key)

	def test_a_metric_spans_two_surveys(self):
		spans = [m for m in SEQI_METRICS if len({s for s, _q in m[4]}) > 1]
		self.assertTrue(spans, "no metric draws on two surveys - cross-survey aggregation unproven")

	def test_weights_sum_to_100(self):
		self.assertEqual(sum(m[2] for m in SEQI_METRICS), 100)

	def _metric_values(self):
		values = {}
		for code, _name, _w, norm, sources in SEQI_METRICS:
			entries = []
			for skey, qkey in sources:
				dist = next(q[3] for q in SURVEYS_A[skey]["questions"] if q[0] == qkey)
				entries += [{"value": v, "normalisation": norm} for v, c in dist for _ in range(c)]
			values[code] = aggregate_metric(entries)["value"]
		return values

	def test_every_metric_scores(self):
		# A Yes/No question stores the word "Yes"; if normalise ever stops reading
		# it, these come back None and the index quietly drops two dimensions.
		for code, value in self._metric_values().items():
			self.assertIsNotNone(value, code)

	def test_calculated_seqi_score(self):
		root = "demo_seqi"
		nodes = [{"key": root, "type": "Index", "label": "SEQI", "parent_key": None, "weight": 0}]
		for i, (code, name, weight, _n, _s) in enumerate(SEQI_METRICS):
			nodes.append({"key": f"{root}_{i}", "type": "Metric", "label": name,
						  "parent_key": root, "weight": weight, "source_metric": code})
		result = compute_index(nodes, self._metric_values())
		self.assertAlmostEqual(result["value"], 76.31, places=2)


if __name__ == "__main__":
	unittest.main(verbosity=2)
