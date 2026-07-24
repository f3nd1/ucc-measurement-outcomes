"""Bench-free unit check for the bulk-paste parser.
Run: `python test_bulk_parse.py`
"""

from bulk_parse import parse_bulk_questions, resolve_type


def test_resolve_type():
	assert resolve_type("Rating") == "Rating"
	assert resolve_type("rating") == "Rating"
	assert resolve_type("yesno") == "Yes / No"
	assert resolve_type("Yes/No") == "Yes / No"
	assert resolve_type("paragraph") == "Paragraph"
	assert resolve_type("Dropdown") == "Dropdown"
	assert resolve_type("wat") == "Short Text"      # unknown -> default
	assert resolve_type("") == "Short Text"


def test_parse():
	text = (
		"The orientation was clear | Rating | 1,2,3,4,5\n"
		"I received LMS access | Yes/No\n"
		"  \n"                                          # blank line ignored
		"Which programme? | Dropdown | A,B,C\n"
		"What should we improve? | Paragraph"
	)
	rows = parse_bulk_questions(text)
	assert len(rows) == 4
	assert rows[0] == {"question_text": "The orientation was clear", "question_type": "Rating", "options": "1,2,3,4,5"}
	assert rows[1]["question_type"] == "Yes / No" and rows[1]["options"] == ""
	assert rows[2]["question_type"] == "Dropdown"
	assert rows[3]["question_type"] == "Paragraph"


if __name__ == "__main__":
	test_resolve_type()
	test_parse()
	print("bulk parse: all checks passed")
