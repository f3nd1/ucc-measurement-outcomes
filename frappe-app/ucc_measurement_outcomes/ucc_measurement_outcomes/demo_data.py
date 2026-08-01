# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Two contrasting demo datasets for walking the studios.

    bench --site <site> execute ucc_measurement_outcomes.demo_data.remove --kwargs "{'dry_run':1}"
    bench --site <site> execute ucc_measurement_outcomes.demo_data.seed
    bench --site <site> execute ucc_measurement_outcomes.demo_data.remove

Set A (DEMO-SEQI) runs the whole chain at realistic scale: a 12-question,
3-page published survey with 60 responses at 95% completion, a second smaller
survey so one metric genuinely spans two surveys, six borrowed Survey
Objectives (three questions carrying two each), six metrics on the real SEQI
dimension weights, a published index and one calculated result with full
Criterion 7.1.1 lineage. Every stage of the pipeline stepper reads done.

Set B (DEMO-SAPI) is parked mid-pipeline: half its questions unmapped and its
index version still Draft, so the stepper shows a current stage and real
"what's next" notes instead.

DETERMINISM. Set A's answers are not sampled - each question carries an exact
(value, count) distribution, and the seeded RNG only decides WHICH respondent
gave which answer. So the calculated SEQI score is a fixed number, asserted
against the real engines in test_demo_data.py rather than eyeballed after a run.

SAFETY. This writes to a shared site that holds real quality data, so two
guards sit in front of every write and every delete:

  * assert_owned  - refuses any DocType this app does not own. Quality Action,
    Quality Meeting and Quality Performance Outcomes are not in OWNED, so this
    module cannot touch them even by mistake.
  * assert_demo   - refuses to delete anything that is not either DEMO-named or
    reached by link from a DEMO-named root.

Both are pure functions with no frappe dependency, proven by test_demo_data.py
without a bench. Deletion runs with link checks ON: if a real record has come
to depend on a demo record, the delete fails loudly rather than orphaning it.
"""

import random

import frappe

DEMO_PREFIX = "DEMO-"
DEMO_SEED = 20260801        # pin the shuffle so a reseed reproduces the same demo
LIKERT = "Likert 1-5 to 0-100"
YESNO = "Yes/No to 100/0"

# Every DocType in this app's five modules. The allowlist IS the "must not write
# outside our own DocTypes" constraint - there is no path around it.
OWNED = frozenset({
	"UCC Survey", "UCC Survey Version", "UCC Survey Question",
	"UCC Survey Question Choice", "UCC Survey Campaign", "UCC Survey Submission",
	"UCC Survey Answer", "UCC Standard", "UCC Question Mapping",
	"UCC Metric Definition", "UCC Metric Source", "UCC Metric Result",
	"UCC Index Definition", "UCC Index Version", "UCC Index Node",
	"UCC Index Result", "UCC Score Breakdown",
})


def assert_owned(doctype):
	"""Refuse to touch a DocType this app does not own."""
	if doctype not in OWNED:
		raise PermissionError(
			f"demo_data refuses to touch {doctype!r}: not a UCC Measurement Outcomes DocType"
		)
	return doctype


def assert_demo(doctype, name, via=None):
	"""Refuse to delete a record that is not demo data.

	A record qualifies either because its own name carries the prefix, or
	because `via` names the DEMO- record it was reached from - the only way the
	six hash-named DocTypes can ever be identified, since they carry no field a
	prefix could live in. `via` must itself be DEMO-marked, so a caller cannot
	wave a record through with a bare True."""
	assert_owned(doctype)
	if str(name).startswith(DEMO_PREFIX):
		return name
	if via and str(via).startswith(DEMO_PREFIX):
		return name
	raise PermissionError(
		f"demo_data refuses to delete {doctype} {name!r}: not {DEMO_PREFIX}-named "
		f"and not traceable to a demo root (via={via!r})"
	)


def _new(doctype, **kwargs):
	assert_owned(doctype)
	return frappe.get_doc({"doctype": doctype, **kwargs}).insert(ignore_permissions=True)


# --- set A: the full end-to-end demo ----------------------------------------
# Answers are DISTRIBUTIONS, not samples: [(answer_value, how many respondents
# gave it)]. Totals below a question's reachable respondent count are the people
# who skipped it, which is how the open-comment questions get realistic partial
# response without any randomness in the score.


def _rating(*counts):
	"""Counts for the five Rating options, 1 through 5."""
	return [(str(i + 1), c) for i, c in enumerate(counts)]


# Chosen to skew positive the way real course-experience data does, with
# Tangibles deliberately the weak dimension so the demo has something worth
# raising a Quality Action about.
SET_A = {
	"survey": "DEMO- Student Experience Survey 2026",
	"description": "Demo data. End-of-semester experience survey feeding the SEQI.",
	"campaign": "SEQI 2026 Semester 1",
	"index": ("DEMO-SEQI", "Student Experience Quality Index"),
	"responses": 60,
	"abandoned": 3,   # ~95% completion; a partial respondent stops at the first page break
	"questions": [
		# key, question type, text, answer distribution (None = structural)
		("intro", "Section Heading", "Section 1 — Your programme experience", None),
		("rel", "Rating", "The programme was delivered as promised in the course information",
		 _rating(0, 2, 9, 28, 21)),
		("asr", "Rating", "Teaching staff were knowledgeable and professional",
		 _rating(0, 1, 7, 26, 26)),
		("tan", "Rating", "Classrooms, equipment and learning materials were adequate",
		 _rating(2, 6, 17, 24, 11)),
		("break1", "Page Break", "Section 2 — Support and communication", None),
		("emp", "Rating", "Staff understood and responded to my individual needs",
		 _rating(1, 2, 10, 27, 17)),
		("rsp", "Yes / No", "Were your enquiries answered within the stated response time?",
		 [("Yes", 48), ("No", 9)]),
		("out", "Yes / No", "Did the programme meet the learning outcomes it advertised?",
		 [("Yes", 44), ("No", 13)]),
		# NPS collects 0-10 and is deliberately NOT wired to a metric: no
		# normalisation rule covers a 0-10 scale, and the Likert rule would score
		# an 8 as 175 clamped to 100. See BENCH_VERIFY.md.
		("nps", "NPS", "How likely are you to recommend United Ceres College to a friend?",
		 [("10", 9), ("9", 13), ("8", 14), ("7", 8), ("6", 5),
		  ("5", 4), ("4", 2), ("3", 1), ("2", 1)]),
		("break2", "Page Break", "Section 3 — Your comments", None),
		("best", "Paragraph", "What worked best for you this semester?", [
			("The lecturers were approachable and explained things clearly.", 7),
			("Small class sizes meant I could actually ask questions.", 6),
			("Assignment feedback came back quickly and was specific.", 5),
			("The timetable was predictable, which helped me plan work shifts.", 5),
			("Practical sessions were the most useful part of the module.", 4),
			("Admin staff sorted out my enrolment issue the same day.", 4),
		]),
		("improve", "Paragraph", "What should the College improve first?", [
			("The air-conditioning in the third floor rooms is unreliable.", 6),
			("More computers in the study room, especially near submission dates.", 5),
			("Some course materials were uploaded late.", 5),
			("Wi-fi drops out in the back classrooms.", 4),
			("Clearer information about resit dates and fees.", 4),
			("More one-to-one time with tutors before assessments.", 3),
		]),
	],
}

# A second, smaller survey. It exists so Reliability draws on TWO surveys and the
# cross-survey aggregation is demonstrated with real rows rather than asserted -
# its other two questions stay unmapped, which is also what makes the source
# browser's "eligible but not yet connected" state visible.
SET_A2 = {
	"survey": "DEMO- Learning Support Pulse 2026",
	"description": "Demo data. Mid-semester pulse; shares the SEQI Reliability metric.",
	"campaign": "Support pulse 2026",
	"responses": 24,
	"abandoned": 0,
	"questions": [
		("d_rel", "Rating", "Classes and timetabled sessions ran as published",
		 _rating(0, 1, 4, 12, 7)),
		("d_space", "Rating", "Library and study spaces were available when I needed them",
		 _rating(0, 2, 7, 10, 5)),
		("d_fee", "Rating", "Fee and payment information was easy to understand",
		 _rating(0, 1, 5, 13, 5)),
	],
}

SURVEYS_A = {"A": SET_A, "A2": SET_A2}

# The real SEQI dimensions and weights (sum 100). No target is set on the index:
# the institution's benchmark score was not supplied, and inventing one would put
# a made-up threshold on an EduTrust evidence record.
SEQI_METRICS = [
	# metric code, name, weight, normalisation, [(survey key, question key)]
	("DEMO-SEQI-REL", "Reliability", 20, LIKERT, [("A", "rel"), ("A2", "d_rel")]),
	("DEMO-SEQI-ASR", "Assurance", 15, LIKERT, [("A", "asr")]),
	("DEMO-SEQI-TAN", "Tangibles", 20, LIKERT, [("A", "tan")]),
	("DEMO-SEQI-EMP", "Empathy", 15, LIKERT, [("A", "emp")]),
	("DEMO-SEQI-RSP", "Responsiveness", 15, YESNO, [("A", "rsp")]),
	("DEMO-SEQI-OUT", "Outcome Alignment", 15, YESNO, [("A", "out")]),
]

# Question -> slots in the borrowed Survey Objective pool. rel, tan and rsp carry
# two objectives each, because real UCC questions do and anything reading these
# has to cope with a list rather than one row.
OBJECTIVE_SLOTS = {
	"rel": (0, 1), "asr": (1,), "tan": (2, 3), "emp": (3,),
	"rsp": (4, 5), "out": (5,), "d_rel": (0,),
}

SET_B = {
	"survey": "DEMO- Academic Performance Pulse",
	"index": ("DEMO-SAPI", "Student Academic Performance Index", 75),
	# Only the first two are mapped and metered. The last two are deliberately
	# left bare so stage 2 reports "2 questions still need objectives".
	"questions": [
		("I was able to keep up with the assessment schedule", "PASS", "Passing Rate",
		 "DEMO-SAPI-PASSING", ["4", "3", "4"]),
		("I expect to complete my programme on time", "GRAD", "Graduation Rate",
		 "DEMO-SAPI-GRADUATION", ["4", "4", "5"]),
		("Course workload was manageable", None, None, None, ["3", "3", "4"]),
		("I received useful feedback on my work", None, None, None, ["4", "4", "4"]),
	],
}


def _build(spec, publish_index):
	"""Survey -> published version -> questions -> campaign -> responses ->
	objective/metric mapping -> index version. Returns nothing; everything is
	found again by name prefix or by link."""
	index_code, index_name, target = spec["index"]
	survey = _new("UCC Survey", title=spec["survey"], status="Active")
	version = _new("UCC Survey Version", survey=survey.name, version_number="01", status="Draft")

	questions = []
	for seq, (text, obj_code, obj_name, metric_code, _answers) in enumerate(spec["questions"]):
		questions.append(_new(
			"UCC Survey Question", survey_version=version.name, question_type="Rating",
			question_text=text, sequence=seq,
			choices=[{"choice_label": str(i), "choice_value": str(i)} for i in range(1, 6)],
		))

	version.status = "Published"
	version.save(ignore_permissions=True)

	# One submission per answer position, so each question's list is one
	# respondent's answer across the survey.
	campaign = _new("UCC Survey Campaign", campaign_name=f"{index_code} pilot",
					survey_version=version.name, status="Open")
	n_responses = len(spec["questions"][0][4])
	for i in range(n_responses):
		submission = _new("UCC Survey Submission", campaign=campaign.name,
						  survey_version=version.name, status="Completed")
		for question, (_t, _oc, _on, _mc, answers) in zip(questions, spec["questions"]):
			_new("UCC Survey Answer", submission=submission.name,
				 question=question.name, answer_value=answers[i])

	standard = _demo_standard()
	# Objectives are BORROWED, never created. UCC Objective used to exist purely
	# so demo data could invent six of its own; now that mappings point at the
	# institution's Survey Objective register, seeding one would put a fake
	# objective into the real record - the same refusal as the Survey Management
	# stub (decision 2026-07-26). So the demo mappings point at real objectives,
	# picked deterministically, and simply do not exist if the register is empty.
	pool = _objective_pool()
	for i, (question, (_text, obj_code, obj_name, metric_code, _a)) in enumerate(
			zip(questions, spec["questions"])):
		if not obj_code:
			continue   # left unmapped on purpose - this is what set B demonstrates
		if pool:
			_new("UCC Question Mapping", question=question.name, survey_version=version.name,
				 objective=pool[i % len(pool)], standard=standard.name, primary_clause="7.1.1")
		_new("UCC Metric Definition", metric_code=metric_code, metric_name=obj_name,
			 default_normalisation="Likert 1-5 to 0-100",
			 sources=[{"source_type": "Survey Question", "source_question": question.name,
					   "normalisation": "Likert 1-5 to 0-100"}])

	_get_or_create("UCC Index Definition", index_code, index_code=index_code,
				   index_name=index_name, target=target)
	metrics = [q[3] for q in spec["questions"] if q[3]]
	root = index_code.lower().replace("-", "_")
	nodes = [{"node_key": root, "node_type": "Index", "label": index_name}]
	for i, metric_code in enumerate(metrics):
		nodes.append({
			"node_key": f"{root}_{i}", "node_type": "Metric", "parent_key": root,
			"label": frappe.db.get_value("UCC Metric Definition", metric_code, "metric_name"),
			"weight": 100 / len(metrics), "source_metric": metric_code,
		})
	iv = _new("UCC Index Version", index=index_code, version_number="01",
			  status="Draft", nodes=nodes)
	if publish_index:
		iv.status = "Published"
		iv.save(ignore_permissions=True)
	return iv, metrics


def reachable(spec, question_key, respondent):
	"""Did respondent number `respondent` get as far as this question?

	Pure so test_demo_data can check every distribution fits its audience without
	a bench - a count larger than the number of people who saw the question would
	silently make up respondents.
	"""
	if respondent not in _abandoned(spec):
		return True
	stop = next((i for i, q in enumerate(spec["questions"]) if q[1] == "Page Break"),
				len(spec["questions"]))
	return question_key in {q[0] for q in spec["questions"][:stop]}


def _abandoned(spec):
	"""Which respondent numbers gave up. Seeded, so it is the same set every run."""
	return set(random.Random(DEMO_SEED).sample(range(spec["responses"]), spec.get("abandoned", 0)))


def audience(spec, question_key):
	"""Respondent numbers who saw this question."""
	return [i for i in range(spec["responses"]) if reachable(spec, question_key, i)]


CHOICES = {
	"Rating": [{"choice_label": str(i), "choice_value": str(i)} for i in range(1, 6)],
	# Labels only, exactly as the Survey Builder creates them - the Yes/No
	# normalisation rule reads the word.
	"Yes / No": [{"choice_label": "Yes"}, {"choice_label": "No"}],
}


def _survey(spec):
	"""Survey -> Draft version -> questions -> Published. Returns (version, {key: doc})."""
	survey = _new("UCC Survey", title=spec["survey"], status="Active",
				  description=spec.get("description"), owner_department=_department())
	version = _new("UCC Survey Version", survey=survey.name, version_number="01", status="Draft")
	questions = {}
	for seq, (key, qtype, text, _dist) in enumerate(spec["questions"]):
		questions[key] = _new(
			"UCC Survey Question", survey_version=version.name, question_type=qtype,
			question_text=text, sequence=seq, choices=CHOICES.get(qtype, []),
		)
	version.status = "Published"
	version.save(ignore_permissions=True)
	return version, questions


def _responses(spec, version, questions):
	"""One submission per respondent, one Answer row per question they answered."""
	campaign = _new("UCC Survey Campaign", campaign_name=spec["campaign"],
					survey_version=version.name, status="Open",
					target_responses=spec["responses"])
	gave_up = _abandoned(spec)
	submissions = [
		_new("UCC Survey Submission", campaign=campaign.name, survey_version=version.name,
			 status="Abandoned" if i in gave_up else "Completed",
			 respondent_key=f"{DEMO_PREFIX}R{i:03d}", source="demo_data")
		for i in range(spec["responses"])
	]

	rng = random.Random(DEMO_SEED)
	for key, _qtype, _text, dist in spec["questions"]:
		if not dist:
			continue
		saw = audience(spec, key)
		values = [v for v, count in dist for _ in range(count)]
		if len(values) > len(saw):
			raise ValueError(f"{key}: {len(values)} answers but only {len(saw)} respondents saw it")
		values += [None] * (len(saw) - len(values))   # the rest skipped the question
		rng.shuffle(values)
		for respondent, value in zip(saw, values):
			if value is None:
				continue
			_new("UCC Survey Answer", submission=submissions[respondent].name,
				 question=questions[key].name, survey_version=version.name,
				 answer_value=value)
	return campaign


def _department():
	"""An existing Department for the source browser to group by, or None.

	Department is not ours to create (it is not in OWNED), so the demo borrows one
	the same way it borrows objectives, and simply groups under "Unassigned" if
	the site has none.
	"""
	rows = frappe.get_all("Department", pluck="name", order_by="name asc", limit=1)
	return rows[0] if rows else None


def _build_full():
	"""Set A: two surveys -> responses -> objectives + metrics -> published SEQI."""
	built = {}
	for skey, spec in SURVEYS_A.items():
		version, questions = _survey(spec)
		_responses(spec, version, questions)
		built[skey] = (version, questions)

	standard = _demo_standard()
	pool = _objective_pool()
	if pool:
		for skey, spec in SURVEYS_A.items():
			version, questions = built[skey]
			for key, _qtype, _text, _dist in spec["questions"]:
				slots = OBJECTIVE_SLOTS.get(key)
				if not slots:
					continue
				# Dedupe: a short pool would otherwise put the same objective on a
				# question twice, which is a duplicate row, not two objectives.
				for objective in sorted({pool[s % len(pool)] for s in slots}):
					_new("UCC Question Mapping", question=questions[key].name,
						 survey_version=version.name, objective=objective,
						 standard=standard.name, primary_clause="7.1.1")

	for code, name, _weight, norm, sources in SEQI_METRICS:
		_new("UCC Metric Definition", metric_code=code, metric_name=name,
			 default_normalisation=norm,
			 description=f"Demo data. SEQI {name} dimension.",
			 sources=[{"source_type": "Survey Question",
					   "source_question": built[skey][1][qkey].name,
					   "normalisation": norm} for skey, qkey in sources])

	index_code, index_name = SET_A["index"]
	_get_or_create("UCC Index Definition", index_code, index_code=index_code,
				   index_name=index_name,
				   # No target: the governing document states SEQI's SCALE
				   # ("Total Score: 5"), not a benchmark. Same statement of fact
				   # the templates carry, rather than an invented threshold.
				   description="Demo data. Calculated 0-100; the institutional "
							   "scale is 0-5, so the 5-point equivalent is "
							   "1 + score/25. Weights are the real SEQI "
							   "dimension weights (clause GD4 7.2.2).")
	root = index_code.lower().replace("-", "_")
	nodes = [{"node_key": root, "node_type": "Index", "label": index_name}]
	for i, (code, name, weight, _n, _s) in enumerate(SEQI_METRICS):
		nodes.append({"node_key": f"{root}_{i}", "node_type": "Metric", "parent_key": root,
					  "label": name, "weight": weight, "source_metric": code})
	version = _new("UCC Index Version", index=index_code, version_number="01",
				   status="Draft", nodes=nodes)
	version.status = "Published"
	version.save(ignore_permissions=True)
	return version, [m[0] for m in SEQI_METRICS]


def _objective_pool(limit=6):
	"""Real Survey Objective docnames for the demo mappings to point at.

	Deterministic (sorted, first `limit`) so a reseed produces the same demo
	every time. Empty when the register is empty, and the caller then creates no
	mappings at all rather than inventing an objective - the demo is allowed to
	be less complete, never to lie about the institutional record.
	"""
	pool = frappe.get_all("Survey Objective", pluck="name", order_by="name asc", limit=limit)
	if not pool:
		print("demo_data: no Survey Objective records - demo mappings skipped. "
			  "Metrics and index still seed; Mapping Studio will show every "
			  "demo question as unmapped, which is a true statement about this site.")
	return pool


def _demo_standard():
	return _get_or_create("UCC Standard", f"{DEMO_PREFIX}STD-C7",
						  standard_code=f"{DEMO_PREFIX}STD-C7",
						  standard_name="Criterion 7 - Quality Assurance (demo)")


def _get_or_create(doctype, name, **kwargs):
	assert_owned(doctype)
	if frappe.db.exists(doctype, name):
		return frappe.get_doc(doctype, name)
	return _new(doctype, **kwargs)


def seed():
	"""Idempotent: if set A's index already exists, this has run before."""
	from ucc_measurement_outcomes.index_calc import calculate_index
	from ucc_measurement_outcomes.metric_calc import calculate_metric_result

	if frappe.db.exists("UCC Index Definition", SET_A["index"][0]):
		print(f"Already seeded ({SET_A['index'][0]} exists). Run remove first to rebuild.")
		return

	iv_a, metrics_a = _build_full()
	for metric_code in metrics_a:
		calculate_metric_result(metric_code)
	calculate_index(iv_a.name)

	# Set B stops before publishing its index, so no metric results either - the
	# point is a pipeline that is visibly partway through, not one that failed.
	_build(SET_B, publish_index=False)

	frappe.db.commit()
	print(f"Seeded {SET_A['index'][0]} (complete) and {SET_B['index'][0]} (mid-pipeline).")


def _prefixed(doctype):
	"""Records whose own name carries the prefix - the four code-named DocTypes
	and the two {parent}-V{n} ones that inherit it."""
	assert_owned(doctype)
	return [(n, None) for n in
			frappe.get_all(doctype, filters={"name": ["like", DEMO_PREFIX + "%"]}, pluck="name")]


def _children(doctype, field, parents, via):
	"""Rows linking to `parents`, each tagged with the demo root that proves it.
	An empty parent list returns nothing rather than an unfiltered query - that
	short circuit is what stops a broken traversal from selecting the site."""
	assert_owned(doctype)
	if not parents:
		return []
	names = [p[0] for p in parents]
	return [(n, via) for n in
			frappe.get_all(doctype, filters={field: ["in", names]}, pluck="name")]


def remove(dry_run=0):
	"""Delete every demo record, children before parents. Traverses per survey so
	each hash-named row carries the DEMO- title it descends from."""
	answers, submissions, campaigns, questions, versions, mappings = [], [], [], [], [], []
	surveys = []
	for s in frappe.get_all("UCC Survey", filters={"title": ["like", DEMO_PREFIX + "%"]},
							fields=["name", "title"]):
		via = s.title
		surveys.append((s.name, via))
		v = _children("UCC Survey Version", "survey", [(s.name, via)], via)
		q = _children("UCC Survey Question", "survey_version", v, via)
		c = _children("UCC Survey Campaign", "survey_version", v, via)
		sub = _children("UCC Survey Submission", "campaign", c, via)
		versions += v
		questions += q
		campaigns += c
		submissions += sub
		answers += _children("UCC Survey Answer", "submission", sub, via)
		mappings += _children("UCC Question Mapping", "question", q, via)

	metrics = _prefixed("UCC Metric Definition")
	index_versions = _prefixed("UCC Index Version")
	plan = [
		("UCC Index Result", _children("UCC Index Result", "index_version", index_versions,
									   index_versions[0][0] if index_versions else None)),
		("UCC Index Version", index_versions),
		("UCC Index Definition", _prefixed("UCC Index Definition")),
		("UCC Metric Result", _children("UCC Metric Result", "metric", metrics,
										metrics[0][0] if metrics else None)),
		("UCC Metric Definition", metrics),
		("UCC Question Mapping", mappings),
		("UCC Standard", _prefixed("UCC Standard")),
		("UCC Survey Answer", answers),
		("UCC Survey Submission", submissions),
		("UCC Survey Campaign", campaigns),
		("UCC Survey Question", questions),
		("UCC Survey Version", versions),
		("UCC Survey", surveys),
	]

	total = 0
	for doctype, rows in plan:
		for name, via in rows:
			assert_demo(doctype, name, via=via)
			total += 1
			if dry_run:
				print(f"  would delete {doctype}: {name}")
				continue
			if doctype == "UCC Survey Version":
				# UCC Survey.current_version points back at this row; clear it or
				# the link check blocks the delete.
				frappe.db.set_value("UCC Survey", frappe.db.get_value(
					"UCC Survey Version", name, "survey"), "current_version", None)
			frappe.delete_doc(doctype, name, ignore_permissions=True)

	if dry_run:
		print(f"Dry run: {total} demo records would be deleted. Nothing was changed.")
		return total
	frappe.db.commit()
	print(f"Removed {total} demo records.")
	return total
