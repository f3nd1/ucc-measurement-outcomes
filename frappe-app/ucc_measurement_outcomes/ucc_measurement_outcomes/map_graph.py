# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""The two-column mapping canvas: questions on the left, objectives on the
right, an edge per real question->objective mapping.

Frappe-free so it can be unit-tested without a bench (test_map_graph.py). The
canvas is a WRITE surface - dropping a line creates a mapping - so the two rules
that decide what a dropped line means are the last things that should live
inside an event handler:

  * which node ids exist, and
  * which pair a drop resolves to, in either drag direction.

Node ids are prefixed ("q:" / "o:") rather than raw docnames. Both columns are
Link targets in the same canvas, and a question and an objective could in
principle share a name; without a prefix a drop would be ambiguous with no way
to tell.
"""

Q_PREFIX = "q:"
O_PREFIX = "o:"

# Layout-only rows. coverage.py skips these for the same reason: counting a
# section heading as an unmapped question produces a gap nobody can ever clear.
SKIP_TYPES = frozenset({"Section Heading"})

COL_Q_X = 30
COL_O_X = 380
ROW_H = 92
TOP = 20


def _rows(items, x, prefix, kind, port):
	return [
		{
			"id": prefix + it["name"],
			"type": kind,
			"title": it.get("title") or it["name"],
			"sub": it.get("sub") or "",
			"x": x,
			"y": TOP + i * ROW_H,
			"port": port,
		}
		for i, it in enumerate(items)
	]


def build_map_graph(questions, objectives, unmapped_only=False, unmapped=()):
	"""(nodes, edges) for the canvas.

	questions:  [{name, question_text, question_type, objectives: [code, ...]}]
	objectives: [{name}]
	unmapped:   question names the SERVER says have no objective. Passed in
	            rather than recomputed from `objectives` being empty, so the
	            canvas and the coverage header can never disagree about what
	            counts as a gap.
	"""
	unmapped = set(unmapped)
	qs = [q for q in questions if q.get("question_type") not in SKIP_TYPES]
	if unmapped_only:
		qs = [q for q in qs if q["name"] in unmapped]

	q_nodes = _rows(
		[{"name": q["name"],
		  "title": (q.get("question_text") or "")[:60],
		  "sub": q.get("question_type") or ""} for q in qs],
		COL_Q_X, Q_PREFIX, "question", True)
	# A question with no objective is the thing this view exists to fix - give it
	# the same red "gap" treatment the list uses rather than making it look done.
	for node, q in zip(q_nodes, qs):
		if q["name"] in unmapped:
			node["type"] = "gap"

	o_nodes = _rows([{"name": o["name"], "sub": "objective"} for o in objectives],
					COL_O_X, O_PREFIX, "objective", False)

	known = {n["id"] for n in o_nodes}
	edges = []
	for q in qs:
		for code in q.get("objectives") or []:
			# An objective a question is mapped to but which is not on the canvas
			# (deleted, or filtered out) must not produce a dangling edge - the
			# renderer would silently drop it, which reads as "not mapped".
			if O_PREFIX + code in known:
				edges.append([Q_PREFIX + q["name"], O_PREFIX + code])
	return q_nodes + o_nodes, edges


def connection_pair(a, b):
	"""(question, objective) for a drop, or None when the pair is meaningless.

	Accepts either drag direction: a canvas that only works left-to-right is a
	trap, because both ends look identical to the user. Question-to-question and
	objective-to-objective are not mappings and are refused rather than
	coerced into one.
	"""
	ends = {}
	for node_id in (a, b):
		if isinstance(node_id, str) and node_id.startswith(Q_PREFIX):
			ends.setdefault("q", node_id[len(Q_PREFIX):])
		elif isinstance(node_id, str) and node_id.startswith(O_PREFIX):
			ends.setdefault("o", node_id[len(O_PREFIX):])
	if len(ends) != 2 or not ends.get("q") or not ends.get("o"):
		return None
	return ends["q"], ends["o"]
