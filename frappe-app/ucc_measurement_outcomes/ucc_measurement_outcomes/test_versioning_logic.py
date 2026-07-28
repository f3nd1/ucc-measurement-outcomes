"""Bench-free unit check for the pure version-transition rules.

Runs under plain Python (no Frappe): `python test_versioning_logic.py`.
The Frappe DocType tests that need a live site live next to each DocType.
"""

from versioning import (
	PRESENTATION_FIELDS,
	presentation_only_change,
	FROZEN_STATUSES,
	frozen_fields_blocked,
	next_version_number,
	version_is_frozen,
	version_transition_blocked,
)


def test_frozen():
	assert version_is_frozen("Published")
	assert version_is_frozen("Closed")
	assert not version_is_frozen("Draft")
	assert not version_is_frozen("In Review")


def test_transitions():
	# Forward flow while editable is allowed.
	assert not version_transition_blocked("Draft", "In Review")
	assert not version_transition_blocked("In Review", "Published")
	# The one permitted move out of Published.
	assert not version_transition_blocked("Published", "Closed")
	# Same-status saves pass the TRANSITION guard — which is exactly why the
	# frozen-CONTENT guard below exists: a Published -> Published save must not
	# be a route to rewriting frozen content (found in the Pass 1 review).
	assert not version_transition_blocked("Published", "Published")
	assert not version_transition_blocked("Closed", "Closed")
	# Everything else out of a frozen status is blocked.
	assert version_transition_blocked("Published", "Draft")
	assert version_transition_blocked("Published", "In Review")
	assert version_transition_blocked("Closed", "Published")
	assert version_transition_blocked("Closed", "Draft")


def test_frozen_content():
	# Draft versions may change anything.
	assert not frozen_fields_blocked("Draft", ["version_number", "survey"])
	assert not frozen_fields_blocked("In Review", ["title_snapshot"])
	# Frozen versions may change nothing but status.
	assert frozen_fields_blocked("Published", ["version_number"])
	assert frozen_fields_blocked("Published", ["survey", "title_snapshot"])
	assert frozen_fields_blocked("Closed", ["description_snapshot"])
	# A pure status move (Published -> Closed) touches no guarded field.
	assert not frozen_fields_blocked("Published", [])
	assert not frozen_fields_blocked("Published", ["status"])
	# Custom allow-list still works.
	assert not frozen_fields_blocked("Published", ["pos_x"], allowed=("status", "pos_x"))


def test_next_version_number():
	# Nothing exists yet: count=0 -> V1, no probing needed.
	assert next_version_number(0, lambda n: False) == 1
	# Normal case: 2 rows exist (V1, V2) -> next is V3.
	assert next_version_number(2, lambda n: n in (1, 2)) == 3
	# The bug this exists to prevent: V1 deleted from a V1+V2 pair leaves
	# count=1, so a naive "count + 1" collides with the still-existing V2.
	assert next_version_number(1, lambda n: n == 2) == 3
	# A deeper gap: V1-V4 exist, V2 was deleted. count=3 (V1,V3,V4) says "try 4",
	# which also collides; probe until 5.
	assert next_version_number(3, lambda n: n in (1, 3, 4)) == 5


def _q(**over):
	"""A published question as the guard sees it: plain dicts, because
	presentation_only_change() only ever calls .get()."""
	q = {
		"survey_version": "SV-01", "sequence": 3, "question_type": "Rating",
		"is_required": 1, "layout_width": "Full Width",
		"question_text": "Teaching was effective", "help_text": None,
		"matrix_rows": None, "display_logic": "Always Show",
		"display_logic_config": None,
		"choices": [{"choice_label": "1", "choice_value": "1", "sequence": 0},
					{"choice_label": "2", "choice_value": "2", "sequence": 1}],
	}
	q.update(over)
	return q


def test_presentation_only_change():
	# The whole point: width alone may change after publish.
	assert presentation_only_change(_q(), _q(layout_width="Half"))
	# Content may not - each of these is what immutability exists to protect.
	assert not presentation_only_change(_q(), _q(question_text="Reworded"))
	assert not presentation_only_change(_q(), _q(question_type="Slider"))
	assert not presentation_only_change(_q(), _q(is_required=0))
	assert not presentation_only_change(_q(), _q(sequence=4))
	assert not presentation_only_change(_q(), _q(display_logic="Show If Previous Answer Matches"))
	# Width TOGETHER with content is still content: the exemption is not a
	# loophole for smuggling an edit through beside a layout tweak.
	assert not presentation_only_change(_q(), _q(layout_width="Half", question_text="Reworded"))
	# Re-parenting can never be presentation-only.
	assert not presentation_only_change(_q(), _q(survey_version="SV-02"))
	# A no-op save is not a presentation edit - unchanged from before, a save on
	# a frozen version with nothing to change still throws.
	assert not presentation_only_change(_q(), _q())


def test_presentation_only_change_on_choices():
	# Choices are content, including their ORDER: reordering the options of a
	# published question changes what respondents see and how answers read.
	relabelled = _q()
	relabelled["choices"] = [{"choice_label": "One", "choice_value": "1", "sequence": 0},
							 {"choice_label": "2", "choice_value": "2", "sequence": 1}]
	assert not presentation_only_change(_q(), relabelled)
	reordered = _q()
	reordered["choices"] = list(reversed(_q()["choices"]))
	assert not presentation_only_change(_q(), reordered)
	dropped = _q()
	dropped["choices"] = _q()["choices"][:1]
	assert not presentation_only_change(_q(), dropped)
	added = _q()
	added["choices"] = _q()["choices"] + [{"choice_label": "3", "choice_value": "3", "sequence": 2}]
	assert not presentation_only_change(_q(), added)


def test_presentation_field_whitelist_stays_small():
	# A blacklist would make every field added later silently editable after
	# publish. If this fails, someone widened the exemption - that is a product
	# decision and belongs in docs/09-decision-log.md, not in a passing test.
	assert PRESENTATION_FIELDS == {"layout_width"}


def test_blank_and_unset_are_the_same():
	# Frappe hands back "" where the DB holds NULL depending on the path; that
	# must not read as an edit and lock a published question out of a width change.
	assert presentation_only_change(_q(help_text=None), _q(help_text="", layout_width="Half"))
	assert not presentation_only_change(_q(help_text=None), _q(help_text="x"))


if __name__ == "__main__":
	test_frozen()
	test_transitions()
	test_frozen_content()
	test_next_version_number()
	test_presentation_only_change()
	test_presentation_only_change_on_choices()
	test_presentation_field_whitelist_stays_small()
	test_blank_and_unset_are_the_same()
	assert FROZEN_STATUSES == {"Published", "Closed"}
	print("versioning logic: all checks passed")
