# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Runs the drop_ucc_standard patch against every site state it can meet.

    python3 test_patch_drop_ucc_standard.py

This exists because v0.31.0's first attempt crashed live during `bench migrate`:

    ModuleNotFoundError: ucc_measurement_outcomes.mapping_studio.doctype
                         .ucc_standard.ucc_standard

`frappe.delete_doc` on a ROW calls `frappe.get_doc`, which imports the DocType's
controller - and the same release deleted that file. So the stub below raises
ModuleNotFoundError from `get_doc` for exactly that DocType, the way a real bench
does. A patch that reaches for the document layer fails here.

The four states matter because a failed patch is rolled back and NOT written to
the Patch Log, so it re-runs on the next migrate against whatever is left.
"""

import sys
import types
import unittest

DOCTYPE = "UCC Standard"


class StubDB:
	def __init__(self, table, rows, doctype_row):
		self.table = table
		self.rows = list(rows)
		self.doctype_row = doctype_row
		self.deleted_tables = []
		self.committed = False

	def table_exists(self, doctype, cached=True):
		return self.table and doctype == DOCTYPE

	def exists(self, doctype, name=None):
		if doctype == "DocType" and name == DOCTYPE:
			return DOCTYPE if self.doctype_row else None
		return None

	def sql(self, query, *a, **kw):
		assert "tab" + DOCTYPE in query, query
		if not self.table:
			raise RuntimeError("queried a table that does not exist: " + query)
		return [(r,) for r in self.rows]

	def delete(self, doctype, filters=None, **kw):
		# The plain DELETE query. No document is loaded, which is the whole point.
		assert doctype == DOCTYPE, doctype
		self.deleted_tables.append(doctype)
		self.rows = []

	def commit(self):
		self.committed = True


class StubFrappe(types.ModuleType):
	"""A bench where UCC Standard's controller file is already gone."""

	def __init__(self, table=True, rows=(), doctype_row=True):
		super().__init__("frappe")
		self.db = StubDB(table, rows, doctype_row)
		self.deleted_docs = []

	def get_doc(self, doctype, name=None, *a, **kw):
		if doctype == DOCTYPE:
			raise ModuleNotFoundError(
				"No module named 'ucc_measurement_outcomes.mapping_studio."
				"doctype.ucc_standard.ucc_standard'")
		return types.SimpleNamespace(doctype=doctype, name=name)

	def delete_doc(self, doctype, name=None, **kw):
		if doctype == DOCTYPE:
			# This is the v0.31.0 crash, reproduced: delete_doc on a row goes
			# through get_doc and needs the controller.
			return self.get_doc(doctype, name)
		self.deleted_docs.append((doctype, name, kw))
		if doctype == "DocType" and name == DOCTYPE:
			self.db.doctype_row = None


def run(table=True, rows=(), doctype_row=True):
	bench = StubFrappe(table, rows, doctype_row)
	sys.modules["frappe"] = bench
	for mod in list(sys.modules):
		if "drop_ucc_standard" in mod:
			sys.modules.pop(mod)
	sys.path.insert(0, "patches/v0_31_0")
	import drop_ucc_standard
	drop_ucc_standard.execute()
	return bench


class TestPatchSurvivesEverySiteState(unittest.TestCase):
	def test_the_exact_failed_state(self):
		"""Table there, DocType there, DEMO-STD-C7 still present after rollback."""
		bench = run(table=True, rows=["DEMO-STD-C7"], doctype_row=True)
		self.assertEqual(bench.db.deleted_tables, [DOCTYPE])
		self.assertEqual(bench.db.rows, [])
		self.assertIn(("DocType", DOCTYPE), [(d, n) for d, n, _ in bench.deleted_docs])
		self.assertTrue(bench.db.committed)

	def test_the_doctype_delete_is_forced(self):
		# A non-custom DocType is refused without force=True
		# ("Standard DocType can not be deleted", frappe/model/delete_doc.py).
		bench = run(rows=["DEMO-STD-C7"])
		kw = [k for d, n, k in bench.deleted_docs if d == "DocType"][0]
		self.assertTrue(kw.get("force"))
		self.assertTrue(kw.get("ignore_missing"))

	def test_rerun_after_success_is_a_no_op(self):
		bench = run(table=False, rows=(), doctype_row=False)
		self.assertEqual(bench.db.deleted_tables, [])
		self.assertEqual(bench.deleted_docs, [])
		self.assertFalse(bench.db.committed)

	def test_table_present_but_already_empty(self):
		bench = run(table=True, rows=(), doctype_row=True)
		self.assertEqual(bench.db.deleted_tables, [])          # nothing to delete
		self.assertIn(("DocType", DOCTYPE), [(d, n) for d, n, _ in bench.deleted_docs])

	def test_doctype_gone_but_table_left_behind(self):
		"""The half-done state a re-run can meet. get_all would fail here - there
		is no meta left - which is why the patch reads the rows by raw SQL."""
		bench = run(table=True, rows=["DEMO-STD-C7"], doctype_row=False)
		self.assertEqual(bench.db.deleted_tables, [DOCTYPE])
		self.assertEqual(bench.deleted_docs, [])

	def test_a_site_holding_real_rows_still_completes(self):
		bench = run(table=True, rows=["GD4", "GD5", "DEMO-STD-C7"], doctype_row=True)
		self.assertEqual(bench.db.rows, [])
		self.assertTrue(bench.db.committed)

	def test_the_stub_really_reproduces_the_crash(self):
		"""Proof this suite would have caught v0.31.0: the OLD call still raises."""
		bench = run(rows=["DEMO-STD-C7"])
		with self.assertRaises(ModuleNotFoundError):
			bench.delete_doc(DOCTYPE, "DEMO-STD-C7", force=True)


if __name__ == "__main__":
	unittest.main(verbosity=2)
