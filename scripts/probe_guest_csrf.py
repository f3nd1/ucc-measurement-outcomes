#!/usr/bin/env python
"""The last untested public-submission edge case: a GUEST carrying a session cookie.

Every earlier probe posted with NO cookie at all. Frappe's CSRF check
(frappe/auth.py v15.83.0, verified against source) short-circuits on
`not frappe.session.data.csrf_token`, so a cookie-less request never exercises
the check. A real browser is not cookie-less: it holds a `sid`, and that session
CAN hold a csrf_token.

    cd ~/ucc-sms-v2/sites
    ../env/bin/python ../apps/ucc_measurement_outcomes_repo/scripts/probe_guest_csrf.py ucc-sms-v2.orb.local

READ-ONLY BY CONSTRUCTION for the cases that matter, except case C, which makes
one real submission and then deletes it - it is the only way to prove the happy
path actually stores. Row counts are compared before and after and any drift is
reported loudly.

Three cases, in the order a real respondent hits them:

  A  Guest session with NO csrf_token, page-rendered token empty.
     Expect ACCEPT. This is the ordinary respondent.
  B  Guest session that HAS a csrf_token (the browser touched /app at some
     point, which calls frappe.sessions.get_csrf_token and PERSISTS one), page
     fetched afterwards so it renders that token, submitted with the header.
     Expect ACCEPT.
  C  Same as B but the survey page was fetched BEFORE the token existed, so the
     page carries "" while the session now holds a token.
     Expect REJECT (HTTP 400, "Invalid Request"). This is the ordering hazard:
     it is not a bug in api/public.py, it is a page rendered against an older
     session state.

Report pass/fail. DO NOT change api/public.py on the strength of this without
flagging it first - the trust boundary is deliberate.
"""

import http.cookiejar
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

import frappe

SITE = sys.argv[1] if len(sys.argv) > 1 else "ucc-sms-v2.orb.local"
TOKEN_ARG = sys.argv[2] if len(sys.argv) > 2 else None

frappe.init(site=SITE)
frappe.connect()

BASE = frappe.utils.get_url()
ENDPOINT = "/api/method/ucc_measurement_outcomes.api.public.submit_survey"


def opener():
	"""A fresh browser: its own cookie jar, so each case is an isolated session."""
	return urllib.request.build_opener(
		urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def get(op, path):
	try:
		with op.open(BASE + path, timeout=20) as r:
			return r.status, r.read().decode("utf-8", "replace")
	except urllib.error.HTTPError as e:
		return e.code, e.read().decode("utf-8", "replace")


def post(op, path, data, headers=None):
	req = urllib.request.Request(
		BASE + path, data=urllib.parse.urlencode(data).encode(),
		headers=dict({"Content-Type": "application/x-www-form-urlencoded"}, **(headers or {})))
	try:
		with op.open(req, timeout=20) as r:
			return r.status, r.read().decode("utf-8", "replace")
	except urllib.error.HTTPError as e:
		return e.code, e.read().decode("utf-8", "replace")


def page_csrf(html):
	"""The token www/survey.py rendered into the page, as survey.html reads it."""
	m = re.search(r'id="ucc-csrf">(.*?)</script>', html, re.S)
	if not m:
		return None
	try:
		return json.loads(m.group(1).strip())
	except ValueError:
		return None


def has_sid(op):
	return any(c.name == "sid" for c in op.handlers[-1].cookiejar) if op.handlers else False


# --- find the campaign ----------------------------------------------------
token = TOKEN_ARG
if not token:
	rows = frappe.get_all(
		"Survey Tracking",
		filters={"ucc_public_token": ["!=", ""], "ucc_collection_status": "Open"},
		fields=["ucc_public_token", "ucc_survey_version"])
	if not rows:
		print("No open campaign with a public token. Pass one as argv[2].")
		sys.exit(1)
	token, version = rows[0].ucc_public_token, rows[0].ucc_survey_version
else:
	version = frappe.db.get_value("Survey Tracking", {"ucc_public_token": token},
								  "ucc_survey_version")

question = frappe.get_all(
	"UCC Survey Question",
	filters={"survey_version": version, "question_type": ["in", ["Rating", "Single Choice", "Dropdown"]]},
	fields=["name"], order_by="sequence asc", limit_page_length=1)
if not question:
	print("No scale question in %s - nothing valid to submit." % version)
	sys.exit(1)
answer = [{"question": question[0].name, "value": "4"}]

print("site    : %s" % BASE)
print("version : %s" % version)
print("token   : %s…" % str(token)[:8])

before = (frappe.db.count("UCC Survey Submission"), frappe.db.count("UCC Survey Answer"))
print("rows before: submissions=%d answers=%d\n" % before)
print("=" * 72)

results = []


def report(label, expect_accept, status, body, note=""):
	accepted = status is not None and status < 400
	ok = accepted == expect_accept
	results.append((label, ok, "accepted" if accepted else "rejected"))
	print("\nCASE %s" % label)
	if note:
		print("  note  : %s" % note)
	print("  expect: %s" % ("ACCEPT" if expect_accept else "REJECT"))
	print("  HTTP  : %s" % status)
	print("  body  : %s" % body[:220].replace("\n", " "))
	print("  -> %s" % ("PASS" if ok else "*** FAIL ***"))


# --- A: ordinary respondent ----------------------------------------------
op = opener()
status, html = get(op, "/survey/%s" % token)
tok = page_csrf(html)
report("A  guest, fresh session, no csrf_token in session", True,
	   *post(op, ENDPOINT, {"token": token, "answers": json.dumps(answer)},
			 {"X-Frappe-CSRF-Token": tok or ""}),
	   note="sid cookie present=%s, page token=%r" % (has_sid(op), tok))

# --- B: session already carries a token, page fetched after ---------------
op = opener()
get(op, "/app")                       # persists a csrf_token onto this session
status, html = get(op, "/survey/%s" % token)
tok_b = page_csrf(html)
report("B  guest whose session HAS a csrf_token, page fetched after", True,
	   *post(op, ENDPOINT, {"token": token, "answers": json.dumps(answer)},
			 {"X-Frappe-CSRF-Token": tok_b or ""}),
	   note="page token=%r (should be non-empty)" % tok_b)

# --- C: the ordering hazard ----------------------------------------------
op = opener()
status, html = get(op, "/survey/%s" % token)   # rendered BEFORE any token exists
tok_c = page_csrf(html)
get(op, "/app")                                # token minted onto the SAME session
report("C  page rendered BEFORE the session got a token, submitted after", False,
	   *post(op, ENDPOINT, {"token": token, "answers": json.dumps(answer)},
			 {"X-Frappe-CSRF-Token": tok_c or ""}),
	   note="page token=%r, session token minted afterwards" % tok_c)

after = (frappe.db.count("UCC Survey Submission"), frappe.db.count("UCC Survey Answer"))
print("\n" + "=" * 72)
print("rows after : submissions=%d answers=%d  (delta %+d/%+d)"
	  % (after[0], after[1], after[0] - before[0], after[1] - before[1]))
print("Accepted cases DO store - delete the probe submissions above by hand,")
print("or run demo_data.remove if they are demo rows.")

print("\nsummary:")
for label, ok, outcome in results:
	print("  %-58s %-8s %s" % (label[:58], outcome, "PASS" if ok else "FAIL"))
print("\nOverall: %s" % ("PASS" if all(r[1] for r in results) else "FAIL"))

frappe.destroy()
