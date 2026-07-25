// Copyright (c) 2026, United Ceres College and contributors
// Shared context trail (finding 1). Shows where you are in the
// survey → mapping → index → dashboard chain and lets you jump back up.
// Navigation reuses the app's existing convention: set frappe.route_options,
// then frappe.set_route(page) — the same mechanism ucc_survey_version.js uses
// and survey_builder.js reads. No custom router, no session state.

window.UCCTrail = {
	// el: container element. segments: [{label, page, routeOptions}].
	// The last segment is the current location and is never a link.
	render(el, segments) {
		if (!el) return;
		this._injectStyle();
		const segs = (segments || []).filter(Boolean);
		const $el = $(el).empty().addClass("ucc-trail");
		segs.forEach((seg, i) => {
			const isLast = i === segs.length - 1;
			if (i) $('<span class="ucc-trail-arrow">→</span>').appendTo($el);
			const $seg = $('<span class="ucc-trail-seg"></span>').text(seg.label).appendTo($el);
			if (isLast) {
				$seg.addClass("current");
				return;
			}
			if (seg.page) {
				$seg.addClass("link").on("click", () => {
					frappe.route_options = seg.routeOptions || {};
					frappe.set_route(seg.page);
				});
			}
		});
	},

	_injectStyle() {
		if (document.getElementById("ucc-trail-style")) return;
		const el = document.createElement("style");
		el.id = "ucc-trail-style";
		el.textContent = `
		.ucc-trail{display:flex;align-items:center;gap:6px;flex-wrap:wrap;
			margin:0 0 12px;font-size:12px;color:var(--text-muted,#8b95a5)}
		.ucc-trail-seg{padding:2px 8px;border-radius:4px}
		.ucc-trail-seg.link{cursor:pointer;color:var(--text-color,#1f272e)}
		.ucc-trail-seg.link:hover{background:var(--bg-light-gray,#eef2f7);text-decoration:underline}
		.ucc-trail-seg.current{background:var(--bg-light-gray,#eef2f7);
			color:var(--text-color,#1f272e);font-weight:600}
		.ucc-trail-arrow{color:var(--text-muted,#b1b8bf);font-size:11px}
		`;
		document.head.appendChild(el);
	},
};
