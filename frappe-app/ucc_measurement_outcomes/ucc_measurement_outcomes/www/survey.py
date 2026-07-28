# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Public survey page controller.

Two mutually exclusive modes, with two different gates:

  /survey?token=<public_token>   the respondent's. Anonymous, so everything is
                                 checked: token resolves, campaign Open and in
                                 window, version Published, survey not Archived.

  /survey?preview=<version>      the author's. Logged in, with read permission on
                                 that version - strictly stronger than the
                                 anonymous gate. Relaxes exactly one thing: the
                                 content need not be Published, which is the
                                 point, since a Draft has no campaign and no
                                 token.

Preview relaxes NOTHING about writing. It renders with an empty token, and
submit_survey's first act is to resolve one, so a previewed form has nothing to
submit with; UCCSurveyForm is also given no onSubmit, so it draws no submit
button at all. submit_survey has no preview parameter and no preview branch, and
must never grow one.
"""

import frappe

from ucc_measurement_outcomes.api.public import preview_payload, public_survey_payload

# TODO: bench-verify - confirm guest website access is enabled (Website Settings)
# and that guest frappe.call() to submit_survey passes CSRF as configured on the
# real site. Anonymous access model here assumes a public campaign token in the URL.


# The bundle NAMES, exactly as they appear as keys in sites/assets/assets.json -
# which is also why app_include_js takes this form. NOT paths.
ASSET_ERROR = ("This survey cannot be displayed right now. (Its assets are not built - "
               "run: bench build --app ucc_measurement_outcomes)")

SURVEY_JS = "ucc_survey_form.bundle.js"
SURVEY_CSS = "ucc_survey_form.bundle.css"


def _bundle_url(name):
	"""The content-hashed URL of a built bundle, or None.

	There is NO fallback to /assets/<app>/js/<name>, and there must never be one.
	That path is the app's public/ directory - the raw esbuild SOURCE, complete
	with `import` statements - so serving it hands the browser a module as a
	classic script and it dies on "Cannot use import statement outside a module".
	A missing bundle has no safe substitute; the only honest options are the real
	built file or a clear failure.

	Why the previous attempt resolved to that source path every single time:
	frappe.utils.jinja_globals.bundled_asset only consults assets.json when the
	argument does NOT already start with "/assets" -

	    if ".bundle." in path and not path.startswith("/assets"):
	        path = get_assets_json().get(path) or path
	    return abs_url(path)

	- and it was being handed "/assets/ucc_measurement_outcomes/js/…". The lookup
	was skipped and the input came straight back, so the guard-plus-fallback
	never fired: from the caller's side it looked like a successful resolution.
	Hence the bare name here, and hence the /dist/ check below, which verifies the
	RESULT rather than trusting that the call did what it was asked.
	"""
	url = None
	try:
		from frappe.utils.jinja_globals import bundled_asset

		url = bundled_asset(name)
	except Exception as e:
		frappe.logger("ucc_public", allow_site=True).error(
			"bundled_asset unavailable (%s: %s) - cannot resolve %s" % (type(e).__name__, e, name)
		)
		return None
	# Every built bundle lands in dist/ under a content-hashed filename. Anything
	# else is a lookup that quietly did nothing, which is precisely the failure
	# that shipped a raw source file to the browser.
	if url and "/dist/" in url:
		return url
	frappe.logger("ucc_public", allow_site=True).error(
		"%s did not resolve to a built asset (got %r). Run: bench build --app "
		"ucc_measurement_outcomes" % (name, url)
	)
	return None


def get_context(context):
	context.no_cache = 1
	# The page's own assets, resolved to a URL here and rendered as explicit tags
	# by the template.
	#
	# This used to set context.include_js / include_css, which is the documented
	# mechanism for a Web Page DOCUMENT but is not rendered for a www/ TEMPLATE
	# page - the exact thing the TODO here warned about. The symptom was
	# survey_form.js never loading and the page saying "run bench build", which
	# is what it says whenever the global is absent, so it pointed at a build
	# that had in fact succeeded.
	#
	# Set BEFORE either branch, so preview and token render identically. That was
	# already true when this broke - both branches were equally broken, preview
	# was simply opened first - and check_repo.sh now asserts it stays true.
	context.survey_js = _bundle_url(SURVEY_JS)
	context.survey_css = _bundle_url(SURVEY_CSS)
	# Unresolvable assets are a broken deployment, not a survey problem. Say so
	# here rather than rendering a form whose JS can never run - both routes, one
	# check, because both are equally dead without it.
	context.assets_missing = not (context.survey_js and context.survey_css)
	# Frappe's CSRF check runs in auth.py BEFORE any whitelisted method body and
	# throws CSRFTokenError - a ValidationError subclass, so HTTP 400 with the
	# message "Invalid Request". window.csrf_token is set for logged-in desk
	# users and is routinely absent on a guest portal page, which made every
	# guest submission fail with a 400 that never reached our code (and so never
	# logged). Hand the page the token for the session it was actually rendered
	# under instead of hoping a global exists.
	session = getattr(frappe.local, "session", None)
	context.csrf_token = (session.data.csrf_token if session and session.data else "") or ""
	context.preview = 0

	preview = frappe.form_dict.get("preview")
	if preview:
		# Guest is refused before anything is looked up. This is the only branch
		# of the only guest-reachable page that can serve unpublished content, so
		# it refuses first and asks questions second; preview_payload checks the
		# same thing again on its own account.
		if frappe.session.user == "Guest":
			raise frappe.PermissionError
		context.preview = 1
		context.token = ""          # never a token in preview - see the module docstring
		context.survey = None
		context.error = None if not context.assets_missing else ASSET_ERROR
		try:
			context.survey = preview_payload(preview)
		except frappe.PermissionError:
			context.error = "You do not have permission to preview this survey version."
		except Exception as e:
			context.error = frappe.utils.strip_html(str(e)) or "This survey version is unavailable."
		context.survey_json = frappe.as_json(context.survey) if context.survey else "null"
		return context

	token = frappe.form_dict.get("token")
	context.token = token or ""
	context.survey = None
	context.error = None if not context.assets_missing else ASSET_ERROR
	if not token:
		context.error = "This survey link is missing its token."
		return context
	try:
		context.survey = public_survey_payload(token)
	except frappe.DoesNotExistError:
		context.error = "Survey not found."
	except Exception as e:
		# Surface the friendly message (e.g. "not currently open") without internals.
		context.error = frappe.utils.strip_html(str(e)) or "This survey is unavailable."
	context.survey_json = frappe.as_json(context.survey) if context.survey else "null"
	return context
