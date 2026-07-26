# Copyright (c) 2026, United Ceres College and contributors
# For license information, please see license.txt

"""Public survey page controller, served at /survey?token=<public_token>.

Renders only published survey content for an open campaign. Submission goes
through the existing guest-whitelisted submit_survey endpoint (client-side),
which is the single trusted write boundary.
"""

import frappe

from ucc_measurement_outcomes.api.public import public_survey_payload

# TODO: bench-verify - confirm guest website access is enabled (Website Settings)
# and that guest frappe.call() to submit_survey passes CSRF as configured on the
# real site. Anonymous access model here assumes a public campaign token in the URL.


def get_context(context):
	context.no_cache = 1
	# Frappe's CSRF check runs in auth.py BEFORE any whitelisted method body and
	# throws CSRFTokenError - a ValidationError subclass, so HTTP 400 with the
	# message "Invalid Request". window.csrf_token is set for logged-in desk
	# users and is routinely absent on a guest portal page, which made every
	# guest submission fail with a 400 that never reached our code (and so never
	# logged). Hand the page the token for the session it was actually rendered
	# under instead of hoping a global exists.
	session = getattr(frappe.local, "session", None)
	context.csrf_token = (session.data.csrf_token if session and session.data else "") or ""
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
