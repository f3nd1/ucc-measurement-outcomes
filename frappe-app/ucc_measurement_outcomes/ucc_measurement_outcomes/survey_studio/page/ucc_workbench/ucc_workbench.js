// Copyright (c) 2026, United Ceres College and contributors
//
// Measurement Outcomes: one compact workbench, five PARALLEL workspaces.
//
// The five are Surveys, Objectives, Metrics, Indices and Criterion 7. They are
// not five steps - the old 5-step progress bar is deliberately not reinstated
// here, because it implied every survey walks one linear path and it was the
// only signpost to where results lived.
//
// WHAT THIS FILE IS AND IS NOT. It is markup, selection state and endpoint
// calls. Every number, permission and status it shows comes from the existing
// backend: get_survey_builder decides what is editable, mapping_coverage
// decides what counts as unmapped, validate_index decides what is publishable.
// Nothing here re-implements a rule. Where the UI needs to express a state -
// "review mode, answer-determining fields are protected" - it READS
// version.status and version.is_immutable and renders that; the freeze itself
// stays in versioning.py where it is tested.
//
// Every visible class comes from the design prototype, scoped under .ucc-mo by
// public/css/ucc_mo.bundle.css. No Frappe form layouts, no .form-control.

frappe.pages["ucc-workbench"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: "", single_column: true });
	try {
		wrapper.ucc = new MeasurementOutcomes(page);
	} catch (e) {
		console.error("[UCC] ucc-workbench failed to initialise:", e);
		frappe.msgprint({
			title: __("Page failed to load"), indicator: "red",
			message: __("ucc-workbench could not initialise: ") + (e && e.message ? e.message : e),
		});
		throw e;
	}
};

frappe.pages["ucc-workbench"].on_page_show = function (wrapper) {
	if (!wrapper.ucc) return;
	// The page is guaranteed visible here (see mo_ui.js UCCMO.refit for why
	// mount()-time measurement is not) - this is the reliable place to size the
	// shell, not a backup for it.
	window.UCCMO.refit(wrapper.ucc.$root);
	wrapper.ucc.applyRouteOptions();
};

const BAPI = "ucc_measurement_outcomes.api.builder.";
const MAPI = "ucc_measurement_outcomes.api.mapping.";
const XAPI = "ucc_measurement_outcomes.api.metrics.";
const IAPI = "ucc_measurement_outcomes.api.index_studio.";
const CAPI = "ucc_measurement_outcomes.api.campaign.";
const DAPI = "ucc_measurement_outcomes.api.dashboard.";
const LAPI = "ucc_measurement_outcomes.api.lineage.";

// Mirrors api/builder.CHOICE_DEFAULTS + MATRIX_ROW_DEFAULTS' key space. The
// picker shows what the backend can actually create; a type offered here that
// add_question rejects would be a dead control.
const VERSION_STATUS_COLOR = { Draft: "gray", "In Review": "orange", Published: "green", Closed: "gray" };

// The Select field's real options (UCC Survey Question.question_type), which is
// the authority this list must match exactly - Frappe's own _validate_selects
// throws "not a valid option" on doc.insert() for anything else. "Long Text"
// used to be here as a value: it is only a bulk-paste SHORTHAND alias
// (bulk_parse.py's "long text" -> "Paragraph"), never a stored value, so
// picking it would have failed on the very first Apply. Ranking and Page Break
// were missing entirely - not deliberate, a straight omission caught in QA.
const TYPES = [
	{ value: "Short Text", help: "One line" },
	{ value: "Paragraph", help: "Multiple lines" },
	{ value: "Email", help: "Validated address" },
	{ value: "Number", help: "Numeric only" },
	{ value: "Date", help: "Calendar date" },
	{ value: "Rating", help: "Stars or scale" },
	{ value: "Single Choice", help: "One of many" },
	{ value: "Multiple Choice", help: "Several of many" },
	{ value: "Dropdown", help: "Compact list" },
	{ value: "Yes / No", help: "Binary" },
	{ value: "NPS", help: "0-10 recommend" },
	{ value: "Ranking", help: "Drag to order" },
	{ value: "Slider", help: "0-100 range" },
	{ value: "Likert Matrix", help: "Agreement grid" },
	{ value: "Multiple Choice Grid", help: "One per row" },
	{ value: "Checkbox Grid", help: "Many per row" },
	{ value: "File Upload", help: "Attachment" },
	{ value: "Section Heading", help: "In-page heading" },
	// Page Break, not Section Heading, is the marker the respondent-facing
	// renderer actually splits pages on - confirmed against survey_form.js
	// ("Pages are the runs between 'Page Break' markers"). See _paginate()
	// below for the fix this drove: this workspace used to split on Section
	// Heading, which meant its "Page 1 / Page 2" never matched what a
	// respondent would actually see.
	{ value: "Page Break", help: "Starts a new page" },
];

const NORMALISATIONS = [
	"Likert 1-5 to 0-100", "Yes/No to 100/0", "Reverse 0-100",
	"Ratio to Percentage", "Count", "Hours", "Category Only (No Score)",
];

class MeasurementOutcomes {
	constructor(page) {
		this.page = page;
		this.ws = "surveys";
		this.state = {};
		this._build();
		this.applyRouteOptions();
	}

	call(method, args) {
		return new Promise((resolve) =>
			frappe.call({ method, args, callback: (r) => resolve(r.message) }));
	}

	// Deep linking, per the brief's "preserve deep linking" rule. Same
	// frappe.route_options idiom every other page in this app uses, so a link
	// from Mapping Studio or the old Builder still lands somewhere sensible.
	applyRouteOptions() {
		const o = frappe.route_options || {};
		frappe.route_options = {};
		if (o.workspace) this.ws = o.workspace;
		if (o.survey_version) this.state.surveyVersion = o.survey_version;
		if (o.question) this.state.question = o.question;
		if (o.metric) { this.ws = "metrics"; this.state.metric = o.metric; }
		if (o.index_version) { this.ws = "indices"; this.state.indexVersion = o.index_version; }
		this.render();
	}

	_build() {
		this.$root = window.UCCMO.mount(this.page, `
			<div class="app">
				<header class="topbar">
					<div class="brand">
						<span class="brand-mark">${window.UCCMO.icon("i-chart")}</span>
						<div><b>${__("Measurement Outcomes")}</b>
						<div class="eyebrow">${__("United Ceres College")}</div></div>
					</div>
					<div class="search">${window.UCCMO.icon("i-search", "sm")}
						<input type="text" data-global-search placeholder="${
							__("Search surveys, objectives, metrics…")}"></div>
					<div class="top-actions"></div>
				</header>
				<div data-nav></div>
				<main class="workspace active" data-workspace></main>
			</div>`);

		this.$root.on("click", "[data-ws]", (e) => {
			this.ws = $(e.currentTarget).data("ws");
			this.render();
		});
		// Status-strip cells that jump to another workspace. The brief's example:
		// "5 unmapped" opens the Objectives queue on those very questions.
		this.$root.on("click", "[data-goto]", (e) => {
			const $b = $(e.currentTarget);
			this.ws = $b.data("goto");
			if ($b.data("arg")) this.state.gotoArg = $b.data("arg");
			this.render();
		});
		this.$root.on("click", "[data-tab]", (e) => {
			this.state[this.ws + "Tab"] = $(e.currentTarget).data("tab");
			this.render();
		});
	}

	render() {
		this.$root.find("[data-nav]").html(window.UCCMO.workspaceNav(this.ws, this.counts || {}));
		const $ws = this.$root.find("[data-workspace]").empty();
		const Cls = {
			surveys: SurveyWorkspace, objectives: ObjectiveWorkspace,
			metrics: MetricWorkspace, indices: IndexWorkspace, criterion7: Criterion7Workspace,
		}[this.ws];
		this.current = new Cls(this, $ws);
		this.current.render();
	}

	tab(defaultKey) {
		return this.state[this.ws + "Tab"] || defaultKey;
	}

	toast(message, indicator) {
		frappe.show_alert({ message, indicator: indicator || "green" });
	}
}

// ============================================================== SURVEYS ===
// Three panes: outline | one page at a time | contextual inspector.
class SurveyWorkspace {
	constructor(app, $el) {
		this.app = app;
		this.$el = $el;
		this.pageIndex = 0;
	}

	get s() { return this.app.state; }

	render() {
		this.$el.html('<div class="pane" style="height:100%"><div class="pane-body">' +
			__("Loading…") + "</div></div>");
		this.app.call(BAPI + "list_versions", { limit: 100 }).then((versions) => {
			this.versions = versions || [];
			if (!this.s.surveyVersion && this.versions.length) {
				this.s.surveyVersion = this.versions[0].name;
			}
			if (!this.s.surveyVersion) return this._renderEmpty();
			this._load();
		});
	}

	_renderEmpty() {
		this.$el.html(`${window.UCCMO.contextBar({
			eyebrow: __("Survey workspace"), title: __("No surveys yet"),
			actions: [{ label: __("New survey"), tone: "primary", icon: "i-plus", act: "new-survey" }],
		})}<div class="workarea">${window.UCCMO.empty(
			__("Create a survey to start building questions."),
			{ label: __("New survey"), tone: "primary", act: "new-survey" })}</div>`);
		this.$el.off("click.mo").on("click.mo", '[data-act="new-survey"]', () => this._newSurvey());
	}

	_load() {
		Promise.all([
			this.app.call(BAPI + "get_survey_builder", { survey_version: this.s.surveyVersion }),
			this.app.call(MAPI + "mapping_coverage", { survey_version: this.s.surveyVersion }),
			this.app.call(BAPI + "response_summary", { survey_version: this.s.surveyVersion }),
		]).then(([m, cov, resp]) => {
			if (!m) return this._renderEmpty();
			this.version = m.version;
			this.questions = m.questions || [];
			// editable comes from the SERVER (not version.status parsed here), so
			// the lock the UI draws is the lock the backend will actually enforce.
			this.editable = !!m.editable;
			this.coverage = cov || {};
			this.responses = (resp && resp.responses) || 0;
			this.campaign = resp && resp.campaign;
			this.app.counts = Object.assign(this.app.counts || {}, { surveys: this.versions.length });
			this._paginate();
			this._draw();
		});
	}

	// Pages split on "Page Break", not "Section Heading" - verified against the
	// actual respondent-facing renderer (public/js/survey_form.js): "Pages are
	// the runs between 'Page Break' markers... A survey with no Page Break is
	// simply one page." Section Heading is an IN-PAGE heading there (a bare
	// <h4>, never a page boundary), so it stays in `items` like any other row -
	// excluding it would make this outline lie about what a respondent sees,
	// which is the same class of bug the wording-correction marker exists to
	// prevent one layer up.
	//
	// This was wrong in the first cut of this workspace (it split on Section
	// Heading), caught in QA alongside Page Break being missing from TYPES
	// entirely - the two are the same bug: nothing exercised page-break
	// behaviour because nothing could create one.
	_paginate() {
		this.pages = [];
		let cur = { title: __("Page 1"), items: [] };
		this.questions.forEach((q) => {
			if (q.question_type === "Page Break") {
				this.pages.push(cur);
				cur = { title: __("Page {0}", [this.pages.length + 1]), items: [] };
			} else {
				cur.items.push(q);
			}
		});
		this.pages.push(cur);
		if (this.pageIndex >= this.pages.length) this.pageIndex = 0;
		// Arriving on a deep link to a question: show ITS page, not page 1.
		if (this.s.question) {
			const i = this.pages.findIndex((p) => p.items.some((q) => q.name === this.s.question));
			if (i >= 0) this.pageIndex = i;
		}
	}

	_draw() {
		const U = window.UCCMO;
		const v = this.version;
		const unmapped = (this.coverage.questions_without_objective || []).length;
		const tab = this.app.tab("build");
		const published = !this.editable;

		this.$el.html(`
			${U.contextBar({
				eyebrow: __("Survey workspace"),
				picker: true,
				status: v.status,
				statusTone: published ? "ok" : "warn",
				statusIcon: published ? "i-lock" : null,
				actions: [
					{ label: __("Preview"), icon: "i-eye", act: "preview" },
					published
						? { label: __("Create editable version"), tone: "primary", icon: "i-plus", act: "new-version" }
						: { label: __("Save draft"), tone: "primary", icon: "i-save", act: "save-draft" },
				],
			})}
			${U.tabs([
				{ key: "build", label: __("Build") }, { key: "preview", label: __("Preview") },
				{ key: "share", label: __("Share") }, { key: "responses", label: __("Responses") },
				{ key: "exports", label: __("Exports") },
			], tab)}
			${U.statusStrip([
				{ value: this.questions.length, label: __("questions") },
				{ value: this.pages.length, label: __("pages") },
				{ value: unmapped, label: __("unmapped"), ws: "objectives", wsLabel: __("Objectives") },
				{ value: this.responses, label: __("responses"), ws: "criterion7", wsLabel: __("Criterion 7") },
			], published ? {
				text: __("Review mode, answer-determining fields are protected."),
				tone: "warn", icon: "i-lock",
			} : null)}
			<div class="workarea" data-body></div>`);

		const body = {
			build: () => this._build3(),
			preview: () => this._previewTab(),
			share: () => this._shareTab(),
			responses: () => this._responsesTab(),
			exports: () => this._exportsTab(),
		}[tab]();
		this.$el.find("[data-body]").html(body);
		this._mountPicker();
		this._wire();
		if (tab === "build") this._renderInspector();
	}

	// Bug 2 fix: the context bar's title used to be plain static text - no way
	// to switch survey or version without leaving the workspace. list_versions
	// is already the flat, cross-survey list the old Builder's picker used
	// (see its own docstring), so ONE picker serves as both a survey picker and
	// a version picker at once - selecting an entry switches both together,
	// exactly how the old Builder behaved.
	_mountPicker() {
		const U = window.UCCMO;
		U.mountPicker(this, this.$el, {
			statusColor: VERSION_STATUS_COLOR,
			placeholder: __("Pick a survey version…"),
			newLabel: __("+ New survey"),
			onSelect: (name) => { this.s.surveyVersion = name; this.s.question = null; this._load(); },
			onEdit: (name) => frappe.set_route("Form", "UCC Survey Version", name),
			onCreate: () => this._newSurvey(),
		}, this.versions.map((v) => ({
			name: v.name,
			label: (v.survey_title || v.survey) + " — v" + v.version_number,
			status: v.status,
		})), this.s.surveyVersion);
	}

	_build3() {
		const U = window.UCCMO;
		const page = this.pages[this.pageIndex] || { items: [] };
		// Left: pages, and only the SELECTED page expands. Collapsed siblings are
		// the whole point - a full survey listed vertically is what this replaces.
		const outline = this.pages.map((p, i) => `
			<div class="page-item ${i === this.pageIndex ? "active" : ""}">
				<button class="page-item-btn" data-page="${i}">
					${U.icon("i-page", "sm")}
					<span class="page-title">${U.esc(p.title)}</span>
					<span class="count">${p.items.length}</span>
				</button>
				${i === this.pageIndex ? `<div class="outline-list">${p.items.map((q) => `
					<button class="outline-question ${q.name === this.s.question ? "selected" : ""}" data-q="${U.esc(q.name)}">
						<span class="outline-icon">${U.icon(window.UCCMOIcons.forQuestionType(q.question_type), "xs")}</span>
						<span class="question-copy">${U.esc((q.question_text || "").slice(0, 46))}</span>
						<span class="map-dot ${(q.objectives || []).length ? "ok" : ""}"></span>
					</button>`).join("")}</div>` : ""}
			</div>`).join("");

		const rows = page.items.length
			? page.items.map((q, i) => U.questionRow(q, {
				index: i + 1, selected: q.name === this.s.question, editable: this.editable,
				actions: this.editable
					? [{ act: "dup", icon: "i-copy", title: __("Duplicate") },
					   { act: "del", icon: "i-trash", title: __("Delete") }]
					: [],
			})).join("")
			: U.empty(__("This page has no questions yet."));

		return `<div class="builder-shell ${this.leftCollapsed ? "left-collapsed" : ""} ${
			this.rightCollapsed ? "right-collapsed" : ""}">
			${U.pane({
				cls: "left-pane", title: __("Outline"), icon: "i-survey",
				collapse: { act: "collapse-left", side: "left", collapsed: !!this.leftCollapsed,
							label: __("Collapse outline"), shortLabel: __("Outline") },
				body: `<div class="page-list">${outline}</div>${
					this.editable ? `<button class="add-page" data-act="add-page">${
						U.icon("i-plus", "sm")}${__("Add page")}</button>` : ""}`,
			})}
			<section class="pane canvas-pane">
				<header class="pane-head">
					<div class="canvas-head-left">${U.icon("i-page", "sm")}
						<b>${U.esc((this.pages[this.pageIndex] || {}).title || "")}</b>
						<span class="eyebrow">${__("{0} of {1}", [this.pageIndex + 1, this.pages.length])}</span></div>
					<div class="canvas-head-right">
						${this.editable ? `<button class="btn primary small" data-act="add-question">${
							U.icon("i-plus", "sm")}${__("Add question")}</button>` : ""}
					</div>
				</header>
				<div class="pane-body canvas-body">
					<div class="page-canvas">
						<div class="question-list">${rows}</div>
						<div class="canvas-help">${__("Only this page is shown. Use the outline to move between pages.")}</div>
					</div>
					${this.editable ? U.popover({
						key: "types", placeholder: __("Search field types…"),
						items: TYPES.map((t) => ({
							value: t.value, label: t.value, help: t.help,
							icon: window.UCCMOIcons.forQuestionType(t.value),
						})),
					}) : ""}
				</div>
			</section>
			<div data-inspector></div>
		</div>`;
	}

	_renderInspector() {
		const U = window.UCCMO;
		const q = this.questions.find((x) => x.name === this.s.question);
		const $slot = this.$el.find("[data-inspector]");
		if (!q) {
			$slot.html(U.inspector({
				title: __("Inspector"), icon: "i-settings",
				body: U.empty(__("Select a question to edit its wording, type, options and mapping.")),
			}));
			return;
		}
		const itab = this.s.qtab || "content";
		const locked = !this.editable;
		const lockReason = __("This version is published. Answer-determining fields are frozen so published scores stay reproducible.");
		let body;
		if (itab === "content") {
			body = U.field({ label: __("Question"), name: "question_text", type: "textarea",
							 value: q.question_text, locked: locked && !this.correcting,
							 lockReason: lockReason })
				+ U.field({ label: __("Type"), name: "question_type", type: "select",
							value: q.question_type, options: TYPES.map((t) => t.value),
							locked, lockReason })
				+ U.field({ label: __("Help text"), name: "help_text", type: "textarea", rows: 2,
							value: q.help_text, locked, lockReason })
				+ (locked ? `<div class="published-lock-row">${U.icon("i-lock", "xs")}<div>
					<b>${__("Review mode")}</b><br>${__("Wording may still be corrected for a typo, with a reason. Everything that decides what counts as a valid answer stays frozen.")}
					</div></div>
					${U.field({ label: __("Corrected wording"), name: "corrected_text", type: "textarea",
								value: q.question_text })}
					${U.field({ label: __("Correction reason"), name: "correction_reason", type: "textarea",
								rows: 2, value: q.correction_reason,
								placeholder: __("e.g. fixed the spelling of Teaching") })}` : "");
		} else if (itab === "options") {
			body = U.field({ label: __("Required response"), name: "is_required", type: "switch",
							 value: q.is_required, switchLabel: __("Must be answered"), locked, lockReason })
				+ U.field({ label: __("Column width"), name: "layout_width", type: "select",
							value: q.layout_width || "Full",
							options: ["Full", "Two Thirds", "Half", "One Third"] })
				+ `<div class="help">${__("Width is presentation only, so it can be changed even on a published version.")}</div>`
				+ (q.choices && q.choices.length ? U.field({
					label: __("Choices"), name: "choices", type: "textarea", rows: 5, locked, lockReason,
					value: (q.choices || []).map((c) => c.choice_value
						? c.choice_label + "|" + c.choice_value : c.choice_label).join("\n"),
				}) : "");
		} else if (itab === "logic") {
			body = `<div class="help">${__("Display conditions are re-checked on the server at submit time, so a hidden question can never store an answer.")}</div>`
				+ U.field({ label: __("Display logic"), name: "display_logic", type: "select",
							value: q.display_logic || "", locked, lockReason,
							options: [{ value: "", label: __("Always shown") },
									  { value: "Show If", label: __("Show if…") },
									  { value: "Hide If", label: __("Hide if…") }] })
				+ (q.display_logic_config
					? `<div class="help">${U.esc(q.display_logic_config)}</div>` : "");
		} else {
			const objs = q.objectives || [];
			body = `<div class="field"><label>${__("Objective mapping")}</label>
				${objs.length
					? objs.map((o) => U.chip(o, "ok", "i-link")).join(" ")
					: U.chip(__("Not mapped"), "warn", "i-warning")}</div>
				<div class="help">${__("Objective mapping is governance and evidence lineage. It does not change the index score - that comes from this question's metrics.")}</div>
				${U.button({ label: __("Map in Objectives workspace"), small: true, icon: "i-target", act: "goto-map" })}`;
		}

		$slot.html(U.inspector({
			title: q.question_text ? q.question_text.slice(0, 28) : __("Question"),
			icon: window.UCCMOIcons.forQuestionType(q.question_type),
			tabs: [{ key: "content", label: __("Content") }, { key: "options", label: __("Options") },
				   { key: "logic", label: __("Logic") }, { key: "mapping", label: __("Mapping") }],
			tab: itab,
			collapse: { act: "collapse-right", side: "right", collapsed: !!this.rightCollapsed,
						label: __("Collapse settings"), shortLabel: __("Settings") },
			body,
			footer: itab === "mapping" ? "" : U.footerActions(
				locked
					? [{ label: __("Save wording correction"), tone: "primary", icon: "i-save", act: "apply-correction" }]
					: [{ label: __("Apply changes"), tone: "primary", icon: "i-save", act: "apply" }]),
		}));
	}

	// ------------------------------------------------------------- non-build tabs
	_previewTab() {
		return `<div class="pane" style="height:100%"><div class="pane-body">
			<div class="canvas-help">${__("Preview opens the real respondent page in a new tab. It collects nothing and needs a login, so it is safe on a draft.")}</div>
			<div style="padding:12px">${window.UCCMO.button({
				label: __("Open preview"), tone: "primary", icon: "i-eye", act: "preview" })}</div>
		</div></div>`;
	}

	_shareTab() {
		const U = window.UCCMO;
		return `<div class="pane" style="height:100%"><div class="pane-body" data-share>
			<div class="canvas-help">${__("Loading link…")}</div></div></div>`;
	}

	_responsesTab() {
		return `<div class="pane" style="height:100%"><div class="pane-body" data-responses>
			<div class="canvas-help">${__("Loading responses…")}</div></div></div>`;
	}

	_exportsTab() {
		const U = window.UCCMO;
		return `<div class="pane" style="height:100%"><div class="pane-body" style="padding:12px">
			<div class="canvas-help">${__("Exports are permission-checked and generated on the server.")}</div>
			<div style="display:flex;gap:8px;margin-top:10px">
				${U.button({ label: __("Responses (CSV)"), icon: "i-save", act: "export-csv" })}
			</div>
		</div></div>`;
	}

	_wire() {
		const $el = this.$el;
		$el.off("click.mo input.mo");
		$el.on("click.mo", "[data-page]", (e) => {
			this.pageIndex = +$(e.currentTarget).data("page");
			this.s.question = null;
			this._draw();
		});
		$el.on("click.mo", "[data-q]", (e) => {
			this.s.question = $(e.currentTarget).data("q");
			this._draw();
		});
		$el.on("click.mo", "[data-itab]", (e) => {
			this.s.qtab = $(e.currentTarget).data("itab");
			this._renderInspector();
		});
		$el.on("click.mo", '[data-act="collapse-left"]', () => {
			this.leftCollapsed = !this.leftCollapsed; this._draw();
		});
		$el.on("click.mo", '[data-act="collapse-right"]', () => {
			this.rightCollapsed = !this.rightCollapsed; this._draw();
		});
		$el.on("click.mo", '[data-act="goto-map"]', () => {
			this.app.ws = "objectives";
			this.app.state.gotoArg = this.s.question;
			this.app.render();
		});
		$el.on("click.mo", '[data-act="add-question"]', (e) => {
			e.stopPropagation();
			const $pop = window.UCCMO.wirePopover($el, "types");
			$pop.toggleClass("open");
			$pop.find("[data-pop-search]").val("").trigger("input").focus();
		});
		$el.on("click.mo", "[data-pick]", (e) => {
			$el.find('[data-pop="types"]').removeClass("open");
			this._addQuestion($(e.currentTarget).data("pick"));
		});
		$el.on("click.mo", '[data-act="dup"]', (e) => {
			e.stopPropagation();
			this.app.call(BAPI + "duplicate_question", { question: $(e.currentTarget).data("q") })
				.then(() => this._load());
		});
		$el.on("click.mo", '[data-act="del"]', (e) => {
			e.stopPropagation();
			const q = $(e.currentTarget).data("q");
			frappe.confirm(__("Delete this question?"), () =>
				this.app.call(BAPI + "delete_question", { question: q }).then(() => {
					this.s.question = null;
					this._load();
				}));
		});
		// Page Break, not Section Heading - see _paginate()'s comment for why.
		$el.on("click.mo", '[data-act="add-page"]', () => this._addQuestion("Page Break"));
		$el.on("click.mo", '[data-act="apply"]', () => this._apply());
		$el.on("click.mo", '[data-act="apply-correction"]', () => this._applyCorrection());
		$el.on("click.mo", '[data-act="preview"]', () => this._preview());
		$el.on("click.mo", '[data-act="new-version"]', () => this._newVersion());
		$el.on("click.mo", '[data-act="new-survey"]', () => this._newSurvey());
		$el.on("click.mo", '[data-act="save-draft"]', () => this._apply());
		$el.on("click.mo", '[data-act="export-csv"]', () => this._export());
		$el.on("click.mo", ".switch:not([disabled])", (e) =>
			$(e.currentTarget).toggleClass("on"));
		if (this.app.tab("build") === "share") this._fillShare();
		if (this.app.tab("build") === "responses") this._fillResponses();
	}

	_val(f) {
		const $c = this.$el.find(`[data-f="${f}"]`);
		if (!$c.length) return null;
		if ($c.hasClass("switch")) return $c.hasClass("on") ? 1 : 0;
		return $c.val();
	}

	_apply() {
		const name = this.s.question;
		if (!name) return this.app.toast(__("Select a question first."), "orange");
		const payload = {
			question_text: this._val("question_text"), help_text: this._val("help_text"),
			question_type: this._val("question_type"), is_required: this._val("is_required"),
			layout_width: this._val("layout_width"),
		};
		const choices = this._val("choices");
		if (choices !== null) {
			payload.choices = choices.split("\n").map((s) => s.trim()).filter(Boolean)
				.map((line, i) => {
					const [label, value] = line.split("|").map((x) => x.trim());
					return { choice_label: label, choice_value: value || null, sequence: i };
				});
		}
		const logic = this._val("display_logic");
		if (logic !== null) payload.display_logic = logic;
		Object.keys(payload).forEach((k) => payload[k] === null && delete payload[k]);
		this.app.call(BAPI + "update_question", { question: name, payload: JSON.stringify(payload) })
			.then((ok) => {
				if (!ok) return;
				this.app.toast(__("Saved"));
				this._load();
			});
	}

	// The narrow path a frozen version accepts. Sends wording + reason ALONE, so
	// nothing else from the inspector can ride along - versioning.py decides.
	_applyCorrection() {
		const text = (this._val("corrected_text") || "").trim();
		const reason = (this._val("correction_reason") || "").trim();
		const q = this.questions.find((x) => x.name === this.s.question);
		if (!text) return this.app.toast(__("The question cannot be empty."), "orange");
		if (q && text === (q.question_text || "").trim()) {
			return this.app.toast(__("The wording is unchanged."), "blue");
		}
		if (!reason) return this.app.toast(__("A correction needs a reason."), "orange");
		this.app.call(BAPI + "update_question", {
			question: this.s.question,
			payload: JSON.stringify({ question_text: text, correction_reason: reason }),
		}).then((ok) => {
			if (!ok) return;
			this.app.toast(__("Wording corrected"));
			this._load();
		});
	}

	_addQuestion(type) {
		const page = this.pages[this.pageIndex] || { items: [] };
		const last = page.items[page.items.length - 1];
		const at = last ? this.questions.findIndex((q) => q.name === last.name) + 1 : undefined;
		this.app.call(BAPI + "add_question", {
			survey_version: this.s.surveyVersion, question_type: type, sequence: at,
		}).then((name) => {
			if (!name) return;
			this.s.question = name;
			this._load();
		});
	}

	_preview() {
		this.app.call(BAPI + "preview_link", { survey_version: this.s.surveyVersion })
			.then((r) => r && r.url && window.open(r.url, "_blank", "noopener"));
	}

	_newVersion() {
		frappe.confirm(
			__("Create a new draft version of this survey? The published one keeps collecting."),
			() => this.app.call(BAPI + "new_version", { survey: this.version.survey })
				.then((name) => {
					if (!name) return;
					this.s.surveyVersion = name;
					this.s.question = null;
					this.app.toast(__("Draft version created"));
					this.render();
				}));
	}

	_newSurvey() {
		frappe.prompt([{ fieldname: "title", fieldtype: "Data", label: __("Survey title"), reqd: 1 }],
			(v) => this.app.call(BAPI + "new_survey_with_version", { title: v.title })
				.then((name) => {
					if (!name) return;
					this.s.surveyVersion = name;
					this.render();
				}), __("New survey"), __("Create"));
	}

	_fillShare() {
		const U = window.UCCMO;
		this.app.call(BAPI + "public_link", { survey_version: this.s.surveyVersion }).then((r) => {
			const $b = this.$el.find("[data-share]");
			if (!r) return;
			if (!r.url) {
				$b.html(`<div style="padding:12px">
					<div class="canvas-help">${U.esc(r.reason || "")}</div>
					${!r.campaign && this.version.status === "Published"
						? `<div style="margin-top:10px">${U.button({
							label: __("Start collecting"), tone: "primary", icon: "i-link",
							act: "start-collecting" })}</div>` : ""}</div>`);
				$b.find('[data-act="start-collecting"]').on("click", () => this._startCollecting());
				return;
			}
			$b.html(`<div style="padding:12px">
				<div class="field"><label>${__("Public link")}</label>
					<input type="text" readonly value="${U.esc(r.url)}"></div>
				<div style="display:flex;gap:8px">
					${U.button({ label: __("Copy"), icon: "i-copy", act: "copy" })}
					${U.button({ label: __("QR code"), icon: "i-grid", act: "qr" })}
				</div></div>`);
			$b.find('[data-act="copy"]').on("click", () => {
				frappe.utils.copy_to_clipboard(r.url);
				this.app.toast(__("Link copied"));
			});
			$b.find('[data-act="qr"]').on("click", () =>
				this.app.call(BAPI + "campaign_qr", { campaign: r.campaign }).then((qr) => {
					if (!qr) return;
					const d = new frappe.ui.Dialog({
						title: __("Scan to open this survey"),
						fields: [{ fieldtype: "HTML", fieldname: "qr" }],
					});
					d.fields_dict.qr.$wrapper.html(
						`<div style="text-align:center">${qr.svg}</div>`);
					d.show();
				}));
		});
	}

	_startCollecting() {
		this.app.call(CAPI + "collection_setup", { survey_version: this.s.surveyVersion }).then((f) => {
			if (!f) return;
			const d = new frappe.ui.Dialog({
				title: __("Start collecting responses"),
				fields: [{ fieldname: "planning_record", fieldtype: f.fieldtype, options: f.options,
						   label: f.label, reqd: 1 }],
				primary_action_label: __("Open the survey"),
				primary_action: (v) => this.app.call(CAPI + "start_collecting", {
					survey_version: this.s.surveyVersion, planning_record: v.planning_record,
				}).then((res) => {
					if (!res) return;
					d.hide();
					this.app.toast(__("Campaign {0} created", [res.campaign]));
					this._draw();
				}),
			});
			d.show();
		});
	}

	_fillResponses() {
		const U = window.UCCMO;
		const $b = this.$el.find("[data-responses]");
		if (!this.campaign) {
			return $b.html(`<div style="padding:12px" class="canvas-help">${
				__("No responses yet. Publish the version and start collecting to gather some.")}</div>`);
		}
		this.app.call(CAPI + "campaign_analytics", { survey_tracking: this.campaign }).then((d) => {
			if (!d) return;
			const c = d.counts;
			$b.html(`<div style="padding:12px">
				<div class="status-strip" style="border:0;padding:0;margin-bottom:10px">
					<span class="stat"><b>${c.completed}</b> <span>${__("completed")}</span></span>
					<span class="stat-divider"></span>
					<span class="stat"><b>${d.response_rate === null ? "—" : d.response_rate + "%"}</b> <span>${__("response rate")}</span></span>
					<span class="stat-divider"></span>
					<span class="stat"><b>${c.answers}</b> <span>${__("answers")}</span></span>
				</div>
				${d.distribution.map((q) => `
					<div class="source-row" style="margin-bottom:6px">
						<span class="type-icon">${U.icon("i-chart", "sm")}</span>
						<div><b>${U.esc(q.label)}</b>${q.corrected
							? ` <span class="chip warning" title="${U.esc(q.corrected)}">${
								__("wording corrected")}</span>` : ""}
							<div class="eyebrow">${q.values.map((v) =>
								U.esc(v.value) + " × " + v.count).join(" · ")}</div></div>
					</div>`).join("")}
			</div>`);
		});
	}

	_export() {
		this.app.call(DAPI + "export_dashboard", { fmt: "csv", section: "kpis" }).then((r) => {
			if (!r) return;
			const blob = new Blob([r.content], { type: "text/csv" });
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = r.filename || "export.csv";
			a.click();
		});
	}
}

// =========================================================== OBJECTIVES ===
// Queue | focused canvas | node editor. Never all 97 objectives at once.
class ObjectiveWorkspace {
	constructor(app, $el) { this.app = app; this.$el = $el; }
	get s() { return this.app.state; }

	render() {
		this.$el.html('<div class="pane" style="height:100%"><div class="pane-body">' + __("Loading…") + "</div></div>");
		this.app.call(BAPI + "list_versions", { limit: 100 }).then((versions) => {
			this.versions = versions || [];
			if (!this.s.surveyVersion && this.versions.length) this.s.surveyVersion = this.versions[0].name;
			if (!this.s.surveyVersion) return this.$el.html(window.UCCMO.empty(__("No surveys yet.")));
			this._load();
		});
	}

	_load() {
		Promise.all([
			this.app.call(MAPI + "get_mapping_overview", { survey_version: this.s.surveyVersion }),
			this.app.call(MAPI + "mapping_coverage", { survey_version: this.s.surveyVersion }),
			this.app.call(MAPI + "mapping_masters"),
		]).then(([ov, cov, masters]) => {
			this.rows = (ov && ov.questions) || [];
			this.coverage = cov || {};
			this.masters = masters || { objectives: [] };
			this.unmapped = new Set(this.coverage.questions_without_objective || []);
			if (this.s.gotoArg) { this.s.question = this.s.gotoArg; this.s.gotoArg = null; }
			if (!this.s.question || !this.rows.some((r) => r.name === this.s.question)) {
				const first = this.rows.find((r) => this.unmapped.has(r.name)) || this.rows[0];
				this.s.question = first && first.name;
			}
			this.app.counts = Object.assign(this.app.counts || {}, { objectives: this.unmapped.size });
			this._draw();
		});
	}

	get question() { return this.rows.find((r) => r.name === this.s.question); }

	// The focused set: what this question already links to, plus a few candidates
	// from the same survey's vocabulary. Never the whole register - "Browse all"
	// is the deliberate escape hatch.
	_focusObjectives() {
		const q = this.question;
		if (!q) return [];
		const linked = q.objectives || [];
		const nearby = [];
		this.rows.forEach((r) => (r.objectives || []).forEach((o) => {
			if (linked.indexOf(o) === -1 && nearby.indexOf(o) === -1) nearby.push(o);
		}));
		const shown = linked.concat(nearby.slice(0, Math.max(0, 5 - linked.length)));
		return shown.map((o) => ({ code: o, linked: linked.indexOf(o) !== -1 }));
	}

	_draw() {
		const U = window.UCCMO;
		const tab = this.app.tab("map");
		const showAll = this.queueShowAll;
		const queue = this.rows.filter((r) =>
			r.question_type !== "Section Heading" && (showAll || this.unmapped.has(r.name)));

		this.$el.html(`
			${U.contextBar({
				eyebrow: __("Objectives workspace"),
				title: __("Mapping questions to the objective register"),
				status: __("{0} unmapped", [this.unmapped.size]),
				statusTone: this.unmapped.size ? "warn" : "ok",
				actions: [{ label: __("Browse all objectives"), icon: "i-target", act: "browse-all" }],
			})}
			${U.tabs([{ key: "map", label: __("Map") }, { key: "coverage", label: __("Coverage") },
					  { key: "governance", label: __("Governance") }], tab)}
			${U.statusStrip([
				{ value: (this.coverage.counts || {}).questions || 0, label: __("questions") },
				{ value: (this.coverage.counts || {}).questions_mapped || 0, label: __("mapped") },
				{ value: (this.coverage.counts || {}).objectives || 0, label: __("in register") },
			], {
				text: __("Mapping is governance and lineage. It does not change any index score."),
				tone: "", icon: "i-warning",
			})}
			<div class="workarea">${tab === "map" ? `
				<div class="objective-shell">
					${U.pane({
						cls: "queue", title: __("Questions"), icon: "i-filter", count: queue.length,
						actions: [{ act: "toggle-queue", label: showAll ? __("Needs attention") : __("Show all") }],
						body: queue.length ? queue.map((r) => `
							<button class="queue-item ${r.name === this.s.question ? "selected" : ""}" data-q="${U.esc(r.name)}">
								<span class="outline-icon">${U.icon(window.UCCMOIcons.forQuestionType(r.question_type), "xs")}</span>
								<span class="question-copy">${U.esc((r.question_text || "").slice(0, 44))}
									<span class="eyebrow">${U.esc(this.s.surveyVersion)}</span></span>
								${this.unmapped.has(r.name)
									? U.chip(__("Unmapped"), "warn") : U.chip(__("Mapped"), "ok")}
							</button>`).join("")
							: U.empty(__("Nothing needs attention. Every question has an objective.")),
					})}
					<section class="pane mapping-pane">
						<header class="pane-head">
							<div class="pane-title-with-icon">${U.icon("i-target", "sm")}<span>${__("Mapping")}</span></div>
							${U.button({ label: __("Browse all {0}", [(this.coverage.counts || {}).objectives || 0]),
										 small: true, act: "browse-all" })}
						</header>
						<div class="pane-body mapping-stage"><div class="mapping-stage-inner">
							${this._canvas()}
						</div></div>
					</section>
					<div data-node-editor></div>
				</div>` : this._otherTab(tab)}</div>`);

		this._wire();
		if (tab === "map") {
			this._renderNodeEditor();
			requestAnimationFrame(() => this._drawLines());
		}
	}

	_canvas() {
		const U = window.UCCMO;
		const q = this.question;
		if (!q) return U.empty(__("Pick a question from the queue."));
		const objs = this._focusObjectives();
		return `<svg class="mapping-svg"></svg>
			<div class="node-column">
				<div class="map-node question ${this.sel === "question" ? "selected" : ""}" data-map-node="question">
					<div class="node-kicker">${__("Question")}</div>
					<div class="node-title">${U.esc((q.question_text || "").slice(0, 70))}</div>
					<div class="node-meta">${U.esc(q.question_type || "")}</div>
				</div>
			</div>
			<div class="node-column">
				${objs.length ? objs.map((o) => `
					<div class="map-node objective ${o.linked ? "linked" : ""} ${
						this.sel === o.code ? "selected" : ""}" data-map-node="${U.esc(o.code)}">
						<div class="node-kicker">${__("Objective")}</div>
						<div class="node-title">${U.esc(o.code)}</div>
						<div class="node-meta link-state">${o.linked
							? U.chip(__("Linked"), "ok", "i-link") : U.chip(__("Not linked"), "", "i-unlink")}</div>
					</div>`).join("")
					: U.empty(__("No objectives in view yet."),
							  { label: __("Browse all"), act: "browse-all", tone: "primary" })}
			</div>`;
	}

	// SVG connectors, drawn from real element positions - the same technique the
	// prototype uses, and the reason the canvas is redrawn after a frame rather
	// than during the same tick that inserts the nodes.
	_drawLines() {
		const $stage = this.$el.find(".mapping-stage-inner");
		const svg = this.$el.find(".mapping-svg").get(0);
		if (!svg || !$stage.length) return;
		const box = $stage.get(0).getBoundingClientRect();
		const $q = this.$el.find('[data-map-node="question"]');
		if (!$q.length) return;
		const qr = $q.get(0).getBoundingClientRect();
		const x1 = qr.right - box.left, y1 = qr.top + qr.height / 2 - box.top;
		let paths = "";
		this.$el.find('.map-node.objective').each((_, el) => {
			const r = el.getBoundingClientRect();
			const x2 = r.left - box.left, y2 = r.top + r.height / 2 - box.top;
			const c = Math.max(40, (x2 - x1) / 2);
			const linked = el.classList.contains("linked");
			paths += `<path class="map-line ${linked ? "linked" : ""}" d="M ${x1} ${y1} C ${
				x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}"></path>`;
		});
		svg.innerHTML = paths;
	}

	_renderNodeEditor() {
		const U = window.UCCMO;
		const $slot = this.$el.find("[data-node-editor]");
		const q = this.question;
		if (!this.sel || this.sel === "question") {
			$slot.html(U.inspector({
				title: __("Question"), icon: q ? window.UCCMOIcons.forQuestionType(q.question_type) : "i-survey",
				body: q ? U.field({ label: __("Question"), name: "qt", type: "textarea",
									value: q.question_text, locked: true,
									lockReason: __("Wording is managed in the Survey workspace.") })
					+ U.field({ label: __("Survey version"), name: "sv", value: this.s.surveyVersion, locked: true })
					+ U.field({ label: __("Type"), name: "qty", value: q.question_type, locked: true })
					+ U.button({ label: __("Open in Survey workspace"), small: true, icon: "i-survey", act: "goto-survey" })
					: U.empty(__("Select a node.")),
			}));
			return;
		}
		const linked = q && (q.objectives || []).indexOf(this.sel) !== -1;
		const otab = this.otab || "details";
		const detail = (this.masters.objectives || []).find((o) => o.name === this.sel) || {};
		let body;
		if (otab === "details") {
			body = U.field({ label: __("Objective code"), name: "oc", value: this.sel, locked: true })
				+ (detail.objective_name ? U.field({ label: __("Name"), name: "on", value: detail.objective_name, locked: true }) : "")
				+ (detail.clause_or_criterion ? U.field({ label: __("Clause / criterion"), name: "occ", value: detail.clause_or_criterion, locked: true }) : "")
				+ (detail.status ? U.field({ label: __("Status"), name: "os", value: detail.status, locked: true }) : "")
				+ `<div class="help">${__("The objective itself belongs to the institutional register and is not edited here.")}</div>`
				+ U.button({ label: __("Open in register"), small: true, icon: "i-link", act: "open-register" });
		} else if (otab === "mapping") {
			body = `<div class="switch-row"><button class="switch ${linked ? "on" : ""}" data-act="toggle-link"></button>
					<span>${linked ? __("Linked to this question") : __("Not linked")}</span></div>
				<div class="help">${__("Linking records evidence lineage. It does not change the index score.")}</div>`
				+ U.field({ label: __("Primary clause"), name: "primary_clause",
							value: (q && q.primary_clause) || "", placeholder: __("e.g. 7.1.1") })
				+ U.field({ label: __("Rationale"), name: "related_clauses", type: "textarea", rows: 3,
							value: (q && q.related_clauses) || "",
							placeholder: __("Why this question evidences this objective") });
		} else {
			body = `<div class="help">${__("Who linked this and when comes from Frappe's own document history on UCC Question Mapping - there is no second log to disagree with it.")}</div>`
				+ U.field({ label: __("Source survey version"), name: "asv", value: this.s.surveyVersion, locked: true })
				+ U.field({ label: __("Question"), name: "aq", value: this.s.question, locked: true })
				+ U.button({ label: __("Open mapping records"), small: true, icon: "i-history", act: "open-mappings" });
		}
		$slot.html(U.inspector({
			title: this.sel, icon: "i-target",
			tabs: [{ key: "details", label: __("Details") }, { key: "mapping", label: __("Mapping") },
				   { key: "audit", label: __("Audit") }],
			tab: otab, body,
			footer: otab === "mapping" ? U.footerActions([
				linked
					? { label: __("Unlink"), tone: "ghost", icon: "i-unlink", act: "unlink" }
					: { label: __("Link objective"), tone: "primary", icon: "i-link", act: "link" },
				{ label: __("Save rationale"), icon: "i-save", act: "save-mapping", disabled: !linked },
			]) : "",
		}));
	}

	_otherTab(tab) {
		const U = window.UCCMO;
		const c = this.coverage.counts || {};
		if (tab === "coverage") {
			const idle = this.coverage.unmapped_objectives || [];
			return `<div class="pane" style="height:100%"><div class="pane-body" style="padding:12px">
				<div class="status-strip" style="border:0;padding:0;margin-bottom:12px">
					<span class="stat"><b>${c.questions_mapped || 0}/${c.questions || 0}</b> <span>${__("questions mapped")}</span></span>
					<span class="stat-divider"></span>
					<span class="stat"><b>${c.objectives_used || 0}/${c.objectives || 0}</b> <span>${__("objectives reached")}</span></span>
				</div>
				<div class="section-label">${__("Objectives this survey does not reach")} (${idle.length})</div>
				<div>${idle.slice(0, 40).map((o) => U.chip(o, "")).join(" ")}${
					idle.length > 40 ? `<span class="eyebrow"> +${idle.length - 40} ${__("more")}</span>` : ""}</div>
			</div></div>`;
		}
		return `<div class="pane" style="height:100%"><div class="pane-body" style="padding:12px">
			<div class="help">${__("Every mapping change is recorded by Frappe's document history on UCC Question Mapping, including who made it and when.")}</div>
			<div class="section-label" style="margin-top:12px">${__("Duplicate question text")}</div>
			<div>${(this.coverage.duplicate_questions || []).length
				? (this.coverage.duplicate_questions || []).map((g) => U.chip(g.join(" / "), "warn")).join(" ")
				: `<span class="eyebrow">${__("None found.")}</span>`}</div>
		</div></div>`;
	}

	_wire() {
		const $el = this.$el;
		$el.off("click.mo");
		$el.on("click.mo", "[data-q]", (e) => {
			this.s.question = $(e.currentTarget).data("q");
			this.sel = "question";
			this._draw();
		});
		$el.on("click.mo", "[data-map-node]", (e) => {
			this.sel = $(e.currentTarget).data("map-node");
			this._draw();
		});
		$el.on("click.mo", "[data-itab]", (e) => {
			this.otab = $(e.currentTarget).data("itab");
			this._renderNodeEditor();
		});
		$el.on("click.mo", '[data-act="toggle-queue"]', () => {
			this.queueShowAll = !this.queueShowAll; this._draw();
		});
		$el.on("click.mo", '[data-act="browse-all"]', () => this._browseAll());
		$el.on("click.mo", '[data-act="link"], [data-act="toggle-link"]', () => this._link());
		$el.on("click.mo", '[data-act="unlink"]', () => this._unlink());
		$el.on("click.mo", '[data-act="save-mapping"]', () => this._saveMapping());
		$el.on("click.mo", '[data-act="goto-survey"]', () => {
			this.app.ws = "surveys"; this.app.render();
		});
		$el.on("click.mo", '[data-act="open-register"]', () =>
			frappe.set_route("Form", "Survey Objective", this.sel));
		$el.on("click.mo", '[data-act="open-mappings"]', () =>
			frappe.set_route("List", "UCC Question Mapping", { question: this.s.question }));
	}

	_browseAll() {
		const d = new frappe.ui.Dialog({
			title: __("Objective register"),
			fields: [{ fieldname: "objective", fieldtype: "Link", options: "Survey Objective",
					   label: __("Search the register"), reqd: 1 }],
			primary_action_label: __("Add to canvas"),
			primary_action: (v) => {
				d.hide();
				this.sel = v.objective;
				// Held so the focused canvas includes it without linking anything -
				// browsing is not committing.
				const q = this.question;
				if (q && (q.objectives || []).indexOf(v.objective) === -1) {
					q.objectives = (q.objectives || []).concat([]);
					this._extra = v.objective;
				}
				this._draw();
			},
		});
		d.show();
	}

	_link() {
		this.app.call(MAPI + "connect_nodes", { a: "q:" + this.s.question, b: "o:" + this.sel })
			.then((r) => {
				this.app.toast(r ? __("Objective linked") : __("Already linked"),
							   r ? "green" : "blue");
				this._load();
			});
	}

	_unlink() {
		frappe.confirm(__("Remove this mapping? Any clause and rationale on it go too."), () =>
			this.app.call(MAPI + "disconnect_nodes", { a: "q:" + this.s.question, b: "o:" + this.sel })
				.then(() => { this.app.toast(__("Unlinked")); this._load(); }));
	}

	_saveMapping() {
		this.app.call(MAPI + "upsert_question_mapping", {
			question: this.s.question, objective: this.sel,
			primary_clause: this.$el.find('[data-f="primary_clause"]').val(),
			related_clauses: this.$el.find('[data-f="related_clauses"]').val(),
		}).then(() => { this.app.toast(__("Mapping saved")); this._load(); });
	}
}

// ============================================================== METRICS ===
// The gap the model always allowed and no UI ever offered: assembling one
// metric from questions across SEVERAL surveys.
class MetricWorkspace {
	constructor(app, $el) { this.app = app; this.$el = $el; }
	get s() { return this.app.state; }

	render() {
		this.$el.html('<div class="pane" style="height:100%"><div class="pane-body">' + __("Loading…") + "</div></div>");
		this.app.call(XAPI + "list_metrics").then((metrics) => {
			this.metrics = metrics || [];
			if (!this.s.metric && this.metrics.length) this.s.metric = this.metrics[0].name;
			this.app.counts = Object.assign(this.app.counts || {}, { metrics: this.metrics.length });
			if (!this.s.metric) return this._draw(null);
			this.app.call(XAPI + "get_metric", { metric_code: this.s.metric }).then((m) => this._draw(m));
		});
	}

	_draw(m) {
		const U = window.UCCMO;
		this.metric = m;
		const tab = this.app.tab("build");
		this.$el.html(`
			${U.contextBar({
				eyebrow: __("Metrics workspace"),
				title: m ? (m.metric_name || m.name) : __("No metrics yet"),
				version: m ? m.name : "",
				status: m ? (m.sources.length ? __("{0} sources", [m.sources.length]) : __("No sources"))
						  : "",
				statusTone: m && m.sources.length ? "ok" : "warn",
				actions: [
					{ label: __("New metric"), icon: "i-plus", act: "new-metric" },
					{ label: __("Preview calculation"), tone: "primary", icon: "i-chart",
					  act: "preview", disabled: !m },
				],
			})}
			${U.tabs([{ key: "build", label: __("Build") },
					  { key: "library", label: __("Source library") },
					  { key: "validation", label: __("Validation") }], tab)}
			${U.statusStrip(m ? [
				{ value: m.sources.length, label: __("source questions") },
				{ value: m.survey_count, label: __("surveys") },
				{ value: (m.used_by || []).length, label: __("index nodes") },
			] : [{ value: this.metrics.length, label: __("metrics") }],
			m && m.survey_count > 1
				? { text: __("This metric draws on {0} survey versions.", [m.survey_count]), tone: "", icon: "i-check" }
				: null)}
			<div class="workarea"><div class="metric-layout">
				${U.pane({
					cls: "metric-list", title: __("Metrics"), icon: "i-metric", count: this.metrics.length,
					body: this.metrics.map((x) => `
						<button class="metric-item ${x.name === this.s.metric ? "selected" : ""}" data-metric="${U.esc(x.name)}">
							<span class="type-icon metric">${U.icon("i-metric", "sm")}</span>
							<span class="question-copy"><b>${U.esc(x.metric_name || x.name)}</b>
								<span class="eyebrow">${U.esc(x.name)}</span></span>
							${x.sourceless ? U.chip(__("No sources"), "warn") : U.chip(x.sources + " ▸", "ok")}
						</button>`).join("") || U.empty(__("No metrics defined yet.")),
				})}
				${tab === "build" ? this._centre(m) : this._otherTab(tab, m)}
				${tab === "build" ? this._scoring(m) : ""}
			</div></div>`);
		this._wire();
	}

	_centre(m) {
		const U = window.UCCMO;
		if (!m) return U.pane({ title: __("Sources"), body: U.empty(__("Create a metric to begin.")) });
		const rows = m.sources.map((s) => s.kind === "operational"
			? `<div class="source-row"><span class="type-icon">${U.icon("i-settings", "sm")}</span>
				<div><b>${U.esc(s.reference || __("Operational field"))}</b>
				<div class="eyebrow">${__("Not read by the calculation yet")}</div></div>
				<span></span><span></span></div>`
			: `<div class="source-row">
				<span class="type-icon">${U.icon(window.UCCMOIcons.forQuestionType(s.question_type), "sm")}</span>
				<div><b>${U.esc((s.text || "").slice(0, 66))}</b>
					<div class="eyebrow">${U.esc(s.survey || "")} ${U.esc(s.version_number ? "v" + s.version_number : "")}
						· ${U.esc(s.answers)} ${__("answers")} · ${U.esc(s.normalisation || m.default_normalisation)}</div></div>
				<select class="mini-select" data-norm="${U.esc(s.question)}" title="${
					__("Normalisation for this source")}">${NORMALISATIONS.map((n) =>
					`<option ${n === (s.normalisation || m.default_normalisation) ? "selected" : ""}>${
						U.esc(n)}</option>`).join("")}</select>
				<button class="mini" data-act="rm-source" data-q="${U.esc(s.question)}" title="${
					__("Remove")}">${U.icon("i-trash", "sm")}</button>
			</div>`).join("");

		// The weight total is shown as RECORDED, never as a requirement. The
		// engine takes a plain mean over answers and reads weight_within_metric
		// nowhere, so an amber "add 10% more" bar would be demanding something
		// that changes no number. See the decision log: the aggregation rule is
		// an open decision, and this states the truth until it is made.
		const total = m.sources.reduce((a, s) => a + (s.weight || 0), 0);
		return `<section class="pane">
			<header class="pane-head">
				<div class="pane-title-with-icon">${U.icon("i-metric", "sm")}<span>${__("Source questions")}</span>
					<span class="count">${m.sources.length}</span></div>
				${U.button({ label: __("Add source"), tone: "primary", small: true, icon: "i-plus", act: "add-source" })}
			</header>
			<div class="pane-body">
				<div class="source-table">${rows || U.empty(
					__("No sources. A metric with no source questions scores nothing."),
					{ label: __("Add source"), tone: "primary", act: "add-source" })}</div>
				<div class="total-row">
					<span>${__("Recorded weights")}</span>
					<b>${total}%</b>
					<span class="eyebrow">${__("Recorded only. The calculation currently averages every answer equally; weighting is an open decision (see the decision log).")}</span>
				</div>
			</div>
		</section>`;
	}

	_scoring(m) {
		const U = window.UCCMO;
		if (!m) return "<div></div>";
		return U.inspector({
			title: __("Scoring"), icon: "i-settings",
			body: U.field({ label: __("Metric name"), name: "metric_name", value: m.metric_name })
				+ U.field({ label: __("Default normalisation"), name: "default_normalisation",
							type: "select", value: m.default_normalisation, options: NORMALISATIONS })
				+ U.field({ label: __("Description"), name: "description", type: "textarea", rows: 3,
							value: m.description })
				+ `<div class="help">${__("Normalisation runs once, here at the metric layer. The index applies weights only and never re-normalises.")}</div>`
				+ ((m.used_by || []).length
					? `<div class="section-label">${__("Consumed by")}</div>` + m.used_by.map((u) =>
						U.chip(u.parent + " · " + (u.label || ""), "")).join(" ")
					: `<div class="help">${__("No index node uses this metric yet.")}</div>`),
			footer: U.footerActions([{ label: __("Save metric"), tone: "primary", icon: "i-save", act: "save-metric" }]),
		});
	}

	_otherTab(tab, m) {
		const U = window.UCCMO;
		if (tab === "validation") {
			const issues = [];
			this.metrics.forEach((x) => {
				if (x.sourceless) issues.push({ metric: x.name, text: __("No source questions — scores nothing") });
				else if (!x.used_by) issues.push({ metric: x.name, text: __("Not used by any index node") });
			});
			return `<section class="pane"><div class="pane-body" style="padding:12px">
				${issues.length ? issues.map((i) => `<div class="source-row" style="margin-bottom:6px">
					<span class="type-icon">${U.icon("i-warning", "sm")}</span>
					<div><b>${U.esc(i.metric)}</b><div class="eyebrow">${U.esc(i.text)}</div></div>
					<span></span><span></span></div>`).join("")
					: U.empty(__("Every metric has sources and is used by an index."))}
			</div></section>`;
		}
		return `<section class="pane"><div class="pane-body" style="padding:12px">
			<div class="help">${__("Search every question in every survey. This is what makes a cross-survey metric possible.")}</div>
			<div class="field"><input type="text" data-lib-search placeholder="${
				__("Search question wording…")}"></div>
			<div data-lib></div>
		</div></section>`;
	}

	_wire() {
		const $el = this.$el;
		$el.off("click.mo input.mo change.mo");
		$el.on("click.mo", "[data-metric]", (e) => {
			this.s.metric = $(e.currentTarget).data("metric");
			this.render();
		});
		$el.on("click.mo", '[data-act="new-metric"]', () => this._newMetric());
		$el.on("click.mo", '[data-act="add-source"]', () => this._addSource());
		$el.on("click.mo", '[data-act="rm-source"]', (e) => {
			const q = $(e.currentTarget).data("q");
			this.app.call(XAPI + "remove_metric_source", { metric_code: this.s.metric, question: q })
				.then(() => { this.app.toast(__("Source removed")); this.render(); });
		});
		$el.on("click.mo", '[data-act="save-metric"]', () => {
			this.app.call(XAPI + "save_metric", {
				metric_code: this.s.metric,
				metric_name: $el.find('[data-f="metric_name"]').val(),
				default_normalisation: $el.find('[data-f="default_normalisation"]').val(),
				description: $el.find('[data-f="description"]').val(),
			}).then(() => { this.app.toast(__("Metric saved")); this.render(); });
		});
		$el.on("click.mo", '[data-act="preview"]', () => this._preview());
		$el.on("input.mo", "[data-lib-search]", (e) => this._searchLibrary(e.target.value));
		// Per-source normalisation is the one source setting that DOES reach a
		// score, so it is an inline control rather than buried in a dialog.
		$el.on("change.mo", "[data-norm]", (e) => {
			const $s = $(e.currentTarget);
			this.app.call(XAPI + "set_source_normalisation", {
				metric_code: this.s.metric, question: $s.data("norm"), normalisation: $s.val(),
			}).then(() => { this.app.toast(__("Normalisation updated")); this.render(); });
		});
		if (this.app.tab("build") === "library") this._searchLibrary("");
	}

	_newMetric() {
		frappe.prompt([
			{ fieldname: "metric_code", fieldtype: "Data", label: __("Metric code"), reqd: 1 },
			{ fieldname: "metric_name", fieldtype: "Data", label: __("Metric name") },
		], (v) => this.app.call(XAPI + "new_metric", v).then((name) => {
			if (!name) return;
			this.s.metric = name;
			this.render();
		}), __("New metric"), __("Create"));
	}

	_addSource() {
		const d = new frappe.ui.Dialog({
			title: __("Add a source question"),
			fields: [
				{ fieldname: "q", fieldtype: "Data", label: __("Search across all surveys") },
				{ fieldname: "out", fieldtype: "HTML" },
			],
		});
		const search = () => this.app.call(XAPI + "search_questions", {
			query: d.get_value("q"), exclude_metric: this.s.metric, limit: 30,
		}).then((rows) => {
			const U = window.UCCMO;
			d.fields_dict.out.$wrapper.html(`<div style="max-height:320px;overflow:auto">${
				(rows || []).map((r) => `<div class="source-row" style="margin-bottom:6px;cursor:pointer"
					data-add="${U.esc(r.name)}">
					<span class="type-icon">${U.icon(window.UCCMOIcons.forQuestionType(r.question_type), "sm")}</span>
					<div><b>${U.esc((r.question_text || "").slice(0, 64))}</b>
						<div class="eyebrow">${U.esc(r.survey || "")} ${
							U.esc(r.version_number ? "v" + r.version_number : "")} · ${U.esc(r.version_status || "")}</div></div>
					<span></span><span>+</span></div>`).join("") || __("No questions found.")}</div>`);
			d.fields_dict.out.$wrapper.find("[data-add]").on("click", (e) => {
				this.app.call(XAPI + "add_metric_source", {
					metric_code: this.s.metric, question: $(e.currentTarget).data("add"),
				}).then(() => { d.hide(); this.app.toast(__("Source added")); this.render(); });
			});
		});
		d.fields_dict.q.$input && d.fields_dict.q.$input.on("input", frappe.utils.debounce(search, 250));
		d.show();
		search();
	}

	_searchLibrary(q) {
		this.app.call(XAPI + "search_questions", { query: q, limit: 40 }).then((rows) => {
			const U = window.UCCMO;
			this.$el.find("[data-lib]").html((rows || []).map((r) => `
				<div class="source-row" style="margin-bottom:6px">
					<span class="type-icon">${U.icon(window.UCCMOIcons.forQuestionType(r.question_type), "sm")}</span>
					<div><b>${U.esc((r.question_text || "").slice(0, 70))}</b>
						<div class="eyebrow">${U.esc(r.survey || "")} ${
							U.esc(r.version_number ? "v" + r.version_number : "")}</div></div>
					<span></span><span></span>
				</div>`).join("") || U.empty(__("No questions found.")));
		});
	}

	_preview() {
		this.app.call(XAPI + "preview_metric", { metric_code: this.s.metric }).then((p) => {
			if (!p) return;
			frappe.msgprint({
				title: __("Preview — nothing was saved"),
				message: `<div style="font-size:13px">
					<b style="font-size:22px">${p.value === null ? "—" : Number(p.value).toFixed(1)}</b><br>
					${__("{0} answers read, {1} scoreable, {2} unscoreable", [
						p.response_count, p.scored_count, p.unscoreable])}<br>
					${p.source_versions ? __("From: {0}", [frappe.utils.escape_html(p.source_versions)]) : ""}
					${p.unscoreable ? `<div style="color:#9d5c00;margin-top:8px">${
						__("Unscoreable answers are dropped, not counted as zero. A high number usually means the normalisation rule does not match the question type.")}</div>` : ""}
				</div>`,
			});
		});
	}
}

// ============================================================== INDICES ===
class IndexWorkspace {
	constructor(app, $el) { this.app = app; this.$el = $el; }
	get s() { return this.app.state; }

	render() {
		this.$el.html('<div class="pane" style="height:100%"><div class="pane-body">' + __("Loading…") + "</div></div>");
		frappe.call({
			method: "frappe.client.get_list",
			args: { doctype: "UCC Index Version", fields: ["name", "index", "version_number", "status"],
					order_by: "modified desc", limit_page_length: 50 },
			callback: (r) => {
				this.versions = r.message || [];
				if (!this.s.indexVersion && this.versions.length) this.s.indexVersion = this.versions[0].name;
				if (!this.s.indexVersion) return this.$el.html(window.UCCMO.empty(__("No index versions yet.")));
				this._load();
			},
		});
	}

	_load() {
		Promise.all([
			this.app.call(IAPI + "get_index_builder", { index_version: this.s.indexVersion }),
			this.app.call(IAPI + "node_sources", { index_version: this.s.indexVersion }),
			this.app.call(IAPI + "list_results", { index_version: this.s.indexVersion }),
		]).then(([b, src, results]) => {
			if (!b) return;
			this.builder = b;
			this.nodes = b.nodes || [];
			this.editable = !!b.editable;
			this.sources = (src || {}).sources || {};
			this.results = results || [];
			this.app.counts = Object.assign(this.app.counts || {}, { indices: this.versions.length });
			this._draw();
		});
	}

	_draw() {
		const U = window.UCCMO;
		const tab = this.app.tab("formula");
		const published = !this.editable;
		this.$el.html(`
			${U.contextBar({
				eyebrow: __("Indices workspace"),
				picker: true,
				status: published ? __("Published") : __("Draft"),
				statusTone: published ? "ok" : "warn",
				statusIcon: published ? "i-lock" : null,
				actions: [
					{ label: __("Validate"), icon: "i-check", act: "validate" },
					published
						? { label: __("Calculate"), tone: "primary", icon: "i-chart", act: "calculate" }
						: { label: __("Publish version"), tone: "primary", icon: "i-lock", act: "publish" },
				],
			})}
			${U.tabs([{ key: "formula", label: __("Formula") }, { key: "calculate", label: __("Calculate") },
					  { key: "results", label: __("Results") }], tab)}
			${U.statusStrip([
				{ value: this.nodes.length, label: __("nodes") },
				{ value: this.nodes.filter((n) => n.node_type === "Metric").length, label: __("metrics") },
				{ value: this.results.length, label: __("results") },
			], published ? null : {
				text: __("Draft. Publish this version before results can be calculated — a result must tie to a frozen formula."),
				tone: "warn", icon: "i-warning",
			})}
			<div class="workarea"><div class="index-layout">
				<section class="pane"><header class="pane-head">
					<div class="pane-title-with-icon">${U.icon("i-index", "sm")}<span>${
						tab === "formula" ? __("Formula") : tab === "calculate" ? __("Calculate") : __("Results")}</span></div>
				</header><div class="pane-body">${
					tab === "formula" ? this._formula() :
					tab === "calculate" ? this._calculate() : this._results()}</div></section>
				<div data-node-editor></div>
			</div></div>`);
		this._mountPicker();
		this._wire();
		this._renderEditor();
	}

	// Bug 2, the same fix as the Survey workspace: static "index name / version"
	// text with no way to switch either. UCC Index Version has no raw Desk form
	// route anywhere in this app - the workspace itself is the editor - and
	// creating a new index from a template is a separate flow (template picker
	// dialog) not built here, so onEdit/onCreate are both omitted rather than
	// wired to something that does not exist yet; version_picker.js documents
	// omitting either as how you hide that affordance.
	_mountPicker() {
		window.UCCMO.mountPicker(this, this.$el, {
			statusColor: VERSION_STATUS_COLOR,
			placeholder: __("Pick an index version…"),
			onSelect: (name) => { this.s.indexVersion = name; this._load(); },
		}, this.versions.map((v) => ({
			name: v.name, label: v.index + " — v" + v.version_number, status: v.status,
		})), this.s.indexVersion);
	}

	_formula() {
		const U = window.UCCMO;
		const byParent = {};
		this.nodes.forEach((n) => (byParent[n.parent_key || ""] ||= []).push(n));
		const draw = (key, depth) => (byParent[key] || []).map((n) => `
			<div class="tree-row" style="padding-left:${depth * 18}px">
				${U.node({
					key: n.node_key, title: n.label || n.node_key,
					kicker: n.node_type, meta: n.source_metric || "",
					kind: n.node_type === "Metric" ? "metric" : n.node_type === "Index" ? "index" : "",
					selected: this.sel === n.node_key,
					style: "width:auto",
				})}
				<span class="eyebrow">${n.weight ? n.weight + "%" : ""}</span>
			</div>${draw(n.node_key, depth + 1)}`).join("");
		return `<div class="tree formula-surface">${draw("", 0) || U.empty(__("This version has no nodes yet."))}</div>`;
	}

	_calculate() {
		const U = window.UCCMO;
		if (!this.editable) {
			return `<div style="padding:12px">
				<div class="help">${__("Calculates one immutable UCC Index Result from this frozen formula, using the latest metric result for each node.")}</div>
				<div style="margin-top:10px;display:flex;gap:8px">
					${U.button({ label: __("Calculate now"), tone: "primary", icon: "i-chart", act: "calculate" })}
				</div></div>`;
		}
		return `<div style="padding:12px">${U.empty(
			__("Draft versions cannot be calculated. Publish this version first."))}</div>`;
	}

	_results() {
		const U = window.UCCMO;
		if (!this.results.length) {
			return `<div style="padding:12px">${U.empty(__("No results yet."))}</div>`;
		}
		return `<div style="padding:12px"><table class="source-table" style="width:100%">
			${this.results.map((r) => `<div class="source-row" style="margin-bottom:6px;cursor:pointer"
				data-result="${U.esc(r.name)}">
				<span class="type-icon">${U.icon("i-chart", "sm")}</span>
				<div><b>${r.value === null ? "—" : Number(r.value).toFixed(1)}</b>
					<div class="eyebrow">${U.esc(r.period || "—")} · ${U.esc(r.entity || "—")} · ${
						U.esc(r.owner || "")} · ${frappe.datetime.str_to_user(r.calculation_date || r.creation)}</div></div>
				<span></span><span>→</span></div>`).join("")}
		</table><div data-breakdown></div></div>`;
	}

	_renderEditor() {
		const U = window.UCCMO;
		const n = this.nodes.find((x) => x.node_key === this.sel);
		const $slot = this.$el.find("[data-node-editor]");
		if (!n) {
			return $slot.html(U.inspector({
				title: __("Node"), icon: "i-index",
				body: U.empty(__("Select a node in the formula to edit it.")),
			}));
		}
		const isMetric = n.node_type === "Metric";
		const t = isMetric && this.sources[n.source_metric];
		$slot.html(U.inspector({
			title: n.label || n.node_key, icon: isMetric ? "i-metric" : "i-index",
			body: U.field({ label: __("Label"), name: "label", value: n.label, locked: !this.editable })
				+ U.field({ label: __("Weight (%)"), name: "weight", type: "number", value: n.weight,
							locked: !this.editable })
				+ (isMetric
					? U.field({ label: __("Source metric"), name: "source_metric", value: n.source_metric, locked: true })
					+ (t && t.questions.length
						? `<div class="section-label">${__("Fed by {0} question(s)", [t.questions.length])}</div>
							${this._byVersion(t)}`
						: `<div class="published-lock-row"><b>${__("Nothing feeds this node")}</b><br>${
							__("This metric has no survey questions as sources, so it will score nothing.")}</div>`)
					+ U.button({ label: __("Open in Metrics workspace"), small: true, icon: "i-metric", act: "goto-metric" })
					: "")
				+ `<div class="help">${__("Objectives are never part of the formula. They travel with the result as evidence lineage.")}</div>`,
			footer: this.editable
				? U.footerActions([{ label: __("Apply"), tone: "primary", icon: "i-save", act: "apply-node" }])
				: "",
		}));
	}

	_byVersion(t) {
		const U = window.UCCMO;
		const by = {};
		t.questions.forEach((q) => (by[q.survey_version || __("(unknown)")] ||= []).push(q));
		return Object.keys(by).sort().map((v) => `
			<div class="eyebrow" style="margin-top:6px"><b>${U.esc(v)}</b></div>
			${by[v].map((q) => `<div class="help">${U.esc((q.text || "").slice(0, 60))}</div>`).join("")}`).join("");
	}

	_wire() {
		const $el = this.$el;
		$el.off("click.mo");
		$el.on("click.mo", "[data-node]", (e) => {
			this.sel = $(e.currentTarget).data("node");
			this._draw();
		});
		$el.on("click.mo", '[data-act="validate"]', () =>
			this.app.call(IAPI + "validate_index", { index_version: this.s.indexVersion }).then((r) => {
				if (!r) return;
				frappe.msgprint({
					title: r.valid ? __("Valid") : __("Not valid"),
					indicator: r.valid ? "green" : "red",
					message: (r.issues || []).concat(r.warnings || []).join("<br>") || __("Weights valid."),
				});
			}));
		$el.on("click.mo", '[data-act="publish"]', () =>
			frappe.confirm(__("Publish this index version? It becomes immutable."), () =>
				this.app.call(IAPI + "publish_version", { index_version: this.s.indexVersion })
					.then(() => { this.app.toast(__("Published")); this._load(); })));
		$el.on("click.mo", '[data-act="calculate"]', () =>
			frappe.confirm(__("Calculate a result now? It writes an immutable UCC Index Result."), () =>
				this.app.call(IAPI + "calculate", { index_version: this.s.indexVersion }).then((r) => {
					if (!r) return;
					this.app.toast(__("Result {0} calculated", [r.result]));
					this.app.state.indicesTab = "results";
					this._load();
				})));
		$el.on("click.mo", "[data-result]", (e) => this._breakdown($(e.currentTarget).data("result")));
		$el.on("click.mo", '[data-act="goto-metric"]', () => {
			const n = this.nodes.find((x) => x.node_key === this.sel);
			this.app.ws = "metrics";
			this.app.state.metric = n && n.source_metric;
			this.app.render();
		});
		$el.on("click.mo", '[data-act="apply-node"]', () => {
			const n = this.nodes.find((x) => x.node_key === this.sel);
			if (!n) return;
			n.label = $el.find('[data-f="label"]').val();
			n.weight = parseFloat($el.find('[data-f="weight"]').val()) || 0;
			this.app.call(IAPI + "save_nodes", {
				index_version: this.s.indexVersion, nodes: JSON.stringify(this.nodes),
			}).then(() => { this.app.toast(__("Node updated")); this._load(); });
		});
	}

	_breakdown(name) {
		this.app.call(IAPI + "get_result_breakdown", { index_result: name }).then((d) => {
			if (!d) return;
			const U = window.UCCMO;
			const num = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1));
			this.$el.find("[data-breakdown]").html(`
				<div class="section-label" style="margin-top:12px">${__("Breakdown")} — ${U.esc(name)}</div>
				${d.breakdown.map((b) => `<div class="source-row" style="margin-bottom:6px">
					<span class="type-icon metric">${U.icon("i-metric", "sm")}</span>
					<div><b>${U.esc(b.component_label || b.component_key)}</b>
						<div class="eyebrow">${U.esc(b.source_metric || "—")} · ${__("score")} ${
							num(b.normalised_value)} · ${__("weight")} ${b.weight || 0}%</div></div>
					<span></span><span><b>${num(b.contribution)}</b></span></div>`).join("")}
				<div class="help">${__("This is the snapshot taken when the result was calculated. Editing a mapping today does not change it.")}</div>`);
		});
	}
}

// ========================================================== CRITERION 7 ===
// Frozen snapshots only. Nothing here reads a live mapping or live wording.
class Criterion7Workspace {
	constructor(app, $el) { this.app = app; this.$el = $el; }
	get s() { return this.app.state; }

	render() {
		this.$el.html('<div class="pane" style="height:100%"><div class="pane-body">' + __("Loading…") + "</div></div>");
		Promise.all([
			this.app.call(DAPI + "get_dashboard_data", {}),
			this.app.call(LAPI + "list_results", { limit: 50 }),
		]).then(([d, results]) => {
			this.data = d || {};
			this.results = results || [];
			if (!this.s.result && this.results.length) this.s.result = this.results[0].name;
			this._draw();
		});
	}

	_draw() {
		const U = window.UCCMO;
		const tab = this.app.tab("overview");
		const k = this.data.kpis || {};
		this.$el.html(`
			${U.contextBar({
				eyebrow: __("Criterion 7 workspace"),
				title: __("Outcome evidence"),
				status: __("Frozen snapshots"),
				statusTone: "ok", statusIcon: "i-lock",
				actions: [{ label: __("Export"), icon: "i-save", act: "export" }],
			})}
			${U.tabs([{ key: "overview", label: __("Overview") },
					  { key: "narrative", label: __("Evidence narrative") },
					  { key: "lineage", label: __("Lineage") }], tab)}
			${U.statusStrip([
				{ value: this.results.length, label: __("published results") },
			], { text: __("Every figure here is the snapshot taken at calculation. Editing a mapping today does not change it."),
				 tone: "", icon: "i-lock" })}
			<div class="workarea"><div class="dashboard-layout">
				${U.pane({
					cls: "", title: __("Results"), icon: "i-chart", count: this.results.length,
					body: this.results.map((r) => `
						<button class="queue-item ${r.name === this.s.result ? "selected" : ""}" data-result="${U.esc(r.name)}">
							<span class="question-copy"><b>${r.value === null ? "—" : Number(r.value).toFixed(1)}</b>
								<span class="eyebrow">${U.esc(r.index || "")} · ${U.esc(r.period || "")}</span></span>
						</button>`).join("") || U.empty(__("No published results yet.")),
				})}
				<section class="pane"><div class="pane-body" data-main style="padding:12px">
					${__("Loading…")}</div></section>
				<div data-side></div>
			</div></div>`);
		this._wire();
		this._fill(tab);
	}

	_fill(tab) {
		const U = window.UCCMO;
		if (!this.s.result) {
			return this.$el.find("[data-main]").html(U.empty(__("Calculate an index result to see evidence here.")));
		}
		this.app.call(LAPI + "get_lineage", { index_result: this.s.result }).then((d) => {
			if (!d) return;
			const h = d.header || {};
			const variance = h.target && h.value !== null ? (h.value - h.target).toFixed(1) : null;
			this.$el.find("[data-main]").html(`
				<div class="score-card">
					<div class="big-score">${h.value === null ? "—" : Number(h.value).toFixed(1)}</div>
					<div class="eyebrow">${U.esc(h.index || "")} · ${U.esc(h.period || "")}</div>
					<div>${h.target ? __("Target {0}", [h.target]) : __("No target set")}${
						variance !== null ? ` · <span class="${variance < 0 ? "warn" : "ok"}">${
							variance > 0 ? "+" : ""}${variance}</span>` : ""}</div>
					<div class="eyebrow">${__("Snapshot")} ${U.esc(h.index_version || "")} · ${
						h.calculation_date ? frappe.datetime.str_to_user(h.calculation_date) : ""}</div>
				</div>
				${!d.snapshot_complete ? `<div class="published-lock-row" style="margin-top:10px">${
					U.icon("i-warning", "xs")}<div>${
					__("This result predates the lineage snapshot fields, so its evidence trail was never recorded.")}</div></div>` : ""}
				<div class="section-label" style="margin-top:12px">${__("By objective")}</div>
				${(d.objectives || []).map((o) => `
					<div class="source-row" style="margin-bottom:6px">
						<span class="type-icon">${U.icon("i-target", "sm")}</span>
						<div><b>${U.esc(o.name || o.code)}</b>
							<div class="eyebrow">${(o.clauses || []).map(U.esc.bind(U)).join(", ")}</div>
							${(o.rows || []).map((row) => (row.questions || []).map((q) => `
								<div class="help">${U.esc(q.text)}${q.corrected
									? ` <span class="chip warning" title="${U.esc(q.corrected)}">${
										__("wording corrected")}</span>` : ""}</div>`).join("")).join("")}
						</div><span></span><span></span>
					</div>`).join("") || U.empty(__("Nothing traced to an objective."))}`);
			this.$el.find("[data-side]").html(U.inspector({
				title: __("Priority actions"), icon: "i-warning",
				body: (d.components || []).filter((c) => c.value !== null && h.target && c.value < h.target)
					.map((c) => `<div class="action-card"><b>${U.esc(c.label)}</b>
						<div class="eyebrow">${__("Score")} ${Number(c.value).toFixed(1)} · ${
							__("below target")}</div></div>`).join("")
					|| U.empty(__("Nothing below target in this snapshot.")),
			}));
		});
	}

	_wire() {
		const $el = this.$el;
		$el.off("click.mo");
		$el.on("click.mo", "[data-result]", (e) => {
			this.s.result = $(e.currentTarget).data("result");
			this._draw();
		});
		$el.on("click.mo", '[data-act="export"]', () =>
			this.app.call(DAPI + "export_dashboard", { fmt: "csv", section: "kpis" }).then((r) => {
				if (!r) return;
				const blob = new Blob([r.content], { type: "text/csv" });
				const a = document.createElement("a");
				a.href = URL.createObjectURL(blob);
				a.download = r.filename || "criterion7.csv";
				a.click();
			}));
	}
}
