# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Two contrasting demo datasets for walking the studios.

    bench --site <site> execute ucc_measurement_outcomes.demo_data.remove --kwargs "{'dry_run':1}"
    bench --site <site> execute ucc_measurement_outcomes.demo_data.seed
    bench --site <site> execute ucc_measurement_outcomes.demo_data.remove

Set A (DEMO-SEQI) runs the whole chain: published survey -> responses ->
objective + metric mapping -> published index -> calculated result. Every
stage of the pipeline stepper reads done.

Set B (DEMO-SAPI) is parked mid-pipeline: half its questions unmapped and its
index version still Draft, so the stepper shows a current stage and real
"what's next" notes instead.

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

import frappe

DEMO_PREFIX = "DEMO-"

# Every DocType in this app's five modules. The allowlist IS the "must not write
# outside our own DocTypes" constraint - there is no path around it.
OWNED = frozenset({
	"UCC Survey", "UCC Survey Version", "UCC Survey Question",
	"UCC Survey Question Choice", "UCC Survey Campaign", "UCC Survey Submission",
	"UCC Survey Answer", "UCC Objective", "UCC Standard", "UCC Question Mapping",
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


# --- the two datasets -------------------------------------------------------
# (question text, per-submission answer values). Means are chosen so the SEQI
# components land on distinct, readable scores rather than all the same number.
SET_A = {
	"survey": "DEMO- Student Experience Survey",
	"index": ("DEMO-SEQI", "Student Experience Quality Index", 75),
	"questions": [
		# text, objective code, objective name, metric code, answers -> mean -> score
		("The programme was delivered as promised", "REL", "Reliability",
		 "DEMO-SEQI-REL", ["4", "4", "4", "4", "4"]),           # 4.0 -> 75
		("Teaching staff were knowledgeable and professional", "ASR", "Assurance",
		 "DEMO-SEQI-ASR", ["5", "4", "5", "4", "4"]),           # 4.4 -> 85
		("Facilities and learning materials were adequate", "TAN", "Tangibles",
		 "DEMO-SEQI-TAN", ["3", "4", "4", "3", "4"]),           # 3.6 -> 65
		("Staff understood my individual needs", "EMP", "Empathy",
		 "DEMO-SEQI-EMP", ["4", "5", "4", "4", "4"]),           # 4.2 -> 80
	],
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
	for question, (_text, obj_code, obj_name, metric_code, _a) in zip(questions, spec["questions"]):
		if not obj_code:
			continue   # left unmapped on purpose - this is what set B demonstrates
		objective = _get_or_create("UCC Objective", f"{DEMO_PREFIX}OBJ-{obj_code}",
								   objective_code=f"{DEMO_PREFIX}OBJ-{obj_code}",
								   objective_name=obj_name)
		_new("UCC Question Mapping", question=question.name, survey_version=version.name,
			 objective=objective.name, standard=standard.name, primary_clause="7.1.1")
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

	iv_a, metrics_a = _build(SET_A, publish_index=True)
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
		("UCC Objective", _prefixed("UCC Objective")),
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
