"""Pure scoring / normalisation engine for indices.

No Frappe import — fully unit-tested with fixture data (test_index_engine.py).
The Frappe service (index_calc.py) loads nodes + metric values and delegates all
arithmetic here, so the official calculation is deterministic and reproducible.
"""


def _clamp(v, lo, hi):
	return max(lo, min(hi, v))


# A "Yes / No" question built in the Survey Builder stores the word, not a digit:
# api/builder.CHOICE_DEFAULTS gives it labels "Yes"/"No" with no choice_value, and
# survey_form.js falls back to the label. float("Yes") raises, so before this the
# Yes/No rule scored every such answer as None - a Yes/No metric over a Yes/No
# question came out empty and no error said why.
_YES = frozenset({"yes", "y", "true", "t"})
_NO = frozenset({"no", "n", "false", "f"})


def normalise(value, rule, reverse=False):
	"""Convert a raw metric value to a 0-100 score per the given rule.

	Returns None for "Category Only" and for a missing value. Count/Hours are
	returned unchanged (they are raw metrics, not 0-100 scores).
	"""
	if value is None:
		return None
	if rule == "Category Only (No Score)":
		return None
	if rule == "Yes/No to 100/0" and isinstance(value, str):
		word = value.strip().lower()
		if word in _YES or word in _NO:
			out = 100.0 if word in _YES else 0.0
			return 100 - out if reverse else out
	try:
		v = float(value)
	except (TypeError, ValueError):
		# Non-numeric raw value can't be scored; treat as no score.
		return None
	if rule == "Likert 1-5 to 0-100":
		out = (v - 1) / 4 * 100
	elif rule == "NPS 0-10 to 0-100":
		# The 0-10 recommend scale, scored as position on the scale. NOT the NPS
		# promoters-minus-detractors formula: that is a -100..100 figure for a
		# WHOLE population, and this function scores ONE answer at a time, so
		# there is no population here to compute it over.
		out = v / 10 * 100
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
		# Unknown/missing rule: refuse to score rather than silently clamping the
		# raw value into 0-100 (a Likert 4 with a lost rule would have become
		# 4/100 and quietly poisoned every index above it — Pass 2 finding).
		return None
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


def structural_issues(nodes):
	"""Structural problems that make a formula graph invalid: no nodes, missing
	or multiple roots, duplicate keys, dangling parent references, or cycles.
	compute_index silently scores only what is reachable from the first root, so
	any of these means part of the formula would be silently ignored."""
	if not nodes:
		return ["Formula has no nodes."]
	issues = []
	keys = [n["key"] for n in nodes]
	keyset = set(keys)
	if len(keyset) != len(keys):
		dupes = sorted({k for k in keys if keys.count(k) > 1})
		issues.append("Duplicate node keys: %s." % ", ".join(dupes))
	roots = [n["key"] for n in nodes if not n.get("parent_key")]
	if not roots:
		issues.append("Formula has no root node.")
	elif len(roots) > 1:
		issues.append("Formula has multiple root nodes: %s." % ", ".join(sorted(roots)))
	dangling = sorted(n["key"] for n in nodes
					  if n.get("parent_key") and n["parent_key"] not in keyset)
	if dangling:
		issues.append("Nodes reference a missing parent: %s." % ", ".join(dangling))
	negative = sorted(n["key"] for n in nodes if (n.get("weight") or 0) < 0)
	if negative:
		# weights_valid only checks the SUM per parent, so 120 + (-20) would
		# otherwise publish as a "valid" 100.
		issues.append("Negative weights on: %s." % ", ".join(negative))
	parent = {n["key"]: (n.get("parent_key") or None) for n in nodes}
	for start in parent:
		seen = set()
		k = start
		while k is not None and k in parent:
			if k in seen:
				issues.append("Circular reference involving '%s'." % k)
				return issues  # one cycle is enough to block publish
			seen.add(k)
			k = parent[k]
	return issues


def structural_warnings(nodes):
	"""Problems worth saying out loud that must NOT block publishing.

	A 0% node passes every existing check - it does not change its parent's
	total, so weights_valid is happy and structural_issues has nothing to say -
	while contributing exactly nothing to the score. That is the expected state
	right after adding a node (they are added at 0 rather than silently
	rebalancing everyone else), so it is a warning, not an error."""
	warnings = []
	zero = sorted(n["key"] for n in nodes
				  if n.get("parent_key") and not (n.get("weight") or 0))
	if zero:
		warnings.append(
			"Contributing nothing at 0%% weight: %s." % ", ".join(zero))
	childless = {n.get("parent_key") for n in nodes if n.get("parent_key")}
	leaves = sorted(n["key"] for n in nodes
					if n["key"] not in childless
					and n.get("type") == "Metric"
					and not n.get("source_metric"))
	if leaves:
		warnings.append(
			"Metric nodes with no source metric set: %s." % ", ".join(leaves))
	return warnings


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


def effective_weights(nodes):
	"""{node_key: effective share of the whole index, in percent}.

	The nominal composition of the formula: a child's effective contribution is
	its parent's effective contribution times its own weight within its parent.
	Root = 100.

	This is NOT what compute_index divides by. weighted_score re-bases on the
	weight actually PRESENT, so a sibling with no metric result silently
	redistributes its share at calculation time. That is a property of one
	calculation run against one set of results; this is a property of the
	formula, which is what an editor and an evidence export need to show.
	"""
	children = {}
	for n in nodes:
		children.setdefault(n.get("parent_key") or None, []).append(n)
	out = {}

	def walk(key, share):
		kids = children.get(key, [])
		total = sum((k.get("weight") or 0) for k in kids)
		for k in kids:
			w = k.get("weight") or 0
			# Divide by the declared total, not by 100: a parent whose children
			# total 90 still splits ITS share between them in those proportions,
			# and showing 90% of the parent's share would hide the gap rather
			# than let the weight check report it.
			child_share = share * (w / total) if total else 0
			out[k["key"]] = child_share
			walk(k["key"], child_share)

	roots = [n for n in nodes if not n.get("parent_key")]
	for r in roots:
		out[r["key"]] = 100.0
		walk(r["key"], 100.0)
	return out


def component_problems(nodes, metric_facts=None):
	"""Per-component problems, each naming the exact node it belongs to.

	A generic "formula is invalid" tells nobody which row to fix, which is the
	whole complaint this answers. Returns
	[{key, label, severity, message}] with severity "error" or "warning".

	metric_facts: {metric_code: {"exists": bool, "sources": int, "status": str}}
	Absent means "not checked" - this module never invents a fact about a
	metric it was not told about.
	"""
	facts = metric_facts or {}
	out = []
	label_of = {n["key"]: (n.get("label") or n["key"]) for n in nodes}

	def add(key, severity, message):
		out.append({"key": key, "label": label_of.get(key, key),
		            "severity": severity, "message": message})

	children = {}
	for n in nodes:
		children.setdefault(n.get("parent_key") or None, []).append(n)

	for n in nodes:
		key, weight = n["key"], (n.get("weight") or 0)
		is_root = not n.get("parent_key")
		if not is_root and weight == 0:
			add(key, "warning", "Weight is 0%, so this contributes nothing.")
		if weight < 0:
			add(key, "error", "Weight is negative.")
		if n.get("type") == "Metric" and not n.get("source_metric"):
			add(key, "warning", "No metric is attached, so this node scores nothing.")
		code = n.get("source_metric")
		if code and code in facts:
			fact = facts[code]
			if not fact.get("exists", True):
				add(key, "error", "Metric '{0}' does not exist.".format(code))
			elif not fact.get("sources", 1):
				add(key, "warning",
				    "Metric '{0}' has no source questions, so it scores nothing.".format(code))

	# Duplicate metric under the SAME parent. Across different parents it may be
	# deliberate (one metric feeding two dimensions), so that is not flagged here.
	for parent, kids in children.items():
		seen = {}
		for k in kids:
			code = k.get("source_metric")
			if not code:
				continue
			if code in seen:
				add(k["key"], "error",
				    "Metric '{0}' is already used by '{1}' under the same parent.".format(
					    code, label_of.get(seen[code], seen[code])))
			else:
				seen[code] = k["key"]

	# Each parent's children must total 100. Reported against the PARENT, since
	# that is the row a user fixes, and separately from the top level so a child
	# gap is never hidden by a balanced root.
	for parent, kids in children.items():
		if parent is None:
			continue
		total = weights_total([k.get("weight") or 0 for k in kids])
		if kids and not weights_valid([k.get("weight") or 0 for k in kids]):
			add(parent, "error",
			    "Child weights total {0}%, expected 100%.".format(round(total, 2)))
	return out
