// Copyright (c) 2026, United Ceres College and contributors
//
// Shared pipeline stepper (item 1). Replaces the old location breadcrumb: a
// breadcrumb answers "where am I", which left users on Index Studio with no
// idea what came before or next. This answers "what stage is this, what is
// still missing, and what happens after".
//
// Every page renders the SAME five stages, so the flow reads identically from
// anywhere. Each page passes only the signals it already holds client-side —
// unknown stages render neutral rather than inventing a state.
//
// Navigation reuses the app's existing convention (frappe.route_options +
// frappe.set_route). No router, no state manager, no new dependency.

window.UCCTrail = {
	// The pipeline, in order. `page` null = no destination built yet.
	STAGES: [
		{ n: 1, key: "build", label: "Build survey", page: "ucc-survey-builder" },
		{ n: 2, key: "map", label: "Map to objectives", page: "mapping-studio" },
		{ n: 3, key: "index", label: "Build index", page: "index-studio" },
		{ n: 4, key: "analyse", label: "Analyse", page: "ucc-dashboard-studio" },
		{ n: 5, key: "act", label: "Act on results", page: null },
	],

	// el: container. opts:
	//   current      1-5, the stage this page represents
	//   context      string shown once beside the stepper (e.g. the survey version)
	//   routeOptions carried when navigating to another stage
	//   stages       partial map keyed by stage number:
	//                {done: true} | {note: "..."} | {blocked: "why"}
	//                Omit a stage entirely when this page cannot know its state.
	render(el, opts) {
		if (!el) return;
		this._injectStyle();
		opts = opts || {};
		const stages = opts.stages || {};
		const $el = $(el).empty().addClass("ucc-step");

		this.STAGES.forEach((s, i) => {
			if (i) $('<span class="ucc-step-arrow">→</span>').appendTo($el);
			const st = stages[s.n] || {};
			const isCurrent = opts.current === s.n;
			const $s = $('<span class="ucc-step-item"></span>').appendTo($el);
			if (isCurrent) $s.addClass("current");
			if (st.done) $s.addClass("done");
			if (st.blocked) $s.addClass("blocked");

			// Number, or a tick once the stage's work is finished.
			$('<span class="ucc-step-n"></span>').text(st.done ? "✓" : s.n).appendTo($s);
			const $body = $('<span class="ucc-step-body"></span>').appendTo($s);
			$('<span class="ucc-step-label"></span>').text(__(s.label)).appendTo($body);

			// The blocker/note is inline, never a tooltip: it is the whole point
			// of the stepper that you can read what is missing without hovering.
			const note = st.blocked || st.note;
			if (note) $('<span class="ucc-step-note"></span>').text(note).appendTo($body);

			if (!isCurrent && s.page) {
				$s.addClass("link").on("click", () => {
					frappe.route_options = opts.routeOptions || {};
					frappe.set_route(s.page);
				});
			}
		});

		// The working context appears once, next to the stepper — not repeated
		// as a per-page breadcrumb segment.
		if (opts.context) {
			$('<span class="ucc-step-context"></span>').text(opts.context).appendTo($el);
		}
	},

	_injectStyle() {
		if (document.getElementById("ucc-step-style")) return;
		const el = document.createElement("style");
		el.id = "ucc-step-style";
		el.textContent = `
		.ucc-step{display:flex;align-items:flex-start;flex-wrap:wrap;gap:4px;
			margin:0 0 14px;padding:10px 12px;border:1px solid var(--border-color,#e2e6ea);
			border-radius:8px;background:var(--fg-color,#fff);font-size:12px}
		.ucc-step-item{display:flex;align-items:flex-start;gap:6px;padding:4px 8px;
			border-radius:6px;color:var(--text-muted,#8b95a5);max-width:210px}
		.ucc-step-item.link{cursor:pointer}
		.ucc-step-item.link:hover{background:var(--bg-light-gray,#eef2f7)}
		.ucc-step-n{display:inline-flex;align-items:center;justify-content:center;
			width:18px;height:18px;border-radius:50%;flex:0 0 18px;font-size:10px;
			font-weight:700;background:var(--bg-light-gray,#eef2f7);
			color:var(--text-muted,#8b95a5)}
		.ucc-step-body{display:flex;flex-direction:column;line-height:1.35}
		.ucc-step-label{white-space:nowrap}
		.ucc-step-note{font-size:10px;opacity:.85;white-space:normal}
		.ucc-step-item.current{background:var(--bg-light-gray,#eef2f7);
			color:var(--text-color,#1f272e);font-weight:600}
		.ucc-step-item.current .ucc-step-n{background:var(--primary,#4a63e7);color:#fff}
		.ucc-step-item.done{color:var(--text-color,#1f272e)}
		.ucc-step-item.done .ucc-step-n{background:#e8f5ef;color:#237a57}
		.ucc-step-item.blocked .ucc-step-note{color:#b94848}
		.ucc-step-arrow{color:var(--text-muted,#c3c9cf);padding-top:6px}
		.ucc-step-context{margin-left:auto;align-self:center;padding:3px 9px;
			border-radius:12px;background:var(--bg-light-gray,#eef2f7);
			color:var(--text-color,#1f272e);font-weight:600}
		`;
		document.head.appendChild(el);
	},
};
