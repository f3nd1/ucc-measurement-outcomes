// Copyright (c) 2026, United Ceres College and contributors
// UCC Dashboard Studio: shared filter bar + two layouts (Overview, Criterion 7)
// composed from the same widgets, reading this app's Index Results.

frappe.pages["ucc-dashboard-studio"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("UCC Dashboard Studio"),
		single_column: true,
	});
	// Frappe can swallow exceptions thrown from on_page_load, which hides a
	// half-built page behind a clean console. Surface it loudly instead.
	try {
		wrapper.ucc = new DashboardStudio(page);
	} catch (e) {
		console.error("[UCC] ucc-dashboard-studio failed to initialise:", e);
		frappe.msgprint({title: __("Page failed to load"), indicator: "red",
			message: __("ucc-dashboard-studio could not initialise: ") + (e && e.message ? e.message : e)});
		throw e;
	}
};

// Finding 2: see survey_builder — pages construct once, on_page_show runs every visit.
frappe.pages["ucc-dashboard-studio"].on_page_show = function (wrapper) {
	if (wrapper.ucc) wrapper.ucc.applyRouteOptions();
};

const DAPI = "ucc_measurement_outcomes.api.dashboard.";

class DashboardStudio {
	constructor(page) {
		this.page = page;
		this.filters = {};
		this.view = "overview";
		this.data = null;
		this._injectStyle();
		this._build();
		frappe.call({ method: DAPI + "dashboard_filters", callback: (r) => { if (r.message) this._fillFilters(r.message); } });
		this.applyRouteOptions();
		this.load();
	}

	// Finding 2: deep-link entry point (idempotent, clears route_options).
	applyRouteOptions() {
		const opts = frappe.route_options || {};
		frappe.route_options = {};
		["index", "index_version", "period", "entity_type", "entity"].forEach((f) => {
			if (opts[f]) this.filters[f] = opts[f];
		});
		if (Object.keys(opts).length) this.load();
	}

	_injectStyle() {
		if (document.getElementById("ucc-db-style")) return;
		const css = `
		.ucc-db-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:12px}
		.ucc-db-kpi{background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e6ea);border-radius:10px;padding:14px}
		.ucc-db-kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted,#8b95a5)}
		.ucc-db-kpi .v{font-size:26px;font-weight:700;margin:5px 0 2px}
		.ucc-db-kpi .n{font-size:11px;color:var(--text-muted,#8b95a5)}
		.ucc-db-up{color:var(--green,#237a57);font-weight:600}
		.ucc-db-down{color:var(--red,#b94848);font-weight:600}
		.ucc-db-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-top:14px}
		.ucc-db-panel{background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e6ea);border-radius:10px;padding:14px}
		.ucc-db-panel h5{margin:0 0 10px;font-size:13px}
		.ucc-db-sec{margin-top:18px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted,#8b95a5);font-weight:600}
		.ucc-db-bar{display:grid;grid-template-columns:150px 1fr 46px;gap:9px;align-items:center;margin:9px 0;font-size:11px}
		.ucc-db-track{height:11px;background:var(--bg-light-gray,#eef2f7);border-radius:99px;overflow:hidden}
		.ucc-db-track span{display:block;height:100%;background:linear-gradient(90deg,#223a6b,#b58a45);border-radius:99px}
		.ucc-db-weak{border:1px solid #ecd6aa;background:#fff8ea;border-radius:8px;padding:6px 10px;margin:5px 0;font-size:12px;color:#715824}
		.ucc-db-empty{color:var(--text-muted,#8b95a5);font-size:12px;padding:22px;text-align:center}
		/* finding 4: trace-back affordance on every number */
		.ucc-db-trace{font-size:10px;color:var(--text-muted,#8b95a5);cursor:pointer;margin-top:6px;
			text-decoration:underline dotted}
		.ucc-db-trace:hover{color:var(--primary,#4a63e7)}
		.ucc-db-bar .ucc-db-trace{margin-left:5px;margin-top:0;text-decoration:none}
		.ucc-db-tabs{display:flex;gap:4px;margin:12px 0 0}
		.ucc-db-tabs button.active{background:var(--navy,#17294d);color:#fff}
		`;
		const el = document.createElement("style");
		el.id = "ucc-db-style";
		el.textContent = css;
		document.head.appendChild(el);
	}

	_build() {
		const $m = $(this.page.main).empty();
		this.$trail = $('<div></div>').appendTo($m);   // finding 1
		this.$filter = $('<div></div>').appendTo($m).get(0);
		this.filterBar = new window.UCCFilterBar(this.$filter, {
			fields: [
				{ name: "index", label: __("Index") },
				{ name: "index_version", label: __("Index Version") },
				{ name: "period", label: __("Period / Academic Year") },
				{ name: "entity_type", label: __("Dimension") },
				{ name: "entity", label: __("Value") },
			],
			onChange: (v) => { this.filters = v; this.load(); },
		});
		const $tabs = $('<div class="ucc-db-tabs"></div>').appendTo($m);
		// Finding 6: these were the only buttons with no variant class, so they
		// rendered unstyled next to the app's btn-default/btn-primary set.
		this.$tabOverview = $(`<button class="btn btn-default btn-sm active">${__("Overview")}</button>`).appendTo($tabs).on("click", () => this._setView("overview"));
		this.$tabC7 = $(`<button class="btn btn-default btn-sm">${__("Criterion 7")}</button>`).appendTo($tabs).on("click", () => this._setView("criterion7"));
		this.$body = $('<div></div>').appendTo($m);
		this.$next = $('<div></div>').appendTo($m);   // item 2
		this._renderTrail();
	}

	// Finding 1: the dashboard reads results produced upstream in Index Studio.
	_renderTrail() {
		if (!window.UCCTrail) return console.warn("[UCC] trail.js not loaded - run: bench build --app ucc_measurement_outcomes && bench restart");
		// Finding 2: Index Studio now reads route_options, so this hop is live.
		// Item 1: stage 4. Results existing proves a published index produced
		// them, so stage 3 is done too. Stage 5 has no integration yet.
		const stages = {};
		const hasResults = !!(this.data && this.data.kpis && this.data.kpis.length);
		if (this.data) {
			stages[3] = hasResults ? { done: true } : {};
			stages[4] = hasResults
				? { done: true }
				: { blocked: __("no results yet — calculate an index") };
		} else {
			stages[4] = { note: __("loading results…") };
		}
		stages[5] = { blocked: __("not built yet") };
		window.UCCTrail.render(this.$trail.get(0), {
			current: 4,
			context: this.filters.index || null,
			routeOptions: this.filters.index_version
				? { index_version: this.filters.index_version }
				: {},
			stages: stages,
		});
		this._renderNext();
	}

	// Item 2: the next stage is acting on weak results via Quality Actions —
	// which is bench-blocked and genuinely not built. Say that, rather than
	// offering a button that goes nowhere.
	_renderNext() {
		if (!window.UCCTrail || !this.$next) return;
		const weak = (this.data && this.data.weak_areas) || {};
		const count = (weak.indices || []).length + (weak.components || []).length;
		window.UCCTrail.renderNext(this.$next.get(0), {
			blocked: count
				? __("Quality Actions aren't built yet — {0} weak areas are waiting for them", [count])
				: __("Quality Actions aren't built yet"),
		});
	}

	_fillFilters(d) {
		this.filterBar.setOptions("index", d.indexes);
		this.filterBar.setOptions("index_version", d.index_versions);
		this.filterBar.setOptions("period", d.periods);
		this.filterBar.setOptions("entity_type", d.entity_types);
		this.filterBar.setOptions("entity", d.entities);
	}

	_setView(v) {
		this.view = v;
		this.$tabOverview.toggleClass("active", v === "overview");
		this.$tabC7.toggleClass("active", v === "criterion7");
		this._render();
	}

	load() {
		frappe.call({
			method: DAPI + "get_dashboard_data",
			args: this.filters,
			callback: (r) => { if (r.message) { this.data = r.message; this._render(); } },
		});
	}

	_render() {
		if (!this.data) return;
		this.$body.empty();
		this._renderTrail();
		if (this.view === "criterion7") this._renderCriterion7();
		else this._renderOverview();
		// Finding 4: widgets render as HTML strings, so bind trace clicks after.
		this.$body.find(".ucc-db-trace").on("click", (e) => {
			e.stopPropagation();
			const $t = $(e.currentTarget);
			frappe.route_options = { index_version: $t.data("version") };
			if ($t.data("node")) frappe.route_options.node_key = $t.data("node");
			frappe.set_route("index-studio");
		});
		// Finding 4: dead end — give the user the page that creates this data.
		if (!this.data.kpis.length && window.UCCEmptyState) {
			window.UCCEmptyState.render(this.$body.find(".ucc-db-empty-slot").get(0), {
				message: __("No results yet — calculate an index to see them here."),
				actionLabel: __("Open Index Studio"),
				onAction: () => frappe.set_route("index-studio"),
			});
		}
	}

	// ---- shared widgets ----
	_kpiCards(kpis) {
		// Finding 4: empty slot filled by _render() with a message + a way out.
		if (!kpis.length) return '<div class="ucc-db-empty ucc-db-empty-slot"></div>';
		return '<div class="ucc-db-kpis">' + kpis.map((k) => {
			const val = k.value === null ? "—" : Number(k.value).toFixed(2);
			let note = k.target != null ? __("Target {0}", [k.target]) : "";
			if (k.delta != null) {
				const cls = k.delta >= 0 ? "ucc-db-up" : "ucc-db-down";
				note += ` <span class="${cls}">${k.delta >= 0 ? "+" : ""}${k.delta}</span>`;
			}
			// Finding 4: trace to the exact published formula this number came from.
			const trace = k.index_version
				? `<div class="ucc-db-trace" data-version="${frappe.utils.escape_html(k.index_version)}">${__("trace to Index Studio")} →</div>`
				: "";
			return `<div class="ucc-db-kpi"><div class="l">${frappe.utils.escape_html(k.index)}</div><div class="v">${val}</div><div class="n">${note}</div>${trace}</div>`;
		}).join("") + "</div>";
	}

	_trendSvg(trend) {
		const pts = (trend || []).filter((t) => t.value != null);
		if (!pts.length) return `<div class="ucc-db-empty">${__("No trend data")}</div>`;
		const w = 480, h = 200, p = 30;
		const vals = pts.map((t) => t.value);
		const min = Math.min(...vals) * 0.95, max = Math.max(...vals) * 1.05 || 1;
		const x = (i) => p + (i * (w - 2 * p)) / Math.max(1, pts.length - 1);
		const y = (v) => h - p - ((v - min) / (max - min || 1)) * (h - 2 * p);
		const poly = pts.map((t, i) => `${x(i)},${y(t.value)}`).join(" ");
		const dots = pts.map((t, i) => `<circle cx="${x(i)}" cy="${y(t.value)}" r="4" fill="#fff" stroke="#223a6b" stroke-width="2"><title>${frappe.utils.escape_html(t.period || "")}: ${t.value}</title></circle>`).join("");
		const labels = pts.map((t, i) => `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#8b95a5">${frappe.utils.escape_html(t.period || "")}</text>`).join("");
		return `<svg viewBox="0 0 ${w} ${h}" style="width:100%"><polyline points="${poly}" fill="none" stroke="#223a6b" stroke-width="3" stroke-linejoin="round"/>${dots}${labels}</svg>`;
	}

	_bars(rows) {
		const usable = (rows || []).filter((r) => r.value != null);
		if (!usable.length) return `<div class="ucc-db-empty">${__("No data")}</div>`;
		return usable.map((r) => {
			const pct = Math.max(0, Math.min(100, (r.value / (r.max || 100)) * 100));
			// Finding 4: component rows carry the real node key + version.
			const trace = r.nodeKey && r.indexVersion
				? `<span class="ucc-db-trace" data-version="${frappe.utils.escape_html(r.indexVersion)}" data-node="${frappe.utils.escape_html(r.nodeKey)}" title="${__("Trace to this node in Index Studio")}">→</span>`
				: "";
			return `<div class="ucc-db-bar"><span>${frappe.utils.escape_html(String(r.label))}</span><div class="ucc-db-track"><span style="width:${pct}%"></span></div><b>${Number(r.value).toFixed(1)}${trace}</b></div>`;
		}).join("");
	}

	_contribRows() {
		return (this.data.contribution || []).map((c) => ({
			label: c.component_label || c.component_key,
			value: c.normalised_value,
			max: 100,
			nodeKey: c.component_key,        // finding 4: real index node key
			indexVersion: c.index_version,   // finding 4: the version it came from
		}));
	}
	_comparisonRows() {
		return (this.data.comparison || []).map((c) => ({ label: c.entity, value: c.value, max: 100 }));
	}

	_weakWidget() {
		const w = this.data.weak_areas || { indices: [], components: [] };
		if (!w.indices.length && !w.components.length) return `<div class="ucc-db-empty">${__("No areas below target.")}</div>`;
		const idx = w.indices.map((k) => `<div class="ucc-db-weak"><b>${frappe.utils.escape_html(k.index)}</b> ${Number(k.value).toFixed(2)} · ${__("target")} ${k.target} <span class="ucc-db-down">${k.delta}</span></div>`).join("");
		const comp = w.components.map((c) => `<div class="ucc-db-weak">${frappe.utils.escape_html(c.component_label || c.component_key)} · ${Number(c.normalised_value).toFixed(1)}/100 (&lt; ${w.threshold})</div>`).join("");
		return idx + comp;
	}

	// ---- layouts ----
	_renderOverview() {
		this.$body.html(`
			${this._kpiCards(this.data.kpis)}
			<div class="ucc-db-grid">
				<div class="ucc-db-panel"><h5>${__("Trend")}</h5>${this._trendSvg(this.data.trend)}</div>
				<div class="ucc-db-panel"><h5>${__("Component Contribution")}</h5>${this._bars(this._contribRows())}</div>
			</div>
			<div class="ucc-db-panel" style="margin-top:14px"><h5>${__("Entity Comparison")}</h5>${this._bars(this._comparisonRows())}</div>
		`);
	}

	_renderCriterion7() {
		// Overall outcomes -> tactical indices -> operational measures -> trends ->
		// targets/benchmarks -> weak areas, all from the same widgets.
		this.$body.html(`
			<div class="ucc-db-sec">${__("Overall Outcomes & Tactical Indices")}</div>
			${this._kpiCards(this.data.kpis)}
			<div class="ucc-db-grid">
				<div class="ucc-db-panel"><h5>${__("Trends vs Target")}</h5>${this._trendSvg(this.data.trend)}</div>
				<div class="ucc-db-panel"><h5>${__("Operational Measures (components)")}</h5>${this._bars(this._contribRows())}</div>
			</div>
			<div class="ucc-db-sec">${__("Benchmarks by Entity")}</div>
			<div class="ucc-db-panel">${this._bars(this._comparisonRows())}</div>
			<div class="ucc-db-sec">${__("Weak Areas (below target / threshold)")}</div>
			<div class="ucc-db-panel">${this._weakWidget()}</div>
		`);
	}
}
