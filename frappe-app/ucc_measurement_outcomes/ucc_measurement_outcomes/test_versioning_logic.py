"""Bench-free unit check for the pure version-transition rules.

Runs under plain Python (no Frappe): `python test_versioning_logic.py`.
The Frappe DocType tests that need a live site live next to each DocType.
"""

from versioning import (
	FROZEN_STATUSES,
	frozen_fields_blocked,
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


if __name__ == "__main__":
	test_frozen()
	test_transitions()
	test_frozen_content()
	assert FROZEN_STATUSES == {"Published", "Closed"}
	print("versioning logic: all checks passed")
