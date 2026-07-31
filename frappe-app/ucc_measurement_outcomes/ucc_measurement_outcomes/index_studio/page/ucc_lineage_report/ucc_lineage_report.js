// Copyright (c) 2026, United Ceres College and contributors
// Lineage Report: Index -> Objective -> Question -> Result, top to bottom.
//
// Its own page rather than a panel inside Index Studio: it spans every
// workspace and belongs to none, it is read-only evidence rather than an
// editing surface, and a report page is the natural host for a print format.

frappe.pages["ucc-lineage-report"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Lineage Report"),
		single_column: true,
	});
	try {
		wrapper.ucc = new LineageReport(page);
	} catch (e) {
		console.error("[UCC] ucc-lineage-report failed to initialise:", e);
		frappe.msgprint({title: __("Page failed to load"), indicator: "red",
			message: __("ucc-lineage-report could not initialise: ") + (e && e.message ? e.message : e)});
		throw e;
	}
};

frappe.pages["ucc-lineage-report"].on_page_show = function (wrapper) {
	if (wrapper.ucc) wrapper.ucc.applyRouteOptions();
};

const LAPI = "ucc_measurement_outcomes.api.lineage.";

class LineageReport {
	constructor(page) {
		this.page = page;
		this.results = [];
		this._injectStyle();
		this._build();
		this.loadResults();
		this.applyRouteOptions();
	}

	applyRouteOptions() {
		const opts = frappe.route_options || {};
		frappe.route_options = {};
		if (opts.index_result) this._pending = opts.index_result;
		this._applyPending();
	}

	_applyPending() {
		if (!this._pending || !this.results.length) return;
		if (this.results.some((r) => r.name === this._pending)) {
			this.$select.val(this._pending);
			this.load(this._pending);
			this._pending = null;
		}
	}

	_injectStyle() {
		if (document.getElementById("ucc-lin-style")) return;
		const el = document.createElement("style");
		el.id = "ucc-lin-style";
		el.textContent = `
		.ucc-lin-head{border:1px solid #d9e0ea;border-radius:10px;background:#f7f9fc;padding:14px 16px;margin-top:12px}
		.ucc-lin-head .score{font-size:34px;font-weight:700;line-height:1.1;color:#1f272e}
		.ucc-lin-head .vs{font-size:13px;color:#8b95a5;margin-left:8px}
		.ucc-lin-head .meta{font-size:12px;color:#5b6672;margin-top:4px}
		.ucc-lin-asat{font-size:11px;color:#8a6d1f;background:#fff8ea;border:1px solid #ecd6aa;
			border-radius:7px;padding:7px 10px;margin-top:10px}
		.ucc-lin-sec{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#8b95a5;
			font-weight:600;margin:22px 0 8px}
		.ucc-lin-obj{border:1px solid #e2e6ea;border-radius:9px;margin-bottom:12px;overflow:hidden}
		.ucc-lin-ohead{display:flex;align-items:baseline;gap:10px;padding:9px 12px;background:#f2f5f9;font-size:12px}
		.ucc-lin-ohead b{font-size:13px}
		.ucc-lin-ohead .cl{color:#8b95a5;font-size:11px}
		.ucc-lin-row{padding:9px 12px 9px 24px;border-top:1px solid #eef2f7;font-size:12px}
		.ucc-lin-q{color:#1f272e}
		.ucc-lin-corrected{margin-left:7px;font-size:10px;padding:1px 7px;border-radius:20px;
			background:#fff4e0;color:#8a6d1f;border:1px solid #ecd6aa;cursor:help;white-space:nowrap}
		.ucc-lin-flow{font-size:11px;color:#5b6672;margin-top:3px}
		.ucc-lin-flow b{color:#1f272e}
		.ucc-lin-shared{font-size:10px;color:#6f58a8;background:#f1edf9;border-radius:20px;padding:1px 8px;margin-left:6px}
		.ucc-lin-bar{display:grid;grid-template-columns:180px 1fr 60px;gap:9px;align-items:center;margin:6px 0;font-size:11px}
		.ucc-lin-track{height:9px;background:#e4e9f1;border-radius:99px;overflow:hidden}
		.ucc-lin-track span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#223a6b,#b58a45)}
		.ucc-lin-gap{border:1px dashed #e0b4b4;background:#fdf6f6;border-radius:9px;padding:11px 13px;font-size:12px;color:#8f3838}
		.ucc-lin-gap .r{font-size:11px;color:#a06a6a}
		`;
		document.head.appendChild(el);
	}

	_build() {
		const $m = $(this.page.main).empty();
		this.$trail = $('<div></div>').appendTo($m);
		const $picker = $('<div style="max-width:520px"></div>').appendTo($m);
		this.$select = $('<select class="form-control input-sm"></select>').appendTo($picker);
		this.$select.on("change", () => this.load(this.$select.val()));
		this.$body = $('<div></div>').appendTo($m);
		this._renderTrail();
	}

	_renderTrail() {
		if (!window.UCCTrail) return console.warn("[UCC] trail.js not loaded - run: bench build --app ucc_measurement_outcomes && bench restart");
		// A report over the finished pipeline, not a stage in it.
		window.UCCTrail.render(this.$trail.get(0), {
			context: (this.data && this.data.header.index_version) || null,
			stages: { 4: { done: true }, 5: { blocked: __("not built yet") } },
		});
	}

	loadResults() {
		frappe.call({
			method: LAPI + "list_results",
			callback: (r) => {
				this.results = r.message || [];
				if (!this.results.length) {
					return this.$body.html(`<div class="ucc-lin-gap" style="margin-top:14px">${
						__("No index results yet. Publish an index version and calculate it, then its lineage can be reported.")}</div>`);
				}
				this.$select.html(this.results.map((r2) =>
					`<option value="${frappe.utils.escape_html(r2.name)}">${
						frappe.utils.escape_html(r2.index_version)} · ${
						frappe.utils.escape_html(r2.period || __("no period"))} · ${
						r2.value === null ? "—" : r2.value}</option>`).join(""));
				this._applyPending();
				if (!this._pending) this.load(this.$select.val());
			},
		});
	}

	load(name) {
		if (!name) return;
		frappe.call({
			method: LAPI + "get_lineage",
			args: { index_result: name },
			callback: (r) => { if (r.message) { this.data = r.message; this._render(); } },
		});
	}

	_render() {
		const d = this.data;
		const h = d.header;
		const esc = frappe.utils.escape_html;
		const num = (v) => (v === null || v === undefined ? "—" : Math.round(v * 100) / 100);

		let html = `<div class="ucc-lin-head">
			<div><span class="score">${num(h.value)}</span><span class="vs">${
				h.target ? __("against target {0}", [h.target]) : __("no target set")}</span></div>
			<div class="meta">${esc(h.index_version || "")}${h.period ? " · " + esc(h.period) : ""}${
				h.entity ? " · " + esc(h.entity) : ""}</div>
			<div class="ucc-lin-asat">${
				__("Scores and the objective/question lineage below are the snapshot taken when this result was calculated ({0}). Editing a mapping today does not change this report.",
				   [esc(String(h.calculation_date || "—"))])}</div>
		</div>`;

		// Components first: the snapshot, verbatim, so the arithmetic is visible
		// before it is regrouped by objective.
		const maxC = Math.max(1, ...d.components.map((c) => Math.abs(c.contribution || 0)));
		html += `<div class="ucc-lin-sec">${__("Contribution by component")}</div>`;
		html += d.components.filter((c) => c.metric).map((c) => `
			<div class="ucc-lin-bar">
				<div title="${esc(c.label)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.label)}</div>
				<div class="ucc-lin-track"><span style="width:${Math.round((Math.abs(c.contribution || 0) / maxC) * 100)}%"></span></div>
				<div style="text-align:right">${num(c.contribution)}</div>
			</div>`).join("");

		html += `<div class="ucc-lin-sec">${__("By objective")}</div>`;
		html += d.objectives.length ? d.objectives.map((o) => `
			<div class="ucc-lin-obj">
				<div class="ucc-lin-ohead">
					<b>${esc(o.code)}</b>
					<span>${esc(o.name !== o.code ? o.name : "")}</span>
					<span class="cl">${esc(o.clauses.join(", "))}</span>
				</div>
				${o.rows.map((r) => `
					<div class="ucc-lin-row">
						${r.questions.length
							// A corrected question says so HERE, where the evidence is
							// read. The wording is resolved live, so without this the
							// report would print post-correction text as though it were
							// what respondents saw.
							? r.questions.map((q) => `<div class="ucc-lin-q">${esc(q.text)}${
								q.corrected ? `<span class="ucc-lin-corrected" title="${
									esc(q.corrected)}">${__("wording corrected")}</span>` : ""
								}</div>`).join("")
							: `<div class="text-muted">${__("no source questions recorded")}</div>`}
						<div class="ucc-lin-flow">→ ${esc(r.component.metric || "")} ·
							${__("normalised")} <b>${num(r.component.value)}</b> ·
							${__("weight")} ${num(r.component.weight)}% ·
							${__("contributed")} <b>${num(r.component.contribution)}</b>
							${r.note ? `<span class="ucc-lin-shared">${esc(r.note)}</span>` : ""}
						</div>
					</div>`).join("")}
			</div>`).join("")
			: `<div class="text-muted" style="font-size:12px">${__("Nothing traced to an objective.")}</div>`;

		// What cannot be traced is a finding, not an omission.
		if (d.untraceable.length) {
			html += `<div class="ucc-lin-sec">${__("Not traceable to an objective")}</div>`;
			html += d.untraceable.map((u) => `<div class="ucc-lin-gap" style="margin-bottom:8px">
				<b>${esc(u.component.label)}</b> — ${__("contributed")} ${num(u.component.contribution)}
				<div class="r">${esc(u.reason)}</div>
			</div>`).join("");
		}

		if (!d.snapshot_complete) {
			html += `<div class="ucc-lin-gap" style="margin-top:14px">
				${__("Some components carry no recorded lineage. Results calculated before lineage was snapshotted have none — that is 'never recorded', not 'traces to nothing'. Recalculate the index to capture it.")}
			</div>`;
		}

		this.$body.html(html);
		this._renderTrail();
	}
}
