# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Actually RUNS demo_data.seed() - against a stub bench, on this machine.

    python3 test_demo_seed_dry.py

Every other test in this repo checks pure functions. This one executes the
seed's Frappe half: `_survey`, `_responses`, `_build_full`, the mapping loop,
the metric and index writes. Nothing in that path had ever run, and the whole
point of a demo dataset is that it works on the first attempt in front of
someone.

WHAT THE STUB CHECKS, and why it is not merely a mock: every field passed to
`frappe.get_doc` is validated against the DocType's OWN JSON on disk, and every
Select value against that field's options. A typo'd fieldname, a Select value
that is not in the list, a missing `reqd` field - the three ways this seed would
have died on a real bench - all fail here instead. Link targets are checked for
shape only (the stub has no database), which is the honest limit of this tier.
"""

import glob
import json
import os
import sys
import types
import unittest

ROOT = os.path.dirname(os.path.abspath(__file__))
CHILD_PARENT = {"UCC Survey Question Choice": "UCC Survey Question",
                "UCC Metric Source": "UCC Metric Definition",
                "UCC Index Node": "UCC Index Version",
                "UCC Score Breakdown": "UCC Index Result"}


def _load_meta():
	"""fieldname -> (fieldtype, options) per DocType, read from the app's JSON."""
	meta = {}
	for path in glob.glob(os.path.join(ROOT, "*", "doctype", "*", "*.json")):
		if os.path.basename(path) != os.path.basename(os.path.dirname(path)) + ".json":
			continue
		with open(path) as fh:
			doc = json.load(fh)
		if doc.get("doctype") != "DocType":
			continue
		meta[doc["name"]] = {
			f["fieldname"]: (f["fieldtype"], f.get("options") or "", bool(f.get("reqd")))
			for f in doc["fields"] if f.get("fieldname")
		}
	return meta


META = _load_meta()
# Frappe writes these on every doc; they are not in the JSON but are legal.
BUILT_IN = {"doctype", "name", "owner", "creation", "modified", "modified_by",
            "docstatus", "idx", "parent", "parenttype", "parentfield"}


class StubDoc:
	def __init__(self, data, bench):
		self._bench = bench
		self.doctype = data["doctype"]
		self._data = dict(data)
		self.name = None
		for k, v in data.items():
			setattr(self, k, v)

	def _validate(self):
		fields = META.get(self.doctype)
		assert fields is not None, "unknown DocType " + self.doctype
		for key, value in self._data.items():
			if key in BUILT_IN:
				continue
			assert key in fields, "{0} has no field {1!r}".format(self.doctype, key)
			ftype, options, _reqd = fields[key]
			if ftype == "Select" and value:
				allowed = [o for o in options.split("\n") if o]
				assert value in allowed, \
					"{0}.{1}: {2!r} not in {3}".format(self.doctype, key, value, allowed)
			if ftype == "Table" and value:
				child = options
				for row in value:
					StubDoc(dict(row, doctype=child), self._bench)._validate()
		for key, (_t, _o, reqd) in fields.items():
			if reqd and key != "naming_series":
				assert self._data.get(key) not in (None, ""), \
					"{0} is missing required field {1}".format(self.doctype, key)

	def insert(self, ignore_permissions=False):
		self._validate()
		self._bench.count[self.doctype] = self._bench.count.get(self.doctype, 0) + 1
		self.name = "{0}-{1:05d}".format(
			"".join(w[0] for w in self.doctype.split())[:6], self._bench.count[self.doctype])
		self._bench.docs.setdefault(self.doctype, []).append(self)
		return self

	def save(self, ignore_permissions=False):
		self._data = {k: getattr(self, k) for k in self._data}
		self._validate()
		return self

	def append(self, field, row):
		self._data.setdefault(field, []).append(row)
		setattr(self, field, self._data[field])


class StubBench(types.ModuleType):
	"""The narrowest frappe that demo_data actually touches.

	`raises_for` names DocTypes whose controller file is GONE from disk, so
	get_doc on one raises ModuleNotFoundError exactly as a real bench does. That
	is the shape a patch removing a DocType has to survive - see
	test_patch_drop_ucc_standard.
	"""

	def __init__(self, objectives=(), departments=(), raises_for=()):
		super().__init__("frappe")
		self.count, self.docs = {}, {}
		self._objectives = list(objectives)
		self._departments = list(departments)
		self._raises_for = set(raises_for)
		self.db = types.SimpleNamespace(
			exists=self._exists, get_value=self._get_value,
			set_value=lambda *a, **k: None, count=lambda *a, **k: 0,
			commit=lambda: None)
		self.utils = types.SimpleNamespace(now=lambda: "2026-08-01 00:00:00")
		self.session = types.SimpleNamespace(user="Administrator")

	def get_doc(self, data, *a):
		doctype = data if isinstance(data, str) else data.get("doctype")
		if doctype in self._raises_for:
			raise ModuleNotFoundError(
				"No module named 'ucc_measurement_outcomes.<module>.doctype."
				"%s.%s'" % (doctype.lower().replace(" ", "_"), doctype.lower().replace(" ", "_")))
		if isinstance(data, str):
			return types.SimpleNamespace(doctype=data, name=a[0] if a else None)
		return StubDoc(data, self)

	def get_all(self, doctype, **kw):
		if doctype == "Survey Objective":
			return self._objectives[:kw.get("limit", 100)]
		if doctype == "Department":
			return self._departments[:kw.get("limit", 100)]
		return []

	def _exists(self, doctype, name):
		if doctype == "Survey Objective":
			return name in self._objectives
		return False

	def _get_value(self, doctype, name, field):
		for d in self.docs.get(doctype, []):
			if d.name == name:
				return getattr(d, field, None)
		return None


def _run(objectives=(), departments=()):
	bench = StubBench(objectives, departments)
	sys.modules["frappe"] = bench
	for mod in ("demo_data", "ucc_measurement_outcomes.demo_data"):
		sys.modules.pop(mod, None)
	try:
		import demo_data
	except ImportError:  # pragma: no cover
		from ucc_measurement_outcomes import demo_data
	demo_data._build_full()
	return bench


# The real SEQI objective IDs, as they appear in reference-documents/03.
REAL = ["OBJ-0397", "OBJ-0398", "OBJ-0399", "OBJ-0400", "OBJ-0402",
        "OBJ-0403", "OBJ-0420"]


class TestTheStubActuallyBites(unittest.TestCase):
	"""Negative tests. A validator nobody has seen reject anything is a mock.

	These are the three failures the seed would hit on a real bench, each proven
	to fail HERE first.
	"""

	def setUp(self):
		self.bench = StubBench()

	def _insert(self, data):
		StubDoc(data, self.bench).insert()

	def test_rejects_an_unknown_fieldname(self):
		with self.assertRaises(AssertionError) as e:
			self._insert({"doctype": "UCC Survey", "title": "x", "ownr_department": "y"})
		self.assertIn("no field", str(e.exception))

	def test_rejects_a_select_value_outside_the_options(self):
		with self.assertRaises(AssertionError) as e:
			self._insert({"doctype": "UCC Survey", "title": "x", "status": "Live"})
		self.assertIn("not in", str(e.exception))

	def test_rejects_a_missing_required_field(self):
		with self.assertRaises(AssertionError) as e:
			self._insert({"doctype": "UCC Survey Question", "question_type": "Rating",
						  "question_text": "x"})          # no survey_version
		self.assertIn("required field survey_version", str(e.exception))

	def test_validates_child_table_rows_too(self):
		with self.assertRaises(AssertionError) as e:
			self._insert({"doctype": "UCC Survey Question", "survey_version": "V",
						  "question_type": "Rating", "question_text": "x",
						  "choices": [{"choice_label": "1", "choice_valu": "1"}]})
		self.assertIn("UCC Survey Question Choice has no field", str(e.exception))


class TestSeedRuns(unittest.TestCase):
	def test_builds_the_advertised_records(self):
		c = _run(objectives=REAL, departments=["Academic - UCC"]).count
		self.assertEqual(c["UCC Survey"], 2)
		self.assertEqual(c["UCC Survey Version"], 2)
		self.assertEqual(c["UCC Survey Question"], 15)        # 12 + 3
		self.assertEqual(c["UCC Survey Campaign"], 2)
		self.assertEqual(c["UCC Survey Submission"], 84)      # 60 + 24
		self.assertEqual(c["UCC Survey Answer"], 538)
		self.assertEqual(c["UCC Metric Definition"], 6)
		self.assertEqual(c["UCC Index Definition"], 1)
		self.assertEqual(c["UCC Index Version"], 1)
		# 2 objectives each on rel/tan/rsp, 1 each on asr/emp/out/d_rel = 10 rows.
		self.assertEqual(c["UCC Question Mapping"], 10)

	def test_falls_back_when_the_named_objectives_are_absent(self):
		c = _run(objectives=["OBJ-0001", "OBJ-0002", "OBJ-0003"]).count
		# Same shape against a different register, and never zero mappings.
		self.assertEqual(c["UCC Question Mapping"], 10)

	def test_creates_no_mappings_when_the_register_is_empty(self):
		c = _run(objectives=[]).count
		self.assertNotIn("UCC Question Mapping", c)
		# ...but everything else still seeds. The demo is allowed to be less
		# complete, never to invent an objective.
		self.assertEqual(c["UCC Survey Answer"], 538)

	def test_survives_a_site_with_no_departments(self):
		self.assertEqual(_run(objectives=REAL, departments=[]).count["UCC Survey"], 2)

	def test_index_version_carries_the_real_seqi_weights(self):
		bench = _run(objectives=REAL)
		version = bench.docs["UCC Index Version"][0]
		metrics = [n for n in version.nodes if n.get("parent_key")]
		self.assertEqual([n["weight"] for n in metrics], [20, 15, 20, 15, 15, 15])
		self.assertEqual(sum(n["weight"] for n in metrics), 100)
		self.assertEqual(version.status, "Published")

	def test_reliability_has_sources_from_both_surveys(self):
		bench = _run(objectives=REAL)
		rel = next(m for m in bench.docs["UCC Metric Definition"]
				   if m.metric_code == "DEMO-SEQI-REL")
		self.assertEqual(len(rel.sources), 2)
		questions = {s["source_question"] for s in rel.sources}
		versions = {q.survey_version for q in bench.docs["UCC Survey Question"]
					if q.name in questions}
		self.assertEqual(len(versions), 2, "Reliability must span two survey versions")


if __name__ == "__main__":
	unittest.main(verbosity=2)
