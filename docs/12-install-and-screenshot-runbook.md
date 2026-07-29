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

**After pulling a branch that adds a Page, `bench migrate` is required — `build`
and `restart` are not enough.** Page JSON is a DocType record, so migrate is what
registers it; build only bundles assets. A new Studio page will 404 until then,
which reads as a broken route rather than a missing record. This bit the Campaign
Analytics and Lineage Report pages, both of which needed migrate after a
build+restart that looked complete.

Rule of thumb for what a pull needs:

| Changed | Command |
|---|---|
| Page JSON, DocType JSON, Custom Field fixtures | `bench --site <site> migrate` |
| Any `.js` under `public/` or a Studio page | `bench build --app ucc_measurement_outcomes` |
| Python (controllers, `api/*`) | `bench restart` |
| **`hooks.py`** | `bench --site <site> clear-cache` **and** `bench restart` |
| A `www/` web page template | `bench --site <site> clear-website-cache` |

When in doubt, all four in that order.

**`hooks.py` needs `clear-cache`, not just `restart`.** App hooks are cached, so
a restart alone keeps serving the old map. If a hook's target has moved, the
stale map calls a function that no longer exists and every save of that DocType
fails with `AttributeError: module … has no attribute …` — pointing at code that
is correct on disk. This blocked Survey Tracking creation entirely once.

**Always read the tail of `bench build`.** JS and CSS bundle in one run, and a
CSS failure exits non-zero *after* the JS has built — so `sites/assets/assets.json`
is never regenerated and keeps naming the previous content hash. Every asset then
404s and no `UCC*` global is defined. The symptom is a Desk page dying on
something like `window.UCCVersionPicker is not a constructor`, which points four
steps away from the cause. A green-looking page load is not evidence the build
succeeded.

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

## Part D1 — Draft → collecting responses (the click path)

The whole path, and every step of it that still has no purpose-built UI.

**0. Reach the Survey Builder.** `/app/measurement-outcomes` — the Measurement
Outcomes workspace, which lists all seven Desk pages and the main record types.
The awesomebar also finds it: type "UCC Survey Builder". *(The workspace ships in
`survey_studio/workspace/` and appears after `bench migrate`; see
BENCH_VERIFY.md — it was authored without a bench.)*

**1. Build the questions.** Pick a Draft version in the picker, drag types from
the palette, edit in the Inspector. Preview paginates exactly as respondents see
it.

**2. Draft → Published.** ⚠️ **No Publish button exists in the Builder.** Click
the pencil on the version in the picker (that routes to the UCC Survey Version
form), set **Status = Published**, Save. The version freezes on save: status
*and* content, permanently.

**3. The campaign is a Survey Tracking record.** ⚠️ **No create-campaign UI
exists in the Builder either.** New → Survey Tracking (educ_sg's DocType; it
requires an existing Survey Management record — decision 2026-07-26). In the
**UCC Campaign** section this app adds:

| Field | Set it to |
|---|---|
| UCC Survey Version | the version you just published |
| Collection Status | `Open` |
| Access Mode | `Anonymous Link` |
| Allow Multiple Responses | tick only if one person may answer more than once |

**4. The token mints itself.** `ucc_public_token` is generated on save by
`survey_tracking_hooks.validate` as soon as Collection Status is set — including
when you set it on a row that already existed. (It used to mint only in
`before_insert`, so creating the row first and setting the status afterwards left
it permanently token-less with nothing saying why. Fixed 2026-07-28.) Historical
Survey Tracking rows have no collection status and never get a token.

**5. The link appears in the Builder.** Reload the Survey Builder on that
version: a **Public link** bar sits under the toolbar with the full
`/survey?token=…` URL and a Copy button. If it instead shows a sentence, that
sentence is the reason — version not Published, no campaign pointing at it, the
campaign not Open, or no token yet.

**6. Collect.** Open the link in a private window. Submissions land as UCC Survey
Submission + one UCC Survey Answer per question.

**7. Adjusting layout after publishing.** A published version's *content* is
frozen, but its *presentation* is not (decision 2026-07-28), so a survey that
reads badly on a phone can be fixed without spinning a new version and orphaning
the campaign collecting against it. Two ways, both live on a Published version:

- Inspector → **Width** → **Apply Width**.
- **Preview → Edit layout**, then drag the grip on a question's right edge.
  Widths snap to full / two thirds / half / one third.

Wording, type, choices, required, order and display logic all still throw on a
published version. Every width change is recorded in the Version log
(`track_changes` was already on for UCC Survey Question), so the edit is
auditable like any other.

**Preview link.** Under the public link sits an amber, dashed **PREVIEW**
control: `/survey?preview=<version>`. It is present for every version including
Draft — no campaign, no token and no Published status required — and it renders
the real respondent page with a sticky "nothing is saved" banner and no Submit
button.

It is **not anonymous**: opening it needs a Desk login with read permission on
the version, re-checked server-side. Colleagues without an account get a login
page. That is deliberate — an anonymous preview token would be a second
unauthenticated route to unpublished survey content guarded by nothing but a
secret string. If external reviewers need access, give them a read-only Frappe
user or export a print format.

**Known gaps (no UI, Desk form or console only):** publishing a version,
creating the campaign, and setting the collection window dates. Everything else
in the path is now reachable from the Builder.

## Part D2 — Branding the public survey page (optional)

**Measurement Outcomes → Survey Theme** (or the **Theme…** button in the Survey
Builder toolbar). Eight colour pickers and a font, applied site-wide to
`/survey`. Pick a version under **Preview With**, save, then **Refresh preview**
to see it on a real survey page.

United Ceres has one brand, so this is deliberately **site-wide, not per-survey**
— twelve differently-coloured surveys would be a downgrade, not a feature.
Leaving a colour empty keeps the built-in default; **Reset all to default** clears
everything. **Font = Site Default** emits no font rule at all, so the form keeps
inheriting the Website Theme and matches the rest of the portal.

The preview shows **saved** values. That is deliberate: pushing unsaved colours
into it would mean passing them through the URL into the guest-reachable page,
which is exactly the untrusted-input path this feature is built to avoid.

`/survey` also still inherits the site's Website Theme (navbar, logo, base font)
through `templates/web.html` — the theme editor only governs the form's own
controls.

**There is deliberately no free-text CSS field, and there must never be one.**
`/survey` is the only guest-reachable page in this app. Values are validated
server-side against `^#[0-9a-f]{6}$`, the font is a key into a hard-coded table
of stacks, and the variable names are a closed list — so the emitted CSS can only
ever be `--<known-name>:#rrggbb;`. Nothing stored is echoed into the page, which
is why no `</style>` can be smuggled and no `url()` or attribute selector can be
introduced. See `theme.py` and the attack strings in `test_theme.py`.

Setting the variables by hand in **Website Settings → Theme** still works and
still overrides nothing — it is the same `--ucc-*` variables, just the manual
route:

```css
:root{ --ucc-accent:#003a70; --ucc-star:#c8a02e; }
```

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
