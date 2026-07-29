// Copyright (c) 2026, United Ceres College and contributors
//
// The form itself IS the editor - Frappe's Color fieldtype renders a picker and
// Select renders the closed font list, so there is no custom control code here.
// This adds only what the form cannot infer: the preview iframe and the resets.

frappe.ui.form.on("UCC Survey Theme", {
	refresh(frm) {
		renderVersionPicker(frm);
		frm.add_custom_button(__("Reset all to default"), () => {
			frappe.confirm(__("Clear every colour and the font override?"), () => {
				frm.call("ucc_measurement_outcomes.survey_studio.doctype.ucc_survey_theme.ucc_survey_theme.reset")
					.then(() => frm.reload_doc());
			});
		});
		frm.add_custom_button(__("Refresh preview"), () => renderPreview(frm));
		renderPreview(frm);
	},

	preview_version(frm) {
		renderPreview(frm);
	},
});

// The SAME picker the Survey Builder uses, fed by the SAME list_versions API -
// not a second copy of its label format. A raw Link field showed docnames like
// "SUR-0001-V01" while the Builder showed "Versi 01 · V01" for the same record,
// which is exactly the kind of drift a shared component exists to prevent.
// The Link field is still the storage (link validation, referential integrity);
// it is just hidden and set from here.
function renderVersionPicker(frm) {
	const field = frm.get_field("preview_version_picker");
	if (!field || !window.UCCVersionPicker) return;
	const $wrap = $(field.wrapper).empty();
	const host = $('<div style="max-width:360px"></div>').appendTo($wrap).get(0);
	const picker = new window.UCCVersionPicker(host, {
		statusColor: { Draft: "gray", "In Review": "orange", Published: "green", Closed: "gray" },
		placeholder: __("Pick a survey version…"),
		onSelect: (name) => frm.set_value("preview_version", name),
	});
	frappe.call({
		method: "ucc_measurement_outcomes.api.builder.list_versions",
		callback: (r) => {
			picker.setItems((r.message || []).map((v) => ({
				name: v.name, status: v.status,
				label: `${v.survey_title} · V${v.version_number}`,
			})), frm.doc.preview_version);
		},
	});
}

// Save-then-refresh, deliberately: the preview is the REAL respondent page and
// it reads the theme server-side. Pushing unsaved colours into it would mean
// passing them through the URL into the guest-reachable page - exactly the
// untrusted-input path this feature exists to avoid. One extra click buys the
// guarantee that nothing user-supplied ever reaches /survey through a request.
function renderPreview(frm) {
	const $wrap = $(frm.get_field("preview_html").wrapper).empty();
	if (!frm.doc.preview_version) {
		$wrap.html(`<p class="text-muted" style="font-size:12px">${
			__("Pick a survey version above to see the theme on a real form.")}</p>`);
		return;
	}
	if (frm.is_dirty()) {
		$wrap.html(`<p class="text-muted" style="font-size:12px">${
			__("Unsaved changes — save, then Refresh preview. The preview renders the real survey page, which reads saved values.")}</p>`);
		return;
	}
	const url = "/survey?preview=" + encodeURIComponent(frm.doc.preview_version)
		+ "&t=" + Date.now();   // defeat the iframe cache after a save
	$wrap.html(`<iframe src="${frappe.utils.escape_html(url)}" title="${__("Survey preview")}"
		style="width:100%;height:520px;border:1px solid var(--border-color,#e2e6ea);border-radius:8px"></iframe>`);
}
