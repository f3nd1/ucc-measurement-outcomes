# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Plan a one-time extraction from educ_sg's question master into our own model.

Frappe-free, so the decisions are unit-tested without a bench
(test_extraction.py). api/extract.py resolves the real fieldnames, hands the raw
rows here, shows the returned plan to the user, and only then writes.

WHY A PLAN OBJECT AND NOT A DIRECT IMPORT: this runs against a shared site
holding real institutional work - 275 of 318 Survey Question Item rows carry an
objective a human decided on. The user sees exactly what would be created before
anything is written, and the same plan is re-derived at commit time so a stale
preview cannot write something the user never saw.

Nothing here reads Survey Response. Extraction copies QUESTION DESIGN
(question -> objective -> clause), never responses; historical responses stay
reference-only.
"""

# educ_sg's master carries no question type. Defaulting to a scored type would
# invent a normalisation rule for questions nobody has reviewed, so extracted
# questions land as free text and are retyped in Survey Studio deliberately.
DEFAULT_QUESTION_TYPE = "Short Text"


def normalize_text(s):
	return " ".join((s or "").lower().split())


def objective_code(name):
	"""educ_sg objective names are free text; UCC Objective autonames from
	objective_code. Keep it short, uppercase and stable so re-running the
	extraction resolves to the same record instead of making a second one."""
	cleaned = "".join(c if c.isalnum() else " " for c in (name or ""))
	words = cleaned.upper().split()
	return "-".join(words)[:60] or "UNNAMED"


def build_plan(items, existing_objectives=(), existing_questions=()):
	"""What an extraction WOULD create. Writes nothing.

	items: [{question, objective, clause}] - already field-resolved by the
	       caller, one row per (question, objective) pair as educ_sg stores it.
	existing_objectives: objective_codes already in UCC Objective.
	existing_questions:  question_text values already on the target version.

	Returns questions (each with every objective it carries), the objectives
	that would be created, and what is skipped and why. A question mapped to
	three objectives yields three mappings - the unique constraint that would
	have blocked that was removed in checkpoint A.
	"""
	have_obj = {normalize_text(o) for o in existing_objectives}
	have_obj_codes = set(existing_objectives)
	have_q = {normalize_text(q) for q in existing_questions}

	by_question = {}
	skipped = []
	for row in items:
		text = (row.get("question") or "").strip()
		if not text:
			skipped.append({"reason": "no question text", "row": row})
			continue
		key = normalize_text(text)
		entry = by_question.setdefault(key, {
			"question_text": text,
			"question_type": DEFAULT_QUESTION_TYPE,
			"objectives": [],
			"clauses": [],
			"exists": key in have_q,
		})
		obj = (row.get("objective") or "").strip()
		if obj:
			code = objective_code(obj)
			if not any(o["code"] == code for o in entry["objectives"]):
				entry["objectives"].append({
					"code": code,
					"label": obj,
					# An objective is new unless its CODE already exists. Matching
					# on the label too would silently reuse a differently-coded
					# record that happens to read the same.
					"is_new": code not in have_obj_codes and normalize_text(obj) not in have_obj,
				})
		clause = (row.get("clause") or "").strip()
		if clause and clause not in entry["clauses"]:
			entry["clauses"].append(clause)

	questions = list(by_question.values())
	for i, q in enumerate(questions):
		q["sequence"] = i
		# Clause maps to primary_clause + related_clauses, same split the
		# mapping inspector already uses.
		q["primary_clause"] = q["clauses"][0] if q["clauses"] else None
		q["related_clauses"] = ", ".join(q["clauses"][1:]) or None
		if not q["objectives"]:
			skipped.append({"reason": "no objective on any row", "question": q["question_text"]})

	new_objectives = {}
	for q in questions:
		for o in q["objectives"]:
			if o["is_new"]:
				new_objectives.setdefault(o["code"], o["label"])

	mappings = sum(len(q["objectives"]) for q in questions)
	return {
		"questions": questions,
		"new_objectives": [{"code": c, "label": l} for c, l in sorted(new_objectives.items())],
		"skipped": skipped,
		"counts": {
			"source_rows": len(items),
			"questions": len(questions),
			"questions_already_present": sum(1 for q in questions if q["exists"]),
			"questions_multi_objective": sum(1 for q in questions if len(q["objectives"]) > 1),
			"mappings": mappings,
			"new_objectives": len(new_objectives),
			"skipped": len(skipped),
		},
	}
