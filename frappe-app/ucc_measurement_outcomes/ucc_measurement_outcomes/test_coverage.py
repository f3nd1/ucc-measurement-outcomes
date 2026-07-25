"""Bench-free unit check for mapping coverage analysis.
Run: `python test_coverage.py`
"""

from coverage import (
	coverage_summary,
	find_duplicate_questions,
	is_mappable,
	normalize_text,
)

QUESTIONS = [
	{"name": "Q1", "question_text": "The teacher explained clearly"},
	{"name": "Q2", "question_text": "The  TEACHER   explained clearly"},   # dup of Q1
	{"name": "Q3", "question_text": "Facilities were adequate"},
	{"name": "Q4", "question_text": ""},                                     # blank, ignored for dup
]
MAPPINGS = [
	{"question": "Q1", "objective": "OBJ-A", "primary_clause": "GD4_1.1"},
	{"question": "Q3", "objective": "OBJ-A", "primary_clause": None},        # mapped, no clause
]
OBJECTIVES = ["OBJ-A", "OBJ-B", "OBJ-C"]


def test_normalize():
	assert normalize_text("  The  TEACHER   Explained ") == "the teacher explained"
	assert normalize_text(None) == ""


def test_duplicates():
	dups = find_duplicate_questions(QUESTIONS)
	assert dups == [["Q1", "Q2"]]                       # Q4 blank not grouped


def test_coverage_summary():
	s = coverage_summary(QUESTIONS, MAPPINGS, OBJECTIVES)
	assert s["questions_without_objective"] == ["Q2", "Q4"]     # only Q1, Q3 mapped
	assert s["questions_without_clause"] == ["Q2", "Q3", "Q4"]  # Q3 mapped but no clause
	assert s["unmapped_objectives"] == ["OBJ-B", "OBJ-C"]       # only OBJ-A used
	assert s["duplicate_questions"] == [["Q1", "Q2"]]
	assert s["counts"] == {"questions": 4, "questions_mapped": 2, "objectives": 3, "objectives_used": 1}


def test_section_headings_are_not_gaps():
	# A Section Heading is layout: it can never carry an objective, so counting
	# it as unmapped produced a phantom gap no user could ever clear.
	assert is_mappable({"name": "Q1", "question_type": "Rating"})
	assert not is_mappable({"name": "S1", "question_type": "Section Heading"})
	# A question dict with no type at all stays mappable (older callers).
	assert is_mappable({"name": "Q9"})

	questions = [
		{"name": "S1", "question_text": "Your experience", "question_type": "Section Heading"},
		{"name": "Q1", "question_text": "The teacher explained clearly", "question_type": "Rating"},
	]
	s = coverage_summary(questions, [], ["OBJ-A"])
	assert s["questions_without_objective"] == ["Q1"]   # not S1
	assert s["questions_without_clause"] == ["Q1"]
	assert s["counts"]["questions"] == 1                # headings excluded

	# Two identical section headings are not "duplicate questions" either.
	dupes = coverage_summary(
		[
			{"name": "S1", "question_text": "Part A", "question_type": "Section Heading"},
			{"name": "S2", "question_text": "Part A", "question_type": "Section Heading"},
		], [], [],
	)
	assert dupes["duplicate_questions"] == []


if __name__ == "__main__":
	test_normalize()
	test_duplicates()
	test_coverage_summary()
	test_section_headings_are_not_gaps()
	print("coverage: all checks passed")
