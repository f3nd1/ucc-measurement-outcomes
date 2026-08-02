# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Runs the drop_ucc_standard patch against every site state it can meet.

    python3 test_patch_drop_ucc_standard.py

This exists because v0.31.0's first attempt crashed live during `bench migrate`:

    ModuleNotFoundError: ucc_measurement_outcomes.mapping_studio.doctype
                         .ucc_standard.ucc_standard

`frappe.delete_doc` on a ROW calls `frappe.get_doc`, which imports the DocType's
controller - and the same release deleted that file. `StubBench(raises_for=...)`
reproduces exactly that, so a patch that reaches for the document layer fails
here rather than on the site.

The four states matter because a failed patch is rolled back and NOT written to
the Patch Log, so it re-runs on the next migrate against whatever is left.
"""

import sys
import types
import unittest

from test_demo_seed_dry import StubBench

DOCTYPE = "UCC Standard"


class PatchBench(StubBench):
	"""The shared stub plus the handful of db calls this patch makes."""

	def __init__(self, table=True, rows=(), doctype_row=True):
		super().__init__(raises_for=[DOCTYPE])
		self.table = table
		self.rows = list(rows)
		self.doctype_row = doctype_row
		self.deleted_tables = []
		self.deleted_docs = []
		self.committed = False
		self.db = types.SimpleNamespace(
			table_exists=lambda dt, cached=True: self.table and dt == DOCTYPE,
			exists=lambda dt, name=None: DOCTYPE if (dt == "DocType" and name == DOCTYPE
													 and self.doctype_row) else None,
			sql=self._sql, delete=self._delete, commit=self._commit)

	def _sql(self, query, *a, **kw):
		assert "tab" + DOCTYPE in query, query
		assert self.table, "queried a table that does not exist: " + query
		return [(r,) for r in self.rows]

	def _delete(self, doctype, filters=None, **kw):
		# The plain DELETE query. No document is loaded, which is the whole point.
		assert doctype == DOCTYPE, doctype
		self.deleted_tables.append(doctype)
		self.rows = []

	def _commit(self):
		self.committed = True

	def delete_doc(self, doctype, name=None, **kw):
		if doctype == DOCTYPE:
			# The v0.31.0 crash: delete_doc on a row goes through get_doc.
			return self.get_doc(doctype, name)
		self.deleted_docs.append((doctype, name, kw))
		if doctype == "DocType" and name == DOCTYPE:
			self.doctype_row = None


def run(table=True, rows=(), doctype_row=True):
	bench = PatchBench(table, rows, doctype_row)
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
		self.assertEqual(bench.deleted_tables, [DOCTYPE])
		self.assertEqual(bench.rows, [])
		self.assertIn(("DocType", DOCTYPE), [(d, n) for d, n, _ in bench.deleted_docs])
		self.assertTrue(bench.committed)

	def test_the_doctype_delete_is_forced(self):
		# A non-custom DocType is refused without force=True
		# ("Standard DocType can not be deleted", frappe/model/delete_doc.py).
		bench = run(rows=["DEMO-STD-C7"])
		kw = [k for d, n, k in bench.deleted_docs if d == "DocType"][0]
		self.assertTrue(kw.get("force"))
		self.assertTrue(kw.get("ignore_missing"))

	def test_rerun_after_success_is_a_no_op(self):
		bench = run(table=False, rows=(), doctype_row=False)
		self.assertEqual(bench.deleted_tables, [])
		self.assertEqual(bench.deleted_docs, [])
		self.assertFalse(bench.committed)

	def test_table_present_but_already_empty(self):
		bench = run(table=True, rows=(), doctype_row=True)
		self.assertEqual(bench.deleted_tables, [])          # nothing to delete
		self.assertIn(("DocType", DOCTYPE), [(d, n) for d, n, _ in bench.deleted_docs])

	def test_doctype_gone_but_table_left_behind(self):
		"""The half-done state a re-run can meet. get_all would fail here - there
		is no meta left - which is why the patch reads the rows by raw SQL."""
		bench = run(table=True, rows=["DEMO-STD-C7"], doctype_row=False)
		self.assertEqual(bench.deleted_tables, [DOCTYPE])
		self.assertEqual(bench.deleted_docs, [])

	def test_a_site_holding_real_rows_still_completes(self):
		bench = run(table=True, rows=["GD4", "GD5", "DEMO-STD-C7"], doctype_row=True)
		self.assertEqual(bench.rows, [])
		self.assertTrue(bench.committed)

	def test_the_stub_really_reproduces_the_crash(self):
		"""Proof this suite would have caught v0.31.0: the OLD call still raises."""
		bench = run(rows=["DEMO-STD-C7"])
		with self.assertRaises(ModuleNotFoundError):
			bench.delete_doc(DOCTYPE, "DEMO-STD-C7", force=True)


if __name__ == "__main__":
	unittest.main(verbosity=2)
