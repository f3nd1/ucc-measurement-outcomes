# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Extraction planning, without a bench:  python3 test_extraction.py"""

try:
	from ucc_measurement_outcomes.extraction import (
		build_plan, objective_ref, DEFAULT_QUESTION_TYPE,
	)
except ImportError:
	from extraction import build_plan, objective_ref, DEFAULT_QUESTION_TYPE


def test_multi_objective_question_yields_one_mapping_per_objective():
	# The case checkpoint A unblocked: real data has a question on three
	# objectives. It must stay ONE question with three mappings, not three
	# duplicate questions.
	plan = build_plan([
		{"question": "Teaching was clear", "objective": "Teaching Quality", "clause": "7.1.1"},
		{"question": "Teaching was clear", "objective": "Student Support", "clause": "7.2.1"},
		{"question": "Teaching was clear", "objective": "Assessment", "clause": None},
	], known_objectives=["Teaching Quality", "Student Support", "Assessment"])
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
		{"question": "Q", "objective": " Teaching Quality ", "clause": None},
	], known_objectives=["Teaching Quality"])
	# Same docname, whitespace aside -> one mapping, not two.
	assert plan["counts"]["mappings"] == 1, plan["questions"]


def test_a_different_objective_is_never_folded_into_another():
	# The old slugifier normalised case and punctuation, so "Teaching Quality"
	# and "teaching   quality" collapsed. These are DOCNAMES now: two docnames
	# that differ are two different objectives, and merging them would reassign
	# a question's evidence to an objective nobody chose.
	plan = build_plan([
		{"question": "Q", "objective": "Teaching Quality", "clause": None},
		{"question": "Q", "objective": "teaching quality", "clause": None},
	], known_objectives=["Teaching Quality", "teaching quality"])
	assert plan["counts"]["mappings"] == 2, plan["questions"]


def test_question_text_is_deduplicated_on_whitespace_and_case():
	plan = build_plan([
		{"question": "Was it useful?", "objective": "A", "clause": None},
		{"question": "  was it   USEFUL?  ", "objective": "B", "clause": None},
	], known_objectives=["A", "B"])
	assert plan["counts"]["questions"] == 1
	assert plan["counts"]["mappings"] == 2
	# The first spelling wins, untouched - we do not invent a canonical form.
	assert plan["questions"][0]["question_text"] == "Was it useful?"


def test_extraction_never_invents_an_objective():
	# Survey Objective is the institution's register. A source row pointing at
	# something not in it is REPORTED and its mapping dropped - the alternative
	# is writing a record nobody planned into the register, which is the same
	# refusal as the Survey Management stub (decision 2026-07-26).
	rows = [{"question": "Q", "objective": "Teaching Quality", "clause": None}]
	missing = build_plan(rows)                       # register empty
	assert missing["unknown_objectives"] == ["Teaching Quality"]
	assert missing["counts"]["unknown_objectives"] == 1
	assert missing["counts"]["mappings"] == 0, "nothing may be mapped to it"
	assert [s["reason"] for s in missing["skipped"]] == [
		"no objective the register recognises"]

	present = build_plan(rows, known_objectives=["Teaching Quality"])
	assert present["unknown_objectives"] == []
	assert present["counts"]["mappings"] == 1
	# The docname is written straight through - no code, no slug, no lookup.
	assert present["questions"][0]["objectives"][0]["code"] == "Teaching Quality"


def test_one_unknown_objective_does_not_lose_the_known_ones():
	plan = build_plan([
		{"question": "Q", "objective": "Real Objective", "clause": None},
		{"question": "Q", "objective": "Typo Objective", "clause": None},
	], known_objectives=["Real Objective"])
	assert plan["counts"]["mappings"] == 1
	assert plan["unknown_objectives"] == ["Typo Objective"]
	assert plan["skipped"] == [], "the question is still mappable"


def test_existing_questions_are_flagged_not_silently_skipped():
	plan = build_plan([{"question": "Q", "objective": "A", "clause": None}],
					  known_objectives=["A"], existing_questions=["q"])
	assert plan["counts"]["questions_already_present"] == 1
	assert plan["questions"][0]["exists"] is True


def test_rows_without_a_question_or_objective_are_reported():
	plan = build_plan([
		{"question": "", "objective": "A", "clause": None},
		{"question": "Orphan", "objective": None, "clause": None},
	], known_objectives=["A"])
	reasons = sorted(s["reason"] for s in plan["skipped"])
	assert reasons == ["no objective the register recognises", "no question text"], plan["skipped"]
	assert plan["counts"]["source_rows"] == 2


def test_extracted_questions_are_not_given_a_scored_type():
	# educ_sg's master carries no question type. Guessing "Rating" would attach
	# a normalisation rule to questions nobody reviewed.
	plan = build_plan([{"question": "Q", "objective": "A", "clause": None}],
					  known_objectives=["A"])
	assert plan["questions"][0]["question_type"] == DEFAULT_QUESTION_TYPE
	assert DEFAULT_QUESTION_TYPE == "Short Text"


def test_objective_ref_is_the_docname_untouched():
	# The whole point. Survey Question Item.objective is a Link, so its value is
	# already the key; anything other than passing it through breaks the join.
	# The previous slugifier truncated at 60 chars, which would have merged two
	# distinct objectives sharing a long prefix into one record, silently.
	long_a = "Students demonstrate professional communication in written and " + "oral form"
	long_b = "Students demonstrate professional communication in written and " + "visual form"
	assert objective_ref(long_a) == long_a
	assert objective_ref(long_a) != objective_ref(long_b)
	assert len(objective_ref(long_a)) > 60
	assert objective_ref("  Graduate Employability  ") == "Graduate Employability"
	assert objective_ref(None) == "" and objective_ref("") == ""


def test_plan_writes_nothing_and_is_pure():
	rows = [{"question": "Q", "objective": "A", "clause": "7.1"}]
	before = [dict(r) for r in rows]
	build_plan(rows, known_objectives=["A"])
	assert rows == before, "build_plan must not mutate its input"


if __name__ == "__main__":
	for name, fn in sorted(globals().items()):
		if name.startswith("test_") and callable(fn):
			fn()
	print("extraction: all checks passed")
