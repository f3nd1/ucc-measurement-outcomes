# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Matching free text like "Academic Affairs" to a real Department docname.

Frappe-free so it can be unit-tested without a bench (test_department_match.py),
which is the whole reason this is not written inline in the patch: a data
migration that rewrites a column is the last place to find out the matching rule
was wrong.

WHY THIS IS NOT A ONE-LINER. ERPNext's Department does not name itself after its
department_name. Its autoname is:

    self.name = get_abbreviated_name(self.department_name, self.company)
    #           -> f"{department_name} - {company_abbr}"

(erpnext/setup/doctype/department/department.py, version-15, verified against
source rather than assumed). So a survey whose owner_department reads
"Academic Affairs" matches a Department whose DOCNAME is "Academic Affairs - UCC"
and whose department_name is "Academic Affairs". A naive
`exists("Department", value)` would find nothing and report every existing value
as unmatched.

AMBIGUITY IS NOT RESOLVED, IT IS REPORTED. Two companies can each have an
"Academic Affairs", giving two docnames for one typed string. Picking one is a
coin flip on which company's reporting a survey lands in, so those come back as
unmatched with their candidates attached, for a human.
"""


def _key(value):
	"""Case- and whitespace-insensitive. "  academic affairs " matches
	"Academic Affairs" — the typed values are free text and were never
	constrained, so they will not be clean."""
	return " ".join((value or "").split()).casefold()


def match_department(value, departments):
	"""(docname, reason) for one free-text value.

	`departments` is [{"name": …, "department_name": …}] — whatever
	frappe.get_all("Department", …) returned, passed in rather than fetched so
	this stays testable.

	Returns (None, reason) when it will not guess. Reasons are for the migration
	report, so they name what a human has to do.
	"""
	if not _key(value):
		return None, "empty"

	# 1. Already a real docname. The idempotent case: re-running the patch after
	#    it has done its work must change nothing.
	for d in departments:
		if d["name"] == value:
			return d["name"], "exact docname"

	# 2. Same, but tolerant of case and spacing.
	hits = [d for d in departments if _key(d["name"]) == _key(value)]
	if len(hits) == 1:
		return hits[0]["name"], "docname, normalised"

	# 3. The expected case: the typed text is the department_name and the
	#    docname carries a company abbreviation the user never typed.
	hits = [d for d in departments if _key(d.get("department_name")) == _key(value)]
	if len(hits) == 1:
		return hits[0]["name"], "department_name"
	if len(hits) > 1:
		return None, "ambiguous: " + ", ".join(sorted(d["name"] for d in hits))

	return None, "no Department matches"


def plan(values, departments):
	"""{value: (docname_or_None, reason)} for a whole column, deduplicated.

	The patch writes from this and the report prints it, so what is reported and
	what is written cannot drift apart.
	"""
	return {v: match_department(v, departments) for v in dict.fromkeys(values) if v}
