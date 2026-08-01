# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Runs create_index_from_template for all seven templates, offline.

    python3 test_index_studio_dry.py

This endpoint has been reported broken twice: first it refused six of seven
templates outright (Link validation on metric codes that do not exist), then the
templates themselves turned out to be invented. Both were found by a person
clicking the button on a live site. This runs it here instead, on the same
field-validating stub bench as test_demo_seed_dry, across the two site states
that matter: no metrics defined (every site, day one) and all metrics defined.
"""

import importlib
import importlib.util
import os
import sys
import types
import unittest

from test_demo_seed_dry import META, StubBench, StubDoc


class Rejected(Exception):
	pass


class ApiBench(StubBench):
	"""StubBench plus the handful of extras api/index_studio reaches for."""

	def __init__(self, existing_metrics=()):
		super().__init__()
		self.metrics = set(existing_metrics)
		self.messages = []
		self.PermissionError = PermissionError
		self.db.count = lambda *a, **k: 0
		self.db.exists = self._exists
		self.permitted = True

	def has_permission(self, *a, **kw):
		return self.permitted

	def throw(self, msg, exc=None):
		raise Rejected(msg)

	def msgprint(self, msg, **kw):
		self.messages.append(msg)

	def whitelist(self, *a, **kw):
		return lambda fn: fn

	def _exists(self, doctype, name):
		if doctype == "UCC Metric Definition":
			return name in self.metrics
		for d in self.docs.get(doctype, []):
			if d.name == name:
				return True
		return False


ROOT = os.path.dirname(os.path.abspath(__file__))


def _load(bench):
	"""Import api/index_studio.py against `bench`, fresh each time.

	The module says `from ucc_measurement_outcomes.index_engine import ...`, so a
	stand-in package is registered whose submodules are the real files sitting
	next to this test. The code under test is the real code, unmodified.
	"""
	sys.modules["frappe"] = bench
	bench._ = lambda s: s          # `from frappe import _`
	sys.path.insert(0, ROOT)
	package = types.ModuleType("ucc_measurement_outcomes")
	package.__path__ = [ROOT]
	sys.modules["ucc_measurement_outcomes"] = package
	for name in ("index_engine", "index_templates", "index_calc"):
		sys.modules.pop(name, None)
		sys.modules.pop("ucc_measurement_outcomes." + name, None)
		module = importlib.import_module(name)
		sys.modules["ucc_measurement_outcomes." + name] = module
		setattr(package, name, module)
	spec = importlib.util.spec_from_file_location(
		"_index_studio_under_test", os.path.join(ROOT, "api", "index_studio.py"))
	module = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(module)
	return module


ALL = ["API", "SAPI", "SEQI", "FSI", "QIPI", "ESI", "TEI"]
EXPECTED_CHILDREN = {"API": 6, "SAPI": 4, "SEQI": 6, "FSI": 3, "QIPI": 1, "ESI": 9, "TEI": 6}


class TestCreateFromTemplate(unittest.TestCase):
	def test_every_template_creates_on_a_site_with_no_metrics(self):
		"""Day one on any site. This is the state that used to fail 6 of 7."""
		for code in ALL:
			bench = ApiBench(existing_metrics=())
			mod = _load(bench)
			name = mod.create_index_from_template(code)
			self.assertTrue(name, code)
			version = bench.docs["UCC Index Version"][0]
			children = [n for n in version._data["nodes"] if n["parent_key"]]
			self.assertEqual(len(children), EXPECTED_CHILDREN[code], code)
			# Every unresolvable metric link is blanked, never written.
			self.assertTrue(all(n["source_metric"] is None for n in children), code)
			self.assertEqual(sum(n["weight"] for n in children), 100, code)
			self.assertEqual(version.status, "Draft", code)

	def test_metric_backed_templates_warn_about_what_is_missing(self):
		bench = ApiBench(existing_metrics=())
		mod = _load(bench)
		mod.create_index_from_template("TEI")
		self.assertEqual(len(bench.messages), 1)
		self.assertIn("TEI_APPLICATION", bench.messages[0])

	def test_dimension_templates_warn_about_nothing(self):
		# SEQI and API name no metrics at all, so there is nothing to warn about
		# and a warning would be noise.
		for code in ("SEQI", "API", "ESI"):
			bench = ApiBench(existing_metrics=())
			_load(bench).create_index_from_template(code)
			self.assertEqual(bench.messages, [], code)

	def test_links_are_kept_when_the_metrics_exist(self):
		bench = ApiBench(existing_metrics=(
			"TEI_NEEDS_ALIGNMENT", "TEI_PARTICIPATION", "TEI_SATISFACTION",
			"TEI_RETENTION", "TEI_APPLICATION", "TEI_ROE"))
		mod = _load(bench)
		mod.create_index_from_template("TEI")
		children = [n for n in bench.docs["UCC Index Version"][0]._data["nodes"]
					if n["parent_key"]]
		self.assertTrue(all(n["source_metric"] for n in children))
		self.assertEqual(bench.messages, [])

	def test_index_definition_carries_the_scale_and_no_target(self):
		bench = ApiBench()
		_load(bench).create_index_from_template("SEQI")
		definition = bench.docs["UCC Index Definition"][0]
		self.assertIsNone(getattr(definition, "target", None))
		self.assertIn("0-5", definition.description)
		self.assertIn("GD4 7.2.2", definition.description)

	def test_unknown_template_is_refused(self):
		bench = ApiBench()
		mod = _load(bench)
		with self.assertRaises(Rejected):
			mod.create_index_from_template("NOPE")

	def test_permission_is_checked_before_anything_is_written(self):
		bench = ApiBench()
		bench.permitted = False
		mod = _load(bench)
		with self.assertRaises(Rejected):
			mod.create_index_from_template("SEQI")
		self.assertEqual(bench.docs, {})

	def test_the_field_validator_is_live_here_too(self):
		# Proof this suite would catch a bad field, not just a happy path.
		bench = ApiBench()
		with self.assertRaises(AssertionError):
			StubDoc({"doctype": "UCC Index Version", "index": "SEQI",
					 "version_number": "01", "stat": "Draft"}, bench).insert()
		self.assertIn("UCC Index Version", META)


if __name__ == "__main__":
	unittest.main(verbosity=2)
