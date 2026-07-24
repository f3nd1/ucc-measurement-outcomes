// Copyright (c) 2026, United Ceres College and contributors

frappe.ui.form.on("UCC Survey Campaign", {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.public_token) return;
		frm.add_custom_button(__("Public Link QR"), () => {
			frappe.call({
				method: "ucc_measurement_outcomes.api.builder.campaign_qr",
				args: { campaign: frm.doc.name },
				callback: (r) => {
					if (!r.message) return;
					const d = new frappe.ui.Dialog({ title: __("Public Survey Link"), size: "small" });
					$(d.body).html(
						`<div style="text-align:center">
							<div style="max-width:220px;margin:0 auto">${r.message.svg}</div>
							<p style="margin-top:10px"><a href="${frappe.utils.escape_html(r.message.url)}" target="_blank">${frappe.utils.escape_html(r.message.url)}</a></p>
						</div>`
					);
					d.show();
				},
			});
		});
	},
});
