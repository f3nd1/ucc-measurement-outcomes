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

	// Item 2: the one forward action at the end of a stage. Same navigation
	// mechanism as the stepper. When the next stage has an unmet prerequisite
	// the button states the blocker and does not navigate.
	// opts: {label, page, routeOptions, blocked, note}
	renderNext(el, opts) {
		if (!el) return;
		this._injectStyle();
		opts = opts || {};
		const $el = $(el).empty().addClass("ucc-next");
		if (opts.note) {
			// A page that is not a pipeline stage says so, rather than being
			// given a fake next step.
			$('<span class="ucc-next-note"></span>').text(opts.note).appendTo($el);
			return;
		}
		const $btn = $('<button class="btn btn-sm"></button>').appendTo($el);
		if (opts.blocked) {
			$btn.addClass("btn-default").prop("disabled", true).text(opts.blocked);
			return;
		}
		$btn.addClass("btn-primary").text(opts.label).on("click", () => {
			frappe.route_options = opts.routeOptions || {};
			frappe.set_route(opts.page);
		});
	},

	_injectStyle() {
		if (document.getElementById("ucc-step-style")) return;
		const el = document.createElement("style");
		el.id = "ucc-step-style";
		// Colours are literal, not var(--primary): in this Frappe build --primary
		// resolves to rgb(23,23,23), so the "you are here" badge was painting the
		// same near-black as ordinary text and read as no state at all.
		// Rule order matters: .current is last so that a stage which is both
		// current and done still shows the accent badge (you are here) rather than
		// the quieter done badge winning on source order.
		el.textContent = `
		.ucc-step{display:flex;align-items:flex-start;flex-wrap:wrap;gap:4px;
			margin:0 0 16px;padding:12px 14px;border:1px solid #d9e0ea;
			border-radius:10px;background:#f7f9fc;font-size:12px}
		.ucc-step-item{display:flex;align-items:flex-start;gap:7px;padding:5px 9px;
			border-radius:7px;color:#97a1b0;max-width:210px}
		.ucc-step-item.link{cursor:pointer}
		.ucc-step-item.link:hover{background:#e7edf6}
		.ucc-step-n{display:inline-flex;align-items:center;justify-content:center;
			width:20px;height:20px;border-radius:50%;flex:0 0 20px;font-size:10px;
			font-weight:700;background:#e4e9f1;color:#97a1b0}
		.ucc-step-body{display:flex;flex-direction:column;line-height:1.35}
		.ucc-step-label{white-space:nowrap}
		.ucc-step-note{font-size:11px;white-space:normal;margin-top:2px;color:#8a6d1f}
		.ucc-step-item.done{color:#1f272e}
		.ucc-step-item.done .ucc-step-n{background:#237a57;color:#fff}
		.ucc-step-item.blocked .ucc-step-n{background:#f6dede;color:#b94848}
		.ucc-step-item.blocked .ucc-step-note{color:#b94848;font-weight:600}
		.ucc-step-item.current{background:#fff;color:#1f272e;font-weight:600;
			box-shadow:0 0 0 1px #c3cfe4,0 1px 3px rgba(23,41,77,.08)}
		.ucc-step-item.current .ucc-step-n{background:#3d55d4;color:#fff}
		.ucc-step-arrow{color:#c3c9cf;padding-top:7px}
		.ucc-next{display:flex;align-items:center;gap:8px;margin-top:14px;
			padding-top:12px;border-top:1px solid var(--border-color,#e2e6ea)}
		.ucc-next-note{font-size:12px;color:var(--text-muted,#8b95a5)}
		.ucc-step-context{margin-left:auto;align-self:center;padding:3px 9px;
			border-radius:12px;background:var(--bg-light-gray,#eef2f7);
			color:var(--text-color,#1f272e);font-weight:600}
		`;
		document.head.appendChild(el);
	},
};
