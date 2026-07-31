"""Pure metric aggregation: raw survey answers -> one 0-100 metric value.

This is the connective tissue between Survey answers and Index calculation that
was missing. Normalisation happens HERE (once), at the metric layer; the index
then applies weights only. Frappe-free and unit-tested (test_metric_engine.py).
"""

try:  # importable both as a package module and as a standalone test target
	from ucc_measurement_outcomes.index_engine import normalise
except ImportError:  # pragma: no cover
	from index_engine import normalise


# The scoring seam. A DocType must appear here to become a score, and the only
# thing that qualifies is our own Answer row - it carries a real question LINK
# and a normalisable value.
#
# This is an ALLOWLIST on purpose. A denylist naming Survey Response would block
# the one path we thought of and wave through the next one; requiring an opt-in
# means a future source has to be argued for rather than merely added.
#
# Historical educ_sg responses can never qualify: 1,104 of 2,339 rows (47%)
# cannot be attributed to a specific question by text, by qn_no, or by row
# position, so a score computed from them would be an average over an unknown
# mixture of questions. They stay visible in Data Explorer and unscoreable here.
SCOREABLE_SOURCE_DOCTYPES = frozenset({"UCC Survey Answer"})


def assert_scoreable_source(doctype):
	"""Raise unless `doctype` may be read into a Metric Result."""
	if doctype not in SCOREABLE_SOURCE_DOCTYPES:
		raise PermissionError(
			f"{doctype!r} is not a scoreable source. Scoring reads only "
			f"{sorted(SCOREABLE_SOURCE_DOCTYPES)}; everything else is reference data."
		)
	return doctype


def contributing_versions(answer_rows):
	"""Comma-separated, sorted, de-duplicated survey versions from the rows a
	metric actually read. "" when nothing contributed.

	Rows are (answer_name, raw_value, normalisation, reverse, survey_version) -
	the tuple metric_calc builds. Lives here rather than beside its one caller
	because metric_calc imports frappe, and this is the repo's pure tier: a rule
	with a test beats a line inside a service.
	"""
	return ", ".join(sorted({r[4] for r in answer_rows if len(r) > 4 and r[4]}))


def aggregate_metric(entries):
	"""entries: [{value, normalisation, reverse}] raw answers for a metric.

	Normalises each answer to 0-100 (non-numeric / unscoreable -> None, ignored)
	and returns the mean over the scoreable answers, plus counts and the
	per-entry normalised list (used to backfill answer_numeric)."""
	normalised = [
		normalise(e.get("value"), e.get("normalisation", ""), bool(e.get("reverse")))
		for e in entries
	]
	scored = [n for n in normalised if n is not None]
	value = sum(scored) / len(scored) if scored else None
	return {
		"value": value,
		"normalised": normalised,
		"response_count": len(entries),
		"scored_count": len(scored),
	}
