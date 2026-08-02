#!/usr/bin/env python
"""Count existing UCC Survey Answer rows whose stored value the new submit-time
validation would have rejected.

READ-ONLY. No insert, no save, no delete, no db.set_value anywhere in this file.
This reports; it does not repair. Historical rows are evidence and stay as they
are — the new check is submit-time only.

Run from the site directory, NOT bench console (IPython has mangled piped
multi-line input twice on this project):

    cd ~/ucc-sms-v2/sites
    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/audit_answer_values.py ucc-sms-v2.orb.local

It uses submission_utils.value_allowed itself rather than hand-rolled SQL, so
the audit and the endpoint can never disagree about what "invalid" means.
"""

import json
import sys
from collections import Counter

import frappe

from ucc_measurement_outcomes.submission_utils import value_allowed

SITE = sys.argv[1] if len(sys.argv) > 1 else "ucc.local"
frappe.init(site=SITE)
frappe.connect()

LIST_TYPES = {"Multiple Choice", "Ranking"}
DICT_TYPES = {"Likert Matrix", "Multiple Choice Grid", "Checkbox Grid"}


def decode(question_type, text):
	"""Undo to_text() for the types stored as JSON. A row that should hold JSON
	but does not is left as the raw string — value_allowed then reports it as the
	wrong shape, which is exactly what it is."""
	if text and question_type in LIST_TYPES | DICT_TYPES:
		try:
			return json.loads(text)
		except ValueError:
			pass
	return text


questions = {
	q.name: q
	for q in frappe.get_all(
		"UCC Survey Question",
		fields=["name", "question_type", "matrix_rows", "question_text"],
	)
}
choices = {name: [] for name in questions}
for c in frappe.get_all(
	"UCC Survey Question Choice",
	filters={"parenttype": "UCC Survey Question"},
	fields=["parent", "choice_label", "choice_value"],
	order_by="parent asc, idx asc",
):
	if c.parent in choices:
		choices[c.parent].append(c)

rows = frappe.get_all(
	"UCC Survey Answer",
	fields=["name", "question", "question_type", "answer_value"],
	limit_page_length=0,
)

by_reason = Counter()
by_type = Counter()
examples = {}
orphans = 0

for r in rows:
	q = questions.get(r.question)
	if not q:
		orphans += 1
		continue
	# The Answer row carries its own question_type snapshot; prefer it, since
	# that is the type the answer was actually captured under.
	qtype = r.question_type or q.question_type
	reason = value_allowed(
		qtype, decode(qtype, r.answer_value), choices.get(r.question), q.matrix_rows
	)
	if reason:
		by_reason[reason] += 1
		by_type[qtype] += 1
		examples.setdefault(
			(qtype, reason), (r.name, (r.answer_value or "")[:60], q.question_text)
		)

print("UCC Survey Answer rows scanned: %d" % len(rows))
print("rows whose question no longer exists (not checked): %d" % orphans)
print("rows the new validation would reject: %d" % sum(by_reason.values()))
if by_reason:
	print("\nby reason:")
	for reason, n in by_reason.most_common():
		print("  %5d  %s" % (n, reason))
	print("\nby question type:")
	for qtype, n in by_type.most_common():
		print("  %5d  %s" % (n, qtype))
	print("\none example each:")
	for (qtype, reason), (name, value, text) in sorted(examples.items()):
		print("  %s / %s" % (qtype, reason))
		print("    %s  value=%r" % (name, value))
		print("    question: %s" % (text or "")[:90])

frappe.destroy()
