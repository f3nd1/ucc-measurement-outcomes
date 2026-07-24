"""Bench-free unit check for the pure version-transition rules.

Runs under plain Python (no Frappe): `python test_versioning_logic.py`.
The Frappe DocType tests that need a live site live next to each DocType.
"""

from versioning import FROZEN_STATUSES, version_is_frozen, version_transition_blocked


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
	# No-op saves are always fine.
	assert not version_transition_blocked("Published", "Published")
	assert not version_transition_blocked("Closed", "Closed")
	# Everything else out of a frozen status is blocked.
	assert version_transition_blocked("Published", "Draft")
	assert version_transition_blocked("Published", "In Review")
	assert version_transition_blocked("Closed", "Published")
	assert version_transition_blocked("Closed", "Draft")


if __name__ == "__main__":
	test_frozen()
	test_transitions()
	assert FROZEN_STATUSES == {"Published", "Closed"}
	print("versioning logic: all checks passed")
