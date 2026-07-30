"""Bench-free unit check for the UCC Objective -> Survey Objective re-link.
Run: `python test_objective_migration.py`

This decides the fate of every existing mapping row, so the tests that matter
are the ones proving it refuses rather than guesses.
"""

from objective_migration import DROP, RELINK, REPORT, plan_relink, summarise

# The real shape found on ucc-sms-v2: six demo rows, one that came from a trial
# extraction, and (here) one that resolves only through objective_name.
UCC = [
	{"name": "DEMO-OBJ-REL", "objective_name": "Reliability"},
	{"name": "DEMO-OBJ-ASR", "objective_name": "Assurance"},
	{"name": "GRADUATE-EMPLOYABILITY", "objective_name": "Graduate Employability"},
	{"name": "SEQI-01", "objective_name": "SEQI-01"},
]
REGISTER = ["Graduate Employability", "SEQI-01", "Student Support"]


def test_the_join_is_on_objective_name():
	# The slug was the docname and the untouched original went to objective_name,
	# so this is the only column that can match. Matching on `name` finds nothing.
	plan = plan_relink(UCC, REGISTER)
	assert plan["GRADUATE-EMPLOYABILITY"] == (RELINK, "Graduate Employability")


def test_a_docname_that_already_matched_still_resolves():
	# The slugifier is a no-op on an already-uppercase-alphanumeric docname, so
	# one row round-tripped and matches on either column.
	assert plan_relink(UCC, REGISTER)["SEQI-01"] == (RELINK, "SEQI-01")


def test_demo_rows_are_dropped_not_carried_over():
	# "Reliability" is not an institutional objective and never was; it is seed
	# data this app owns and demo_data.py recreates on demand.
	plan = plan_relink(UCC, REGISTER)
	assert plan["DEMO-OBJ-REL"][0] == DROP
	assert plan["DEMO-OBJ-ASR"][0] == DROP


def test_anything_else_is_reported_never_guessed():
	# No fuzzy matching, no closest-match, no invention. A wrong objective
	# silently reassigns a question's evidence.
	plan = plan_relink([{"name": "TEACHING-QUALITY", "objective_name": "Teaching Quality"}],
					   REGISTER)
	action, reason = plan["TEACHING-QUALITY"]
	assert action == REPORT
	assert "Teaching Quality" in reason


def test_a_demo_row_that_does_resolve_is_relinked_not_dropped():
	# Ordering matters: resolving beats the DEMO- rule, so a demo row pointing at
	# a real objective keeps its mapping instead of being deleted for its name.
	plan = plan_relink([{"name": "DEMO-OBJ-X", "objective_name": "Student Support"}], REGISTER)
	assert plan["DEMO-OBJ-X"] == (RELINK, "Student Support")


def test_blank_and_missing_labels_do_not_resolve_to_anything():
	for row in ({"name": "X", "objective_name": ""},
				{"name": "X", "objective_name": None},
				{"name": "X"}):
		assert plan_relink([row], REGISTER)["X"][0] == REPORT, row
	# ...and an empty register resolves nothing at all rather than throwing.
	assert plan_relink(UCC, [])[ "GRADUATE-EMPLOYABILITY"][0] == REPORT


def test_whitespace_is_tolerated_but_case_is_not():
	# Docnames are the key. Trimming is safe; case-folding is not - two
	# objectives differing only in case are two records.
	reg = ["Graduate Employability"]
	assert plan_relink([{"name": "A", "objective_name": "  Graduate Employability  "}],
					   reg)["A"][0] == RELINK
	assert plan_relink([{"name": "A", "objective_name": "graduate employability"}],
					   reg)["A"][0] == REPORT


def test_summarise_covers_every_row_exactly_once():
	plan = plan_relink(UCC, REGISTER)
	s = summarise(plan)
	assert sorted(s[RELINK] + s[DROP] + s[REPORT]) == sorted(o["name"] for o in UCC)
	assert s[RELINK] == ["GRADUATE-EMPLOYABILITY", "SEQI-01"]
	assert s[DROP] == ["DEMO-OBJ-ASR", "DEMO-OBJ-REL"]
	assert s[REPORT] == []


def test_empty_input_is_not_an_error():
	assert plan_relink([], REGISTER) == {}
	assert summarise({}) == {RELINK: [], DROP: [], REPORT: []}


if __name__ == "__main__":
	for name, fn in sorted(globals().items()):
		if name.startswith("test_") and callable(fn):
			fn()
	print("objective_migration: all checks passed")
