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
	wrapper.ucc = new MappingStudio(page);
};

// Finding 2: see survey_builder — pages construct once, on_page_show runs every visit.
frappe.pages["mapping-studio"].on_page_show = function (wrapper) {
	if (wrapper.ucc) wrapper.ucc.applyRouteOptions();
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
		this.applyRouteOptions();
	}

	// Finding 2: deep-link entry point (idempotent, clears route_options).
	applyRouteOptions() {
		const opts = frappe.route_options || {};
		frappe.route_options = {};
		if (opts.question) this._pendingQuestion = opts.question;
		if (opts.survey_version) {
			this.versionField.set_value(opts.survey_version);   // triggers load()
		} else {
			this._applyPendingQuestion();
		}
	}

	_applyPendingQuestion() {
		if (!this._pendingQuestion) return;
		const name = this._pendingQuestion;
		this._pendingQuestion = null;
		if (this.rows.some((r) => r.name === name)) this._select(name);
	}

	_build() {
		const $main = $(this.page.main).empty();
		this.$trail = $('<div></div>').appendTo($main);   // finding 1
		const $picker = $('<div style="max-width:360px"></div>').appendTo($main);
		this.versionField = frappe.ui.form.make_control({
			parent: $picker.get(0),
			df: {
				fieldtype: "Link",
				options: "UCC Survey Version",
				// Finding 5: no reqd on a standalone picker (see survey_builder).
				label: __("Survey Version"),
				change: () => { const v = this.versionField.get_value(); if (v) this.load(v); },
			},
			render_input: true,
		});
		this.$coverage = $('<div class="ucc-map-coverage" style="margin-top:12px"></div>').appendTo($main);
		const $grid = $('<div style="display:grid;grid-template-columns:1.4fr 320px;gap:14px;margin-top:12px"></div>').appendTo($main);
		const $left = $('<div></div>').appendTo($grid);
		this.$table = $('<div class="ucc-map-table"></div>').appendTo($left);
		this.$canvas = $('<div style="height:360px;margin-top:12px"></div>').appendTo($left);
		this.$inspector = $('<div class="ucc-map-inspector"><p class="text-muted" style="font-size:12px">' +
			__("Select a question to edit its objective and metric mapping.") + "</p></div>").appendTo($grid);
		this.canvas = new window.UCCNodeCanvas(this.$canvas.get(0), {});
		// Finding 2: say what to do instead of a bare "No nodes to show".
		this.canvas.setEmpty({ message: __("Select a Survey Version above to begin.") });
		this._renderTrail();
	}

	// Finding 1: Survey Studio is upstream of this page — make that clickable.
	_renderTrail() {
		if (!window.UCCTrail) return console.warn("[UCC] trail.js not loaded - run: bench build --app ucc_measurement_outcomes && bench restart");
		const segs = [];
		if (this.version) {
			segs.push({
				label: __("Survey Studio") + " · " + this.version,
				page: "ucc-survey-builder",
				routeOptions: { survey_version: this.version },
			});
		}
		segs.push({ label: __("Mapping Studio") });
		// Finding 5: same live count as the coverage panel below — one source.
		const aside = this.coverage ? {
			label: __("Unmapped"),
			badge: this.coverage.questions_without_objective.length,
		} : null;
		window.UCCTrail.render(this.$trail.get(0), segs, aside);
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
				this.canvas.setEmpty({
					message: __("Select a question in the table to see its objective, clause and metric lineage."),
				});
				this.$inspector.html('<p class="text-muted" style="font-size:12px">' +
					__("Select a question to edit its objective and metric mapping.") + "</p>");
				this._loadCoverage();
				this._renderTrail();
				this._applyPendingQuestion();   // finding 2: arrived via deep link
			},
		});
	}

	_loadCoverage() {
		frappe.call({
			method: MAPI + "mapping_coverage",
			args: { survey_version: this.version },
			callback: (r) => {
				if (!r.message) return;
				this.coverage = r.message;
				this._renderCoverage();
				this._renderTable();   // finding 3: table flags depend on coverage
				this._renderTrail();   // finding 5: badge reflects the same count
			},
		});
	}

	_renderCoverage() {
		const c = this.coverage;
		const cnt = c.counts;
		const gapList = (title, names, cls) => {
			if (!names.length) return `<div style="flex:1"><b>${title}</b><div class="text-muted" style="font-size:11px">${__("None")}</div></div>`;
			const chips = names.map((n) => `<span class="indicator-pill ${cls}" data-gap="${frappe.utils.escape_html(n)}" style="cursor:pointer;margin:2px">${frappe.utils.escape_html((c.question_text && c.question_text[n]) ? c.question_text[n].slice(0, 24) : n)}</span>`).join("");
			return `<div style="flex:1"><b>${title} (${names.length})</b><div style="margin-top:4px">${chips}</div></div>`;
		};
		const dupCount = c.duplicate_questions.length;
		this.$coverage.html(`
			<div class="panel" style="border:1px solid var(--border-color,#e2e6ea);border-radius:8px;padding:12px">
				<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
					<span class="indicator-pill blue">${__("Questions")}: ${cnt.questions_mapped}/${cnt.questions} ${__("mapped")}</span>
					<span class="indicator-pill ${cnt.objectives_used < cnt.objectives ? "orange" : "green"}">${__("Objectives used")}: ${cnt.objectives_used}/${cnt.objectives}</span>
					<span class="indicator-pill ${dupCount ? "red" : "green"}">${__("Duplicate questions")}: ${dupCount}</span>
				</div>
				<div style="display:flex;gap:16px;flex-wrap:wrap">
					${gapList(__("No objective"), c.questions_without_objective, "red")}
					${gapList(__("No clause"), c.questions_without_clause, "orange")}
					<div style="flex:1"><b>${__("Unmapped objectives")} (${c.unmapped_objectives.length})</b><div style="margin-top:4px">${c.unmapped_objectives.map((o) => `<span class="indicator-pill gray" style="margin:2px">${frappe.utils.escape_html(o)}</span>`).join("") || '<span class="text-muted" style="font-size:11px">' + __("None") + "</span>"}</div></div>
				</div>
			</div>`);
		this.$coverage.find("[data-gap]").on("click", (e) => this._select($(e.currentTarget).data("gap")));
	}

	_isUnmapped(name) {
		return this.coverage && this.coverage.questions_without_objective.indexOf(name) !== -1;
	}

	_renderTable() {
		const head = `<thead><tr>
			<th>#</th><th>${__("Question")}</th><th>${__("Objective")}</th>
			<th>${__("Clause")}</th><th>${__("Metrics")}</th></tr></thead>`;
		const body = this.rows.map((q, i) => {
			const metrics = (q.metrics || []).join(", ");
			// Finding 2: the metric cell is the hop into Index Studio; the question
			// text is the hop back to Survey Builder.
			const metricCell = metrics
				? (q.metrics || []).map((m) => `<span class="indicator-pill green ucc-map-metric-link" data-metric="${frappe.utils.escape_html(m)}" style="cursor:pointer" title="${__("Open in Index Studio")}">${frappe.utils.escape_html(m)} →</span>`).join(" ")
				: '<span class="text-muted">—</span>';
			// Finding 3: the table used to decide "unmapped" from q.objective while
			// the canvas used the coverage method — two sources for one fact. Both
			// now read _isUnmapped(), i.e. api.mapping.mapping_coverage.
			const isGap = this._isUnmapped(q.name);
			return `<tr data-name="${q.name}" class="${isGap ? "ucc-map-gap" : ""}" style="cursor:pointer">
				<td>${i + 1}</td>
				<td><span class="ucc-map-q-link" style="cursor:pointer;text-decoration:underline dotted" title="${__("Open in Survey Builder")}">${frappe.utils.escape_html((q.question_text || "").slice(0, 70))}</span></td>
				<td>${isGap ? `<span class="indicator-pill red">${__("unmapped")}</span>` : `<span class="indicator-pill blue">${frappe.utils.escape_html(q.objective || "")}</span>`}</td>
				<td>${frappe.utils.escape_html(q.primary_clause || "—")}</td>
				<td>${metricCell}</td>
			</tr>`;
		}).join("");
		this.$table.html(`<table class="table table-bordered" style="font-size:12px">${head}<tbody>${body}</tbody></table>`);
		this.$table.find("tbody tr").on("click", (e) => this._select($(e.currentTarget).data("name")));
		this.$table.find(".ucc-map-metric-link").on("click", (e) => {
			e.stopPropagation();
			frappe.route_options = { metric: $(e.currentTarget).data("metric") };
			frappe.set_route("index-studio");
		});
		this.$table.find(".ucc-map-q-link").on("click", (e) => {
			e.stopPropagation();
			frappe.route_options = {
				survey_version: this.version,
				question: $(e.currentTarget).closest("tr").data("name"),
			};
			frappe.set_route("ucc-survey-builder");
		});
	}

	_select(name) {
		this.selected = name;
		const q = this.rows.find((x) => x.name === name);
		if (!q) return;
		this._renderLineage(q);
		this._renderInspector(q);
	}

	_renderLineage(q) {
		// question -> objective, question -> clause, question -> metric(s).
		// Unmapped questions (no objective) render as a red "gap" node.
		const qType = this._isUnmapped(q.name) ? "gap" : "question";
		const qSub = this._isUnmapped(q.name) ? __("Unmapped — no objective") : q.question_type;
		const nodes = [{ id: "q", type: qType, title: (q.question_text || "").slice(0, 40), sub: qSub, x: 40, y: 150 }];
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
