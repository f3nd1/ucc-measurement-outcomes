"""Bench-free checks for source_eligibility.verdict.

The point of these: the drawer used to call everything "Compatible", including
Email and Page Break. Each case below is one of those lies, now asserted false.
"""
try:
	from ucc_measurement_outcomes.source_eligibility import verdict, is_structural
except ImportError:
	from source_eligibility import verdict, is_structural

LIKERT = "Likert 1-5 to 0-100"


def check():
	# --- the specific mislabels the QA report named ---
	for qt in ("Email", "Short Text", "Paragraph", "File Upload", "Date", "Ranking"):
		v = verdict(qt, LIKERT, answers=5)
		assert not v["eligible"], qt + " must not be eligible for a Likert metric"
		assert v["state"] == "incompatible", (qt, v)
		assert "not numeric" in v["reason"], v

	for qt in ("Page Break", "Section Heading"):
		v = verdict(qt, LIKERT, answers=5)
		assert not v["eligible"] and v["state"] == "structural", (qt, v)
		assert is_structural(qt)

	# --- what genuinely works for a Likert metric ---
	for qt in ("Rating", "NPS", "Slider", "Number", "Likert Matrix"):
		v = verdict(qt, LIKERT, answers=3)
		assert v["eligible"] and v["state"] == "eligible", (qt, v)

	# Yes/No is NOT Likert-compatible: normalise() would map 1 -> (1-1)/4*100 = 0,
	# scoring every "yes" as zero. Silent wrongness is worse than refusing.
	v = verdict("Yes / No", LIKERT, answers=9)
	assert not v["eligible"], v
	assert v["suggested_normalisation"] == "Yes/No to 100/0", v
	# ...and it IS compatible under its own rule.
	assert verdict("Yes / No", "Yes/No to 100/0", answers=9)["eligible"]

	# --- compatibility and response data are separate verdicts ---
	v = verdict("Rating", LIKERT, answers=0)
	assert v["eligible"], "no answers must not make a question incompatible"
	assert v["state"] == "no_response_data", v

	# --- already connected is a state, not an error ---
	v = verdict("Rating", LIKERT, answers=5, already=True)
	assert not v["eligible"] and v["state"] == "already_connected", v

	# --- choice types depend on whether their choices carry numeric values ---
	assert not verdict("Single Choice", LIKERT, answers=4)["eligible"]
	assert verdict("Single Choice", LIKERT, answers=4, numeric_choices=True)["eligible"]

	# --- a metric that scores nothing accepts nothing ---
	v = verdict("Rating", "Category Only (No Score)", answers=5)
	assert not v["eligible"] and "no score" in v["reason"], v

	# --- a metric with no normalisation cannot score either ---
	assert not verdict("Rating", "", answers=5)["eligible"]

	print("source eligibility: all checks passed")


if __name__ == "__main__":
	check()
