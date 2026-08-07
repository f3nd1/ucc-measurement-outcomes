# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Runs api.mapping.objective_usage offline, against the DocType JSONs on disk.

    python3 test_objective_usage.py

Coverage's drill-down is the first thing in this app that reads ACROSS survey
versions, so it names fields on four DocTypes in one function - and a fieldname
that does not exist is the single most common way bench-path code here has
died. Every `fields=[...]` and every filter key this endpoint asks for is
checked against the real JSON, the same tier test_demo_seed_dry uses for writes.

The grouping is checked too: an objective's questions must arrive whole,
whichever survey they came from, and a mapping row with no objective must not
invent a group.
"""

import importlib.util
import os
import sys
import types
import unittest

from test_demo_seed_dry import BUILT_IN, META

ROOT = os.path.dirname(os.path.abspath(__file__))


class Rejected(Exception):
	pass


class QueryBench(types.ModuleType):
	"""A frappe whose get_all validates every field it is asked for."""

	def __init__(self, tables, permitted=True):
		super().__init__("frappe")
		self.tables = tables            # doctype -> [row dicts]
		self.permitted = permitted
		self.asked = []
		self.PermissionError = PermissionError
		self._ = lambda s: s            # `from frappe import _`

	def whitelist(self, *a, **kw):
		return lambda fn: fn

	def has_permission(self, *a, **kw):
		return self.permitted

	def throw(self, msg, exc=None):
		raise Rejected(msg)

	def get_meta(self, doctype):
		fields = [types.SimpleNamespace(fieldname=f) for f in META[doctype]]
		return types.SimpleNamespace(fields=fields)

	def get_all(self, doctype, filters=None, fields=None, pluck=None, order_by=None, **kw):
		self.asked.append(doctype)
		known = META.get(doctype)
		assert known is not None, "unknown DocType " + doctype
		for f in list(fields or []) + list(filters or {}):
			assert f in known or f in BUILT_IN, "%s has no field %r" % (doctype, f)
		rows = self.tables.get(doctype, [])
		for key, cond in (filters or {}).items():
			if isinstance(cond, (list, tuple)) and cond[0] == "in":
				rows = [r for r in rows if r.get(key) in cond[1]]
			else:
				rows = [r for r in rows if r.get(key) == cond]
		if pluck:
			return [r[pluck] for r in rows]
		return [{f: r.get(f) for f in fields} for r in rows]


def load(bench):
	sys.modules["frappe"] = bench
	sys.path.insert(0, ROOT)
	package = types.ModuleType("ucc_measurement_outcomes")
	package.__path__ = [ROOT]
	sys.modules["ucc_measurement_outcomes"] = package
	for name in ("coverage", "map_graph"):
		sys.modules.pop(name, None)
		module = importlib.import_module(name)
		sys.modules["ucc_measurement_outcomes." + name] = module
		setattr(package, name, module)
	spec = importlib.util.spec_from_file_location(
		"_mapping_under_test", os.path.join(ROOT, "api", "mapping.py"))
	module = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(module)
	return module


# Two surveys reaching one objective is the whole point: nothing per-version
# can see the second one.
TABLES = {
	"UCC Question Mapping": [
		{"question": "Q1", "objective": "OBJ-0304", "survey_version": "SUR-0008-V02"},
		{"question": "QX", "objective": "OBJ-0304", "survey_version": "SUR-0009-V01"},
		{"question": "Q2", "objective": "OBJ-0309", "survey_version": "SUR-0008-V02"},
		# A half-filled row. Real registers have them; it must not become a group.
		{"question": "Q3", "objective": None, "survey_version": "SUR-0008-V02"},
	],
	"UCC Survey Question": [
		{"name": "Q1", "question_text": "How employable do you feel?"},
		{"name": "Q2", "question_text": "Rate the library"},
		{"name": "QX", "question_text": "Did your programme prepare you?"},
		{"name": "Q3", "question_text": "Anything else?"},
	],
	"UCC Survey Version": [
		{"name": "SUR-0008-V02", "survey": "SUR-0008", "version_number": "02"},
		{"name": "SUR-0009-V01", "survey": "SUR-0009", "version_number": "01"},
	],
	"UCC Survey": [
		{"name": "SUR-0008", "title": "Student Experience 2026"},
		{"name": "SUR-0009", "title": "Alumni Follow-up"},
	],
}


class TestObjectiveUsage(unittest.TestCase):
	def usage(self, tables=None):
		bench = QueryBench(TABLES if tables is None else tables)
		return load(bench).objective_usage()["usage"], bench

	def test_every_field_it_asks_for_exists(self):
		# The assertions live in QueryBench.get_all; reaching here is the pass.
		usage, bench = self.usage()
		self.assertEqual(sorted(set(bench.asked)), [
			"UCC Question Mapping", "UCC Survey", "UCC Survey Question", "UCC Survey Version"])

	def test_one_objective_carries_questions_from_both_surveys(self):
		usage, _ = self.usage()
		rows = usage["OBJ-0304"]
		self.assertEqual([r["question"] for r in rows], ["Q1", "QX"])
		self.assertEqual(sorted(r["survey_title"] for r in rows),
						 ["Alumni Follow-up", "Student Experience 2026"])
		self.assertEqual(rows[1]["version_number"], "01")

	def test_question_text_comes_along(self):
		usage, _ = self.usage()
		self.assertEqual(usage["OBJ-0309"][0]["question_text"], "Rate the library")

	def test_a_mapping_with_no_objective_makes_no_group(self):
		usage, _ = self.usage()
		self.assertEqual(sorted(usage), ["OBJ-0304", "OBJ-0309"])
		self.assertNotIn(None, usage)

	def test_unreached_objectives_are_simply_absent(self):
		"""The UI reads a missing key as "not reached" - it must not be a group
		with an empty list, or "Not reached" and "0 questions" both render."""
		usage, _ = self.usage()
		self.assertNotIn("OBJ-0350", usage)

	def test_an_empty_site_returns_an_empty_map_not_a_crash(self):
		usage, _ = self.usage({})
		self.assertEqual(usage, {})

	def test_a_deleted_survey_does_not_lose_the_question(self):
		"""Lineage outlives tidy links: a mapping whose version row is gone still
		names its question, it just has no survey title to show."""
		tables = dict(TABLES, **{"UCC Survey Version": []})
		usage, _ = self.usage(tables)
		self.assertEqual(usage["OBJ-0304"][0]["question_text"], "How employable do you feel?")
		self.assertEqual(usage["OBJ-0304"][0]["survey_title"], "")

	def test_it_refuses_without_read_permission(self):
		bench = QueryBench(TABLES, permitted=False)
		module = load(bench)
		with self.assertRaises(Rejected):
			module.objective_usage()
		self.assertEqual(bench.asked, [])


if __name__ == "__main__":
	unittest.main(verbosity=2)
