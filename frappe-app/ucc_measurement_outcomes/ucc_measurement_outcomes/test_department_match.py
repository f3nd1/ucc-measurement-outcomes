"""Bench-free unit check for free-text -> Department matching.
Run: `python test_department_match.py`

This backs a patch that REWRITES a column, so the interesting tests are the ones
that prove it refuses rather than the ones that prove it matches.
"""

from department_match import match_department, plan

# Shaped like ERPNext's real Department: docname carries the company abbr,
# department_name does not.
DEPTS = [
	{"name": "All Departments", "department_name": "All Departments"},
	{"name": "Academic Affairs - UCC", "department_name": "Academic Affairs"},
	{"name": "Student Services - UCC", "department_name": "Student Services"},
]


def test_department_name_is_the_normal_case():
	# What a user actually typed into a free-text box, vs. what the link stores.
	assert match_department("Academic Affairs", DEPTS) == ("Academic Affairs - UCC", "department_name")


def test_a_real_docname_passes_through_unchanged():
	# Idempotency: running the patch twice must not corrupt the first run's work.
	name, reason = match_department("Academic Affairs - UCC", DEPTS)
	assert (name, reason) == ("Academic Affairs - UCC", "exact docname")
	assert match_department(name, DEPTS)[0] == name


def test_matching_tolerates_case_and_spacing():
	# The column was never constrained, so it will not be clean.
	for messy in ("academic affairs", "  Academic   Affairs ", "ACADEMIC AFFAIRS"):
		assert match_department(messy, DEPTS)[0] == "Academic Affairs - UCC", messy
	assert match_department("  academic affairs - ucc ", DEPTS)[0] == "Academic Affairs - UCC"


def test_unknown_text_is_never_guessed_at():
	# No fuzzy matching, no prefix matching, no "closest". A wrong Department is
	# worse than a blank one - it silently reassigns a survey's ownership.
	for unknown in ("Finance", "Academic", "Affairs", "Academic Affairs Office", ""):
		name, reason = match_department(unknown, DEPTS)
		assert name is None, (unknown, name)
	assert match_department("Finance", DEPTS)[1] == "no Department matches"
	assert match_department("", DEPTS)[1] == "empty"


def test_two_companies_one_department_name_is_reported_not_picked():
	# Picking either is a coin flip on which company's reporting the survey lands
	# in. The candidates go in the reason so a human can choose.
	two = DEPTS + [{"name": "Academic Affairs - UCC2", "department_name": "Academic Affairs"}]
	name, reason = match_department("Academic Affairs", two)
	assert name is None
	assert reason == "ambiguous: Academic Affairs - UCC, Academic Affairs - UCC2"


def test_no_departments_at_all_matches_nothing():
	# ERPNext not installed, or an empty tree. Must not throw - the patch has to
	# report that state, not die during bench migrate.
	assert match_department("Academic Affairs", []) == (None, "no Department matches")
	assert plan(["Academic Affairs"], []) == {"Academic Affairs": (None, "no Department matches")}


def test_plan_deduplicates_and_drops_blanks():
	p = plan(["Academic Affairs", "Academic Affairs", "Finance", "", None], DEPTS)
	assert set(p) == {"Academic Affairs", "Finance"}
	assert p["Academic Affairs"][0] == "Academic Affairs - UCC"
	assert p["Finance"][0] is None


if __name__ == "__main__":
	test_department_name_is_the_normal_case()
	test_a_real_docname_passes_through_unchanged()
	test_matching_tolerates_case_and_spacing()
	test_unknown_text_is_never_guessed_at()
	test_two_companies_one_department_name_is_reported_not_picked()
	test_no_departments_at_all_matches_nothing()
	test_plan_deduplicates_and_drops_blanks()
	print("department_match: all checks passed")
