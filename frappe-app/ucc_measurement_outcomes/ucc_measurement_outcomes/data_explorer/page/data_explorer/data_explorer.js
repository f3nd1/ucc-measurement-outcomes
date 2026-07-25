// Copyright (c) 2026, United Ceres College and contributors
// Data Explorer: build ad-hoc pivots from an APPROVED dataset catalogue only.
// Dataset/measure/dimensions come from list_datasets(); the server rejects
// anything off the catalogue. Export is generated server-side.

frappe.pages["data-explorer"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Data Explorer"),
		single_column: true,
	});
	// Frappe can swallow exceptions thrown from on_page_load, which hides a
	// half-built page behind a clean console. Surface it loudly instead.
	try {
		wrapper.ucc = new DataExplorer(page);
	} catch (e) {
		console.error("[UCC] data-explorer failed to initialise:", e);
		frappe.msgprint({title: __("Page failed to load"), indicator: "red",
			message: __("data-explorer could not initialise: ") + (e && e.message ? e.message : e)});
		throw e;
	}
};

// Finding 2: see survey_builder — pages construct once, on_page_show runs every visit.
frappe.pages["data-explorer"].on_page_show = function (wrapper) {
	if (wrapper.ucc) wrapper.ucc.applyRouteOptions();
};

const XAPI = "ucc_measurement_outcomes.api.explorer.";

class DataExplorer {
	constructor(page) {
		this.page = page;
		this.catalogue = {};
		this.pending = [];
		this.sel = { dataset: null, measure: null, row: null, column: null };
		this._build();
		frappe.call({
			method: XAPI + "list_datasets",
			callback: (r) => {
				this.catalogue = (r.message && r.message.datasets) || {};
				this.pending = (r.message && r.message.pending) || [];
				this._initControls();
				this._applyPendingDataset();   // finding 2: arrived via deep link
			},
		});
		this.applyRouteOptions();
	}

	// Finding 2: deep-link entry point (idempotent, clears route_options).
	applyRouteOptions() {
		const opts = frappe.route_options || {};
		frappe.route_options = {};
		if (opts.dataset) {
			this._pendingDataset = opts.dataset;
			this._applyPendingDataset();
		}
	}

	_applyPendingDataset() {
		if (!this._pendingDataset || !this.dsField) return;
		const name = this._pendingDataset;
		if (!Object.keys(this.catalogue).includes(name)) return;   // not an approved dataset
		this._pendingDataset = null;
		this.dsField.val(name).trigger("change");
		this.run();
	}

	_build() {
		const $m = $(this.page.main).empty();
		this.$trail = $('<div></div>').appendTo($m);   // finding 1
		this.$controls = $('<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px"></div>').appendTo($m);
		const $bar = $('<div style="display:flex;gap:8px;margin-top:10px"></div>').appendTo($m);
		$(`<button class="btn btn-primary btn-sm">${__("Run")}</button>`).appendTo($bar).on("click", () => this.run());
		$(`<button class="btn btn-default btn-sm">${__("Export CSV")}</button>`).appendTo($bar).on("click", () => this.exportAs("csv"));
		$(`<button class="btn btn-default btn-sm">${__("Export JSON")}</button>`).appendTo($bar).on("click", () => this.exportAs("json"));
		this.$note = $('<div class="text-muted" style="font-size:11px;margin-top:8px"></div>').appendTo($m);
		this.$out = $('<div style="margin-top:14px"></div>').appendTo($m);
		this.$next = $('<div></div>').appendTo($m);   // item 2
		this._renderTrail();
	}

	// Finding 1: show which approved dataset is being queried.
	_renderTrail() {
		if (!window.UCCTrail) return console.warn("[UCC] trail.js not loaded - run: bench build --app ucc_measurement_outcomes && bench restart");
		// Item 1/2: Data Explorer is a side branch, not a pipeline stage — no
		// `current`, so the stepper shows the pipeline for orientation without
		// pretending this page sits inside it.
		window.UCCTrail.render(this.$trail.get(0), {
			context: this.sel.dataset || null,
			stages: { 5: { blocked: __("not built yet") } },
		});
		// Item 2: no forward action — this is a side branch off the pipeline,
		// not a stage in it. Say so instead of inventing a next step.
		if (this.$next) {
			window.UCCTrail.renderNext(this.$next.get(0), {
				note: __("Data Explorer is a side branch — query anything the pipeline has produced. There's no next step from here."),
			});
		}
	}

	_initControls() {
		const datasets = Object.keys(this.catalogue);
		this.$controls.empty();
		// Active datasets are selectable; pending ones appear disabled with a note.
		const dsOptions = datasets.concat(this.pending.map((p) => p.name + " " + __("(pending bench)")));
		this.dsField = this._select("Dataset", dsOptions, (v) => this._onDataset(v));
		this.pending.forEach((p) => {
			this.dsField.find(`option:contains('${p.name}')`).prop("disabled", true);
		});
		this.measureField = this._select("Measure", [], (v) => (this.sel.measure = v));
		this.rowField = this._select("Rows", [], (v) => (this.sel.row = v || null));
		this.colField = this._select("Columns", [], (v) => (this.sel.column = v || null));
		if (this.pending.length) {
			this.$note.html(__("Pending datasets need their external DocTypes confirmed on the bench: ") +
				this.pending.map((p) => frappe.utils.escape_html(p.name)).join(", "));
		}
		if (datasets.length) { this.dsField.val(datasets[0]).trigger("change"); }
	}

	_select(label, options, onChange) {
		const $wrap = $(`<div><label style="font-size:11px;color:var(--text-muted,#8b95a5)">${__(label)}</label></div>`).appendTo(this.$controls);
		const $sel = $('<select class="form-control input-sm"></select>').appendTo($wrap);
		$sel.html(options.map((o) => `<option>${frappe.utils.escape_html(o)}</option>`).join(""));
		$sel.on("change", () => onChange($sel.val()));
		return $sel;
	}

	_fill($sel, options, blankFirst) {
		const opts = (blankFirst ? [""] : []).concat(options);
		$sel.html(opts.map((o) => `<option>${frappe.utils.escape_html(o)}</option>`).join(""));
	}

	_onDataset(name) {
		this.sel.dataset = name;
		this._renderTrail();
		const spec = this.catalogue[name] || { dimensions: [], measures: [] };
		this._fill(this.measureField, spec.measures, false);
		this._fill(this.rowField, spec.dimensions, true);
		this._fill(this.colField, spec.dimensions, true);
		this.sel.measure = this.measureField.val();
		this.sel.row = this.rowField.val() || null;
		this.sel.column = this.colField.val() || null;
	}

	_args() {
		return { dataset: this.sel.dataset, measure: this.sel.measure, row: this.sel.row, column: this.sel.column };
	}

	run() {
		if (!this.sel.dataset || !this.sel.measure) return;
		frappe.call({ method: XAPI + "run_analysis", args: this._args(), callback: (r) => { if (r.message) this._render(r.message); } });
	}

	_render(res) {
		const t = res.table;
		if (!t.rows.length) { this.$out.html(`<div class="text-muted" style="padding:20px">${__("No rows.")}</div>`); return; }
		const head = `<tr><th>${frappe.utils.escape_html(res.row_label)}</th>${t.columns.map((c) => `<th>${frappe.utils.escape_html(String(c))}</th>`).join("")}</tr>`;
		const body = t.rows.map((r) => `<tr><td>${frappe.utils.escape_html(String(r.row))}</td>${t.columns.map((c) => `<td>${this._fmt(r.cells[c])}</td>`).join("")}</tr>`).join("");
		this.$out.html(`<table class="table table-bordered" style="font-size:12px">${head}${body}</table>`);
	}

	_fmt(v) {
		if (v === null || v === undefined) return '<span class="text-muted">—</span>';
		return typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : frappe.utils.escape_html(String(v));
	}

	exportAs(fmt) {
		if (!this.sel.dataset || !this.sel.measure) return;
		frappe.call({
			method: XAPI + "export_analysis",
			args: Object.assign(this._args(), { fmt: fmt }),
			callback: (r) => {
				if (!r.message) return;
				const blob = new Blob([r.message.content], { type: fmt === "json" ? "application/json" : "text/csv" });
				const a = document.createElement("a");
				a.href = URL.createObjectURL(blob);
				a.download = r.message.filename;
				a.click();
				frappe.show_alert({ message: __("Exported {0}", [r.message.filename]), indicator: "green" });
			},
		});
	}
}
