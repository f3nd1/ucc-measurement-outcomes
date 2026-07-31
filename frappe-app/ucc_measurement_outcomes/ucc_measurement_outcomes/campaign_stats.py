# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Pure aggregation for one campaign's collected responses.

Frappe-free so the arithmetic is unit-tested without a bench
(test_campaign_stats.py). api/campaign.py fetches the rows and delegates here.

NOT here, deliberately: "who has not responded yet". That needs a roster of who
was invited, and nothing in this system stores one - Survey Tracking carries
distributed-vs-actual COUNTS, not people. Inventing a denominator would produce
a response rate that looks authoritative and is a guess. See
`pending_roster_reason` and BENCH_VERIFY.
"""

ROSTER_PENDING = (
	"Who has not responded yet is not available: no roster of invited "
	"respondents exists. Survey Tracking records how many were distributed to, "
	"not who they were."
)


def _day(ts):
	"""Date part of a Frappe datetime string or datetime-like. Plain string slice
	so this stays Frappe-free; Frappe datetimes are always ISO-ordered."""
	if ts is None:
		return None
	s = str(ts)
	return s[:10] or None


def summarise(submissions, answers, target=None):
	"""submissions: [{name, status, submitted_on}]
	answers:     [{question, question_text, answer_value, corrected}]
	target:      expected respondent count, or None if not set on the campaign.

	Returns counts, response rate (None when there is no target - a rate with an
	invented denominator is worse than no rate), a per-day trend, and a value
	distribution per question.
	"""
	completed = [s for s in submissions if s.get("status") == "Completed"]
	partial = [s for s in submissions if s.get("status") != "Completed"]

	trend = {}
	for s in completed:
		d = _day(s.get("submitted_on"))
		if d:
			trend[d] = trend.get(d, 0) + 1

	distribution = {}
	labels = {}
	# Wording corrected after publication (decision 2026-07-29). These counts are
	# of answers given to the OLD wording, so the label has to say so - a silently
	# relabelled distribution is the evidence problem the correction exemption was
	# only granted on condition of avoiding.
	corrected = {}
	for a in answers:
		q = a.get("question")
		if not q:
			continue
		labels.setdefault(q, a.get("question_text") or q)
		if a.get("corrected"):
			corrected.setdefault(q, a["corrected"])
		value = a.get("answer_value")
		# Blank is a real observation - a question everyone skipped is a finding,
		# not an absence - so it is counted under its own label rather than
		# dropped.
		key = "(no answer)" if value in (None, "") else str(value)
		bucket = distribution.setdefault(q, {})
		bucket[key] = bucket.get(key, 0) + 1

	rate = None
	if target:
		rate = round(100.0 * len(completed) / target, 1)

	return {
		"counts": {
			"completed": len(completed),
			"partial": len(partial),
			"target": target or None,
			"answers": len(answers),
			"questions_answered": len(distribution),
		},
		"response_rate": rate,
		"trend": [{"date": d, "count": n} for d, n in sorted(trend.items())],
		"distribution": [
			{
				"question": q,
				"label": labels[q],
				"corrected": corrected.get(q),
				"values": sorted(
					({"value": v, "count": n} for v, n in buckets.items()),
					key=lambda r: (-r["count"], r["value"]),
				),
			}
			for q, buckets in sorted(distribution.items(), key=lambda kv: labels[kv[0]])
		],
		"roster_pending": ROSTER_PENDING,
	}
