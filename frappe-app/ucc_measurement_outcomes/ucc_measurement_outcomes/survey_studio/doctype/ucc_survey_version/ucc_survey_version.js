// Copyright (c) 2026, United Ceres College and contributors

frappe.ui.form.on("UCC Survey Version", {
	refresh(frm) {
		if (!frm.is_new()) {
			frm.add_custom_button(__("Open in Builder"), () => {
				frappe.route_options = { survey_version: frm.doc.name };
				frappe.set_route("ucc-survey-builder");
			});
		}
	},
});
