// Copyright (c) 2026, United Ceres College and contributors
//
// A UCC Survey on its own does nothing: it is a title that owns versions, and
// versions are built in the Survey Builder. So the raw Desk form is never a
// destination — it is a step on the way to the Builder, and this file is what
// makes it behave like one.
//
// Two routes back, because there are two ways to get here:
//   after_save  — you just created one. Go straight on to the Builder and open
//                 its first draft version. No dialog: the Builder already skips
//                 the "which survey?" prompt when it is told which survey.
//   refresh     — you arrived some other way (Awesomebar, a list, a link).
//                 A button, not a redirect: you may have come to edit the title.

frappe.ui.form.on("UCC Survey", {
	// is_new() is already false by the time after_save runs, so the "was this
	// the first save?" answer has to be taken before it.
	before_save(frm) {
		frm.__ucc_was_new = frm.is_new();
	},

	after_save(frm) {
		if (!frm.__ucc_was_new) return;
		frm.__ucc_was_new = false;
		frappe.show_alert({
			indicator: "green",
			message: __("Survey created — opening the Survey Builder"),
		});
		// One tick, deliberately: form.js calls me.refresh() synchronously right
		// after this trigger, and a new doc's route is still the throwaway
		// "new-ucc-survey-…" at that moment. Navigating after the current task
		// lets that settle instead of racing it.
		setTimeout(() => _toBuilder(frm.doc.name), 0);
	},

	refresh(frm) {
		if (frm.is_new()) return;
		frm.add_custom_button(__("Survey Builder"), () => _toBuilder(frm.doc.name));
	},
});

// new_version_for (not survey_version): the Builder reads it as "this survey
// exists but has no version I can name yet — make one".
function _toBuilder(survey) {
	frappe.route_options = { new_version_for: survey };
	frappe.set_route("ucc-survey-builder");
}
