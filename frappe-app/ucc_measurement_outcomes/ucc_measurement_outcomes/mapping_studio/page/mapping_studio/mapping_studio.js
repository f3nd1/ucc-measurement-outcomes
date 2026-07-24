// Copyright (c) 2026, United Ceres College and contributors
// Mapping Studio: pick a version, see each question's objective + metric mapping
// in a table, edit it via whitelisted methods, and view a selected question's
// lineage on the shared node canvas (window.UCCNodeCanvas).

frappe.pages["mapping-studio"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Mapping Studio"),
		single_column: true,
	});
	new MappingStudio(page);
};

const MAPI = "ucc_measurement_outcomes.api.mapping.";

class MappingStudio {
	constructor(page) {
		this.page = page;
		this.rows = [];
		this.masters = { objectives: [], standards: [], metrics: [] };
		this.selected = null;
		this._build();
		frappe.call({ method: MAPI + "mapping_masters", callback: (r) => { if (r.message) this.masters = r.message; } });
	}

	_build() {
		const $main = $(this.page.main).empty();
		const $picker = $('<div style="max-width:360px"></div>').appendTo($main);
		this.versionField = frappe.ui.form.make_control({
			parent: $picker.get(0),
			df: {
				fieldtype: "Link",
				options: "UCC Survey Version",
				label: __("Survey Version"),
				reqd: 1,
				change: () => { const v = this.versionField.get_value(); if (v) this.load(v); },
			},
			render_input: true,
		});
		const $grid = $('<div style="display:grid;grid-template-columns:1.4fr 320px;gap:14px;margin-top:12px"></div>').appendTo($main);
		const $left = $('<div></div>').appendTo($grid);
		this.$table = $('<div class="ucc-map-table"></div>').appendTo($left);
		this.$canvas = $('<div style="height:360px;margin-top:12px"></div>').appendTo($left);
		this.$inspector = $('<div class="ucc-map-inspector"><p class="text-muted" style="font-size:12px">' +
			__("Select a question to edit its objective and metric mapping.") + "</p></div>").appendTo($grid);
		this.canvas = new window.UCCNodeCanvas(this.$canvas.get(0), {});
	}

	load(version) {
		frappe.call({
			method: MAPI + "get_mapping_overview",
			args: { survey_version: version },
			callback: (r) => {
				if (!r.message) return;
				this.version = version;
				this.rows = r.message.questions || [];
				this.selected = null;
				this._renderTable();
				this.canvas.setGraph([], []);
				this.$inspector.html('<p class="text-muted" style="font-size:12px">' +
					__("Select a question to edit its objective and metric mapping.") + "</p>");
			},
		});
	}

	_renderTable() {
		const head = `<thead><tr>
			<th>#</th><th>${__("Question")}</th><th>${__("Objective")}</th>
			<th>${__("Clause")}</th><th>${__("Metrics")}</th></tr></thead>`;
		const body = this.rows.map((q, i) => {
			const metrics = (q.metrics || []).join(", ");
			return `<tr data-name="${q.name}" style="cursor:pointer">
				<td>${i + 1}</td>
				<td>${frappe.utils.escape_html((q.question_text || "").slice(0, 70))}</td>
				<td>${q.objective ? `<span class="indicator-pill blue">${frappe.utils.escape_html(q.objective)}</span>` : '<span class="text-muted">—</span>'}</td>
				<td>${frappe.utils.escape_html(q.primary_clause || "—")}</td>
				<td>${metrics ? `<span class="indicator-pill green">${frappe.utils.escape_html(metrics)}</span>` : '<span class="text-muted">—</span>'}</td>
			</tr>`;
		}).join("");
		this.$table.html(`<table class="table table-bordered" style="font-size:12px">${head}<tbody>${body}</tbody></table>`);
		this.$table.find("tbody tr").on("click", (e) => this._select($(e.currentTarget).data("name")));
	}

	_select(name) {
		this.selected = name;
		const q = this.rows.find((x) => x.name === name);
		if (!q) return;
		this._renderLineage(q);
		this._renderInspector(q);
	}

	_renderLineage(q) {
		// question -> objective, question -> clause, question -> metric(s)
		const nodes = [{ id: "q", type: "question", title: (q.question_text || "").slice(0, 40), sub: q.question_type, x: 40, y: 150 }];
		const edges = [];
		if (q.objective) { nodes.push({ id: "obj", type: "objective", title: q.objective, sub: __("Objective"), x: 300, y: 40 }); edges.push(["q", "obj"]); }
		if (q.primary_clause) { nodes.push({ id: "cl", type: "clause", title: q.primary_clause, sub: q.standard || "", x: 300, y: 150 }); edges.push(["q", "cl"]); }
		(q.metrics || []).forEach((m, i) => { nodes.push({ id: "m" + i, type: "metric", title: m, sub: __("Metric"), x: 300, y: 260 + i * 90 }); edges.push(["q", "m" + i]); });
		this.canvas.setGraph(nodes, edges);
	}

	_renderInspector(q) {
		const opt = (arr, val, key) =>
			['<option value=""></option>'].concat(
				arr.map((o) => `<option value="${o.name}" ${o.name === val ? "selected" : ""}>${frappe.utils.escape_html(o.name)}</option>`)
			).join("");
		this.$inspector.html(`
			<h5 style="margin-top:0">${__("Objective Mapping")}</h5>
			<div class="form-group"><label>${__("Objective")}</label><select class="form-control" data-f="objective">${opt(this.masters.objectives, q.objective)}</select></div>
			<div class="form-group"><label>${__("Standard")}</label><select class="form-control" data-f="standard">${opt(this.masters.standards, q.standard)}</select></div>
			<div class="form-group"><label>${__("Primary Clause")}</label><input class="form-control" data-f="primary_clause" value="${frappe.utils.escape_html(q.primary_clause || "")}"></div>
			<div class="form-group"><label>${__("Related Clauses")}</label><textarea class="form-control" data-f="related_clauses">${frappe.utils.escape_html(q.related_clauses || "")}</textarea></div>
			<button class="btn btn-primary btn-sm btn-block ucc-map-save">${__("Save Objective Mapping")}</button>
			<hr>
			<h5>${__("Metric Mapping")}</h5>
			<div class="form-group"><label>${__("Metric Code")}</label><input class="form-control" data-f="metric_code" placeholder="e.g. TEACHING_CLARITY"></div>
			<button class="btn btn-default btn-sm btn-block ucc-map-metric">${__("Add As Metric Source")}</button>
		`);
		this.$inspector.find(".ucc-map-save").on("click", () => this._saveMapping(q.name));
		this.$inspector.find(".ucc-map-metric").on("click", () => this._saveMetric(q.name));
	}

	_val(f) { return this.$inspector.find(`[data-f="${f}"]`).val(); }

	_saveMapping(name) {
		if (!this._val("objective")) {
			frappe.show_alert({ message: __("Objective is required."), indicator: "orange" });
			return;
		}
		frappe.call({
			method: MAPI + "upsert_question_mapping",
			args: {
				question: name,
				objective: this._val("objective"),
				standard: this._val("standard"),
				primary_clause: this._val("primary_clause"),
				related_clauses: this._val("related_clauses"),
			},
			callback: () => { frappe.show_alert({ message: __("Mapping saved"), indicator: "green" }); this.load(this.version); },
		});
	}

	_saveMetric(name) {
		const code = (this._val("metric_code") || "").trim();
		if (!code) { frappe.show_alert({ message: __("Enter a metric code."), indicator: "orange" }); return; }
		frappe.call({
			method: MAPI + "set_question_metric",
			args: { question: name, metric_code: code },
			callback: () => { frappe.show_alert({ message: __("Metric source added"), indicator: "green" }); this.load(this.version); },
		});
	}
}
