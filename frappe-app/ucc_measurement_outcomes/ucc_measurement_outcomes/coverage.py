"""Pure mapping gap / coverage analysis.

Frappe-free so it can be unit-tested without a bench (test_coverage.py). The
Mapping Studio API feeds it questions/mappings/objectives and renders the result.
"""


def normalize_text(s):
	"""Collapse whitespace + lowercase, for duplicate-question comparison."""
	return " ".join((s or "").lower().split())


def find_duplicate_questions(questions):
	"""questions: [{name, question_text}] -> list of name-groups that share text."""
	groups = {}
	for q in questions:
		key = normalize_text(q.get("question_text"))
		if not key:
			continue
		groups.setdefault(key, []).append(q["name"])
	return [sorted(names) for names in groups.values() if len(names) > 1]


def coverage_summary(questions, mappings, objectives):
	"""Compute gap lists for one survey version.

	questions:  [{name, question_text}]
	mappings:   [{question, objective, primary_clause}]
	objectives: [objective_code, ...]  (the objectives in scope)
	"""
	all_q = {q["name"] for q in questions}
	mapped_q = {m["question"] for m in mappings if m.get("question")}
	obj_used = {m["objective"] for m in mappings if m.get("objective")}
	q_with_clause = {m["question"] for m in mappings if m.get("primary_clause")}

	return {
		"questions_without_objective": sorted(all_q - mapped_q),
		"questions_without_clause": sorted(all_q - q_with_clause),
		"unmapped_objectives": sorted(set(objectives) - obj_used),
		"duplicate_questions": find_duplicate_questions(questions),
		"counts": {
			"questions": len(all_q),
			"questions_mapped": len(all_q & mapped_q),
			"objectives": len(set(objectives)),
			"objectives_used": len(obj_used),
		},
	}
