# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Re-pointing UCC Question Mapping.objective from UCC Objective to the real
Survey Objective register.

Frappe-free so it is tested without a bench (test_objective_migration.py) -
this decides what happens to every existing mapping row, which is the last place
to find out the rule was wrong.

THE JOIN KEY IS `objective_name`, NOT `name`. extraction.objective_code used to
slugify the source value ("Graduate Employability" -> GRADUATE-EMPLOYABILITY)
and store the slug as the UCC Objective docname, keeping the untouched original
in objective_name. So the docname cannot be matched against the register and
objective_name can. Getting this backwards reports every row as unresolvable.

Three outcomes, and only three:
  RELINK  - objective_name is a real Survey Objective. Rewrite the mapping.
  DROP    - a DEMO- seeded row. demo_data.py owns those and recreates them on
            demand, so deleting is cheap and leaving a dangling Link is not:
            Frappe's _validate_links() throws on the NEXT save of that row.
  REPORT  - anything else. Never guessed at, never deleted.
"""

RELINK = "relink"
DROP = "drop"
REPORT = "report"

DEMO_PREFIX = "DEMO-"


def plan_relink(objectives, register):
	"""{ucc_objective_docname: (action, target_or_reason)}.

	objectives: [{"name": ..., "objective_name": ...}] - every UCC Objective row.
	register:   Survey Objective docnames.
	"""
	known = set(register)
	out = {}
	for o in objectives:
		name = o["name"]
		label = (o.get("objective_name") or "").strip()
		if label in known:
			out[name] = (RELINK, label)
		elif name in known:
			# The one that already matched by docname: the slugifier is a no-op
			# on a docname that is already uppercase alphanumeric with hyphens,
			# so it round-tripped unchanged.
			out[name] = (RELINK, name)
		elif str(name).startswith(DEMO_PREFIX):
			out[name] = (DROP, "demo seed - demo_data.py recreates it")
		else:
			out[name] = (REPORT, "no Survey Objective named %r" % (label or name))
	return out


def summarise(plan):
	"""{action: [docnames]} - what the report prints and the patch acts on, from
	one source so they cannot describe different things."""
	out = {RELINK: [], DROP: [], REPORT: []}
	for name, (action, _detail) in sorted(plan.items()):
		out[action].append(name)
	return out
