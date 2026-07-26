#!/usr/bin/env python
"""Phase 1 probe: is there a STRUCTURAL response->question link (qn_no / idx /
section), independent of wording?

READ-ONLY. No insert, no save, no delete, no db.set_value anywhere in this file.

Run from the bench directory (NOT bench console - IPython has mangled piped
multi-line input twice on this project):

    cd ~/frappe-bench
    env/bin/python apps/ucc_measurement_outcomes/probe_qn_no.py ucc.local > probe_out.txt 2>&1

Then send probe_out.txt back.
"""

import re
import sys
from collections import Counter, defaultdict

import frappe

SITE = sys.argv[1] if len(sys.argv) > 1 else "ucc.local"
frappe.init(site=SITE)
frappe.connect()

DESIGN = "Survey Management Survey Question Design Childtable"
RESP_CT = "Survey Response List Childtable"


def head(t):
	print("\n" + "=" * 72 + f"\n{t}\n" + "=" * 72)


def norm(s):
	return re.sub(r"\s+", " ", (s or "").strip().lower())


def cols(doctype):
	"""Real columns, so this probe cannot die on a guessed fieldname."""
	return {c["Field"] for c in frappe.db.sql(f"DESC `tab{doctype}`", as_dict=True)}


# --- 1a: what is qn_no numbered against? ------------------------------------
head("1a. qn_no - what does it reference?")
for dt in ("Survey Tracking Benchmark Childtable", "Survey Management Benchmark Childtable"):
	try:
		c = cols(dt)
	except Exception as e:
		print(f"{dt}: NOT PRESENT ({e})")
		continue
	print(f"\n{dt} columns: {sorted(c)}")
	rows = frappe.db.sql(
		f"SELECT parent, parenttype, idx, qn_no FROM `tab{dt}` "
		f"WHERE qn_no IS NOT NULL AND qn_no != '' ORDER BY parent, idx LIMIT 40",
		as_dict=True)
	for r in rows[:20]:
		print(f"  {r.parenttype}/{r.parent} idx={r.idx} qn_no={r.qn_no!r}")
	# Is it always a comma-separated integer list, or is it free text?
	allv = frappe.db.sql(f"SELECT qn_no FROM `tab{dt}` WHERE qn_no IS NOT NULL AND qn_no != ''",
						 as_dict=True)
	clean = sum(1 for v in allv if re.fullmatch(r"\s*\d+(\s*,\s*\d+)*\s*", v.qn_no or ""))
	print(f"  {len(allv)} non-empty qn_no; {clean} are pure comma-separated integers, "
		  f"{len(allv) - clean} are NOT (free text creeps in)")
	mx = 0
	for v in allv:
		for n in re.findall(r"\d+", v.qn_no or ""):
			mx = max(mx, int(n))
	print(f"  highest number seen anywhere in qn_no: {mx}")

# Cross-reference qn_no against real question order for >=3 Survey Management records.
head("1a (cont). qn_no vs actual question order, 3+ Survey Management records")
sm_with_bench = frappe.db.sql(
	"""SELECT DISTINCT parent FROM `tabSurvey Management Benchmark Childtable`
	   WHERE qn_no IS NOT NULL AND qn_no != '' LIMIT 5""", as_dict=True)
for row in sm_with_bench:
	sm = row.parent
	qs = frappe.db.sql(
		f"SELECT idx, question FROM `tab{DESIGN}` WHERE parent=%s ORDER BY idx",
		sm, as_dict=True)
	bench = frappe.db.sql(
		"""SELECT idx, qn_no FROM `tabSurvey Management Benchmark Childtable`
		   WHERE parent=%s ORDER BY idx""", sm, as_dict=True)
	print(f"\n-- {sm}: {len(qs)} design questions, {len(bench)} benchmark rows")
	for b in bench[:6]:
		nums = [int(n) for n in re.findall(r"\d+", b.qn_no or "")]
		over = [n for n in nums if n > len(qs)]
		print(f"   qn_no={b.qn_no!r} -> max={max(nums) if nums else None} "
			  f"{'OUT OF RANGE ' + str(over) if over else 'in range'}")
	for q in qs[:8]:
		print(f"   design idx={q.idx}: {(q.question or '')[:70]!r}")

# --- 1b: any positional link on the response side? --------------------------
head("1b. Response side - is there ANY positional field?")
for dt in ("Survey Response", RESP_CT, "Survey Tracking List of Surveys Childtable"):
	try:
		print(f"\n{dt}: {sorted(cols(dt))}")
	except Exception as e:
		print(f"{dt}: NOT PRESENT ({e})")

print(f"\nCounts: Survey Response={frappe.db.count('Survey Response')} "
	  f"{RESP_CT}={frappe.db.count(RESP_CT)}")

# Does the child idx order reproduce a consistent question sequence?
# If responses were imported in question order, the SAME idx should carry the
# SAME question across submissions of the same survey. That is the test.
head("1b (cont). Does idx carry a stable question position?")
link_cols = cols("Survey Tracking List of Surveys Childtable")
print(f"link table columns: {sorted(link_cols)}")

# Group responses by (program, frequency) as a proxy for "same instrument run"
# when no explicit survey link exists on Survey Response.
sr_cols = cols("Survey Response")
group_expr = "COALESCE(program,'') , COALESCE(frequency,'')"
groups = frappe.db.sql(
	f"""SELECT COALESCE(program,'') AS program, COALESCE(frequency,'') AS frequency,
			   COUNT(*) AS n
		FROM `tabSurvey Response` GROUP BY {group_expr} ORDER BY n DESC LIMIT 8""",
	as_dict=True)
for g in groups:
	parents = frappe.db.sql(
		"""SELECT name FROM `tabSurvey Response`
		   WHERE COALESCE(program,'')=%s AND COALESCE(frequency,'')=%s LIMIT 300""",
		(g.program, g.frequency), as_dict=True)
	names = [p.name for p in parents]
	if len(names) < 2:
		continue
	ph = ",".join(["%s"] * len(names))
	rows = frappe.db.sql(
		f"SELECT parent, idx, question, category FROM `tab{RESP_CT}` "
		f"WHERE parent IN ({ph}) ORDER BY parent, idx", tuple(names), as_dict=True)
	by_idx = defaultdict(set)
	for r in rows:
		by_idx[r.idx].add(norm(r.question))
	if not by_idx:
		continue
	stable = sum(1 for v in by_idx.values() if len(v) == 1)
	print(f"\n  group program={g.program!r} freq={g.frequency!r} "
		  f"({len(names)} responses, {len(by_idx)} idx positions)")
	print(f"    idx positions holding exactly ONE distinct question: {stable}/{len(by_idx)}"
		  f"  -> {'idx IS positional' if stable == len(by_idx) else 'idx is NOT reliable'}")
	worst = sorted(by_idx.items(), key=lambda kv: -len(kv[1]))[:3]
	for idx, qset in worst:
		if len(qset) > 1:
			print(f"    idx={idx} holds {len(qset)} different questions, e.g. "
				  f"{[q[:50] for q in list(qset)[:3]]}")

# Does every response have the same number of rows? Ragged = positions shift.
head("1b (cont). Row-count consistency per response (ragged tables break position)")
counts = frappe.db.sql(
	f"SELECT parent, COUNT(*) n FROM `tab{RESP_CT}` GROUP BY parent", as_dict=True)
print(Counter(c.n for c in counts).most_common(15))
print(f"distinct row-counts across {len(counts)} responses: "
	  f"{len({c.n for c in counts})} (1 would mean perfectly rectangular)")

# --- 1c: is category more stable than question text? ------------------------
head("1c. category vs design sections")
cats = frappe.db.sql(f"SELECT category, COUNT(*) n FROM `tab{RESP_CT}` "
					 f"GROUP BY category ORDER BY n DESC", as_dict=True)
print(f"{len(cats)} distinct category values; after normalisation: "
	  f"{len({norm(c.category) for c in cats})}")
for c in cats[:15]:
	print(f"  n={c.n:5d} {(c.category or '')[:100]!r}")

design_cols = cols(DESIGN)
print(f"\n{DESIGN} columns: {sorted(design_cols)}")
section_col = next((c for c in ("section", "category", "section_name", "part")
					if c in design_cols), None)
print(f"section-like column on design table: {section_col!r}")
if section_col:
	dsec = frappe.db.sql(f"SELECT DISTINCT `{section_col}` s FROM `tab{DESIGN}`", as_dict=True)
	dn = {norm(r.s) for r in dsec if r.s}
	rn = {norm(c.category) for c in cats if c.category}
	print(f"design sections={len(dn)} response categories={len(rn)} "
		  f"exact-normalised overlap={len(dn & rn)}")
	print(f"  categories with NO design section match: {len(rn - dn)}")

# --- 1d: does position resolve the 44% that text could not? -----------------
head("1d. Would position resolve the text-unmatched questions?")
master = frappe.db.sql("SELECT question FROM `tabSurvey Question Item`", as_dict=True)
mset = {r.question for r in master if r.question}
mnorm = {norm(q) for q in mset}
rq = {r.question for r in frappe.db.sql(
	f"SELECT DISTINCT question FROM `tab{RESP_CT}`", as_dict=True) if r.question}
exact = {q for q in rq if q in mset}
loose = {q for q in rq - exact if norm(q) in mnorm}
unmatched = rq - exact - loose
print(f"distinct response questions={len(rq)} exact={len(exact)} "
	  f"normalised={len(loose)} UNMATCHED={len(unmatched)}")

# For the unmatched set: does it sit at an idx position that IS text-resolvable
# in other responses of the same group? That is the only way position rescues it.
rows = frappe.db.sql(
	f"SELECT parent, idx, question, category FROM `tab{RESP_CT}`", as_dict=True)
idx_to_matched = defaultdict(Counter)
for r in rows:
	if r.question in exact or norm(r.question) in mnorm:
		idx_to_matched[(norm(r.category), r.idx)][norm(r.question)] += 1
rescued, ambiguous, orphan = 0, 0, 0
for r in rows:
	if r.question not in unmatched:
		continue
	cand = idx_to_matched.get((norm(r.category), r.idx))
	if not cand:
		orphan += 1
	elif len(cand) == 1:
		rescued += 1
	else:
		ambiguous += 1
total_unmatched_rows = sum(1 for r in rows if r.question in unmatched)
print(f"\nunmatched ROWS={total_unmatched_rows} of {len(rows)} total")
print(f"  rescued by (category, idx) landing on exactly one known question: {rescued}")
print(f"  ambiguous (position maps to >1 question): {ambiguous}")
print(f"  orphan (no matched question ever seen at that position): {orphan}")
print(f"\n  => position rescues {rescued}/{total_unmatched_rows} unmatched rows "
	  f"({100.0 * rescued / total_unmatched_rows if total_unmatched_rows else 0:.1f}%)")

# --- scoreability threshold input (Phase 2 needs these raw numbers) ---------
head("Scoreability inputs")
resp_vals = Counter(norm(r.response) for r in frappe.db.sql(
	f"SELECT response FROM `tab{RESP_CT}`", as_dict=True))
numericish = sum(n for v, n in resp_vals.items()
				 if re.fullmatch(r"-?\d+(\.\d+)?", v or ""))
likertish = sum(n for v, n in resp_vals.items()
				if re.match(r"^\d+\s*[-–]\s*\w", v or ""))
print(f"total response rows={sum(resp_vals.values())}")
print(f"  bare numeric: {numericish}")
print(f"  'N - Label' form: {likertish}")
print(f"  distinct response values: {len(resp_vals)}")
for v, n in resp_vals.most_common(40):
	print(f"    n={n:5d} {v[:70]!r}")

qi_cols = cols("Survey Question Item")
print(f"\nSurvey Question Item columns: {sorted(qi_cols)}")
if "objective" in qi_cols:
	tot = frappe.db.count("Survey Question Item")
	with_obj = frappe.db.sql("SELECT COUNT(*) c FROM `tabSurvey Question Item` "
							 "WHERE objective IS NOT NULL AND objective != ''")[0][0]
	print(f"Survey Question Item: {tot} rows, {with_obj} with objective")

frappe.destroy()
print("\nprobe complete - nothing was written")
