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


def objective_ref(value):
	"""The Survey Objective this row points at, or "" .

	`Survey Question Item.objective` is a **Link to Survey Objective** - verified
	against the live site, not inferred. So the value IS a docname and the only
	correct transformation is none at all.

	This used to slugify it (`"Graduate Employability"` -> `GRADUATE-EMPLOYABILITY`)
	on the belief that educ_sg objective names were free text. They are not, and
	that belief cost real damage: the slug became the primary key of a parallel
	`UCC Objective` table, so this app's objectives could never be joined back to
	the 97 real ones, and two objectives sharing a 60-character prefix would have
	silently merged into one record. Both problems disappear by keeping the
	docname.
	"""
	return (value or "").strip()


def build_plan(items, known_objectives=(), existing_questions=()):
	"""What an extraction WOULD create. Writes nothing.

	items: [{question, objective, clause}] - already field-resolved by the
	       caller, one row per (question, objective) pair as educ_sg stores it.
	known_objectives: every Survey Objective docname on the site. Used ONLY to
	       flag rows pointing at something that is not there - extraction never
	       creates an objective. Survey Objective is the institution's register,
	       and writing into it is the same refusal as the Survey Management stub
	       (decision 2026-07-26).
	existing_questions:  question_text values already on the target version.

	Returns questions (each with every objective it carries), any objective the
	register does not recognise, and what is skipped and why. A question mapped
	to three objectives yields three mappings - the unique constraint that would
	have blocked that was removed in checkpoint A.
	"""
	known = set(known_objectives)
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
		obj = objective_ref(row.get("objective"))
		if obj and not any(o["code"] == obj for o in entry["objectives"]):
			entry["objectives"].append({
				# code == label == the Survey Objective docname. Three names for
				# one value, kept so the UI and api/extract.py did not all have to
				# change at once; `code` is what gets written to the mapping.
				"code": obj,
				"label": obj,
				# Not "is this new" any more - nothing is created. Either the
				# register has it or the source row points at nothing.
				"known": obj in known,
			})
		clause = (row.get("clause") or "").strip()
		if clause and clause not in entry["clauses"]:
			entry["clauses"].append(clause)

	questions = list(by_question.values())

	# An objective the register does not have cannot be mapped to: the mapping's
	# Link would refuse it at insert. Report it rather than dropping it silently,
	# and never invent the missing record. Dropped BEFORE the skip check below,
	# so a question whose only objective is unknown is correctly reported as
	# having none rather than looking mappable.
	unknown = sorted({o["code"] for q in questions for o in q["objectives"] if not o["known"]})
	for q in questions:
		q["objectives"] = [o for o in q["objectives"] if o["known"]]

	for i, q in enumerate(questions):
		q["sequence"] = i
		# Clause maps to primary_clause + related_clauses, same split the
		# mapping inspector already uses.
		q["primary_clause"] = q["clauses"][0] if q["clauses"] else None
		q["related_clauses"] = ", ".join(q["clauses"][1:]) or None
		if not q["objectives"]:
			skipped.append({"reason": "no objective the register recognises",
							"question": q["question_text"]})

	mappings = sum(len(q["objectives"]) for q in questions)
	return {
		"questions": questions,
		"unknown_objectives": unknown,
		"skipped": skipped,
		"counts": {
			"source_rows": len(items),
			"questions": len(questions),
			"questions_already_present": sum(1 for q in questions if q["exists"]),
			"questions_multi_objective": sum(1 for q in questions if len(q["objectives"]) > 1),
			"mappings": mappings,
			"unknown_objectives": len(unknown),
			"skipped": len(skipped),
		},
	}
