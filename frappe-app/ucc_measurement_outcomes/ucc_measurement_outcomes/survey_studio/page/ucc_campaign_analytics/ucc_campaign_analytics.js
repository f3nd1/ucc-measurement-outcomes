// Copyright (c) 2026, United Ceres College and contributors
// Campaign Analytics (1b): response state for ONE campaign, permission-scoped.
// A campaign is a Survey Tracking record with a collection status (D2).
//
// Charts are plain HTML/CSS bars in the same idiom Dashboard Studio already
// uses - no charting dependency, and the node canvas is the wrong shape for
// distributions. Nothing here reads historical Survey Response data.

frappe.pages["ucc-campaign-analytics"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Campaign Analytics"),
		single_column: true,
	});
	// Frappe can swallow exceptions from on_page_load, hiding a half-built page
	// behind a clean console. Surface it loudly instead.
	try {
		wrapper.ucc = new CampaignAnalytics(page);
	} catch (e) {
		console.error("[UCC] ucc-campaign-analytics failed to initialise:", e);
		frappe.msgprint({title: __("Page failed to load"), indicator: "red",
			message: __("ucc-campaign-analytics could not initialise: ") + (e && e.message ? e.message : e)});
		throw e;
	}
};

frappe.pages["ucc-campaign-analytics"].on_page_show = function (wrapper) {
	// Campaigns are created elsewhere; pick up new ones without a full reload
	// (the stale-list bug already fixed in Mapping and Dashboard Studio).
	if (wrapper.ucc) wrapper.ucc.loadCampaigns();
};

const CAPI = "ucc_measurement_outcomes.api.campaign.";

class CampaignAnalytics {
	constructor(page) {
		this.page = page;
		this.campaigns = [];
		this.data = null;
		this._injectStyle();
		this._build();
		this.loadCampaigns();
	}

	_injectStyle() {
		if (document.getElementById("ucc-ca-style")) return;
		const el = document.createElement("style");
		el.id = "ucc-ca-style";
		el.textContent = `
		.ucc-ca-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:14px}
		.ucc-ca-kpi{background:var(--card-bg,#fff);border:1px solid #e2e6ea;border-radius:10px;padding:14px}
		.ucc-ca-kpi .l{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8b95a5}
		.ucc-ca-kpi .v{font-size:26px;font-weight:700;margin:5px 0 2px}
		.ucc-ca-panel{background:var(--card-bg,#fff);border:1px solid #e2e6ea;border-radius:10px;padding:14px;margin-top:14px}
		.ucc-ca-panel h5{margin:0 0 10px;font-size:13px}
		.ucc-ca-bar{display:grid;grid-template-columns:180px 1fr 46px;gap:9px;align-items:center;margin:7px 0;font-size:11px}
		.ucc-ca-track{height:11px;background:#eef2f7;border-radius:99px;overflow:hidden}
		.ucc-ca-track span{display:block;height:100%;background:linear-gradient(90deg,#223a6b,#b58a45);border-radius:99px}
		.ucc-ca-q{font-weight:600;font-size:12px;margin:14px 0 4px}
		.ucc-ca-pending{border:1px dashed #ecd6aa;background:#fff8ea;color:#715824;
			border-radius:8px;padding:10px 12px;font-size:12px;margin-top:14px}
		`;
		document.head.appendChild(el);
	}

	_build() {
		const $m = $(this.page.main).empty();
		this.$trail = $('<div></div>').appendTo($m);
		const $picker = $('<div style="max-width:360px"></div>').appendTo($m);
		this.$select = $('<select class="form-control input-sm"></select>').appendTo($picker);
		this.$select.on("change", () => this.load(this.$select.val()));
		this.$body = $('<div></div>').appendTo($m);
		this._renderTrail();
	}

	_renderTrail() {
		if (!window.UCCTrail) return console.warn("[UCC] trail.js not loaded - run: bench build --app ucc_measurement_outcomes && bench restart");
		// Collection sits alongside stage 1 rather than inside the pipeline, so
		// like Data Explorer this shows the stages for orientation without
		// claiming to be one of them.
		window.UCCTrail.render(this.$trail.get(0), {
			context: (this.data && this.data.campaign) || null,
			stages: { 5: { blocked: __("not built yet") } },
		});
	}

	loadCampaigns() {
		frappe.call({
			method: CAPI + "list_campaigns",
			callback: (r) => {
				this.campaigns = r.message || [];
				const keep = this.$select.val();
				this.$select.html(
					this.campaigns.map((c) =>
						`<option value="${frappe.utils.escape_html(c.name)}">${
							frappe.utils.escape_html(c.name)} — ${
							frappe.utils.escape_html(c.ucc_survey_version || __("no version"))}</option>`
					).join("")
				);
				if (!this.campaigns.length) return this._renderNoCampaigns();
				this.$select.val(keep && this.campaigns.some((c) => c.name === keep)
					? keep : this.campaigns[0].name);
				this.load(this.$select.val());
			},
		});
	}

	// Option 2 for Finding A: a campaign needs a Survey Management planning
	// record, because educ_sg makes Survey Tracking.survey_name mandatory. Say
	// that here rather than leaving an empty dropdown that looks broken.
	_renderNoCampaigns() {
		this.$body.html(`<div class="ucc-ca-pending">
			<b>${__("No campaigns yet.")}</b><br>
			${__("A campaign is a Survey Tracking record with a Collection Status. Creating one needs a Survey Management planning record (its Survey Name is required by the existing system) plus the UCC Survey Version you want to collect against.")}
		</div>`);
	}

	load(name) {
		if (!name) return;
		frappe.call({
			method: CAPI + "campaign_analytics",
			args: { survey_tracking: name },
			callback: (r) => { if (r.message) { this.data = r.message; this._render(); } },
		});
	}

	_bar(label, count, max) {
		const pct = max ? Math.round((count / max) * 100) : 0;
		return `<div class="ucc-ca-bar">
			<div title="${frappe.utils.escape_html(label)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${frappe.utils.escape_html(label)}</div>
			<div class="ucc-ca-track"><span style="width:${pct}%"></span></div>
			<div style="text-align:right">${count}</div>
		</div>`;
	}

	_render() {
		const d = this.data;
		const c = d.counts;
		const kpi = (l, v, n) => `<div class="ucc-ca-kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="l" style="text-transform:none">${n || ""}</div></div>`;
		let html = `<div class="ucc-ca-kpis">
			${kpi(__("Completed"), c.completed, __("responses"))}
			${kpi(__("Response rate"), d.response_rate === null ? "—" : d.response_rate + "%",
				  c.target ? __("of {0} distributed", [c.target]) : __("no target recorded"))}
			${kpi(__("In progress"), c.partial, __("not submitted"))}
			${kpi(__("Answers"), c.answers, __("across {0} questions", [c.questions_answered]))}
		</div>`;

		const maxDay = Math.max(1, ...d.trend.map((t) => t.count));
		html += `<div class="ucc-ca-panel"><h5>${__("Responses per day")}</h5>${
			d.trend.length
				? d.trend.map((t) => this._bar(t.date, t.count, maxDay)).join("")
				: `<div class="text-muted" style="font-size:12px">${__("No responses yet.")}</div>`
		}</div>`;

		html += `<div class="ucc-ca-panel"><h5>${__("Answer distribution")}</h5>${
			d.distribution.length
				? d.distribution.map((q) => {
					const max = Math.max(1, ...q.values.map((v) => v.count));
					return `<div class="ucc-ca-q">${frappe.utils.escape_html(q.label)}</div>` +
						q.values.map((v) => this._bar(v.value, v.count, max)).join("");
				}).join("")
				: `<div class="text-muted" style="font-size:12px">${__("No answers yet.")}</div>`
		}</div>`;

		// The half of 1b that cannot be built yet says so, rather than being
		// quietly missing from the page.
		html += `<div class="ucc-ca-pending"><b>${__("Who hasn't responded — pending")}</b><br>${
			frappe.utils.escape_html(d.roster_pending)}</div>`;

		this.$body.html(html);
		this._renderTrail();
	}
}
