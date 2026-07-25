// Copyright (c) 2026, United Ceres College and contributors
// Index Studio: pick an index version, view/edit its node graph on the shared
// canvas (window.UCCNodeCanvas, reused from Mapping Studio), validate weights,
// and publish. All persistence via whitelisted methods.

frappe.pages["index-studio"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Index Studio"),
		single_column: true,
	});
	// Frappe can swallow exceptions thrown from on_page_load, which hides a
	// half-built page behind a clean console. Surface it loudly instead.
	try {
		wrapper.ucc = new IndexStudio(page);
	} catch (e) {
		console.error("[UCC] index-studio failed to initialise:", e);
		frappe.msgprint({title: __("Page failed to load"), indicator: "red",
			message: __("index-studio could not initialise: ") + (e && e.message ? e.message : e)});
		throw e;
	}
};

// Finding 2: see survey_builder — pages construct once, on_page_show runs every visit.
frappe.pages["index-studio"].on_page_show = function (wrapper) {
	if (wrapper.ucc) wrapper.ucc.applyRouteOptions();
};

const IAPI = "ucc_measurement_outcomes.api.index_studio.";
const NORMALISATIONS = [
	"Likert 1-5 to 0-100", "Yes/No to 100/0", "Reverse 0-100",
	"Ratio to Percentage", "Count", "Hours", "Category Only (No Score)",
];

class IndexStudio {
	constructor(page) {
		this.page = page;
		this.nodes = [];
		this.editable = false;
		this.selectedKey = null;
		this._build();
		this.applyRouteOptions();
	}

	// Finding 2: deep-link entry point (idempotent, clears route_options).
	applyRouteOptions() {
		const opts = frappe.route_options || {};
		frappe.route_options = {};
		if (opts.node_key) this._pendingNodeKey = opts.node_key;
		// ponytail: a metric arriving from Mapping Studio is held until a version
		// is loaded, then its node is selected. Resolving metric -> version
		// server-side would make this one click instead of two; see the note in
		// the session report before adding a lookup method for it.
		if (opts.metric) this._pendingMetric = opts.metric;
		// Decision (b): Mapping Studio hands over the survey context and its
		// already-computed counts, so the stepper can show stages 1-2 when the
		// user arrives through the pipeline. On a cold load they stay neutral —
		// this page has no way to know which survey is in play.
		if (opts.survey_version) {
			this.surveyContext = {
				version: opts.survey_version,
				questions: opts.question_count,
				unmapped: opts.unmapped_count,
			};
		}
		if (opts.index_version) {
			this.versionField.set_value(opts.index_version);   // triggers load()
		} else {
			this._applyPendingSelection();
		}
	}

	_applyPendingSelection() {
		if (!this.nodes || !this.nodes.length) return;
		let node = null;
		if (this._pendingNodeKey) {
			node = this.nodes.find((n) => n.node_key === this._pendingNodeKey);
			this._pendingNodeKey = null;
		}
		if (!node && this._pendingMetric) {
			node = this.nodes.find((n) => n.source_metric === this._pendingMetric);
			if (node) this._pendingMetric = null;   // keep it until a version matches
		}
		if (node) this._select(node.node_key);
	}

	_build() {
		const $main = $(this.page.main).empty();
		this.$trail = $('<div></div>').appendTo($main);   // finding 1
		const $picker = $('<div style="max-width:360px"></div>').appendTo($main);
		this.versionField = frappe.ui.form.make_control({
			parent: $picker.get(0),
			df: {
				// Finding 5: no reqd on a standalone picker (see survey_builder).
				fieldtype: "Link", options: "UCC Index Version", label: __("Index Version"),
				change: () => { const v = this.versionField.get_value(); if (v) this.load(v); },
			},
			render_input: true,
		});
		const $bar = $('<div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap"></div>').appendTo($main);
		this.$template = $('<select class="form-control input-sm" style="width:auto"><option value="">' + __("New from template…") + "</option></select>").appendTo($bar);
		// Track the choice as it changes rather than only reading .val() at click
		// time, so the button cannot depend on the select's state at that instant.
		this.templateCode = "";
		this.$template.on("change", (e) => { this.templateCode = e.target.value || ""; });
		this.$create = $(`<button class="btn btn-primary btn-sm">${__("Create")}</button>`).appendTo($bar);
		this.$create.on("click", () => this._createFromTemplate());
		$('<span style="width:10px"></span>').appendTo($bar);
		this.$validate = $(`<button class="btn btn-default btn-sm">${__("Validate")}</button>`).appendTo($bar).on("click", () => this._validate());
		this.$publish = $(`<button class="btn btn-danger btn-sm">${__("Publish Version")}</button>`).appendTo($bar).on("click", () => this._publish());
		this.$badge = $('<span style="margin-left:6px;font-size:12px"></span>').appendTo($bar);
		frappe.call({
			method: IAPI + "list_index_templates",
			callback: (r) => {
				const templates = r.message || [];
				templates.forEach((t) => {
					this.$template.append(`<option value="${t.code}">${frappe.utils.escape_html(t.name)} (${t.code})</option>`);
				});
				// If the list never arrives the dropdown holds only its placeholder,
				// so Create has nothing to act on. Say so instead of looking idle.
				if (!templates.length) {
					this.$template.append(`<option value="" disabled>${__("(no templates returned)")}</option>`);
					frappe.show_alert({
						message: __("No index templates were returned — is the app fully migrated on this site?"),
						indicator: "orange",
					});
				}
			},
		});
		const $grid = $('<div style="display:grid;grid-template-columns:1fr 320px;gap:14px;margin-top:12px"></div>').appendTo($main);
		this.$canvas = $('<div style="height:560px"></div>').appendTo($grid);
		this.$inspector = $('<div><p class="text-muted" style="font-size:12px">' + __("Click a node to edit its weight, metric and normalisation.") + "</p></div>").appendTo($grid);
		this.canvas = new window.UCCNodeCanvas(this.$canvas.get(0), {
			onSelect: (n) => this._select(n.id),
			onMove: (n) => this._onMove(n),
		});
		// Finding 2: say what to do instead of a bare "No nodes to show".
		this.canvas.setEmpty({
			message: __("Start from a template — SEQI is the usual starting point for student experience."),
		});
		this.$next = $('<div></div>').appendTo($main);   // item 2
		this._renderTrail();
	}

	// Finding 1: show which index version this canvas belongs to.
	_renderTrail() {
		if (!window.UCCTrail) return console.warn("[UCC] trail.js not loaded - run: bench build --app ucc_measurement_outcomes && bench restart");
		// Item 1: stage 3. Knows only the selected version — a published one
		// (editable === false) means the formula is frozen and stage 3 is done.
		// Nothing here can see survey/mapping state, so those stay neutral.
		const stages = {};
		if (this.version) {
			stages[3] = this.editable
				? { note: __("draft — publish it to calculate results") }
				: { done: true };
		}
		// Decision (b): stages 1-2 only when Mapping Studio handed them over.
		const ctx = this.surveyContext;
		if (ctx) {
			stages[1] = { done: (ctx.questions || 0) > 0 };
			stages[2] = ctx.unmapped
				? { note: __("{0} questions still need objectives", [ctx.unmapped]) }
				: { done: true };
		}
		window.UCCTrail.render(this.$trail.get(0), {
			current: 3,
			context: this.version,
			routeOptions: this.version ? { index_version: this.version } : {},
			stages: stages,
		});
		this._renderNext();
	}

	// Item 2: forward action — results live on the dashboard, but only a
	// published version can produce them.
	_renderNext() {
		if (!window.UCCTrail || !this.$next) return;
		if (!this.version) {
			return window.UCCTrail.renderNext(this.$next.get(0), {
				blocked: __("Pick or create an index version first"),
			});
		}
		if (this.editable) {
			return window.UCCTrail.renderNext(this.$next.get(0), {
				blocked: __("Publish this version before results can be calculated"),
			});
		}
		window.UCCTrail.renderNext(this.$next.get(0), {
			label: __("Next: view results on the dashboard →"),
			page: "ucc-dashboard-studio",
			routeOptions: { index_version: this.version },
		});
	}

	_createFromTemplate() {
		// Prefer the tracked value; fall back to reading the select directly.
		const code = this.templateCode || (this.$template && this.$template.val()) || "";
		// Temporary diagnostic: three rounds of remote debugging could not tell
		// "handler never ran" apart from "handler ran with an empty value".
		console.log("[UCC] Create clicked; template code =", JSON.stringify(code));
		// Was a silent `return`, which made a click look like a dead button when
		// nothing was selected (or when the template list failed to load).
		if (!code) {
			frappe.show_alert({
				message: __("Choose a template from the dropdown first."),
				indicator: "orange",
			});
			return;
		}
		frappe.call({
			method: IAPI + "create_index_from_template",
			args: { template_code: code },
			callback: (r) => {
				if (!r.message) return;
				frappe.show_alert({ message: __("Created {0}", [r.message]), indicator: "green" });
				this.versionField.set_value(r.message);   // loads the new draft version
			},
		});
	}

	load(version) {
		frappe.call({
			method: IAPI + "get_index_builder",
			args: { index_version: version },
			callback: (r) => {
				if (!r.message) return;
				this.version = version;
				this.indexCode = r.message.index;
				this.nodes = r.message.nodes || [];
				this.editable = !!r.message.editable;
				this.selectedKey = null;
				this.$publish.prop("disabled", !this.editable);
				this.$badge.text(this.editable ? "" : __("Published (read-only)"));
				this._renderCanvas();
				this._renderInspector();
				this._renderTrail();
				this._applyPendingSelection();   // finding 2: arrived via deep link
			},
		});
	}

	_renderCanvas() {
		// Map stored nodes to canvas nodes; edges from parent_key wiring.
		const cnodes = this.nodes.map((n, i) => ({
			id: n.node_key,
			type: (n.node_type || "metric").toLowerCase(),
			title: n.label || n.node_key,
			sub: n.node_type === "Metric" ? (n.source_metric || "") + (n.weight ? ` · ${n.weight}%` : "") : (n.weight ? `${n.weight}%` : ""),
			x: n.pos_x || 40 + (i % 3) * 220,
			y: n.pos_y || 40 + Math.floor(i / 3) * 120,
		}));
		const edges = this.nodes.filter((n) => n.parent_key).map((n) => [n.node_key, n.parent_key]);
		this.canvas.setGraph(cnodes, edges);
		// Finding 2: a blank draft had no way to create a first node.
		if (!cnodes.length) {
			this.canvas.setEmpty({
				message: this.editable
					? __("This index version has no nodes yet.")
					: __("This published version has no nodes."),
				actionLabel: this.editable ? __("+ Add root node") : null,
				onAction: this.editable ? () => this._addRootNode() : null,
			});
		}
	}

	_addRootNode() {
		// The root is the index node itself; dimensions/metrics hang off it.
		this.nodes.push({
			node_key: "root", node_type: "Index",
			label: this.indexCode || __("Index"),
			parent_key: null, weight: 0, pos_x: 60, pos_y: 60,
		});
		this._save(() => {
			this._renderCanvas();
			frappe.show_alert({ message: __("Root node added"), indicator: "green" });
		});
	}

	_onMove(cnode) {
		const n = this.nodes.find((x) => x.node_key === cnode.id);
		if (n) { n.pos_x = cnode.x; n.pos_y = cnode.y; }
		this._save(); // persist layout (draft only; blocked server-side if frozen)
	}

	_select(key) {
		this.selectedKey = key;
		this._renderInspector();
	}

	_renderInspector() {
		const n = this.nodes.find((x) => x.node_key === this.selectedKey);
		if (!n) {
			this.$inspector.html('<p class="text-muted" style="font-size:12px">' + __("Click a node to edit its weight, metric and normalisation.") + "</p>");
			return;
		}
		const dis = this.editable ? "" : "disabled";
		const isMetric = n.node_type === "Metric";
		const normOpts = NORMALISATIONS.map((o) => `<option ${o === n.normalisation ? "selected" : ""}>${o}</option>`).join("");
		this.$inspector.html(`
			<h5 style="margin-top:0">${frappe.utils.escape_html(n.label || n.node_key)} <span class="text-muted" style="font-size:11px">(${n.node_type})</span></h5>
			<div class="form-group"><label>${__("Label")}</label><input class="form-control" data-f="label" value="${frappe.utils.escape_html(n.label || "")}" ${dis}></div>
			<div class="form-group"><label>${__("Weight (%)")}</label><input type="number" class="form-control" data-f="weight" value="${n.weight || 0}" ${dis}></div>
			${isMetric ? `
			<div class="form-group"><label>${__("Source Metric")}</label><input class="form-control" data-f="source_metric" value="${frappe.utils.escape_html(n.source_metric || "")}" placeholder="Metric code" ${dis}></div>
			<div class="form-group"><label>${__("Normalisation")}</label><select class="form-control" data-f="normalisation" ${dis}>${normOpts}</select></div>
			<div class="checkbox"><label><input type="checkbox" data-f="reverse_scored" ${n.reverse_scored ? "checked" : ""} ${dis}> ${__("Reverse Scored")}</label></div>` : ""}
			${this.editable ? `<button class="btn btn-primary btn-sm btn-block ucc-idx-apply">${__("Apply")}</button>` : ""}
		`);
		this.$inspector.find(".ucc-idx-apply").on("click", () => this._apply(n));
	}

	_apply(n) {
		const g = (f) => this.$inspector.find(`[data-f="${f}"]`);
		n.label = g("label").val();
		n.weight = parseFloat(g("weight").val()) || 0;
		if (n.node_type === "Metric") {
			n.source_metric = g("source_metric").val();
			n.normalisation = g("normalisation").val();
			n.reverse_scored = g("reverse_scored").is(":checked") ? 1 : 0;
		}
		this._save(() => { this._renderCanvas(); frappe.show_alert({ message: __("Node updated"), indicator: "green" }); });
	}

	_save(cb) {
		if (!this.editable) return;
		frappe.call({
			method: IAPI + "save_nodes",
			args: { index_version: this.version, nodes: JSON.stringify(this.nodes) },
			callback: () => cb && cb(),
		});
	}

	_validate() {
		frappe.call({
			method: IAPI + "validate_index",
			args: { index_version: this.version },
			callback: (r) => {
				if (!r.message) return;
				if (r.message.valid) {
					this.$badge.css("color", "var(--green,#237a57)").text(__("Weights valid"));
				} else {
					this.$badge.css("color", "var(--red,#b94848)").text(r.message.issues.join(" "));
				}
			},
		});
	}

	_publish() {
		frappe.confirm(__("Publish this index version? It becomes immutable."), () => {
			frappe.call({
				method: IAPI + "publish_version",
				args: { index_version: this.version },
				callback: () => { frappe.show_alert({ message: __("Published"), indicator: "green" }); this.load(this.version); },
			});
		});
	}
}
