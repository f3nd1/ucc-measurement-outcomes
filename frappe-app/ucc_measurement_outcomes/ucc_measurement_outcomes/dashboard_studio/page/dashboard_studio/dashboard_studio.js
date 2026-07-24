// Copyright (c) 2026, United Ceres College and contributors
// Dashboard Studio: KPI cards, trend, component contribution and entity
// comparison, read from this app's Index Results via whitelisted methods.

frappe.pages["dashboard-studio"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Dashboard Studio"),
		single_column: true,
	});
	new DashboardStudio(page);
};

const DAPI = "ucc_measurement_outcomes.api.dashboard.";

class DashboardStudio {
	constructor(page) {
		this.page = page;
		this.filters = {};
		this._injectStyle();
		this._buildFilters();
		this._buildBody();
		frappe.call({ method: DAPI + "dashboard_filters", callback: (r) => { if (r.message) this._fillFilters(r.message); } });
		this.load();
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
		.ucc-db-bar{display:grid;grid-template-columns:130px 1fr 46px;gap:9px;align-items:center;margin:9px 0;font-size:11px}
		.ucc-db-track{height:11px;background:var(--bg-light-gray,#eef2f7);border-radius:99px;overflow:hidden}
		.ucc-db-track span{display:block;height:100%;background:linear-gradient(90deg,#223a6b,#b58a45);border-radius:99px}
		.ucc-db-empty{color:var(--text-muted,#8b95a5);font-size:12px;padding:22px;text-align:center}
		`;
		const el = document.createElement("style");
		el.id = "ucc-db-style";
		el.textContent = css;
		document.head.appendChild(el);
	}

	_buildFilters() {
		this.controls = {};
		[["index", "UCC Index Definition"], ["period", null], ["entity", null]].forEach(([f]) => {
			this.controls[f] = this.page.add_field({
				fieldname: f, label: __(f.charAt(0).toUpperCase() + f.slice(1)),
				fieldtype: "Select", options: [""],
				change: () => { this.filters[f] = this.controls[f].get_value(); this.load(); },
			});
		});
	}

	_fillFilters(data) {
		this.controls.index.df.options = [""].concat(data.indexes);
		this.controls.period.df.options = [""].concat(data.periods);
		this.controls.entity.df.options = [""].concat(data.entities);
		["index", "period", "entity"].forEach((f) => this.controls[f].refresh());
	}

	_buildBody() {
		const $m = $(this.page.main).empty();
		this.$kpis = $('<div class="ucc-db-kpis"></div>').appendTo($m);
		const $grid = $('<div class="ucc-db-grid"></div>').appendTo($m);
		this.$trend = $(`<div class="ucc-db-panel"><h5>${__("Trend")}</h5><div class="body"></div></div>`).appendTo($grid).find(".body");
		this.$contrib = $(`<div class="ucc-db-panel"><h5>${__("Component Contribution")}</h5><div class="body"></div></div>`).appendTo($grid).find(".body");
		this.$compare = $(`<div class="ucc-db-panel" style="margin-top:14px"><h5>${__("Entity Comparison")}</h5><div class="body"></div></div>`).appendTo($m).find(".body");
	}

	load() {
		frappe.call({
			method: DAPI + "get_dashboard_data",
			args: this.filters,
			callback: (r) => { if (r.message) this._render(r.message); },
		});
	}

	_render(d) {
		// KPI cards
		if (!d.kpis.length) {
			this.$kpis.html(`<div class="ucc-db-empty">${__("No index results yet. Calculate an index in Index Studio first.")}</div>`);
		} else {
			this.$kpis.html(d.kpis.map((k) => {
				const val = k.value === null ? "—" : Number(k.value).toFixed(2);
				let note = k.target != null ? __("Target {0}", [k.target]) : "";
				if (k.delta != null) {
					const cls = k.delta >= 0 ? "ucc-db-up" : "ucc-db-down";
					note += ` <span class="${cls}">${k.delta >= 0 ? "+" : ""}${k.delta}</span>`;
				}
				return `<div class="ucc-db-kpi"><div class="l">${frappe.utils.escape_html(k.index)}</div><div class="v">${val}</div><div class="n">${note}</div></div>`;
			}).join(""));
		}
		this._renderTrend(d.trend);
		this._renderBars(this.$contrib, d.contribution.map((c) => ({ label: c.component_label || c.component_key, value: c.contribution, max: 100 })));
		this._renderBars(this.$compare, d.comparison.map((c) => ({ label: c.entity, value: c.value, max: 100 })));
	}

	_renderTrend(trend) {
		const pts = trend.filter((t) => t.value != null);
		if (!pts.length) { this.$trend.html(`<div class="ucc-db-empty">${__("No trend data")}</div>`); return; }
		const w = 480, h = 200, p = 30;
		const vals = pts.map((t) => t.value);
		const min = Math.min(...vals) * 0.95, max = Math.max(...vals) * 1.05 || 1;
		const x = (i) => p + (i * (w - 2 * p)) / Math.max(1, pts.length - 1);
		const y = (v) => h - p - ((v - min) / (max - min || 1)) * (h - 2 * p);
		const poly = pts.map((t, i) => `${x(i)},${y(t.value)}`).join(" ");
		const dots = pts.map((t, i) => `<circle cx="${x(i)}" cy="${y(t.value)}" r="4" fill="#fff" stroke="#223a6b" stroke-width="2"><title>${frappe.utils.escape_html(t.period || "")}: ${t.value}</title></circle>`).join("");
		const labels = pts.map((t, i) => `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#8b95a5">${frappe.utils.escape_html(t.period || "")}</text>`).join("");
		this.$trend.html(`<svg viewBox="0 0 ${w} ${h}" style="width:100%"><polyline points="${poly}" fill="none" stroke="#223a6b" stroke-width="3" stroke-linejoin="round"/>${dots}${labels}</svg>`);
	}

	_renderBars($el, rows) {
		const usable = rows.filter((r) => r.value != null);
		if (!usable.length) { $el.html(`<div class="ucc-db-empty">${__("No data")}</div>`); return; }
		$el.html(usable.map((r) => {
			const pct = Math.max(0, Math.min(100, (r.value / (r.max || 100)) * 100));
			return `<div class="ucc-db-bar"><span>${frappe.utils.escape_html(String(r.label))}</span><div class="ucc-db-track"><span style="width:${pct}%"></span></div><b>${Number(r.value).toFixed(1)}</b></div>`;
		}).join(""));
	}
}
