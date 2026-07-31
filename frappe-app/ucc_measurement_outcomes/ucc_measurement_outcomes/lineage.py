# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Assemble the Index -> Objective -> Question -> Result report.

Frappe-free so the shape is unit-tested without a bench (test_lineage.py).
api/lineage.py fetches the rows and delegates here.

Two rules this module exists to hold:

1. A metric's contribution is NEVER split across objectives. 5 of 265 real
   questions carry more than one objective, so a metric can trace to several.
   Splitting the number would invent arithmetic that appears in no calculation
   and attributing it to a "primary" objective would silently drop the rest, so
   the component is listed under each objective it touches, once, marked shared.

2. What cannot be traced is reported, not omitted. A component contributing 13
   points with no objective behind it is exactly the gap this product exists to
   surface; a report that quietly drops it reads as complete when it is not.
"""

SHARED_NOTE = "shared - also counted under {0}"


def _split(s):
	return [p.strip() for p in (s or "").split(",") if p.strip()]


def build_report(result, breakdown, question_text=None, objective_names=None,
				 corrections=None):
	"""result:    {index, index_version, period, entity, value, target, calculation_date}
	breakdown:    UCC Score Breakdown rows, the SNAPSHOT taken at calculation.
	question_text/objective_names: display lookups only; never affect structure.
	corrections:  {question_name: reason} for questions whose WORDING was
	              corrected after publication (decision 2026-07-29).

	Why corrections have to appear here. No answer row snapshots the wording a
	respondent saw, and this report resolves question_text live - so after a
	correction it would print the new wording as though it were the original,
	with nothing saying otherwise. That is precisely the failure the
	frozen-content rule exists to prevent, so the exemption only holds while the
	correction is visible at the point the evidence is READ, not merely recorded
	in a version history nobody opens.

	Returns {header, components, objectives, untraceable, snapshot_complete}.
	"""
	question_text = question_text or {}
	objective_names = objective_names or {}
	corrections = corrections or {}

	components = []
	for b in breakdown:
		components.append({
			"key": b.get("component_key"),
			"label": b.get("component_label") or b.get("component_key"),
			"metric": b.get("source_metric"),
			"raw_value": b.get("raw_value"),
			"value": b.get("normalised_value"),
			"weight": b.get("weight"),
			"contribution": b.get("contribution"),
			"objectives": _split(b.get("lineage_objectives")),
			"clauses": _split(b.get("lineage_clauses")),
			"questions": _split(b.get("lineage_questions")),
		})

	# Results calculated before the snapshot fields existed carry no lineage at
	# all. Say so rather than rendering an empty report that looks like "nothing
	# traces" when the truth is "this was never recorded".
	scoring = [c for c in components if c["metric"]]
	snapshot_complete = bool(scoring) and all(
		c["objectives"] or c["questions"] for c in scoring
	)

	by_objective = {}
	untraceable = []
	for c in components:
		if not c["metric"]:
			continue   # structural node (index root / dimension), not a leaf
		if not c["objectives"]:
			untraceable.append({
				"component": c,
				"reason": ("metric has no source questions"
						   if not c["questions"]
						   else "source questions map to no objective"),
			})
			continue
		for obj in c["objectives"]:
			by_objective.setdefault(obj, []).append(c)

	objectives = []
	for code in sorted(by_objective):
		rows = []
		for c in by_objective[code]:
			others = [o for o in c["objectives"] if o != code]
			rows.append({
				"component": c,
				"shared_with": others,
				# The number is the component's own contribution, repeated - never
				# divided. The note is what stops it being read as additive.
				"note": SHARED_NOTE.format(", ".join(others)) if others else None,
				"questions": [
					{"name": q, "text": question_text.get(q, q),
					 "corrected": corrections.get(q)} for q in c["questions"]
				],
			})
		objectives.append({
			"code": code,
			"name": objective_names.get(code, code),
			"clauses": sorted({cl for c in by_objective[code] for cl in c["clauses"]}),
			"rows": rows,
			# Deliberately no total: with shared components any sum would either
			# double-count or require splitting a number nobody calculated.
			"shared": any(r["shared_with"] for r in rows),
		})

	return {
		"header": {
			"index": result.get("index"),
			"index_version": result.get("index_version"),
			"period": result.get("period"),
			"entity_type": result.get("entity_type"),
			"entity": result.get("entity"),
			"value": result.get("value"),
			"target": result.get("target"),
			"calculation_date": result.get("calculation_date"),
		},
		"components": components,
		"objectives": objectives,
		"untraceable": untraceable,
		"snapshot_complete": snapshot_complete,
	}
