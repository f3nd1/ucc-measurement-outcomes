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
	"""Checkpoint E: the seam is an allowlist, not a comment."""

	def test_only_our_answer_row_is_scoreable(self):
		from ucc_measurement_outcomes.metric_engine import SCOREABLE_SOURCE_DOCTYPES
		self.assertEqual(set(SCOREABLE_SOURCE_DOCTYPES), {"UCC Survey Answer"})

	def test_historical_response_tables_are_refused(self):
		from ucc_measurement_outcomes.metric_engine import assert_scoreable_source
		for forbidden in ("Survey Response", "Survey Response List Childtable",
						  "Survey Tracking", "Survey Question Item", "Assessment Result"):
			with self.assertRaises(PermissionError, msg=forbidden):
				assert_scoreable_source(forbidden)

	def test_the_allowed_source_passes(self):
		from ucc_measurement_outcomes.metric_engine import assert_scoreable_source
		self.assertEqual(assert_scoreable_source("UCC Survey Answer"), "UCC Survey Answer")

	def test_metric_calc_calls_the_guard(self):
		# A guard nothing invokes is a comment. This fails if the call is removed.
		src = pathlib.Path(HERE, "metric_calc.py").read_text()
		self.assertIn("assert_scoreable_source(ANSWER)", src)

	def test_scoring_modules_do_not_name_survey_response(self):
		# Belt and braces: the allowlist is the real guard, but a stray query
		# added outside the seam would still show up here.
		# Export and lineage are included: anything that renders a number as a
		# calculated result must not be able to read historical responses either.
		for module in ("metric_calc.py", "index_calc.py", "metric_engine.py",
					   "index_engine.py", "dashboard_export.py", "lineage.py",
					   os.path.join("api", "dashboard.py"),
					   os.path.join("api", "lineage.py")):
			src = pathlib.Path(HERE, module).read_text()
			# Docstrings are as non-executable as comments, and these modules
			# explain the rule in theirs. Strip them, then scan what is left -
			# what this guard is for is a stray QUERY, not the word.
			import re
			code = re.sub(r'("""|\'\'\')(?:.|\n)*?\1', "", src)
			for line in code.splitlines():
				if "Survey Response" not in line:
					continue
				stripped = line.strip()
				self.assertTrue(
					stripped.startswith("#"),
					f"{module} names Survey Response in code: {stripped}")


class TestCorrectionsCannotRewriteHistory(unittest.TestCase):
	"""Checkpoint 3's second non-negotiable: correcting an answer must never
	retroactively alter an already-published Index Result. It reaches the
	indices through the NEXT calculation or not at all."""

	def test_index_result_refuses_any_edit_after_insert(self):
		src = pathlib.Path(HERE, "index_studio", "doctype", "ucc_index_result",
						   "ucc_index_result.py").read_text()
		self.assertIn("get_doc_before_save() is not None", src)
		self.assertIn("immutable", src)

	def test_index_calc_inserts_a_new_result_never_updates_one(self):
		# If this ever became .save() on an existing row, a recalculation after a
		# correction would silently rewrite a published score.
		src = pathlib.Path(HERE, "index_calc.py").read_text()
		self.assertIn("doc.insert()", src)
		self.assertNotIn("db.set_value(\"UCC Index Result\"", src)

	def test_a_corrected_answer_drops_its_stale_score(self):
		# answer_numeric holds the OLD value's normalised score. Left in place,
		# Data Explorer would report the score of an answer that no longer exists.
		src = pathlib.Path(HERE, "survey_studio", "doctype", "ucc_survey_answer",
						   "ucc_survey_answer.py").read_text()
		self.assertIn("self.answer_numeric = None", src)
		self.assertIn("correction_reason", src)

	def test_answer_changes_are_versioned(self):
		import json
		meta = json.loads(pathlib.Path(HERE, "survey_studio", "doctype",
									   "ucc_survey_answer",
									   "ucc_survey_answer.json").read_text())
		self.assertEqual(meta.get("track_changes"), 1,
						 "the row holding the answer must be auditable")


if __name__ == "__main__":
	unittest.main(verbosity=2)
