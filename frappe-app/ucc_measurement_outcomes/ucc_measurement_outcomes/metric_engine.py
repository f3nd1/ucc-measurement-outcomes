"""Pure metric aggregation: raw survey answers -> one 0-100 metric value.

This is the connective tissue between Survey answers and Index calculation that
was missing. Normalisation happens HERE (once), at the metric layer; the index
then applies weights only. Frappe-free and unit-tested (test_metric_engine.py).
"""

try:  # importable both as a package module and as a standalone test target
	from ucc_measurement_outcomes.index_engine import normalise
except ImportError:  # pragma: no cover
	from index_engine import normalise


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
