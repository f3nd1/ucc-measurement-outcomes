#!/usr/bin/env python
"""Phase 1 probe: is there a STRUCTURAL response->question link (qn_no / idx /
section), independent of wording?

READ-ONLY. No insert, no save, no delete, no db.set_value anywhere in this file.

Run from the site directory, NOT bench console (IPython has mangled piped
multi-line input twice on this project):

    cd ~/ucc-sms-v2/sites
    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/probe_qn_no.py ucc-sms-v2.orb.local > probe_out.txt 2>&1

Then send probe_out.txt back.

v2: every column name is resolved from DESC via pick() before use - v1 declared
a cols() guard and then hardcoded `question` anyway, which is what crashed it on
Survey Management Survey Question Design Childtable (the column is more likely
survey_question). Each section is also isolated, so one bad assumption reports
itself and the remaining sections still run.
"""

import re
import sys
import traceback
from collections import Counter, defaultdict

import frappe

SITE = sys.argv[1] if len(sys.argv) > 1 else "ucc.local"
frappe.init(site=SITE)
frappe.connect()

DESIGN = "Survey Management Survey Question Design Childtable"
RESP_CT = "Survey Response List Childtable"
QITEM = "Survey Question Item"
TRACK_BENCH = "Survey Tracking Benchmark Childtable"
MGMT_BENCH = "Survey Management Benchmark Childtable"

_COLCACHE = {}


def head(t):
	print("\n" + "=" * 72 + f"\n{t}\n" + "=" * 72)


def norm(s):
	return re.sub(r"\s+", " ", (s or "").strip().lower())


def cols(doctype):
	if doctype not in _COLCACHE:
		_COLCACHE[doctype] = {c["Field"] for c in
							  frappe.db.sql(f"DESC `tab{doctype}`", as_dict=True)}
	return _COLCACHE[doctype]


def pick(doctype, *candidates):
	"""First candidate column that actually exists. Raises naming the real
	columns rather than letting MySQL fail on a guess."""
	have = cols(doctype)
	for c in candidates:
		if c in have:
			return c
	raise KeyError(f"{doctype}: none of {candidates} exist. Columns: {sorted(have)}")


def section(title, fn):
	head(title)
	try:
		fn()
	except Exception:
		print("!! SECTION FAILED - continuing so the rest still runs:")
		traceback.print_exc(file=sys.stdout)


# Resolve everything up front so the mapping is visible in the output and a bad
# guess is a printed error, not a crash 70 lines later.
head("Resolved column names")
RESOLVED = {}
for key, dt, cands in (
	("design_q", DESIGN, ("survey_question", "question", "question_text", "questions")),
	("design_sec", DESIGN, ("category", "section", "section_name", "part", "objective")),
	("resp_q", RESP_CT, ("question", "survey_question", "question_text")),
	("resp_cat", RESP_CT, ("category", "section")),
	("resp_val", RESP_CT, ("response", "answer", "value")),
	("qitem_q", QITEM, ("question", "survey_question", "question_text")),
	("qitem_obj", QITEM, ("objective", "survey_objective", "objective_id")),
	("sr_prog", "Survey Response", ("program", "course", "programme")),
	("sr_freq", "Survey Response", ("frequency", "period", "posting_date")),
):
	try:
		RESOLVED[key] = pick(dt, *cands)
		print(f"  {key:12s} {dt} -> {RESOLVED[key]!r}")
	except Exception as e:
		RESOLVED[key] = None
		print(f"  {key:12s} UNRESOLVED: {e}")

for dt in (DESIGN, RESP_CT, QITEM, "Survey Response", TRACK_BENCH, MGMT_BENCH,
		   "Survey Tracking List of Surveys Childtable"):
	try:
		print(f"\n{dt}:\n  {sorted(cols(dt))}")
	except Exception as e:
		print(f"\n{dt}: NOT PRESENT ({e})")


# --- 1a: what is qn_no numbered against? ------------------------------------
def s1a():
	for dt in (TRACK_BENCH, MGMT_BENCH):
		try:
			qn = pick(dt, "qn_no", "question_no", "qn")
		except Exception as e:
			print(f"{dt}: {e}")
			continue
		rows = frappe.db.sql(
			f"SELECT parent, parenttype, idx, `{qn}` AS qn_no FROM `tab{dt}` "
			f"WHERE `{qn}` IS NOT NULL AND `{qn}` != '' ORDER BY parent, idx LIMIT 40",
			as_dict=True)
		print(f"\n{dt} ({qn}):")
		for r in rows[:20]:
			print(f"  {r.parenttype}/{r.parent} idx={r.idx} qn_no={r.qn_no!r}")
		allv = frappe.db.sql(
			f"SELECT parent, `{qn}` AS qn_no FROM `tab{dt}` "
			f"WHERE `{qn}` IS NOT NULL AND `{qn}` != ''", as_dict=True)
		clean = sum(1 for v in allv
					if re.fullmatch(r"\s*\d+(\s*,\s*\d+)*\s*", v.qn_no or ""))
		print(f"  {len(allv)} non-empty; {clean} pure comma-separated integers, "
			  f"{len(allv) - clean} NOT (free text)")
		mx = max((int(n) for v in allv for n in re.findall(r"\d+", v.qn_no or "")),
				 default=0)
		print(f"  highest number anywhere: {mx}")
		# Reused template vs per-survey position: how many DISTINCT sequences?
		seqs = Counter(norm(v.qn_no) for v in allv)
		print(f"  distinct qn_no strings: {len(seqs)} across {len(allv)} rows")
		print(f"  rows whose sequence is shared with another row: "
			  f"{sum(n for s, n in seqs.items() if n > 1)}")
		for s, n in seqs.most_common(8):
			print(f"    x{n:3d} {s[:70]!r}")


def s1a2():
	"""qn_no vs the real question order, several Survey Management records."""
	dq = RESOLVED["design_q"]
	if not dq:
		print("design question column unresolved - cannot cross-reference")
		return
	qn = pick(MGMT_BENCH, "qn_no", "question_no", "qn")
	parents = frappe.db.sql(
		f"""SELECT DISTINCT parent FROM `tab{MGMT_BENCH}`
			WHERE `{qn}` IS NOT NULL AND `{qn}` != '' LIMIT 6""", as_dict=True)
	for row in parents:
		sm = row.parent
		qs = frappe.db.sql(
			f"SELECT idx, `{dq}` AS q FROM `tab{DESIGN}` WHERE parent=%s ORDER BY idx",
			sm, as_dict=True)
		bench = frappe.db.sql(
			f"SELECT idx, `{qn}` AS qn_no FROM `tab{MGMT_BENCH}` WHERE parent=%s ORDER BY idx",
			sm, as_dict=True)
		print(f"\n-- {sm}: {len(qs)} design questions, {len(bench)} benchmark rows")
		for b in bench[:6]:
			nums = [int(n) for n in re.findall(r"\d+", b.qn_no or "")]
			over = [n for n in nums if n > len(qs)]
			print(f"   qn_no={b.qn_no!r} max={max(nums) if nums else None} "
				  f"{'OUT OF RANGE ' + str(over) if over else 'in range'}")
		for q in qs[:8]:
			print(f"   design idx={q.idx}: {(q.q or '')[:70]!r}")


# --- 1b: any positional link on the response side? --------------------------
def s1b():
	rq, rc = RESOLVED["resp_q"], RESOLVED["resp_cat"]
	print(f"Counts: Survey Response={frappe.db.count('Survey Response')} "
		  f"{RESP_CT}={frappe.db.count(RESP_CT)}")
	if not rq:
		print("response question column unresolved - cannot test idx")
		return
	prog, freq = RESOLVED["sr_prog"], RESOLVED["sr_freq"]
	if not (prog and freq):
		print("cannot group responses - program/frequency unresolved")
		return
	groups = frappe.db.sql(
		f"""SELECT COALESCE(`{prog}`,'') AS a, COALESCE(`{freq}`,'') AS b, COUNT(*) n
			FROM `tabSurvey Response` GROUP BY 1,2 ORDER BY n DESC LIMIT 8""",
		as_dict=True)
	catsel = f"`{rc}`" if rc else "''"
	for g in groups:
		names = [p.name for p in frappe.db.sql(
			f"""SELECT name FROM `tabSurvey Response`
				WHERE COALESCE(`{prog}`,'')=%s AND COALESCE(`{freq}`,'')=%s LIMIT 300""",
			(g.a, g.b), as_dict=True)]
		if len(names) < 2:
			continue
		ph = ",".join(["%s"] * len(names))
		rows = frappe.db.sql(
			f"SELECT parent, idx, `{rq}` AS q, {catsel} AS cat FROM `tab{RESP_CT}` "
			f"WHERE parent IN ({ph}) ORDER BY parent, idx", tuple(names), as_dict=True)
		by_idx = defaultdict(set)
		for r in rows:
			by_idx[r.idx].add(norm(r.q))
		if not by_idx:
			continue
		stable = sum(1 for v in by_idx.values() if len(v) == 1)
		print(f"\n  group {g.a!r}/{g.b!r} ({len(names)} responses, {len(by_idx)} idx positions)")
		print(f"    idx positions holding exactly ONE distinct question: "
			  f"{stable}/{len(by_idx)} -> "
			  f"{'idx IS positional' if stable == len(by_idx) else 'idx is NOT reliable'}")
		for idx, qset in sorted(by_idx.items(), key=lambda kv: -len(kv[1]))[:3]:
			if len(qset) > 1:
				print(f"    idx={idx} holds {len(qset)} different questions: "
					  f"{[q[:50] for q in list(qset)[:3]]}")


def s1b2():
	"""Ragged child tables shift every position below the gap."""
	counts = frappe.db.sql(
		f"SELECT parent, COUNT(*) n FROM `tab{RESP_CT}` GROUP BY parent", as_dict=True)
	print(Counter(c.n for c in counts).most_common(15))
	print(f"distinct row-counts across {len(counts)} responses: "
		  f"{len({c.n for c in counts})} (1 = perfectly rectangular)")


# --- 1c: is category more stable than question text? ------------------------
def s1c():
	rc, ds = RESOLVED["resp_cat"], RESOLVED["design_sec"]
	if not rc:
		print("response category column unresolved")
		return
	cats = frappe.db.sql(
		f"SELECT `{rc}` AS cat, COUNT(*) n FROM `tab{RESP_CT}` GROUP BY 1 ORDER BY n DESC",
		as_dict=True)
	print(f"{len(cats)} distinct category values; normalised: "
		  f"{len({norm(c.cat) for c in cats})}")
	for c in cats[:15]:
		print(f"  n={c.n:5d} {(c.cat or '')[:100]!r}")
	if not ds:
		print("no section-like column on the design table")
		return
	dn = {norm(r.s) for r in frappe.db.sql(
		f"SELECT DISTINCT `{ds}` AS s FROM `tab{DESIGN}`", as_dict=True) if r.s}
	rn = {norm(c.cat) for c in cats if c.cat}
	print(f"\ndesign sections ({ds})={len(dn)} response categories={len(rn)} "
		  f"overlap={len(dn & rn)}  no-match={len(rn - dn)}")


# --- 1d: does position resolve what text could not? -------------------------
def s1d():
	rq, rc, qq = RESOLVED["resp_q"], RESOLVED["resp_cat"], RESOLVED["qitem_q"]
	if not (rq and qq):
		print("cannot run - response or question-item column unresolved")
		return
	mset = {r.q for r in frappe.db.sql(
		f"SELECT `{qq}` AS q FROM `tab{QITEM}`", as_dict=True) if r.q}
	mnorm = {norm(q) for q in mset}
	catsel = f"`{rc}`" if rc else "''"
	rows = frappe.db.sql(
		f"SELECT parent, idx, `{rq}` AS q, {catsel} AS cat FROM `tab{RESP_CT}`",
		as_dict=True)
	rqs = {r.q for r in rows if r.q}
	exact = {q for q in rqs if q in mset}
	loose = {q for q in rqs - exact if norm(q) in mnorm}
	unmatched = rqs - exact - loose
	print(f"distinct response questions={len(rqs)} exact={len(exact)} "
		  f"normalised={len(loose)} UNMATCHED={len(unmatched)}")

	idx_to_matched = defaultdict(Counter)
	for r in rows:
		if r.q in exact or norm(r.q) in mnorm:
			idx_to_matched[(norm(r.cat), r.idx)][norm(r.q)] += 1
	rescued = ambiguous = orphan = 0
	for r in rows:
		if r.q not in unmatched:
			continue
		cand = idx_to_matched.get((norm(r.cat), r.idx))
		if not cand:
			orphan += 1
		elif len(cand) == 1:
			rescued += 1
		else:
			ambiguous += 1
	tot = rescued + ambiguous + orphan
	print(f"\nunmatched ROWS={tot} of {len(rows)} total")
	print(f"  rescued  ((category, idx) -> exactly one known question): {rescued}")
	print(f"  ambiguous (position maps to >1 question - SILENT MIS-SCORE RISK): {ambiguous}")
	print(f"  orphan   (no known question ever seen at that position): {orphan}")
	print(f"\n  => position rescues {rescued}/{tot} "
		  f"({100.0 * rescued / tot if tot else 0:.1f}%) of unmatched rows")


# --- scoreability inputs ----------------------------------------------------
def s_score():
	rv = RESOLVED["resp_val"]
	if not rv:
		print("response value column unresolved")
		return
	vals = Counter(norm(r.v) for r in frappe.db.sql(
		f"SELECT `{rv}` AS v FROM `tab{RESP_CT}`", as_dict=True))
	num = sum(n for v, n in vals.items() if re.fullmatch(r"-?\d+(\.\d+)?", v or ""))
	lik = sum(n for v, n in vals.items() if re.match(r"^\d+\s*[-–]\s*\w", v or ""))
	print(f"total response rows={sum(vals.values())}, distinct values={len(vals)}")
	print(f"  bare numeric rows: {num}")
	print(f"  'N - Label' rows:  {lik}")
	for v, n in vals.most_common(40):
		print(f"    n={n:5d} {v[:70]!r}")

	qo = RESOLVED["qitem_obj"]
	if qo:
		tot = frappe.db.count(QITEM)
		with_obj = frappe.db.sql(
			f"SELECT COUNT(*) FROM `tab{QITEM}` WHERE `{qo}` IS NOT NULL AND `{qo}` != ''")[0][0]
		print(f"\n{QITEM}: {tot} rows, {with_obj} with {qo}")
		dupes = frappe.db.sql(
			f"""SELECT parent, COUNT(DISTINCT `{qo}`) c FROM `tab{QITEM}`
				WHERE `{qo}` IS NOT NULL AND `{qo}` != '' GROUP BY parent HAVING c > 1""",
			as_dict=True)
		print(f"  parents with >1 distinct {qo}: {len(dupes)}")


section("1a. qn_no - what does it reference?", s1a)
section("1a (cont). qn_no vs actual question order", s1a2)
section("1b. Response side - does idx carry a stable question position?", s1b)
section("1b (cont). Row-count consistency (ragged tables break position)", s1b2)
section("1c. category vs design sections", s1c)
section("1d. Would position resolve the text-unmatched questions?", s1d)
section("Scoreability inputs", s_score)

frappe.destroy()
print("\nprobe complete - nothing was written")
