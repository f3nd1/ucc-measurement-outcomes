"""Bench-free unit check for mapping coverage analysis.
Run: `python test_coverage.py`
"""

from coverage import coverage_summary, find_duplicate_questions, normalize_text

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


if __name__ == "__main__":
	test_normalize()
	test_duplicates()
	test_coverage_summary()
	print("coverage: all checks passed")
