"""Pure pivot/aggregation for Data Explorer.

Frappe-free so it can be unit-tested without a bench (test_explorer_agg.py).
The catalogue-guarded API (api/explorer.py) fetches whitelisted rows and hands
them here — no arbitrary SQL is ever built.
"""

import csv
import io


def _apply(agg, values, count):
	if agg == "count":
		return count
	if agg == "sum":
		return sum(values) if values else 0
	if agg == "avg":
		return sum(values) / len(values) if values else None
	return None


def aggregate(rows, row_dim, col_dim, agg, field):
	"""Pivot rows into a {columns, rows:[{row, cells}]} table.

	row_dim/col_dim may be None (collapsed to a single "All"/"Total" bucket).
	agg is one of count/sum/avg; field is the measured field (None for count).
	"""
	groups = {}
	rowset, colset = [], []
	for r in rows:
		rv = r.get(row_dim) if row_dim else "All"
		cv = r.get(col_dim) if col_dim else "Total"
		rv = "—" if rv is None else rv
		cv = "—" if cv is None else cv
		g = groups.setdefault((rv, cv), {"vals": [], "count": 0})
		g["count"] += 1
		if field and r.get(field) is not None:
			g["vals"].append(float(r[field]))
		if rv not in rowset:
			rowset.append(rv)
		if cv not in colset:
			colset.append(cv)
	rowset.sort()
	colset.sort()
	matrix = []
	for rv in rowset:
		cells = {}
		for cv in colset:
			g = groups.get((rv, cv))
			cells[cv] = _apply(agg, g["vals"], g["count"]) if g else None
		matrix.append({"row": rv, "cells": cells})
	return {"columns": colset, "rows": matrix}


def to_csv(table, row_label="Row"):
	out = io.StringIO()
	w = csv.writer(out)
	w.writerow([row_label] + list(table["columns"]))
	for r in table["rows"]:
		w.writerow([r["row"]] + [r["cells"].get(c) for c in table["columns"]])
	return out.getvalue()
