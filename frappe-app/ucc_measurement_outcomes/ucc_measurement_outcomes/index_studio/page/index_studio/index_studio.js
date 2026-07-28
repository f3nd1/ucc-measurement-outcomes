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

// What each rule actually does, taken from index_engine.normalise so the label
// and the arithmetic cannot drift apart. "Likert 1-5 to 0-100" tells you nothing
// about where a 4 lands.
const NORM_HELP = {
	"Likert 1-5 to 0-100": "1 → 0, 3 → 50, 5 → 100. Anything outside 1–5 is clamped.",
	"Yes/No to 100/0": "Any non-zero value → 100, zero → 0.",
	"Reverse 0-100": "Flips an existing 0–100 score: 30 → 70. Already reversed, so the Reverse Scored box is ignored.",
	"Ratio to Percentage": "Multiplies by 100: 0.8 → 80. Clamped to 0–100.",
	"Count": "Left as-is. A raw count, not a 0–100 score.",
	"Hours": "Left as-is. Raw hours, not a 0–100 score.",
	"Category Only (No Score)": "Never scored. Contributes nothing to the index.",
};

class IndexStudio {
	constructor(page) {
		this.page = page;
		this.nodes = [];
		this.metrics = [];
		this.editable = false;
		this.selectedKey = null;
		this._injectStyle();
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

	_injectStyle() {
		if (document.getElementById("ucc-idx-style")) return;
		const el = document.createElement("style");
		el.id = "ucc-idx-style";
		el.textContent = `
		.ucc-idx-norm{border-radius:8px;padding:9px 11px;margin:0 0 12px;font-size:12px}
		.ucc-idx-norm .l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;opacity:.75}
		.ucc-idx-norm.ok{background:#e8f5ef;color:#1c5e44;border:1px solid #bfe0d1}
		.ucc-idx-norm.warn{background:#fff8ea;color:#715824;border:1px solid #ecd6aa}
		.ucc-idx-norm.bad{background:#fdf6f6;color:#8f3838;border:1px solid #e0b4b4}
		.ucc-idx-norm.none{background:#f2f5f9;color:#5b6672;border:1px solid #dbe1e8}
		.ucc-idx-help{font-size:11px;opacity:.85;margin-top:4px}
		.ucc-idx-note{font-size:11px;color:#8b95a5;margin-top:6px}
		.ucc-idx-doc{margin-bottom:12px}
		.ucc-idx-doc summary{font-size:11px;color:#8b95a5;cursor:pointer}
		`;
		document.head.appendChild(el);
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
		this.$create = $(`<button class="btn btn-default btn-sm">${__("Create")}</button>`).appendTo($bar);
		this.$create.on("click", () => this._createFromTemplate());
		$('<span style="width:10px"></span>').appendTo($bar);
		// Born disabled. this.version is only set in load()'s callback, so on a
		// cold page these two were live with nothing loaded: clicking Validate
		// sent index_version: undefined, frappe.call dropped the undefined key,
		// and the endpoint got {} and raised a TypeError. Publish had exactly the
		// same hole (its disabled state was also only ever set inside load()).
		// load() re-enables them.
		this.$validate = $(`<button class="btn btn-default btn-sm" disabled>${__("Validate")}</button>`).appendTo($bar).on("click", () => this._validate());
		// Item 4: Publish is the page's consequential action, but it is not
		// destructive — btn-danger read as "this deletes something". btn-primary
		// gives it the weight; irreversibility is carried by _publish()'s confirm.
		// Create drops to btn-default so the primary slot is not contested.
		this.$publish = $(`<button class="btn btn-primary btn-sm" disabled>${__("Publish Version")}</button>`).appendTo($bar).on("click", () => this._publish());
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
		this.$inspector = $('<div><p class="text-muted" style="font-size:12px">' + __("Click a node to edit it.") + "</p></div>").appendTo($grid);
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
		// Same gate as the other stages: with no version picked the map was empty
		// and the stepper showed no state. Say what it is waiting for.
		const stages = {};
		if (this.version) {
			stages[3] = this.editable
				? { note: __("draft — publish it to calculate results") }
				: { done: true };
		} else {
			stages[3] = { note: __("pick or create an index version") };
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
				this.metrics = r.message.metrics || [];
				this.editable = !!r.message.editable;
				this.selectedKey = null;
				this.$validate.prop("disabled", false);
			this.$publish.prop("disabled", !this.editable);
				this.$badge.text(this.editable ? "" : __("Published (read-only)"));
				// (a) The template picker is a CREATE-NEW control and never
				// describes what is loaded, but it sits next to the version field
				// and reads as if it does — a leftover "SAPI" beside a loaded
				// SEQI-V03 invites pressing Create on the wrong index. Reset it so
				// it can only ever show its placeholder while a version is open.
				this.templateCode = "";
				if (this.$template) this.$template.val("");
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

	// Node keys are the formula's identity - they appear in Score Breakdown rows
	// and in deep links - so they must be unique and must not be reused after a
	// removal. Derive from the parent and probe past anything taken.
	_freeKey(parentKey) {
		const taken = new Set(this.nodes.map((n) => n.node_key));
		const base = `${parentKey || "n"}_`;
		let i = 0;
		while (taken.has(base + i)) i += 1;
		return base + i;
	}

	// The node set is saved wholesale by save_nodes, so adding is just pushing
	// onto this.nodes - the same mechanism _addRootNode already uses. No new
	// endpoint, no schema change.
	_addChild(parent) {
		if (!this.editable) return;
		frappe.prompt(
			[
				{ fieldname: "node_type", fieldtype: "Select", label: __("Type"), reqd: 1,
				  options: "Dimension\nMetric", default: "Metric",
				  description: __("A Dimension groups other nodes. A Metric carries a score.") },
				{ fieldname: "label", fieldtype: "Data", label: __("Label"), reqd: 1 },
			],
			(v) => {
				const i = this.nodes.length;
				this.nodes.push({
					node_key: this._freeKey(parent.node_key),
					node_type: v.node_type,
					label: v.label,
					parent_key: parent.node_key,
					// Added at 0%, never by silently rebalancing its siblings:
					// rewriting weights the user did not touch is how a published
					// score stops being reproducible. Validate reports the 0% as a
					// warning; the user rebalances deliberately.
					weight: 0,
					// Same default grid _renderCanvas uses for unpositioned nodes.
					pos_x: 40 + (i % 3) * 220,
					pos_y: 40 + Math.floor(i / 3) * 120,
				});
				this._save(() => {
					this._renderCanvas();
					this._select(this.nodes[this.nodes.length - 1].node_key);
					frappe.show_alert({ indicator: "green", message: __(
						"{0} added at 0% — set its weight, then Validate.", [v.label]) });
				});
			},
			__("Add a node under {0}", [parent.label || parent.node_key]),
			__("Add")
		);
	}

	_removeNode(n) {
		if (!this.editable) return;
		// Cascading would silently destroy the mapping work hanging beneath a
		// dimension. Make the user remove children deliberately instead.
		const kids = this.nodes.filter((x) => x.parent_key === n.node_key);
		if (kids.length) {
			return frappe.msgprint({
				title: __("Remove its children first"),
				indicator: "orange",
				message: __("{0} still has {1} node(s) under it: {2}. Removing it would take them with it.",
					[n.label || n.node_key, kids.length,
					 kids.map((k) => k.label || k.node_key).join(", ")]),
			});
		}
		if (!n.parent_key) {
			return frappe.msgprint({
				title: __("Cannot remove the root"),
				indicator: "orange",
				message: __("The root node is the index itself. Remove the version instead."),
			});
		}
		frappe.confirm(
			__("Remove {0}? Its parent's weights will no longer total 100%, so Validate will fail until you rebalance them.",
			   [n.label || n.node_key]),
			() => {
				this.nodes = this.nodes.filter((x) => x.node_key !== n.node_key);
				this.selectedKey = null;
				this._save(() => {
					this._renderCanvas();
					this._renderInspector();
					this._validate();   // show the now-broken total immediately
					frappe.show_alert({ indicator: "orange", message: __("{0} removed", [n.label || n.node_key]) });
				});
			}
		);
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

	// The one thing the inspector must say unambiguously: what rule turns this
	// node's raw value into a score, and whether one applies at all.
	_normalisationPanel(n, metric) {
		if (!n.source_metric) {
			return `<div class="ucc-idx-norm none">
				<b>${__("No source metric")}</b><br>
				${__("This node scores nothing until a metric is chosen, so no normalisation applies to it yet.")}
			</div>`;
		}
		if (!metric) {
			// Selected metric is not in the list: it was deleted, or the code was
			// typed before this became a select.
			return `<div class="ucc-idx-norm bad">
				<b>${__("Metric not found")}</b><br>
				${__("'{0}' does not exist, so this node cannot score. Pick one from the list.", [n.source_metric])}
			</div>`;
		}
		if (metric.mixed_normalisation) {
			return `<div class="ucc-idx-norm warn">
				<b>${__("Mixed rules")}</b><br>
				${__("{0} has sources using different normalisation rules, so no single rule describes this node. Open it in Mapping Studio to see them.", [metric.name])}
			</div>`;
		}
		const rule = metric.effective_normalisation;
		if (!rule) {
			return `<div class="ucc-idx-norm bad">
				<b>${__("No rule set")}</b><br>
				${__("{0} has no normalisation rule, so its answers are refused rather than scored — the index will treat this node as missing.", [metric.name])}
			</div>`;
		}
		return `<div class="ucc-idx-norm ok">
			<div class="l">${__("Active rule, from {0}", [frappe.utils.escape_html(metric.name)])}</div>
			<b>${frappe.utils.escape_html(rule)}</b>
			<div class="ucc-idx-help">${frappe.utils.escape_html(NORM_HELP[rule] || "")}</div>
		</div>`;
	}

	_renderInspector() {
		const n = this.nodes.find((x) => x.node_key === this.selectedKey);
		if (!n) {
			// (b) Was "edit its weight, metric and normalisation" — true only for
			// Metric nodes. Clicking a Dimension correctly shows Label + Weight
			// alone, which read as a half-broken panel against that promise.
			this.$inspector.html('<p class="text-muted" style="font-size:12px">' + __("Click a node to edit it.") + "</p>");
			return;
		}
		const dis = this.editable ? "" : "disabled";
		const isMetric = n.node_type === "Metric";
		const normOpts = NORMALISATIONS.map((o) => `<option ${o === n.normalisation ? "selected" : ""}>${o}</option>`).join("");
		const metric = (this.metrics || []).find((m) => m.name === n.source_metric);
		const metricOpts = ['<option value=""></option>'].concat(
			(this.metrics || []).map((m) =>
				`<option value="${frappe.utils.escape_html(m.name)}" ${m.name === n.source_metric ? "selected" : ""}>${
					frappe.utils.escape_html(m.name)}${m.metric_name ? " — " + frappe.utils.escape_html(m.metric_name) : ""}</option>`)
		).join("");
		// The rule that ACTUALLY runs lives on the metric's sources, not here.
		// Normalisation happens once at the metric layer; the index applies
		// weights only (docs/09-decision-log.md). So state the effective rule
		// plainly and stop presenting the node's own field as if it drives a score.
		const effective = this._normalisationPanel(n, metric);
		this.$inspector.html(`
			<h5 style="margin-top:0">${frappe.utils.escape_html(n.label || n.node_key)} <span class="text-muted" style="font-size:11px">(${n.node_type})</span></h5>
			<p class="text-muted" style="font-size:11px;margin-top:-4px">${
				isMetric
					? __("Carries a metric: its score comes from the metric named below.")
					: n.node_type === "Index"
						? __("The index root. Its score is the weighted roll-up of everything beneath it.")
						: __("A grouping. It carries weight only — the metrics sit on the nodes beneath it.")
			}</p>
			<div class="form-group"><label>${__("Label")}</label><input class="form-control" data-f="label" value="${frappe.utils.escape_html(n.label || "")}" ${dis}></div>
			<div class="form-group"><label>${__("Weight (%)")}</label><input type="number" class="form-control" data-f="weight" value="${n.weight || 0}" ${dis}></div>
			${isMetric ? `
			<div class="form-group"><label>${__("Source Metric")}</label>
				<select class="form-control" data-f="source_metric" ${dis}>${metricOpts}</select></div>
			${effective}
			<details class="ucc-idx-doc"${n.normalisation ? "" : ""}>
				<summary>${__("Node normalisation note")}</summary>
				<div class="form-group" style="margin-top:8px"><select class="form-control" data-f="normalisation" ${dis}>${normOpts}</select></div>
				<div class="ucc-idx-help">${frappe.utils.escape_html(NORM_HELP[n.normalisation] || __("No rule chosen."))}</div>
				<div class="ucc-idx-note">${__("Documentation only. The score is normalised once, at the metric layer; the index applies weights and never re-normalises.")}</div>
			</details>
			<div class="checkbox"><label><input type="checkbox" data-f="reverse_scored" ${n.reverse_scored ? "checked" : ""} ${dis}> ${__("Reverse Scored")}</label></div>` : ""}
			${this.editable ? `<button class="btn btn-primary btn-sm btn-block ucc-idx-apply">${__("Apply")}</button>
			<hr>
			<button class="btn btn-default btn-sm btn-block ucc-idx-add">${__("+ Add child node")}</button>
			<button class="btn btn-default btn-sm btn-block ucc-idx-remove">${__("Remove this node")}</button>` : ""}
		`);
		this.$inspector.find(".ucc-idx-apply").on("click", () => this._apply(n));
		this.$inspector.find(".ucc-idx-add").on("click", () => this._addChild(n));
		this.$inspector.find(".ucc-idx-remove").on("click", () => this._removeNode(n));
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

	// Same guard Mapping Studio already uses before its version-scoped calls.
	// The disabled buttons are the affordance; this is the invariant, and it also
	// covers _validate()'s internal caller in _removeNode().
	_needVersion() {
		if (this.version) return true;
		frappe.msgprint(__("Pick or create an index version first."));
		return false;
	}

	_validate() {
		if (!this._needVersion()) return;
		frappe.call({
			method: IAPI + "validate_index",
			args: { index_version: this.version },
			callback: (r) => {
				if (!r.message) return;
				const warn = (r.message.warnings || []).join(" ");
				if (!r.message.valid) {
					this.$badge.css("color", "var(--red,#b94848)").text(r.message.issues.join(" "));
				} else if (warn) {
					// Valid but worth saying: a 0% node publishes fine and scores
					// nothing. Amber, never blocking.
					this.$badge.css("color", "#8a6d1f").text(warn);
				} else {
					this.$badge.css("color", "var(--green,#237a57)").text(__("Weights valid"));
				}
			},
		});
	}

	_publish() {
		if (!this._needVersion()) return;
		frappe.confirm(__("Publish this index version? It becomes immutable."), () => {
			frappe.call({
				method: IAPI + "publish_version",
				args: { index_version: this.version },
				callback: () => { frappe.show_alert({ message: __("Published"), indicator: "green" }); this.load(this.version); },
			});
		});
	}
}
