"""Bench-free unit check for Mapping Studio's canvas graph.
Run: `python test_map_graph.py`

The canvas is a WRITE surface, so the interesting tests are the ones about what
a dropped connection is allowed to mean.
"""

from map_graph import COL_O_X, COL_Q_X, build_map_graph, connection_pair

QUESTIONS = [
	{"name": "Q1", "question_text": "How clear was the teaching?",
	 "question_type": "Rating", "objectives": ["OBJ-01"]},
	{"name": "Q2", "question_text": "Section A", "question_type": "Section Heading",
	 "objectives": []},
	{"name": "Q3", "question_text": "Rate the library.", "question_type": "Rating",
	 "objectives": []},
	{"name": "Q4", "question_text": "Overall satisfaction?", "question_type": "NPS",
	 "objectives": ["OBJ-01", "OBJ-02"]},
]
OBJECTIVES = [{"name": "OBJ-01"}, {"name": "OBJ-02"}]
UNMAPPED = ["Q3"]


def ids(nodes):
	return [n["id"] for n in nodes]


def test_two_columns_with_prefixed_ids():
	nodes, _ = build_map_graph(QUESTIONS, OBJECTIVES, unmapped=UNMAPPED)
	assert ids(nodes) == ["q:Q1", "q:Q3", "q:Q4", "o:OBJ-01", "o:OBJ-02"]
	qx = {n["x"] for n in nodes if n["id"].startswith("q:")}
	ox = {n["x"] for n in nodes if n["id"].startswith("o:")}
	assert qx == {COL_Q_X} and ox == {COL_O_X}          # two columns, not a pile
	assert len({n["y"] for n in nodes if n["id"].startswith("q:")}) == 3


def test_section_headings_are_not_questions():
	# Same rule as coverage.py: counting layout rows as mappable produces a gap
	# nobody can ever clear.
	nodes, _ = build_map_graph(QUESTIONS, OBJECTIVES, unmapped=UNMAPPED)
	assert "q:Q2" not in ids(nodes)


def test_only_questions_get_a_port():
	nodes, _ = build_map_graph(QUESTIONS, OBJECTIVES, unmapped=UNMAPPED)
	assert all(n["port"] for n in nodes if n["id"].startswith("q:"))
	assert not any(n["port"] for n in nodes if n["id"].startswith("o:"))


def test_a_question_can_carry_several_objectives():
	# Decision V6: real UCC data has questions on two and three objectives, so
	# one edge per pair, not one edge per question.
	_, edges = build_map_graph(QUESTIONS, OBJECTIVES, unmapped=UNMAPPED)
	assert ["q:Q4", "o:OBJ-01"] in edges and ["q:Q4", "o:OBJ-02"] in edges
	assert edges.count(["q:Q1", "o:OBJ-01"]) == 1
	assert len(edges) == 3


def test_no_edge_to_an_objective_that_is_not_on_the_canvas():
	# A renderer silently drops an edge whose endpoint is missing, which reads as
	# "this question is not mapped" - the opposite of the truth.
	_, edges = build_map_graph(QUESTIONS, [{"name": "OBJ-01"}], unmapped=UNMAPPED)
	assert all(e[1] == "o:OBJ-01" for e in edges), edges


def test_unmapped_only_is_the_default_working_set():
	# NOTE: this exclusion is correct HERE and was the cause of a live bug
	# elsewhere - mapping_studio.js used to rebuild the graph after every
	# successful connect, so a question became mapped and was then filtered off
	# the canvas by this very rule, with nothing saying why. The fix belongs in
	# the caller (do not rebuild after a write), not in this function.
	nodes, edges = build_map_graph(QUESTIONS, OBJECTIVES, unmapped_only=True, unmapped=UNMAPPED)
	assert [n["id"] for n in nodes if n["id"].startswith("q:")] == ["q:Q3"]
	assert edges == []                                   # nothing mapped, by definition
	assert [n["id"] for n in nodes if n["id"].startswith("o:")] == ["o:OBJ-01", "o:OBJ-02"]


def test_gaps_are_flagged_from_the_servers_list_not_guessed():
	# The canvas must not decide "unmapped" for itself, or it and the coverage
	# header can disagree about the same question.
	nodes, _ = build_map_graph(QUESTIONS, OBJECTIVES, unmapped=UNMAPPED)
	by_id = {n["id"]: n for n in nodes}
	assert by_id["q:Q3"]["type"] == "gap"
	assert by_id["q:Q1"]["type"] == "question"
	# Told nothing is unmapped, nothing is flagged - even though Q3 has no
	# objectives of its own.
	nodes, _ = build_map_graph(QUESTIONS, OBJECTIVES, unmapped=[])
	assert {n["id"]: n for n in nodes}["q:Q3"]["type"] == "question"


def test_a_drop_resolves_in_either_direction():
	# Both ends look identical to the user; a canvas that only works
	# left-to-right is a trap.
	assert connection_pair("q:Q1", "o:OBJ-01") == ("Q1", "OBJ-01")
	assert connection_pair("o:OBJ-01", "q:Q1") == ("Q1", "OBJ-01")


def test_a_meaningless_drop_is_refused_not_coerced():
	for a, b in [("q:Q1", "q:Q3"), ("o:OBJ-01", "o:OBJ-02"), ("q:Q1", "q:Q1"),
				 ("q:Q1", "Q1"), ("Q1", "OBJ-01"), ("q:", "o:OBJ-01"),
				 ("q:Q1", ""), (None, "o:OBJ-01"), ("q:Q1", None)]:
		assert connection_pair(a, b) is None, (a, b)


def test_names_containing_the_separator_survive():
	# Docnames are not guaranteed colon-free; only the FIRST prefix is stripped.
	assert connection_pair("q:Q:1", "o:OBJ:01") == ("Q:1", "OBJ:01")


def test_empty_inputs_do_not_throw():
	assert build_map_graph([], [], unmapped=[]) == ([], [])
	assert build_map_graph(QUESTIONS, [], unmapped=UNMAPPED)[1] == []


if __name__ == "__main__":
	test_two_columns_with_prefixed_ids()
	test_section_headings_are_not_questions()
	test_only_questions_get_a_port()
	test_a_question_can_carry_several_objectives()
	test_no_edge_to_an_objective_that_is_not_on_the_canvas()
	test_unmapped_only_is_the_default_working_set()
	test_gaps_are_flagged_from_the_servers_list_not_guessed()
	test_a_drop_resolves_in_either_direction()
	test_a_meaningless_drop_is_refused_not_coerced()
	test_names_containing_the_separator_survive()
	test_empty_inputs_do_not_throw()
	print("map_graph: all checks passed")
