# Install + Screenshot Runbook (bench-connected session)

Purpose: install `ucc_measurement_outcomes` on a **dev/staging** site, seed enough
demo data that every workspace renders something meaningful, and capture the six
screenshots. Written to be run from a session that can reach the OrbStack bench
(Claude Code CLI on the host, or Felix directly) — it does **not** work from a
remote/code-only container.

Throughout, replace `<site>` with your dev site (e.g. `ucc.localhost`) and
`<url>` with its base URL (e.g. `http://ucc.localhost:8000`). **Never run this
against a live site.**

---

## Part A — Preconditions (read-only discovery first)

```bash
bench version                      # confirm Frappe/ERPNext major version
bench --site <site> list-apps      # is ucc_measurement_outcomes already installed?
```

- If the app is **already installed**, skip Part B, go to Part C.
- Confirm `<site>` is dev/staging, not production.
- This runbook assumes the repo is checked out on the bench host. If not:
  `git clone <repo>` somewhere reachable and use that path in Part B.

---

## Part B — Install

The app lives in a subdirectory of the repo (`frappe-app/ucc_measurement_outcomes`),
not the repo root, so `get-app` needs that path.

```bash
# from the frappe-bench directory
bench get-app /path/to/ucc-measurement-outcomes/frappe-app/ucc_measurement_outcomes
# If your bench version rejects a bare path, use the explicit form:
#   bench get-app ucc_measurement_outcomes /path/to/.../frappe-app/ucc_measurement_outcomes
# Verify it landed as an app: `ls apps/ucc_measurement_outcomes/` should show pyproject.toml.
bench --site <site> install-app ucc_measurement_outcomes
bench --site <site> migrate
bench build --app ucc_measurement_outcomes      # bundles the Desk page JS + shared components
bench --site <site> clear-cache
```

`qrcode` is a declared dependency (used by the Campaign QR button) — `get-app`
should pull it; if the QR button later errors, `./env/bin/pip install qrcode`.

**Before trusting anything, run the integration tests that have never executed:**

```bash
bench --site <site> run-tests --module ucc_measurement_outcomes.test_integration_chain
```

If these fail, screenshots may still work but note the failures — they are the
first real-bench signal for the whole app.

---

## Part C — Seed demo data

Empty Studios screenshot as broken. This drives the **real calculation chain**
(answer → metric → index → result) plus one deliberate coverage gap, so each page
has content. Paste the whole block into the console; it commits and prints the
URLs/token you need.

```bash
bench --site <site> console
```

```python
import frappe, json
from ucc_measurement_outcomes.metric_calc import calculate_metric_result
from ucc_measurement_outcomes.index_calc import calculate_index
from ucc_measurement_outcomes.api.index_studio import create_index_from_template

def q(version, qtype, text, seq, choices=None):
    doc = frappe.get_doc({
        "doctype": "UCC Survey Question", "survey_version": version,
        "question_type": qtype, "question_text": text, "sequence": seq,
        "choices": [{"choice_label": c[0], "choice_value": c[1], "sequence": i}
                    for i, c in enumerate(choices or [])],
    })
    return doc.insert().name

# 1) Survey + a draft version with varied question types
survey = frappe.get_doc({"doctype": "UCC Survey", "title": "Student Onboarding (Demo)",
                         "status": "Active"}).insert()
ver = frappe.get_doc({"doctype": "UCC Survey Version", "survey": survey.name,
                      "version_number": "01", "status": "Draft"}).insert()
likert = [("Strongly Agree", "5"), ("Agree", "4"), ("Neutral", "3"),
          ("Disagree", "2"), ("Strongly Disagree", "1")]
q(ver.name, "Section Heading", "Your onboarding experience", 0)
q1 = q(ver.name, "Rating", "The teacher explained concepts clearly.", 1, likert)
q2 = q(ver.name, "Rating", "Facilities met my needs.", 2, likert)   # left UNMAPPED (gap)
q(ver.name, "Yes / No", "Did you receive LMS access on time?", 3, [("Yes", "1"), ("No", "0")])
q(ver.name, "Dropdown", "Which programme are you in?", 4,
  [("Diploma in AI", ""), ("Diploma in Business", ""), ("English", "")])
q(ver.name, "Paragraph", "What should we improve?", 5)

# 2) Publish the version (freezes it)
ver.status = "Published"; ver.save()

# 3) Campaign + a few responses to q1 (so the metric has data)
camp = frappe.get_doc({"doctype": "UCC Survey Campaign", "campaign_name": "Demo Aug Intake",
                       "survey_version": ver.name, "status": "Open",
                       "target_responses": 10}).insert()
for val in ("5", "4", "3", "5"):
    sub = frappe.get_doc({"doctype": "UCC Survey Submission", "campaign": camp.name,
                          "survey_version": ver.name, "status": "Completed"}).insert()
    frappe.get_doc({"doctype": "UCC Survey Answer", "submission": sub.name,
                    "question": q1, "answer_value": val}).insert()

# 4) Mapping: objective + map q1 only (q2 stays an unmapped gap)
obj = frappe.get_doc({"doctype": "UCC Objective", "objective_code": "OBJ-DEMO-1",
                      "objective_name": "Teaching quality"}).insert()
frappe.get_doc({"doctype": "UCC Standard", "standard_code": "GD4",
                "standard_name": "GD4"}).insert(ignore_if_duplicate=True)
frappe.get_doc({"doctype": "UCC Question Mapping", "question": q1, "objective": obj.name,
                "standard": "GD4", "primary_clause": "GD4_5.2.2.2"}).insert()

# 5) Metric sourced from q1, then calculate it (answers -> normalised -> result)
frappe.get_doc({"doctype": "UCC Metric Definition", "metric_code": "TEACHING_CLARITY",
                "metric_name": "Teaching Clarity", "default_normalisation": "Likert 1-5 to 0-100",
                "sources": [{"source_type": "Survey Question", "source_question": q1,
                             "normalisation": "Likert 1-5 to 0-100"}]}).insert()
calculate_metric_result("TEACHING_CLARITY", entity_type="Programme", entity="Diploma in AI")

# 6) SEQI from template — for the Index Studio canvas screenshot (branded 6-dimension graph)
seqi = create_index_from_template("SEQI")   # stays Draft; canvas + weight indicator visible

# 7) A small working index that actually calculates, for Dashboard / Explorer / explain-score
frappe.get_doc({"doctype": "UCC Index Definition", "index_code": "DEMO",
                "index_name": "Demo Experience Index", "target": 75}).insert()
iv = frappe.get_doc({"doctype": "UCC Index Version", "index": "DEMO", "version_number": "01",
                     "status": "Draft", "nodes": [
    {"node_key": "root", "node_type": "Index", "label": "Demo Experience Index"},
    {"node_key": "tc", "node_type": "Metric", "label": "Teaching Clarity",
     "parent_key": "root", "weight": 100, "source_metric": "TEACHING_CLARITY"},
]}).insert()
iv.status = "Published"; iv.save()
calculate_index(iv.name, entity_type="Programme", entity="Diploma in AI")

frappe.db.commit()
print("PUBLIC TOKEN:", camp.public_token)
print("PUBLIC URL:  <url>/survey?token=%s" % camp.public_token)
print("SEQI draft version (Index Studio canvas):", seqi)
print("DEMO published version (has a result):", iv.name)
```

Optional — a shaped trend needs more than one period. After the block above:

```python
# extra prior-period results so Dashboard's trend line has shape (illustrative)
for period, value in [("2025 T3", 71.0), ("2025 T4", 79.0)]:
    frappe.get_doc({"doctype": "UCC Index Result", "index": "DEMO", "index_version": iv.name,
                    "period": period, "entity_type": "Programme", "entity": "Diploma in AI",
                    "value": value, "target": 75}).insert()
frappe.db.commit()
```

---

## Part D — Capture

All Studio pages are Desk pages at `/app/<page-name>`; the public survey is a
website route. Most Studios open with an empty picker — **you must select the
seeded record once** for data to appear (noted per page). Capture **full-page**
(not just viewport) at ~1440px width.

| # | File name | Route | Action to reach the state |
|---|---|---|---|
| 1 | `01-survey-studio-builder.png` | `/app/survey-builder` | Pick **Student Onboarding (Demo)-V01** in the version field; click a question (e.g. the Rating one) so the inspector opens. Palette + questions + inspector all visible. |
| 2 | `02-mapping-studio-canvas.png` | `/app/mapping-studio` | Pick the same version; the coverage panel shows the gap; click the **unmapped** question ("Facilities…") to render its red gap node on the canvas. |
| 3 | `03-index-studio-seqi-canvas.png` | `/app/index-studio` | Pick the **SEQI-V01** version; the 6-dimension graph renders; click **Validate** to show the weights-total indicator. |
| 4 | `04-index-studio-explain-score.png` | `/app/index-studio` or the result | Open the **DEMO** index's `UCC Index Result` (from the list, `/app/ucc-index-result`) to show the Score Breakdown rows (explain-score → source metric → value). |
| 5 | `05-dashboard-criterion7.png` | `/app/dashboard-studio` | Set the Index filter to **DEMO**; switch to the **Criterion 7** tab (overall outcomes, trend, weak areas). Capture a second shot on the **Overview** tab with the filter bar visible. |
| 6 | `06-data-explorer-pivot.png` | `/app/data-explorer` | Dataset **Index Results**, measure **Average Value**, rows **entity**; click **Run** to show the pivot table + chart. |
| 7 | `07-public-survey.png` | `<url>/survey?token=<token>` | No login. Shows the respondent form — the Rating question (scale) and the Paragraph (text input) are both in the first scroll. |

### Optional Playwright capture (login + full-page)

Chromium is pre-installed on the bench image (`/opt/pw-browsers`). This script
logs in with env-var credentials (never hard-code), captures the two routes that
need no picker interaction, and pauses for you to select records on the rest.

```bash
export UCC_URL="<url>"; export UCC_USER="you@dev"; export UCC_PW="…"   # dev creds only
```

```python
# save as shot.py; run with the bench python: ./env/bin/python shot.py
import os
from playwright.sync_api import sync_playwright

URL, USER, PW = os.environ["UCC_URL"], os.environ["UCC_USER"], os.environ["UCC_PW"]
os.makedirs("/tmp/ucc-screenshots", exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    # login
    pg.goto(f"{URL}/login"); pg.fill("#login_email", USER); pg.fill("#login_password", PW)
    pg.click("button.btn-login"); pg.wait_for_load_state("networkidle")

    def shot(route, name):
        pg.goto(f"{URL}{route}"); pg.wait_for_load_state("networkidle")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f"/tmp/ucc-screenshots/{name}", full_page=True)

    # Picker-dependent Studios: navigate, then select the seeded record BY HAND in
    # the opened browser is not possible headless — do these with headed mode
    # (launch(headless=False)) and uncomment the input() pauses, or capture them
    # manually. The two below need no interaction:
    shot(f"/survey?token={os.environ.get('UCC_TOKEN','')}", "07-public-survey.png")
    b.close()
print("saved to /tmp/ucc-screenshots/")
```

The four picker Studios are quickest captured **manually**: open the route, pick
the seeded record, use the browser's full-page screenshot. Automating the Frappe
link-field selection is brittle and not worth it for a one-off.

---

## Part E — Report

List each file with a one-line note on what it shows and whether it rendered
cleanly. **A broken page is a finding, not a skip** — screenshot the error state
and report the console error. Likely first-run issues to watch: unbuilt assets
(re-run `bench build`), the QR button if `qrcode` didn't install, and anything in
`test_integration_chain` that failed in Part B.

## Part F — Teardown (optional)

The demo data is disposable. To remove it (dev site only):

```python
import frappe
for dt, filt in [("UCC Index Result", {"index": "DEMO"}),
                 ("UCC Index Version", {"index": "DEMO"}),
                 ("UCC Index Definition", {"index_code": "DEMO"}),
                 ("UCC Metric Result", {"metric": "TEACHING_CLARITY"}),
                 ("UCC Survey Answer", {}), ("UCC Survey Submission", {}),
                 ("UCC Survey Campaign", {"campaign_name": "Demo Aug Intake"})]:
    for n in frappe.get_all(dt, filters=filt, pluck="name"):
        frappe.delete_doc(dt, n, force=True)
frappe.db.commit()
```
(SEQI/DEMO definitions, the demo survey, objective and metric can be left or
deleted similarly; delete children before parents.)
