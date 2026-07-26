# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Extraction planning, without a bench:  python3 test_extraction.py"""

try:
	from ucc_measurement_outcomes.extraction import (
		build_plan, objective_code, DEFAULT_QUESTION_TYPE,
	)
except ImportError:
	from extraction import build_plan, objective_code, DEFAULT_QUESTION_TYPE


def test_multi_objective_question_yields_one_mapping_per_objective():
	# The case checkpoint A unblocked: real data has a question on three
	# objectives. It must stay ONE question with three mappings, not three
	# duplicate questions.
	plan = build_plan([
		{"question": "Teaching was clear", "objective": "Teaching Quality", "clause": "7.1.1"},
		{"question": "Teaching was clear", "objective": "Student Support", "clause": "7.2.1"},
		{"question": "Teaching was clear", "objective": "Assessment", "clause": None},
	])
	assert plan["counts"]["questions"] == 1, plan["counts"]
	assert plan["counts"]["mappings"] == 3, plan["counts"]
	assert plan["counts"]["questions_multi_objective"] == 1
	q = plan["questions"][0]
	assert [o["label"] for o in q["objectives"]] == [
		"Teaching Quality", "Student Support", "Assessment"]
	assert q["primary_clause"] == "7.1.1"
	assert q["related_clauses"] == "7.2.1"


def test_same_objective_twice_on_a_question_is_not_duplicated():
	plan = build_plan([
		{"question": "Q", "objective": "Teaching Quality", "clause": None},
		{"question": "Q", "objective": "teaching   quality", "clause": None},
	])
	# Different spelling, same code -> one mapping, not two.
	assert plan["counts"]["mappings"] == 1, plan["questions"]


def test_question_text_is_deduplicated_on_whitespace_and_case():
	plan = build_plan([
		{"question": "Was it useful?", "objective": "A", "clause": None},
		{"question": "  was it   USEFUL?  ", "objective": "B", "clause": None},
	])
	assert plan["counts"]["questions"] == 1
	assert plan["counts"]["mappings"] == 2
	# The first spelling wins, untouched - we do not invent a canonical form.
	assert plan["questions"][0]["question_text"] == "Was it useful?"


def test_existing_objectives_are_reused_not_recreated():
	rows = [{"question": "Q", "objective": "Teaching Quality", "clause": None}]
	fresh = build_plan(rows)
	assert fresh["counts"]["new_objectives"] == 1
	again = build_plan(rows, existing_objectives=["TEACHING-QUALITY"])
	assert again["counts"]["new_objectives"] == 0, again["new_objectives"]
	assert again["counts"]["mappings"] == 1, "the mapping is still planned"


def test_existing_questions_are_flagged_not_silently_skipped():
	plan = build_plan([{"question": "Q", "objective": "A", "clause": None}],
					  existing_questions=["q"])
	assert plan["counts"]["questions_already_present"] == 1
	assert plan["questions"][0]["exists"] is True


def test_rows_without_a_question_or_objective_are_reported():
	plan = build_plan([
		{"question": "", "objective": "A", "clause": None},
		{"question": "Orphan", "objective": None, "clause": None},
	])
	reasons = sorted(s["reason"] for s in plan["skipped"])
	assert reasons == ["no objective on any row", "no question text"], plan["skipped"]
	assert plan["counts"]["source_rows"] == 2


def test_extracted_questions_are_not_given_a_scored_type():
	# educ_sg's master carries no question type. Guessing "Rating" would attach
	# a normalisation rule to questions nobody reviewed.
	plan = build_plan([{"question": "Q", "objective": "A", "clause": None}])
	assert plan["questions"][0]["question_type"] == DEFAULT_QUESTION_TYPE
	assert DEFAULT_QUESTION_TYPE == "Short Text"


def test_objective_code_is_stable_and_bounded():
	assert objective_code("Teaching Quality") == "TEACHING-QUALITY"
	assert objective_code("Teaching  &  Learning!") == "TEACHING-LEARNING"
	assert objective_code("") == "UNNAMED"
	assert len(objective_code("x " * 200)) <= 60
	# Stability is what makes re-running the extraction idempotent.
	assert objective_code("Staff  Welfare") == objective_code("staff welfare")


def test_plan_writes_nothing_and_is_pure():
	rows = [{"question": "Q", "objective": "A", "clause": "7.1"}]
	before = [dict(r) for r in rows]
	build_plan(rows)
	assert rows == before, "build_plan must not mutate its input"


if __name__ == "__main__":
	for name, fn in sorted(globals().items()):
		if name.startswith("test_") and callable(fn):
			fn()
	print("extraction: all checks passed")
