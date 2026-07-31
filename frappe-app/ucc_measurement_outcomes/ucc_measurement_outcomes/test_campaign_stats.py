# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Bench-free checks for campaign aggregation. Run: `python3 test_campaign_stats.py`"""

try:
	from ucc_measurement_outcomes.campaign_stats import summarise
except ImportError:
	from campaign_stats import summarise

SUBS = [
	{"name": "s1", "status": "Completed", "submitted_on": "2026-07-24 09:15:00"},
	{"name": "s2", "status": "Completed", "submitted_on": "2026-07-24 17:40:00"},
	{"name": "s3", "status": "Completed", "submitted_on": "2026-07-25 08:00:00"},
	{"name": "s4", "status": "In Progress", "submitted_on": "2026-07-25 08:30:00"},
]
ANS = [
	{"question": "q1", "question_text": "Clarity", "answer_value": "4"},
	{"question": "q1", "question_text": "Clarity", "answer_value": "4"},
	{"question": "q1", "question_text": "Clarity", "answer_value": "5"},
	{"question": "q2", "question_text": "Support", "answer_value": ""},
]


def test_only_completed_submissions_count():
	# An abandoned half-filled form is not a response. Counting it would inflate
	# the rate that gets reported as evidence.
	out = summarise(SUBS, ANS, target=10)
	assert out["counts"]["completed"] == 3, out["counts"]
	assert out["counts"]["partial"] == 1, out["counts"]


def test_response_rate_needs_a_real_target():
	assert summarise(SUBS, ANS, target=10)["response_rate"] == 30.0
	# No target -> no rate. An invented denominator would render a number that
	# looks authoritative and is a guess.
	assert summarise(SUBS, ANS, target=None)["response_rate"] is None
	assert summarise(SUBS, ANS, target=0)["response_rate"] is None


def test_trend_groups_by_day_and_is_ordered():
	trend = summarise(SUBS, ANS, target=None)["trend"]
	assert trend == [{"date": "2026-07-24", "count": 2}, {"date": "2026-07-25", "count": 1}], trend
	# The In Progress row on the 25th is excluded, same rule as the counts.


def test_distribution_counts_values_per_question():
	dist = {d["question"]: d for d in summarise(SUBS, ANS, target=None)["distribution"]}
	assert dist["q1"]["label"] == "Clarity"
	assert dist["q1"]["values"] == [{"value": "4", "count": 2}, {"value": "5", "count": 1}]


def test_blank_answers_are_counted_not_dropped():
	# A question everyone skipped is a finding, not an absence.
	dist = {d["question"]: d for d in summarise(SUBS, ANS, target=None)["distribution"]}
	assert dist["q2"]["values"] == [{"value": "(no answer)", "count": 1}], dist["q2"]


def test_empty_campaign_does_not_divide_by_zero():
	out = summarise([], [], target=25)
	assert out["counts"]["completed"] == 0
	assert out["response_rate"] == 0.0
	assert out["trend"] == [] and out["distribution"] == []


def test_roster_gap_is_reported_not_guessed():
	# The one half of 1b that cannot be built yet must announce itself, not be
	# silently absent from the payload.
	assert "not available" in summarise(SUBS, ANS, target=10)["roster_pending"]


def test_a_corrected_question_is_flagged_on_its_distribution():
	# The counts are answers to the wording as it WAS. Relabelling them silently
	# is the evidence problem the correction exemption was granted on condition
	# of avoiding (decision 2026-07-29).
	out = summarise(
		[{"name": "S1", "status": "Completed", "submitted_on": "2026-07-01"}],
		[{"question": "Q1", "question_text": "Teaching quality", "answer_value": "5",
		  "corrected": "typo: 'Teching' -> 'Teaching'"},
		 {"question": "Q2", "question_text": "Facilities", "answer_value": "4"}],
	)
	by_q = {d["question"]: d for d in out["distribution"]}
	assert by_q["Q1"]["corrected"] == "typo: 'Teching' -> 'Teaching'"
	# An uncorrected question carries None, not a missing key - the renderer
	# tests truthiness and a missing key would read the same, but the contract
	# is that every row answers the question.
	assert "corrected" in by_q["Q2"] and by_q["Q2"]["corrected"] is None


if __name__ == "__main__":
	for name, fn in sorted(globals().items()):
		if name.startswith("test_") and callable(fn):
			fn()
	print("campaign stats: all checks passed")
