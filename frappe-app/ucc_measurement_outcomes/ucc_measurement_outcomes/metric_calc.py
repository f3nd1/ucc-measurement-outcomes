# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Frappe metric-calculation service: survey answers -> one UCC Metric Result.

This is the connective step that was missing between Survey answers and Index
calculation. For a metric, it gathers answers to each of its source questions,
normalises them (via the pure metric_engine), backfills each answer's
answer_numeric, and writes one Metric Result. Runs as a background job.
"""

import frappe

from ucc_measurement_outcomes.metric_engine import aggregate_metric, assert_scoreable_source

METRIC = "UCC Metric Definition"
ANSWER = "UCC Survey Answer"


def calculate_metric_result(metric_code, period=None, entity_type=None, entity=None):
	metric = frappe.get_doc(METRIC, metric_code)

	# THE SCORING SEAM. Everything that becomes a score enters here and nowhere
	# else, so this is where "historical data may be seen, never scored" is
	# enforced rather than merely stated. Any new source type must call
	# assert_scoreable_source before reading, which is an allowlist of one:
	# UCC Survey Answer. Historical educ_sg responses cannot pass it, and a
	# future Operational Field reader cannot quietly point source_reference at
	# Survey Response List Childtable.
	assert_scoreable_source(ANSWER)

	# (answer_name, raw_value, normalisation, reverse, survey_version)
	answer_rows = []
	for src in metric.sources:
		if src.source_type != "Survey Question" or not src.source_question:
			# TODO: bench-verify - Operational Field sources read external DocTypes
			# (e.g. Assessment Result) not yet confirmed on the bench; skipped here.
			# When one is wired, it goes through assert_scoreable_source first -
			# source_reference is a free-text Data field and would otherwise be a
			# way to name any table at all.
			continue
		norm = src.normalisation or metric.default_normalisation
		rev = bool(src.reverse_scored)
		for a in frappe.get_all(
			ANSWER,
			filters={"question": src.source_question},
			fields=["name", "answer_value", "survey_version"],
		):
			answer_rows.append((a["name"], a["answer_value"], norm, rev, a["survey_version"]))

	entries = [{"value": v, "normalisation": n, "reverse": r} for (_n, v, n, r, _v) in answer_rows]
	result = aggregate_metric(entries)

	# Backfill answer_numeric so per-answer normalised scores are reportable in
	# Data Explorer (and traceable from an index score back to the answer).
	for (row, nval) in zip(answer_rows, result["normalised"]):
		if nval is not None:
			frappe.db.set_value(ANSWER, row[0], "answer_numeric", nval, update_modified=False)

	# TODO: bench-verify - entity/period breakdown needs each answer's
	# programme/intake/term, which come from Student/Programme DocTypes not yet
	# confirmed. This aggregates across all answers for the metric.
	doc = frappe.get_doc({
		"doctype": "UCC Metric Result",
		"metric": metric_code,
		"period": period,
		"entity_type": entity_type,
		"entity": entity,
		"value": result["value"],
		"response_count": result["response_count"],
		"source_version": answer_rows[0][4] if answer_rows else None,
	})
	doc.insert()
	return doc.name
