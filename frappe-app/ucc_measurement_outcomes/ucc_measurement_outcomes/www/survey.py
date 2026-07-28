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


def _bundle_url(path):
	"""A bundle's content-hashed URL, falling back to the plain asset path.

	Bundle names, never a raw /assets/… path by choice: esbuild content-hashes
	*.bundle.*, and a raw path is served with a one-year cache, which has already
	caused a stale-asset bug in this app. The fallback still beats a blank page -
	it loads, it just caches badly - and it is logged rather than silent.
	"""
	full = "/assets/ucc_measurement_outcomes/" + path
	try:
		from frappe.utils.jinja_globals import bundled_asset

		return bundled_asset(full) or full
	except Exception:
		frappe.logger("ucc_public", allow_site=True).warning(
			"bundled_asset unavailable; serving %s unhashed (it will cache for a year)" % full
		)
		return full


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
	context.survey_js = _bundle_url("js/ucc_survey_form.bundle.js")
	context.survey_css = _bundle_url("css/ucc_survey_form.bundle.css")
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
		context.error = None
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
	context.error = None
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
