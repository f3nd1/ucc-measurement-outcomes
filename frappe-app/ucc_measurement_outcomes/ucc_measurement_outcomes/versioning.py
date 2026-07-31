"""Version lifecycle rules for UCC survey DocTypes.

The pure functions here encode immutability and are unit-tested WITHOUT a Frappe
bench (see test_versioning_logic.py). Keep this module free of a top-level
`import frappe` so the pure test can import it directly; the one Frappe-aware
helper imports frappe lazily inside the function body.
"""

# A frozen version's identity and content must never change silently, so that a
# previously published/reported score can always be reproduced.
FROZEN_STATUSES = {"Published", "Closed"}

# Decision 2026-07-28: a published version's CONTENT is frozen; its PRESENTATION
# is not. The invariant immutability exists to protect is "every published score
# must be reproducible" - and a score derives from question text, type and
# choices plus the answers given. layout_width feeds none of that: not
# metric_engine, not index_engine, not mapping, not lineage, not Score Breakdown.
# Nothing downstream of a question can observe it.
#
# A WHITELIST, never a blacklist: every field added to a question later is frozen
# by default, and exempting one has to be a deliberate act. A blacklist would
# silently make each new field editable after publish.
PRESENTATION_FIELDS = frozenset({"layout_width"})

# Decision 2026-07-29: a published question's WORDING may be corrected; its
# answer-determining structure may not. A separate frozenset from
# PRESENTATION_FIELDS, not an addition to it, because the two carry different
# permissions: a layout tweak is silent, a wording correction demands a reason
# and is audited. One set would force a reason for dragging a column width, or
# let wording change without one.
#
# THE INVARIANT MOVES, and it is worth saying exactly how. It was "a published
# version's content is frozen". It is now "a published version's
# answer-determining structure is frozen; its wording may be corrected with an
# audited reason". Scores are untouched either way - nothing in metric_engine,
# index_engine or Score Breakdown reads question_text, and lineage_questions
# stores docnames. What weakens is EVIDENCE: no answer row snapshots the wording
# a respondent saw, so after a correction the app can no longer prove what was
# on screen at the time. That is why the readers show a marker (api/lineage.py,
# api/campaign.py) - an audited correction that nobody can see while reading the
# evidence is just a quiet rewrite of the record.
#
# question_type, choices, is_required, matrix_rows, display_logic,
# display_logic_config and survey_version stay frozen: every one of them can
# change what counts as a valid answer.
CORRECTABLE_FIELDS = frozenset({"question_text"})

# The two exemptions must never overlap: a field in both would take whichever
# branch ran first, so one of its two rules would silently not apply.
# check_repo.sh asserts this too.
assert not (PRESENTATION_FIELDS & CORRECTABLE_FIELDS)

# Everything a survey question stores, and the parts of a choice row that carry
# meaning. Listed rather than derived because "compare every field" would drag in
# modified/modified_by/idx and report a change on every save.
QUESTION_FIELDS = (
	"survey_version", "sequence", "question_type", "is_required", "layout_width",
	"question_text", "help_text", "matrix_rows", "display_logic",
	"display_logic_config",
)
CHOICE_FIELDS = ("choice_label", "choice_value", "sequence")


def _norm(value):
	"""Blank and unset are the same thing for comparison; everything else
	compares as text, so 0 and "0" off a form do not read as a change."""
	return None if value is None or value == "" else str(value)


def _choice_rows(rows):
	return [tuple(_norm(r.get(f)) for f in CHOICE_FIELDS) for r in (rows or [])]


def presentation_only_change(before, after):
	"""True if this save changes ONLY presentation fields (and changes something).

	`before` and `after` are anything with .get() - a Frappe Document or a plain
	dict, which is what makes this testable without a bench.

	Order matters as much as content, so choices are compared as an ordered list:
	reordering the options of a published question is a content change.
	Re-parenting is covered too - survey_version is in QUESTION_FIELDS and not in
	PRESENTATION_FIELDS, so moving a question between versions can never pass.
	Fails closed: an unrecognised difference is a difference.
	"""
	changed = {f for f in QUESTION_FIELDS if _norm(before.get(f)) != _norm(after.get(f))}
	if _choice_rows(before.get("choices")) != _choice_rows(after.get("choices")):
		changed.add("choices")
	return bool(changed) and changed <= PRESENTATION_FIELDS


def correctable_only_change(before, after):
	"""True if this save changes ONLY correctable fields (and changes something).

	Same shape and the same fail-closed rule as presentation_only_change: an
	unrecognised difference is a difference, choices compare as an ordered list,
	and re-parenting can never pass because survey_version is in QUESTION_FIELDS
	and not in CORRECTABLE_FIELDS.

	Presentation fields are deliberately NOT accepted here. A save that changes
	wording AND layout together is neither purely presentational nor purely a
	correction, so it fails both gates and is refused - which is the right
	answer, because the reason recorded would describe only half of it.
	"""
	changed = {f for f in QUESTION_FIELDS if _norm(before.get(f)) != _norm(after.get(f))}
	if _choice_rows(before.get("choices")) != _choice_rows(after.get("choices")):
		changed.add("choices")
	return bool(changed) and changed <= CORRECTABLE_FIELDS


def next_version_number(existing_count, name_exists):
	"""Smallest free version number (as an int), probing past any gap left by a
	deleted-then-recreated version.

	existing_count alone is not authoritative: delete V01 of a V01+V02 pair and
	count() drops to 1, so "next = count + 1" collides with V02 and raises
	DuplicateEntry (the exact bug this probe exists to prevent — first found in
	Index Studio's version creation, same shape here since both use
	{parent}-V{n:02d} naming). name_exists(n) checks whether that specific
	number's full name is taken; the caller supplies it since only it knows the
	real name format and has a database to check against.
	"""
	# ponytail: linear probe, fine at human version counts.
	n = existing_count + 1
	while name_exists(n):
		n += 1
	return n


def version_is_frozen(status):
	"""True if a version in this status must not have its content edited."""
	return status in FROZEN_STATUSES


def version_transition_blocked(old_status, new_status):
	"""True if moving a version old_status -> new_status is not allowed.

	Once Published, the only permitted move is Published -> Closed. Closed is
	terminal. Any other move out of a frozen status is blocked.
	"""
	if old_status == new_status:
		return False
	if old_status == "Published" and new_status == "Closed":
		return False
	if old_status in FROZEN_STATUSES:
		return True
	return False


def frozen_fields_blocked(before_status, changed_fieldnames, allowed=("status",)):
	"""True if a doc that was frozen before this save has changes outside the
	allowed fields. The transition guard alone does NOT cover this: a
	Published -> Published save passes version_transition_blocked, so without
	this check a frozen version's content could be silently rewritten."""
	if not version_is_frozen(before_status):
		return False
	return bool(set(changed_fieldnames) - set(allowed))


def assert_version_editable(version_name):
	"""Throw if the linked UCC Survey Version is frozen. Called by question
	records before they are created, modified or deleted."""
	if not version_name:
		return
	import frappe
	from frappe import _

	status = frappe.db.get_value("UCC Survey Version", version_name, "status")
	if status and version_is_frozen(status):
		frappe.throw(
			_("Survey Version {0} is {1} and cannot be modified.").format(version_name, status)
		)


def assert_doc_version_editable(doc):
	"""Version guard for records that belong to a survey version (questions).
	Checks the CURRENT version, and — when the record is being re-parented —
	the PREVIOUS version too, so a record cannot be moved out of a frozen
	version (the old guard only checked the destination).

	Presentation-only edits are exempt (decision 2026-07-28): a published survey
	whose layout reads badly on a phone would otherwise need a whole new version,
	which orphans the campaign already collecting against the published one.
	Content stays absolutely frozen - presentation_only_change() returns False
	the moment anything outside PRESENTATION_FIELDS differs."""
	before = doc.get_doc_before_save()
	if before and presentation_only_change(before, doc):
		return
	if before and correctable_only_change(before, doc):
		# Wording only. Allowed on a frozen version, but never silently: the
		# reason is what turns this from an edit into a correction, and Frappe's
		# own track_changes (already on for UCC Survey Question) records the rest.
		if not (doc.get("correction_reason") or "").strip():
			import frappe
			from frappe import _

			frappe.throw(
				_("Correcting the wording of a published question needs a reason. "
				  "The version history records who, when and what changed; this "
				  "records why - and it is shown wherever this question's results "
				  "are read.")
			)
		return
	assert_version_editable(doc.survey_version)
	if before and before.survey_version != doc.survey_version:
		assert_version_editable(before.survey_version)


def assert_frozen_content_unchanged(doc, before, fieldnames, label):
	"""Throw if a frozen version doc changed anything besides status.
	fieldnames: the content/identity fields to compare (strings compare safely)."""
	if not before or not version_is_frozen(before.status):
		return
	changed = [f for f in fieldnames if (doc.get(f) or None) != (before.get(f) or None)]
	if frozen_fields_blocked(before.status, changed):
		import frappe
		from frappe import _

		frappe.throw(
			_("{0} {1} is {2}; its content is frozen (changed: {3}).").format(
				label, doc.name, before.status, ", ".join(changed)
			)
		)
