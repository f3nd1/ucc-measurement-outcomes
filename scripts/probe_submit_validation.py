#!/usr/bin/env python
"""Live proof that submit-time answer validation rejects crafted values.

Sends REAL HTTP POSTs to submit_survey, bypassing the browser entirely - the
browser widgets cannot produce these values, which is the whole point.

Safety: every payload here is expected to be REJECTED, so nothing should be
written. The script counts UCC Survey Submission and UCC Survey Answer rows
before and after and fails loudly if either moved. If a case is NOT rejected,
that IS the finding - and the row it created is reported, not hidden.

Run from the bench directory:

    cd ~/frappe-bench
    env/bin/python apps/ucc_measurement_outcomes/scripts/probe_submit_validation.py ucc.local

Pass a token explicitly if the site has more than one open campaign:

    env/bin/python apps/.../probe_submit_validation.py ucc.local <public_token>
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

import frappe

SITE = sys.argv[1] if len(sys.argv) > 1 else "ucc.local"
TOKEN_ARG = sys.argv[2] if len(sys.argv) > 2 else None

frappe.init(site=SITE)
frappe.connect()

ENDPOINT = "/api/method/ucc_measurement_outcomes.api.public.submit_survey"


def counts():
	return (
		frappe.db.count("UCC Survey Submission"),
		frappe.db.count("UCC Survey Answer"),
	)


def post(token, answers):
	"""One form-encoded POST, exactly as the public page sends it.

	No cookie, so the session carries no saved csrf_token and Frappe's CSRF check
	returns early - the same reason a fresh guest can submit at all.
	"""
	body = urllib.parse.urlencode({"token": token, "answers": json.dumps(answers)}).encode()
	req = urllib.request.Request(
		frappe.utils.get_url() + ENDPOINT, data=body,
		headers={"Content-Type": "application/x-www-form-urlencoded"},
	)
	try:
		with urllib.request.urlopen(req, timeout=20) as r:
			return r.status, r.read().decode("utf-8", "replace")
	except urllib.error.HTTPError as e:
		return e.code, e.read().decode("utf-8", "replace")
	except Exception as e:  # connection refused, DNS, TLS...
		return None, "%s: %s" % (type(e).__name__, e)


def message(raw):
	"""Pull the human message out of Frappe's error envelope."""
	try:
		payload = json.loads(raw)
	except ValueError:
		return raw[:300]
	msgs = payload.get("_server_messages")
	if msgs:
		try:
			return " | ".join(json.loads(m).get("message", str(m)) for m in json.loads(msgs))
		except Exception:
			return str(msgs)[:300]
	return json.dumps(payload)[:300]


# --- find an open campaign -----------------------------------------------
token = TOKEN_ARG
if not token:
	rows = frappe.get_all(
		"Survey Tracking",
		filters={"ucc_public_token": ["!=", ""], "ucc_collection_status": "Open"},
		fields=["name", "ucc_public_token", "ucc_survey_version"],
	)
	if not rows:
		print("No Survey Tracking row has both a public token and ucc_collection_status = Open.")
		print("Nothing to POST to. Open a campaign (or pass its token as argv[2]) and re-run.")
		sys.exit(1)
	if len(rows) > 1:
		print("More than one open campaign; using the first. Pass a token to choose:")
		for r in rows:
			print("   %s  version=%s" % (r.name, r.ucc_survey_version))
	token = rows[0].ucc_public_token
	version = rows[0].ucc_survey_version
else:
	version = frappe.db.get_value("Survey Tracking", {"ucc_public_token": token}, "ucc_survey_version")

print("site      : %s" % frappe.utils.get_url())
print("version   : %s" % version)
print("token     : %s…" % str(token)[:8])

questions = frappe.get_all(
	"UCC Survey Question",
	filters={"survey_version": version},
	fields=["name", "question_type", "question_text"],
	order_by="sequence asc",
)
by_type = {}
for q in questions:
	by_type.setdefault(q.question_type, q)
print("questions : %d (%s)" % (len(questions), ", ".join(sorted(by_type))))


def choice_values(qname):
	out = []
	for c in frappe.get_all(
		"UCC Survey Question Choice",
		filters={"parent": qname, "parenttype": "UCC Survey Question"},
		fields=["choice_label", "choice_value"], order_by="idx asc",
	):
		out.append(c.choice_value or c.choice_label)
	return out


# --- the four crafted cases ----------------------------------------------
# Each is (title, question-type it needs, value). A scale question is any
# choice-driven type; the demo survey is all Rating, so those land on Rating.
SCALE = ["Rating", "Single Choice", "Dropdown", "Likert Matrix"]


def pick(types):
	for t in types:
		if t in by_type:
			return by_type[t]
	return None


cases = []
scale_q = pick(SCALE)
if scale_q:
	allowed = choice_values(scale_q.name)
	cases.append(("out-of-range Likert value (999)", scale_q, "999",
				  "configured choices: %s" % allowed))
	cases.append(("choice value not in the configured choices", scale_q, "Strongly Agree Forever",
				  "configured choices: %s" % allowed))
	cases.append(("dict where a scalar is expected", scale_q, {"row_0": "1"},
				  "a grid-shaped answer sent to a single-value question"))
else:
	print("\n!! No choice-driven question in this version - three of the four cases cannot run.")

nps_q = pick(["NPS"])
if nps_q:
	cases.append(("NPS value of 47", nps_q, "47", "NPS is a fixed 0-10 scale"))
else:
	print("\n!! No NPS question in this version, so 'NPS 47' cannot be sent as an NPS answer.")
	print("   Add one in the Survey Builder (it is in the type list) and re-run,")
	print("   or read the out-of-range Rating case as the equivalent proof.")

before = counts()
print("\nrows before: submissions=%d answers=%d" % before)
print("=" * 72)

results = []
for title, q, value, note in cases:
	status, raw = post(token, [{"question": q.name, "value": value}])
	msg = message(raw)
	rejected = status is not None and status >= 400
	results.append((title, rejected))
	print("\nCASE  : %s" % title)
	print("  q   : %s (%s)" % (q.question_text[:60], q.question_type))
	print("  note: %s" % note)
	print("  sent: %r" % (value,))
	print("  HTTP: %s" % status)
	print("  body: %s" % msg)
	print("  -> %s" % ("REJECTED" if rejected else "*** ACCEPTED - THIS IS A BUG ***"))

after = counts()
print("\n" + "=" * 72)
print("rows after : submissions=%d answers=%d" % after)
if after == before:
	print("nothing was stored - correct")
else:
	print("*** ROWS CHANGED: submissions %+d answers %+d - something was accepted ***"
		  % (after[0] - before[0], after[1] - before[1]))

print("\nsummary:")
for title, rejected in results:
	print("  %-46s %s" % (title, "rejected" if rejected else "ACCEPTED (bug)"))
if not cases:
	print("  (no cases could be run against this version)")

frappe.destroy()
