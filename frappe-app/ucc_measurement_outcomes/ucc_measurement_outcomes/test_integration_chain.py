# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""END-TO-END integration test across all five workspaces (DB-level).

BENCH-RUN ONLY — needs a live site. Run with:
    bench --site <dev-site> run-tests --module \
        ucc_measurement_outcomes.test_integration_chain

Walks the full chain: survey question -> published version -> submission +
answers -> objective + metric mapping -> Metric Result (normalised once) ->
Index Result (weighted) -> Dashboard KPI -> Explorer pivot, and asserts the
score traces back to the source metric. The pure-logic version of this same
chain runs without a bench in test_chain_contract.py.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from ucc_measurement_outcomes.metric_calc import calculate_metric_result
from ucc_measurement_outcomes.index_calc import calculate_index
from ucc_measurement_outcomes.api.dashboard import get_dashboard_data
from ucc_measurement_outcomes.api.explorer import run_analysis


class TestChainIntegration(FrappeTestCase):
	def test_full_chain(self):
		# 1) Survey + Draft version + a Rating question with numeric choices.
		survey = frappe.get_doc({"doctype": "UCC Survey", "title": "IT Onboarding"}).insert()
		version = frappe.get_doc({
			"doctype": "UCC Survey Version", "survey": survey.name,
			"version_number": "01", "status": "Draft",
		}).insert()
		question = frappe.get_doc({
			"doctype": "UCC Survey Question", "survey_version": version.name,
			"question_type": "Rating", "question_text": "Teacher explained clearly", "sequence": 0,
			"choices": [{"choice_label": str(i), "choice_value": str(i)} for i in range(1, 6)],
		}).insert()

		# 2) Publish the version (freezes it).
		version.status = "Published"
		version.save()

		# 3) Campaign + three completed responses (answers created as the public
		#    endpoint would; the endpoint's own guards are covered separately).
		campaign = frappe.get_doc({
			"doctype": "UCC Survey Campaign", "campaign_name": "Aug intake",
			"survey_version": version.name, "status": "Open",
		}).insert()
		submission = frappe.get_doc({
			"doctype": "UCC Survey Submission", "campaign": campaign.name,
			"survey_version": version.name, "status": "Completed",
		}).insert(ignore_permissions=True)
		for val in ("5", "3", "4"):
			frappe.get_doc({
				"doctype": "UCC Survey Answer", "submission": submission.name,
				"question": question.name, "answer_value": val,
			}).insert(ignore_permissions=True)
		self.assertEqual(frappe.db.count("UCC Survey Answer", {"question": question.name}), 3)

		# 4) Mapping: objective mapping + metric with the question as a source.
		objective = frappe.get_doc({
			"doctype": "UCC Objective", "objective_code": "OBJ-TC", "objective_name": "Teaching",
		}).insert()
		frappe.get_doc({
			"doctype": "UCC Question Mapping", "question": question.name, "objective": objective.name,
		}).insert()
		frappe.get_doc({
			"doctype": "UCC Metric Definition", "metric_code": "TEACHING_CLARITY",
			"metric_name": "Teaching Clarity", "default_normalisation": "Likert 1-5 to 0-100",
			"sources": [{
				"source_type": "Survey Question", "source_question": question.name,
				"normalisation": "Likert 1-5 to 0-100",
			}],
		}).insert()

		# 5) Metric calc: 5,3,4 -> 100,50,75 -> mean 75; answer_numeric backfilled.
		mr = calculate_metric_result("TEACHING_CLARITY")
		self.assertEqual(frappe.db.get_value("UCC Metric Result", mr, "value"), 75)
		numerics = frappe.get_all("UCC Survey Answer", filters={"question": question.name},
								  pluck="answer_numeric")
		self.assertTrue(all(n is not None for n in numerics))

		# 6) Index definition + version + nodes, published.
		frappe.get_doc({
			"doctype": "UCC Index Definition", "index_code": "SEQI",
			"index_name": "Student Experience Quality Index", "target": 75,
		}).insert()
		iv = frappe.get_doc({
			"doctype": "UCC Index Version", "index": "SEQI", "version_number": "01", "status": "Draft",
			"nodes": [
				{"node_key": "seqi", "node_type": "Index", "label": "SEQI"},
				{"node_key": "tc", "node_type": "Metric", "label": "Teaching Clarity",
				 "parent_key": "seqi", "weight": 100, "source_metric": "TEACHING_CLARITY"},
			],
		}).insert()
		iv.status = "Published"
		iv.save()

		# 7) Index calc: weighted-only -> 75, with a breakdown that traces the metric.
		ir = calculate_index(iv.name)
		result = frappe.get_doc("UCC Index Result", ir)
		self.assertEqual(result.value, 75)
		leaf = next(b for b in result.breakdown if b.component_key == "tc")
		self.assertEqual(leaf.source_metric, "TEACHING_CLARITY")
		self.assertEqual(leaf.normalised_value, 75)

		# 8) Dashboard sees the KPI.
		dash = get_dashboard_data(index="SEQI")
		self.assertTrue(any(k["value"] == 75 for k in dash["kpis"]))

		# 9) Data Explorer pivots the same result (approved catalogue, no SQL).
		report = run_analysis("Index Results", "Average Value", "index", None, None)
		cells = {r["row"]: r["cells"] for r in report["table"]["rows"]}
		self.assertEqual(cells["SEQI"]["Total"], 75)


class TestFrozenVersionAdversarial(FrappeTestCase):
	"""Pass 1 review: adversarial attempts to modify frozen content. Each of
	these succeeded before the frozen-content guards were added."""

	def _published_survey_version(self):
		survey = frappe.get_doc({"doctype": "UCC Survey", "title": "Adversarial"}).insert()
		version = frappe.get_doc({
			"doctype": "UCC Survey Version", "survey": survey.name,
			"version_number": "01", "status": "Draft",
		}).insert()
		question = frappe.get_doc({
			"doctype": "UCC Survey Question", "survey_version": version.name,
			"question_type": "Short Text", "question_text": "Q1", "sequence": 0,
		}).insert()
		version.status = "Published"
		version.save()
		return survey, version, question

	def test_published_version_header_frozen(self):
		_survey, version, _q = self._published_survey_version()
		version.reload()
		version.version_number = "99"
		self.assertRaises(frappe.ValidationError, version.save)

	def test_published_to_closed_still_allowed(self):
		_survey, version, _q = self._published_survey_version()
		version.reload()
		version.status = "Closed"
		version.save()  # must not raise: the one permitted move

	def test_question_cannot_leave_published_version(self):
		survey, _version, question = self._published_survey_version()
		draft = frappe.get_doc({
			"doctype": "UCC Survey Version", "survey": survey.name,
			"version_number": "02", "status": "Draft",
		}).insert()
		question.reload()
		question.survey_version = draft.name
		self.assertRaises(frappe.ValidationError, question.save)

	def test_published_index_formula_frozen(self):
		frappe.get_doc({
			"doctype": "UCC Index Definition", "index_code": "ADVIDX", "index_name": "Adv",
		}).insert()
		iv = frappe.get_doc({
			"doctype": "UCC Index Version", "index": "ADVIDX", "version_number": "01",
			"status": "Draft", "nodes": [
				{"node_key": "root", "node_type": "Index", "label": "Adv"},
				{"node_key": "m", "node_type": "Metric", "label": "M",
				 "parent_key": "root", "weight": 100, "source_metric": "X"},
			],
		}).insert()
		iv.status = "Published"
		iv.save()
		# Formula change (weight) must be blocked...
		iv.reload()
		iv.nodes[1].weight = 50
		self.assertRaises(frappe.ValidationError, iv.save)
		# ...but a layout-only move (pos_x/pos_y) is not formula content.
		iv.reload()
		iv.nodes[1].pos_x = 240
		iv.save()


class TestGuestAndExplorerGuards(FrappeTestCase):
	"""Pass 1 review: guest endpoint and Data Explorer hardening."""

	def _open_campaign(self):
		survey = frappe.get_doc({"doctype": "UCC Survey", "title": "Guard"}).insert()
		version = frappe.get_doc({
			"doctype": "UCC Survey Version", "survey": survey.name,
			"version_number": "01", "status": "Draft",
		}).insert()
		version.status = "Published"
		version.save()
		return frappe.get_doc({
			"doctype": "UCC Survey Campaign", "campaign_name": "Guard",
			"survey_version": version.name, "status": "Open",
		}).insert()

	def test_double_submit_same_respondent_rejected(self):
		from ucc_measurement_outcomes.api.public import submit_survey

		campaign = self._open_campaign()
		submit_survey(campaign.public_token, "[]", respondent_key="stu-1")
		self.assertRaises(
			frappe.ValidationError, submit_survey,
			campaign.public_token, "[]", "stu-1",
		)

	def test_malformed_answer_item_rejected(self):
		from ucc_measurement_outcomes.api.public import submit_survey

		campaign = self._open_campaign()
		self.assertRaises(
			frappe.ValidationError, submit_survey,
			campaign.public_token, '[["not-a-dict"]]',
		)

	def test_closed_version_stops_collection(self):
		from ucc_measurement_outcomes.api.public import get_public_survey

		campaign = self._open_campaign()
		version = frappe.get_doc("UCC Survey Version", campaign.survey_version)
		version.status = "Closed"  # the one permitted move out of Published
		version.save()
		# Campaign is still Open, but decision V2 gates on version status.
		self.assertRaises(frappe.ValidationError, get_public_survey, campaign.public_token)

	def test_archived_survey_stops_collection(self):
		from ucc_measurement_outcomes.api.public import get_public_survey

		campaign = self._open_campaign()
		survey = frappe.db.get_value("UCC Survey Version", campaign.survey_version, "survey")
		frappe.db.set_value("UCC Survey", survey, "status", "Archived")
		self.assertRaises(frappe.ValidationError, get_public_survey, campaign.public_token)

	def test_explorer_rejects_operator_filter_values(self):
		from ucc_measurement_outcomes.api.explorer import run_analysis

		# A list value would smuggle a frappe filter operator through the
		# catalogue's equality-only contract.
		self.assertRaises(
			frappe.ValidationError, run_analysis,
			"Metric Results", "Row Count", "metric", None,
			'{"metric": ["like", "%x%"]}',
		)


class TestBuilderOrdering(FrappeTestCase):
	"""Pass 2 review: question ordering after deletions. Sequences drifted
	sparse after deletes, so every position==sequence assumption broke."""

	def _draft_version(self):
		survey = frappe.get_doc({"doctype": "UCC Survey", "title": "Order"}).insert()
		return frappe.get_doc({
			"doctype": "UCC Survey Version", "survey": survey.name,
			"version_number": "01", "status": "Draft",
		}).insert()

	def _ordered_texts(self, version):
		from ucc_measurement_outcomes.api.builder import get_survey_builder
		return [q["question_text"] for q in get_survey_builder(version.name)["questions"]]

	def test_insert_at_position_lands_at_position(self):
		from ucc_measurement_outcomes.api.builder import add_question, update_question
		version = self._draft_version()
		names = [add_question(version.name) for _ in range(3)]
		for i, n in enumerate(names):
			update_question(n, '{"question_text": "Q%d"}' % i)
		inserted = add_question(version.name, question_type="Short Text", sequence=1)
		update_question(inserted, '{"question_text": "NEW"}')
		self.assertEqual(self._ordered_texts(version), ["Q0", "NEW", "Q1", "Q2"])

	def test_delete_then_append_stays_dense_and_last(self):
		from ucc_measurement_outcomes.api.builder import (
			add_question, delete_question, get_survey_builder, update_question,
		)
		version = self._draft_version()
		names = [add_question(version.name) for _ in range(3)]
		for i, n in enumerate(names):
			update_question(n, '{"question_text": "Q%d"}' % i)
		delete_question(names[1])
		appended = add_question(version.name)
		update_question(appended, '{"question_text": "LAST"}')
		self.assertEqual(self._ordered_texts(version), ["Q0", "Q2", "LAST"])
		seqs = [q["sequence"] for q in get_survey_builder(version.name)["questions"]]
		self.assertEqual(seqs, [0, 1, 2])  # dense after delete

	def test_duplicate_lands_directly_after_source(self):
		from ucc_measurement_outcomes.api.builder import add_question, duplicate_question, update_question
		version = self._draft_version()
		names = [add_question(version.name) for _ in range(3)]
		for i, n in enumerate(names):
			update_question(n, '{"question_text": "Q%d"}' % i)
		duplicate_question(names[0])
		self.assertEqual(self._ordered_texts(version), ["Q0", "Q0 (Copy)", "Q1", "Q2"])

	def test_template_version_number_survives_deletion(self):
		from ucc_measurement_outcomes.api.index_studio import create_index_from_template
		v1 = create_index_from_template("SEQI")
		create_index_from_template("SEQI")           # V02
		frappe.delete_doc("UCC Index Version", v1)   # delete V01, count now 1
		v3 = create_index_from_template("SEQI")      # used to crash: DuplicateEntry on V02
		self.assertTrue(v3.endswith("-V03"))
