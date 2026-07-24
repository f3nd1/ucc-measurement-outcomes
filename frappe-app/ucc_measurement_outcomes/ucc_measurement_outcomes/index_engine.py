"""Pure scoring / normalisation engine for indices.

No Frappe import — fully unit-tested with fixture data (test_index_engine.py).
The Frappe service (index_calc.py) loads nodes + metric values and delegates all
arithmetic here, so the official calculation is deterministic and reproducible.
"""


def _clamp(v, lo, hi):
	return max(lo, min(hi, v))


def normalise(value, rule, reverse=False):
	"""Convert a raw metric value to a 0-100 score per the given rule.

	Returns None for "Category Only" and for a missing value. Count/Hours are
	returned unchanged (they are raw metrics, not 0-100 scores).
	"""
	if value is None:
		return None
	if rule == "Category Only (No Score)":
		return None
	try:
		v = float(value)
	except (TypeError, ValueError):
		# Non-numeric raw value can't be scored; treat as no score.
		return None
	if rule == "Likert 1-5 to 0-100":
		out = (v - 1) / 4 * 100
	elif rule == "Yes/No to 100/0":
		out = 100.0 if v else 0.0
	elif rule == "Reverse 0-100":
		# The rule itself reverses; do not also apply the reverse flag.
		return _clamp(100 - v, 0, 100)
	elif rule == "Ratio to Percentage":
		out = v * 100
	elif rule in ("Count", "Hours"):
		return v
	else:
		out = v
	out = _clamp(out, 0, 100)
	if reverse:
		out = 100 - out
	return out


def weighted_score(components):
	"""Weighted average of components [{value, weight}], ignoring missing values.

	Divides by the total weight actually present, so partial coverage still
	produces a fair score. Returns None if nothing usable is present.
	"""
	present = [c for c in components if c.get("value") is not None]
	total_w = sum(c["weight"] for c in present)
	if total_w == 0:
		return None
	return sum(c["value"] * c["weight"] for c in present) / total_w


def weights_total(weights):
	return round(sum(weights), 6)


def weights_valid(weights, expected=100):
	return abs(weights_total(weights) - expected) < 1e-6


def compute_index(nodes, metric_values):
	"""Compute an index score plus a per-node breakdown for the explain view.

	nodes: list of dicts {key, type, label, parent_key, weight, source_metric,
	       normalisation, reverse}. Exactly one root (parent_key falsy).
	metric_values: {metric_code: raw_value}.
	Returns {value, breakdown:[{key,label,type,raw_value,value,weight,
	         parent_key,source_metric,contribution}]}.
	"""
	children = {}
	for n in nodes:
		children.setdefault(n.get("parent_key") or None, []).append(n)
	breakdown = {}

	def score(node):
		kids = children.get(node["key"], [])
		if not kids:
			raw = metric_values.get(node.get("source_metric"))
			# Metric values arrive already normalised to 0-100 from the metric
			# mapping layer (UCC Metric Result). The index applies weights only and
			# never re-normalises, so a value can't be normalised twice.
			val = None if raw is None else _clamp(float(raw), 0, 100)
			breakdown[node["key"]] = {
				"key": node["key"], "label": node.get("label", node["key"]),
				"type": node.get("type"), "raw_value": raw, "value": val,
				"weight": node.get("weight", 0) or 0, "parent_key": node.get("parent_key") or None,
				"source_metric": node.get("source_metric"),
			}
			return val
		comps = [{"key": k["key"], "value": score(k), "weight": k.get("weight", 0) or 0} for k in kids]
		agg = weighted_score(comps)
		breakdown[node["key"]] = {
			"key": node["key"], "label": node.get("label", node["key"]),
			"type": node.get("type"), "raw_value": None, "value": agg,
			"weight": node.get("weight", 0) or 0, "parent_key": node.get("parent_key") or None,
			"source_metric": None,
		}
		return agg

	roots = [n for n in nodes if not n.get("parent_key")]
	value = score(roots[0]) if roots else None

	rows = list(breakdown.values())
	for r in rows:
		pk = r["parent_key"]
		if pk and r["value"] is not None:
			siblings = [x for x in rows if x["parent_key"] == pk and x["value"] is not None]
			tw = sum(s["weight"] for s in siblings)
			r["contribution"] = (r["value"] * r["weight"] / tw) if tw else None
		else:
			r["contribution"] = None
	return {"value": value, "breakdown": rows}
