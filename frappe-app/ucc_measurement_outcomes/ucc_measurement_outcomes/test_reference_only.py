# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""The one rule this whole investigation exists to enforce:

    historical Survey Response data may be SEEN, never SCORED.

Run without a bench:  python3 test_reference_only.py

47% of the 2,339 historical response rows cannot be attributed to a specific
question by any method tested - text matching, qn_no, or row position. So they
are visible in Data Explorer for context and are never read into a Metric Result
or an Index Result. This file is the machine-checkable half of that rule.
"""

import os
import pathlib
import sys
import types
import unittest

# The API module imports frappe at module level; the catalogue itself is plain
# data, so a stub is enough to read it here.
if "frappe" not in sys.modules:
	stub = types.ModuleType("frappe")
	stub.whitelist = lambda *a, **k: (lambda fn: fn)
	stub._ = lambda s: s
	sys.modules["frappe"] = stub
	sys.modules["frappe.utils"] = types.ModuleType("frappe.utils")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # app root, so the package imports

from ucc_measurement_outcomes.api import explorer  # noqa: E402

OURS = "UCC "
HISTORICAL = "Survey Response"


class TestExplorerCatalogue(unittest.TestCase):
	def test_historical_responses_are_visible(self):
		# Reference-only must not mean hidden - the point is context.
		names = [n for n, s in explorer.DATASETS.items()
				 if s["doctype"].startswith(HISTORICAL)]
		self.assertTrue(names, "historical Survey Response should be browsable")

	def test_historical_responses_are_flagged_reference(self):
		for name, spec in explorer.DATASETS.items():
			if spec["doctype"].startswith(HISTORICAL):
				self.assertTrue(spec.get("reference"), name)
				self.assertTrue(spec.get("note"), f"{name} needs a note the UI can show")

	def test_any_foreign_doctype_dataset_must_be_reference(self):
		# The rule that stops the next person adding a scoreable dataset over a
		# DocType this app does not own.
		for name, spec in explorer.DATASETS.items():
			if not spec["doctype"].startswith(OURS):
				self.assertTrue(spec.get("reference"),
								f"{name} reads {spec['doctype']}, which this app does not own")
				self.assertTrue(spec.get("external"),
								f"{name} must be field-checked against the real meta")

	def test_reference_datasets_offer_no_score_like_measure(self):
		# Counting historical rows is context. Averaging them produces a number
		# that looks like a score and is not one.
		for name, spec in explorer.DATASETS.items():
			if not spec.get("reference"):
				continue
			for measure, (agg, field) in spec["measures"].items():
				self.assertEqual(agg, "count",
								 f"{name}/{measure} aggregates {field!r} - "
								 f"a reference dataset may only count rows")

	def test_list_datasets_exposes_the_flag(self):
		# The UI banner is driven by this; drop it from the payload and the
		# warning silently disappears.
		src = pathlib.Path(HERE, "api", "explorer.py").read_text()
		self.assertIn('"reference": bool(spec.get("reference"))', src)


class TestScoringNeverReadsHistorical(unittest.TestCase):
	"""Checkpoint E extends this: metric_calc must never name Survey Response."""

	def test_metric_calc_does_not_mention_survey_response(self):
		for module in ("metric_calc.py", "index_calc.py", "metric_engine.py",
					   "index_engine.py"):
			src = pathlib.Path(HERE, module).read_text()
			self.assertNotIn("Survey Response", src,
							 f"{module} names Survey Response - scoring must never read it")


if __name__ == "__main__":
	unittest.main(verbosity=2)
