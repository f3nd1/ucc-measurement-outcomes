# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Shape dashboard data for export. Frappe-free; tested in test_dashboard_export.py.

CSV is written by explorer_agg.to_csv - the same permission-checked path Data
Explorer already uses. This module only reshapes; it does not write CSV, so
there is exactly one CSV writer in the app.

The PDF body is built here as plain HTML for frappe.utils.pdf.get_pdf. No PDF
library: Frappe ships wkhtmltopdf rendering already.

Everything exported comes from UCC Index Result. Historical Survey Response data
is reference-only and never appears in anything presented as a calculated
result - enforced in test_reference_only.py, not just stated here.
"""

SECTIONS = ("kpis", "contribution", "trend", "weak")


def _fmt(v):
	if v is None:
		return ""
	if isinstance(v, float):
		return round(v, 2)
	return v


def to_table(data, section="kpis"):
	"""Dashboard payload -> the {columns, rows} shape explorer_agg.to_csv takes.

	One section per export so a column means the same thing down a whole file -
	stacking KPIs, contributions and trend into one sheet would put four
	different meanings under one header.
	"""
	if section == "kpis":
		cols = ["Index Version", "Period", "Entity", "Value", "Target", "Delta"]
		rows = [
			{"row": k.get("index"), "cells": {
				"Index Version": _fmt(k.get("index_version")),
				"Period": _fmt(k.get("period")), "Entity": _fmt(k.get("entity")),
				"Value": _fmt(k.get("value")), "Target": _fmt(k.get("target")),
				"Delta": _fmt(k.get("delta")),
			}}
			for k in data.get("kpis", [])
		]
	elif section == "contribution":
		cols = ["Index", "Metric", "Normalised", "Weight", "Contribution"]
		rows = [
			{"row": c.get("component_label") or c.get("component_key"), "cells": {
				"Index": _fmt(c.get("index")), "Metric": _fmt(c.get("source_metric")),
				"Normalised": _fmt(c.get("normalised_value")),
				"Weight": _fmt(c.get("weight")), "Contribution": _fmt(c.get("contribution")),
			}}
			for c in data.get("contribution", [])
		]
	elif section == "trend":
		cols = ["Value", "Target"]
		rows = [
			{"row": t.get("period"), "cells": {
				"Value": _fmt(t.get("value")), "Target": _fmt(t.get("target"))}}
			for t in data.get("trend", [])
		]
	elif section == "weak":
		weak = data.get("weak_areas") or {}
		cols = ["Type", "Value", "Target", "Detail"]
		rows = [
			{"row": k.get("index"), "cells": {
				"Type": "Index below target", "Value": _fmt(k.get("value")),
				"Target": _fmt(k.get("target")), "Detail": _fmt(k.get("period"))}}
			for k in weak.get("indices", [])
		] + [
			{"row": c.get("component_label") or c.get("component_key"), "cells": {
				"Type": "Component below %s" % weak.get("threshold"),
				"Value": _fmt(c.get("normalised_value")), "Target": "",
				"Detail": _fmt(c.get("source_metric"))}}
			for c in weak.get("components", [])
		]
	else:
		raise ValueError("unknown section: %s" % section)
	return {"columns": cols, "rows": rows}


def describe_filters(filters):
	"""Applied filters, in words. A report that does not say what it was filtered
	to is unreadable as evidence - the same numbers mean different things for one
	programme and for the whole college."""
	labels = {"index": "Index", "index_version": "Version", "period": "Period",
			  "entity_type": "Dimension", "entity": "Value"}
	applied = [(labels[k], v) for k, v in filters.items() if v and k in labels]
	if not applied:
		return "No filters applied - all indices, all periods, all entities."
	return " · ".join("%s: %s" % (k, v) for k, v in applied)


def _esc(s):
	return (str("" if s is None else s)
			.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _table_html(title, table):
	if not table["rows"]:
		return "<h3>%s</h3><p class='muted'>None.</p>" % _esc(title)
	head = "".join("<th>%s</th>" % _esc(c) for c in table["columns"])
	body = "".join(
		"<tr><td>%s</td>%s</tr>" % (
			_esc(r["row"]),
			"".join("<td>%s</td>" % _esc(r["cells"].get(c)) for c in table["columns"]),
		)
		for r in table["rows"]
	)
	return ("<h3>%s</h3><table><thead><tr><th></th>%s</tr></thead><tbody>%s</tbody></table>"
			% (_esc(title), head, body))


def _bars(rows, label_key, value_key):
	"""The visuals, as CSS bars. A chart library would be a new dependency and
	wkhtmltopdf renders a table with widths perfectly well."""
	vals = [abs(r.get(value_key) or 0) for r in rows]
	top = max(vals) if vals else 0
	if not top:
		return ""
	out = []
	for r in rows:
		pct = int((abs(r.get(value_key) or 0) / top) * 100)
		out.append(
			"<div class='bar'><span class='l'>%s</span>"
			"<span class='t'><i style='width:%d%%'></i></span>"
			"<span class='v'>%s</span></div>"
			% (_esc(r.get(label_key)), pct, _esc(_fmt(r.get(value_key))))
		)
	return "<div class='bars'>%s</div>" % "".join(out)


def to_html(data, filters, generated_on, title="UCC Measurement Outcomes"):
	"""A formatted report, not a screenshot: what it is, what it was filtered to,
	the numbers, the visuals, and the weak areas."""
	kpis = data.get("kpis", [])
	return """<!doctype html><html><head><meta charset="utf-8"><style>
	body{font-family:Helvetica,Arial,sans-serif;color:#1f272e;font-size:11px;margin:24px}
	h1{font-size:20px;margin:0 0 2px} h2{font-size:12px;color:#5b6672;font-weight:400;margin:0 0 14px}
	h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#8b95a5;margin:20px 0 6px}
	table{width:100%%;border-collapse:collapse} th,td{border:1px solid #dbe1e8;padding:5px 7px;text-align:left}
	th{background:#f2f5f9;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#5b6672}
	.muted{color:#8b95a5} .kpi{display:inline-block;border:1px solid #dbe1e8;border-radius:8px;
	padding:9px 13px;margin:0 8px 8px 0;min-width:120px}
	.kpi .n{font-size:10px;color:#8b95a5;text-transform:uppercase;letter-spacing:.05em}
	.kpi .v{font-size:22px;font-weight:700} .kpi .d{font-size:10px}
	.bars{margin-top:6px} .bar{display:flex;align-items:center;gap:8px;margin:3px 0}
	.bar .l{width:34%%;overflow:hidden} .bar .t{flex:1;height:8px;background:#e4e9f1;border-radius:99px}
	.bar .t i{display:block;height:100%%;background:#223a6b;border-radius:99px}
	.bar .v{width:52px;text-align:right}
	.foot{margin-top:22px;color:#8b95a5;font-size:9px;border-top:1px solid #dbe1e8;padding-top:6px}
	</style></head><body>
	<h1>%(title)s</h1>
	<h2>%(filters)s &nbsp;·&nbsp; generated %(generated)s</h2>
	%(kpiblocks)s
	%(contribution)s
	%(bars)s
	%(trend)s
	%(weak)s
	<div class="foot">Calculated from UCC Index Results only. Historical survey
	responses are reference data and are never included in a calculated result.</div>
	</body></html>""" % {
		"title": _esc(title),
		"filters": _esc(describe_filters(filters)),
		"generated": _esc(generated_on),
		"kpiblocks": "".join(
			"<div class='kpi'><div class='n'>%s</div><div class='v'>%s</div>"
			"<div class='d'>%s</div></div>" % (
				_esc(k.get("index")), _esc(_fmt(k.get("value"))),
				_esc("target %s" % _fmt(k.get("target"))) if k.get("target") is not None else "",
			) for k in kpis),
		"contribution": _table_html("Contribution by component", to_table(data, "contribution")),
		"bars": _bars(data.get("contribution", []), "component_label", "contribution"),
		"trend": _table_html("Trend by period", to_table(data, "trend")),
		"weak": _table_html("Weak areas", to_table(data, "weak")),
	}
