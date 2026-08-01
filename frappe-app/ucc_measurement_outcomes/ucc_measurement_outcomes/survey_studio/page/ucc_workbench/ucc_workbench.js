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
	// Round-4 Item 2: a tall empty band sat between Frappe's navbar and the
	// workspace nav. It was Frappe's own .page-head - make_app_page always
	// renders one, and this page passes title:"" because the workspace nav and
	// context bar already say where you are, so it reserved its full height for
	// a heading, breadcrumb and button area that are all empty. Hidden rather
	// than margined away, and scoped to this wrapper so no other Desk page is
	// touched. UCCMO.refit() measures the mount's real top afterwards, so the
	// shell simply grows into the reclaimed space.
	$(wrapper).find(".page-head").hide();
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
const TAPI = "ucc_measurement_outcomes.api.theme.";

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
	"Likert 1-5 to 0-100", "NPS 0-10 to 0-100", "Yes/No to 100/0", "Reverse 0-100",
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

	// The topbar (brand block + global search) was removed 2026-08-01 per
	// Felix: the workspace nav and context bar already establish where you
	// are, so it was redundant chrome. data-global-search was never wired to
	// anything - no keydown handler, no shortcut binding anywhere in this
	// file - so nothing load-bearing depended on it.
	_build() {
		this.$root = window.UCCMO.mount(this.page, `
			<div class="app">
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
				{ key: "build", label: __("Build") }, { key: "theme", label: __("Theme Settings") },
				{ key: "preview", label: __("Preview") },
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
			theme: () => this._themeTab(),
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
					<span class="page-name">${U.esc(p.title)}</span>
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
						${/* The note goes FIRST and in flow. It used to be an absolute
							overlay pinned to the top of the canvas, which put it on top
							of question 1 (round-4 Item 5a). A caption above the list says
							the same thing and covers nothing. */""}
						<div class="canvas-help">${__("Only this page is shown. Use the outline to move between pages.")}</div>
						<div class="question-list">${rows}</div>
						${/* Round-3 audit Finding 2: on a short survey the canvas measured
							~66-70% empty below the last question. The pane deliberately
							fills its column (see the .pane-body note in ucc_mo.bundle.css),
							so the fix is a treatment for the remainder, not a shorter pane.
							Same dashed affordance the outline already uses for "Add page",
							and the same data-act the header button carries, so it needs no
							new handler. */""}
						${this.editable ? `<button class="add-page" data-act="add-question">${
							U.icon("i-plus", "sm")}${__("Add another question")}</button>` : ""}
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
				// "Full Width", not "Full": these are the UCC Survey Question
				// layout_width Select's literal options, and Frappe's
				// _validate_selects throws on anything not in that list. Same
				// class of bug as the round-2 "Long Text" vs "Paragraph" one.
				+ U.field({ label: __("Column width"), name: "layout_width", type: "select",
							value: q.layout_width || "Full Width",
							options: ["Full Width", "Two Thirds", "Half", "One Third"] })
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
	// Theme Settings (round-5 Item 2). Surfaces the existing UCC Survey Theme
	// rather than reimplementing it: every control, option list and default is
	// rendered from what api/theme.get_theme returns, which in turn reads the
	// pure `theme` module that the stylesheet itself is built from. No colour or
	// option literal lives in this file.
	//
	// SITE-WIDE, and it says so on screen. UCC Survey Theme is a Single DocType -
	// one theme for the whole bench, not one per survey - so "scoped to the
	// survey currently open" is not something the UI can honour today. Making it
	// per-survey is a schema change (an override on UCC Survey Version); it is
	// flagged, not faked.
	_themeTab() {
		const U = window.UCCMO;
		return `<section class="pane" style="height:100%">
			<header class="pane-head">
				<div class="pane-title-with-icon">${U.icon("i-settings", "sm")}<strong>${
					__("Theme Settings")}</strong></div>
				${U.button({ label: __("Save theme"), tone: "primary", small: true, icon: "i-save", act: "save-theme" })}
			</header>
			<div class="pane-body" data-theme><div class="canvas-help">${__("Loading theme…")}</div></div>
		</section>`;
	}

	_fillTheme() {
		const U = window.UCCMO;
		this.app.call(TAPI + "get_theme", {}).then((t) => {
			const $b = this.$el.find("[data-theme]");
			if (!$b.length) return;
			if (!t) return $b.html(U.empty(__("Could not load the theme.")));
			this.theme = t;
			const colour = (key) => U.field({
				label: __(key.replace(/_/g, " ")), name: "th-" + key, type: "color",
				value: t.colours[key] || t.colour_defaults[key] || "#ffffff",
			});
			const select = (field) => U.field({
				label: __(field.replace(/^ucc_/, "").replace(/_/g, " ")), name: "th-" + field,
				type: "select", value: t.selects[field] || "",
				options: (t.select_choices[field] || []),
			});
			$b.html(`<div style="padding:12px;max-width:760px">
				<div class="canvas-help">${__("These settings apply to EVERY survey on this site - UCC Survey Theme is a single site-wide record, not a per-survey one. Changing a colour here changes it for every published survey.")}</div>
				<div class="section-label">${__("Colours")}</div>
				<div class="theme-grid">${Object.keys(t.colour_defaults).map(colour).join("")}</div>
				<div class="section-label">${__("Type and sizing")}</div>
				<div class="theme-grid">${Object.keys(t.select_choices).map(select).join("")}</div>
				<div class="help">${t.is_default
					? __("This site is still on the default theme.")
					: __("This site has customised the theme.")}</div>
			</div>`);
		});
	}

	_saveTheme() {
		const payload = {};
		if (!this.theme) return;
		Object.keys(this.theme.colour_defaults).forEach((k) => {
			payload[k] = this.$el.find(`[data-f="th-${k}"]`).val() || "";
		});
		Object.keys(this.theme.select_choices).forEach((f) => {
			payload[f] = this.$el.find(`[data-f="th-${f}"]`).val() || "";
		});
		this.app.call(TAPI + "save_theme", { payload: JSON.stringify(payload) }).then((r) => {
			if (!r) return;
			this.app.toast(__("Theme saved. It applies to every survey on this site."));
		});
	}

	// Embedded, not just a link out (round-4 Item 3). The iframe loads the REAL
	// respondent page (/survey?preview=…), same-origin, so it is the same
	// renderer and stylesheet a respondent gets rather than a mock that can
	// drift. It stays login-gated and read-only server-side: preview_payload
	// re-checks read permission on every load, and the preview route collects
	// nothing. Same-origin also means Frappe's default X-Frame-Options
	// SAMEORIGIN permits it. The open-in-new-tab button is kept - a full-window
	// view is still the honest way to check a long survey at real width.
	_previewTab() {
		const U = window.UCCMO;
		return `<section class="pane" style="height:100%">
			<header class="pane-head">
				<div class="pane-title-with-icon">${U.icon("i-eye", "sm")}<strong>${__("Preview")}</strong></div>
				${U.button({ label: __("Open in new tab"), small: true, icon: "i-eye", act: "preview" })}
			</header>
			<div class="pane-body" data-preview style="padding:0">
				<div style="padding:12px"><div class="canvas-help">${
					__("Loading the real respondent page…")}</div></div>
			</div>
		</section>`;
	}

	_fillPreview() {
		const U = window.UCCMO;
		this.app.call(BAPI + "preview_link", { survey_version: this.s.surveyVersion }).then((r) => {
			const $b = this.$el.find("[data-preview]");
			if (!$b.length) return;
			if (!r || !r.url) {
				return $b.html(`<div style="padding:12px">${U.empty(
					__("Could not build a preview link for this version."))}</div>`);
			}
			// srcdoc/sandbox would strip the session cookie the preview needs.
			$b.html(`<iframe src="${U.esc(r.url)}" title="${__("Survey preview")}"
				style="width:100%;height:100%;border:0;display:block;background:white"></iframe>`);
		});
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
		$el.on("click.mo", '[data-act="save-theme"]', () => this._saveTheme());
		$el.on("click.mo", '[data-act="new-version"]', () => this._newVersion());
		$el.on("click.mo", '[data-act="new-survey"]', () => this._newSurvey());
		$el.on("click.mo", '[data-act="save-draft"]', () => this._apply());
		$el.on("click.mo", '[data-act="export-csv"]', () => this._export());
		$el.on("click.mo", ".switch:not([disabled])", (e) =>
			$(e.currentTarget).toggleClass("on"));
		const tab = this.app.tab("build");
		if (tab === "build") this._wireWidthGrips();
		if (tab === "share") this._fillShare();
		if (tab === "responses") this._fillResponses();
		if (tab === "preview") this._fillPreview();
		if (tab === "theme") this._fillTheme();
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
	// Drag-to-resize, ported back from the old Survey Builder (round-4 Item 7),
	// which is where this logic was built and verified. Same four spans, same
	// snapping rule, same one-save-on-release: free pixel widths would break
	// both the mobile collapse and the "presentation only" property that lets
	// width be edited on a published version (layout_width is the whole of
	// versioning.PRESENTATION_FIELDS).
	_wireWidthGrips() {
		const SPANS = [[12, "Full Width"], [8, "Two Thirds"], [6, "Half"], [4, "One Third"]];
		const SPAN_OF = { "Full Width": 12, "Two Thirds": 8, "Half": 6, "One Third": 4 };
		const CLS = window.UCCMO.WIDTH_CLASS;
		this.$el.find(".width-grip").off("mousedown.mo").on("mousedown.mo", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();          // never let this start a row selection
			const name = $(e.currentTarget).data("grip");
			const q = this.questions.find((x) => x.name === name);
			if (!q) return;
			const $grip = $(e.currentTarget).addClass("dragging");
			const $card = $grip.closest(".question-row");
			const $list = this.$el.find(".question-list");
			const startX = e.clientX;
			const colWidth = ($list.width() || 1) / 12;
			const startSpan = SPAN_OF[q.layout_width] || 12;
			let width = q.layout_width || "Full Width";
			const move = (ev) => {
				const wanted = startSpan + (ev.clientX - startX) / colWidth;
				const [, label] = SPANS.reduce((best, s) =>
					Math.abs(s[0] - wanted) < Math.abs(best[0] - wanted) ? s : best);
				if (label === width) return;
				width = label;
				$card.removeClass("qw-8 qw-6 qw-4").addClass(CLS[label] || "");
			};
			const up = () => {
				document.removeEventListener("mousemove", move);
				document.removeEventListener("mouseup", up);
				$grip.removeClass("dragging");
				if (width === (q.layout_width || "Full Width")) return;
				q.layout_width = width;   // keep local state honest before the reload
				this.app.call(BAPI + "update_question", {
					question: name, payload: JSON.stringify({ layout_width: width }),
				}).then((ok) => { if (ok) this.app.toast(__("Width: {0}", [__(width)])); });
			};
			document.addEventListener("mousemove", move);
			document.addEventListener("mouseup", up);
		});
	}

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
							: U.empty(this.rows.length
							// Round-5 Item 6: this used to claim "every question has an
							// objective" whenever the queue was empty - including when the
							// version had NO questions at all, which is indistinguishable
							// from a failed load and is what makes the workspace read as
							// broken. Say which of the two it actually is.
							? (showAll ? __("This version has no questions to map.")
									   : __("Nothing needs attention. Every question has an objective."))
							: __("This survey version has no questions yet. Add questions in the Surveys workspace first.")),
					})}
					<section class="pane mapping-pane">
						<header class="pane-head">
							<div class="pane-title-with-icon">${U.icon("i-target", "sm")}<strong>${__("Mapping")}</strong></div>
							<div class="mx-tools">${window.UCCZoom.controls()}
								${U.button({ label: __("Browse all {0}", [(this.coverage.counts || {}).objectives || 0]),
											 small: true, act: "browse-all" })}</div>
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
			requestAnimationFrame(() => {
				this._zoom = window.UCCZoom.attach(
					this.$el.find(".mapping-stage").get(0),
					this.$el.find(".mapping-stage-inner").get(0),
					() => this._drawLines());
				this._drawLines();
				if (this._fitted !== this.s.question) {
					this._fitted = this.s.question;
					this._zoom.fit();
				}
			});
		}
		if (tab === "governance") this._fillHistory();
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
		// POST-transform pixels in, unscaled stage coordinates out - see the
		// contract in mo_zoom.js. The SVG lives inside the same transformed
		// stage, so it draws in unscaled space and the lines stay on the nodes.
		const k = (this._zoom && this._zoom.scale) || 1;
		const box = $stage.get(0).getBoundingClientRect();
		const $q = this.$el.find('[data-map-node="question"]');
		if (!$q.length) return;
		const qr = $q.get(0).getBoundingClientRect();
		const x1 = (qr.right - box.left) / k, y1 = (qr.top + qr.height / 2 - box.top) / k;
		let paths = "";
		this.$el.find('.map-node.objective').each((_, el) => {
			const r = el.getBoundingClientRect();
			const x2 = (r.left - box.left) / k, y2 = (r.top + r.height / 2 - box.top) / k;
			const c = Math.max(40, (x2 - x1) / 2);
			const linked = el.classList.contains("linked");
			paths += `<path class="map-line ${linked ? "linked" : ""}" d="M ${x1} ${y1} C ${
				x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}"></path>`;
		});
		svg.innerHTML = paths;
	}

	// Round-7 Item 2: both tabs used to be passive read-outs with nothing to
	// click, which is why they read as "dunno how to use". Each now opens with a
	// caption saying what it is FOR, and every number and chip is a way back into
	// the Map tab rather than a dead label.
	_otherTab(tab) {
		const U = window.UCCMO;
		const c = this.coverage.counts || {};
		if (tab === "coverage") {
			const idle = this.coverage.unmapped_objectives || [];
			const unmapped = this.unmapped.size;
			return `<div class="pane" style="height:100%"><div class="pane-body" style="padding:12px">
				<div class="canvas-help">${__("Which objectives this survey reaches, and which it misses. Mapping is evidence lineage - it changes no index score. Click any figure or objective below to work on it in the Map tab.")}</div>
				<div class="status-strip" style="border:0;padding:0;margin-bottom:12px">
					<button class="stat status-link" data-act="go-unmapped" title="${
						__("Show the questions that still need an objective")}">
						<b>${c.questions_mapped || 0}/${c.questions || 0}</b> <span>${__("questions mapped")}</span></button>
					<span class="stat-divider"></span>
					<span class="stat"><b>${c.objectives_used || 0}/${c.objectives || 0}</b>
						<span>${__("objectives reached")}</span></span>
				</div>
				${unmapped ? `<div class="published-lock-row">${U.icon("i-warning", "xs")}<div>
					<b>${__("{0} question(s) still have no objective", [unmapped])}</b><br>${
					__("Those questions still score normally; they just carry no governance lineage into Criterion 7.")}
					</div></div>` : ""}
				<div class="section-label">${__("Objectives this survey does not reach")} (${idle.length})</div>
				${idle.length ? `<div>${idle.slice(0, 40).map((o) =>
					`<button class="chip chip-link" data-objective="${U.esc(o)}" title="${
						__("Open the Map tab and look for a question to link to {0}", [o])}">${
						U.icon("i-target", "xs")}${U.esc(o)}</button>`).join(" ")}${
					idle.length > 40 ? `<span class="eyebrow"> +${idle.length - 40} ${__("more")}</span>` : ""}</div>`
					: `<div class="help">${__("Every objective in the register is reached by at least one question in this survey.")}</div>`}
			</div></div>`;
		}
		return `<div class="pane" style="height:100%"><div class="pane-body" style="padding:12px">
			<div class="canvas-help">${__("Who changed a mapping and when, plus data-quality warnings worth resolving before this survey is published.")}</div>
			<div class="section-label">${__("Recent mapping changes")}</div>
			<div data-history>${U.empty(__("Loading history…"))}</div>
			<div class="section-label" style="margin-top:12px">${__("Duplicate question text")}</div>
			${(this.coverage.duplicate_questions || []).length
				? `<div>${(this.coverage.duplicate_questions || []).map((g) =>
					`<button class="chip warn chip-link" data-dupe="${U.esc(g[0])}" title="${
						__("Open the first of these questions in the Map tab")}">${U.esc(g.join(" / "))}</button>`).join(" ")}</div>
				   <div class="help">${__("Identical wording in two questions makes an objective mapping ambiguous to read later. Rename one, or map both deliberately.")}</div>`
				: `<div class="help">${__("No two questions in this version share the same wording.")}</div>`}
		</div></div>`;
	}

	_fillHistory() {
		const U = window.UCCMO;
		this.app.call(MAPI + "mapping_history", { survey_version: this.s.surveyVersion, limit: 25 })
			.then((rows) => {
				const $h = this.$el.find("[data-history]");
				if (!$h.length) return;
				if (!rows || !rows.length) {
					return $h.html(U.empty(__("No mapping changes recorded yet for this survey version.")));
				}
				$h.html(rows.map((r) => `<div class="source-row" style="margin-bottom:6px">
					<span class="type-icon">${U.icon(r.created ? "i-plus" : "i-history", "sm")}</span>
					<div><b>${U.esc(r.mapping)}</b><div class="eyebrow">${
						r.created ? __("created") : __("changed {0}", [r.fields.join(", ") || __("a field")])} · ${
						U.esc(r.user)} · ${r.on ? frappe.datetime.str_to_user(r.on) : ""}</div></div>
					<span></span><span></span></div>`).join(""));
			});
	}

	_renderNodeEditor() {
		const U = window.UCCMO;
		const $slot = this.$el.find("[data-node-editor]");
		const q = this.question;
		if (!this.sel || this.sel === "question") {
			$slot.html(U.inspector({
				// Round-8 Item 1: the same chevron affordance the Survey inspector
				// uses, from the same pane()/inspector() collapse component.
				collapse: { act: "collapse-right", side: "right", collapsed: !!this.rightCollapsed,
							label: __("Collapse details"), shortLabel: __("Details") },
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
			collapse: { act: "collapse-right", side: "right", collapsed: !!this.rightCollapsed,
						label: __("Collapse details"), shortLabel: __("Details") },
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
		$el.on("click.mo", '[data-act="zoom-fit"]', () => this._zoom && this._zoom.fit());
		$el.on("click.mo", '[data-act="zoom-in"]', () => this._zoom && this._zoom.zoomIn());
		$el.on("click.mo", '[data-act="zoom-out"]', () => this._zoom && this._zoom.zoomOut());
		$el.on("click.mo", '[data-act="zoom-reset"]', () => this._zoom && this._zoom.reset());
		$el.on("click.mo", '[data-act="collapse-right"]', () => {
			this.rightCollapsed = !this.rightCollapsed;
			this.$el.find(".objective-shell").toggleClass("right-collapsed", !!this.rightCollapsed);
			this._renderNodeEditor();
		});
		// Coverage/Governance chips are the way back into the Map tab.
		$el.on("click.mo", '[data-act="go-unmapped"]', () => {
			this.queueShowAll = false;
			this.app.state.objectivesTab = "map";
			this._draw();
		});
		$el.on("click.mo", "[data-objective], [data-dupe]", (e) => {
			const dupe = $(e.currentTarget).data("dupe");
			if (dupe) this.s.question = dupe;
			this.app.state.objectivesTab = "map";
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
// =============================================================== METRICS ===
// A node builder, not three unrelated panels.
//
// The one thing this workspace exists to make obvious is the real calculation
// chain: Source Question -> Metric -> Index. Everything else is subordinate to
// that. Three settled decisions from the 2026-08-01 brief are load-bearing here
// and are why some prototype affordances are deliberately absent:
//
//   1. No "missing response handling" / "minimum sample size" controls.
//      UCC Metric Definition has no such fields and aggregate_metric has no
//      concept of either, so a control would be a setting that does nothing.
//   2. weight_within_metric is NOT shown at all. It is stored and read by
//      nothing (api/metrics.py says so in its own docstring); aggregate_metric
//      takes a plain mean over scoreable answers. A visible weight would be a
//      fake operational control, which is the exact confusion this redesign
//      was asked to remove.
//   3. Operational Field sources are hidden. metric_calc skips them and their
//      external DocTypes are unconfirmed, so they are not drawn as nodes in a
//      canvas whose whole claim is "this is what actually feeds the score".
//
// Objectives are never nodes here: they are governance and lineage annotation,
// not part of the scoring chain (docs/09-decision-log.md).
class MetricWorkspace {
	constructor(app, $el) {
		this.app = app;
		this.$el = $el;
		this.sel = { type: "metric" };
		this.itab = "details";
		this.picked = new Set();
	}
	get s() { return this.app.state; }

	render() {
		this.$el.html('<div class="pane" style="height:100%"><div class="pane-body">' + __("Loading…") + "</div></div>");
		this.app.call(XAPI + "list_metrics").then((metrics) => {
			this.metrics = metrics || [];
			if (!this.s.metric && this.metrics.length) this.s.metric = this.metrics[0].name;
			this.app.counts = Object.assign(this.app.counts || {}, { metrics: this.metrics.length });
			if (!this.s.metric) return this._drawEmpty();
			this._load();
		});
	}

	_load() {
		this.app.call(XAPI + "get_metric", { metric_code: this.s.metric }).then((m) => {
			if (!m) return this._drawEmpty();
			this.m = m;
			// Decision 3: the canvas shows only what actually feeds the score.
			this.sources = (m.sources || []).filter((s) => s.kind === "question");
			this.indices = m.used_by || [];
			this._draw();
		});
	}

	_drawEmpty() {
		const U = window.UCCMO;
		this.$el.html(`${U.contextBar({
			eyebrow: __("Metrics workspace"), title: __("No metrics yet"),
			actions: [{ label: __("New metric"), tone: "primary", icon: "i-plus", act: "new-metric" }],
		})}<div class="workarea">${U.empty(
			__("Create a metric, then connect the survey questions that feed it."),
			{ label: __("New metric"), tone: "primary", act: "new-metric" })}</div>`);
		this.$el.off("click.mo").on("click.mo", '[data-act="new-metric"]', () => this._newMetric());
	}

	_draw() {
		const U = window.UCCMO;
		const m = this.m;
		const tab = this.app.tab("build");
		const warn = this.sources.filter((s) => !s.answers).length;
		this.$el.html(`
			${U.contextBar({
				eyebrow: __("Metrics workspace"),
				title: m.metric_name || m.name,
				version: m.name,
				status: __("{0} sources", [this.sources.length]),
				statusTone: this.sources.length ? "ok" : "warn",
				actions: [
					// Round-9 Item 4: this was a plain secondary button sitting next
					// to a primary one, so the eye went to Preview and nobody found
					// how to create a metric. Creating is the rarer but far more
					// important action when you cannot proceed without it.
					{ label: __("New metric"), tone: "primary", icon: "i-plus", act: "new-metric" },
					{ label: __("Preview calculation"), icon: "i-chart", act: "preview" },
				],
			})}
			${U.tabs([{ key: "build", label: __("Build") },
					  { key: "library", label: __("Source library") },
					  { key: "validation", label: __("Validation") }], tab)}
			${U.statusStrip([
				{ value: this.sources.length, label: __("source questions") },
				{ value: m.survey_count, label: __("survey versions") },
				{ value: this.indices.length, label: __("index nodes"), ws: "indices", wsLabel: __("Indices") },
			], warn
				? { text: __("{0} source has no submitted answers, so it contributes nothing yet.", [warn]),
					tone: "warn", icon: "i-warning" }
				: { text: __("Question → Metric → Index. Normalisation runs once, here at the metric layer."),
					tone: "", icon: "i-check" })}
			<div class="workarea ucc-mo-metrics" data-body></div>`);
		this.$el.find("[data-body]").html(
			tab === "build" ? this._build() : tab === "library" ? this._library() : this._validation());
		this._wire();
		if (tab === "build") {
			this._renderInspector();
			requestAnimationFrame(() => {
				this._zoom = window.UCCZoom.attach(
					this.$el.find("[data-stage]").get(0),
					this.$el.find(".mx-stage-inner").get(0),
					() => this._drawEdges());
				this._drawEdges();
				// Auto-fit ONCE per metric, so arriving at a wide model shows all
				// of it, without stealing a zoom the user has since chosen.
				if (this._fitted !== this.s.metric) {
					this._fitted = this.s.metric;
					this._zoom.fit();
				}
			});
		}
		if (tab === "library") { this._loadCategories("library"); this._renderPicked(); }
	}

	// ------------------------------------------------------------- build ---
	_build() {
		const U = window.UCCMO;
		return `<div class="mx-build">
			${this._metricList()}
			<section class="pane mx-canvas">
				<header class="pane-head">
					<div class="pane-title-with-icon">${U.icon("i-metric", "sm")}<strong>${
						__("Metric model")}</strong><span class="count">${__("cross-survey lineage")}</span></div>
					<div class="mx-tools">
						<span class="mx-legend"><i class="q"></i>${__("Question")}</span>
						<span class="mx-legend"><i class="m"></i>${__("Metric")}</span>
						<span class="mx-legend"><i class="x"></i>${__("Index")}</span>
						${window.UCCZoom.controls()}
						${U.button({ label: __("Fit"), small: true, act: "fit" })}
						${U.button({ label: __("Add source"), small: true, tone: "primary", icon: "i-plus", act: "add-source" })}
					</div>
				</header>
				<div class="pane-body mx-stage" data-stage>
					<div class="mx-stage-inner">
						<svg class="mx-edges" data-edges></svg>
						<div data-edge-labels></div>
						<div class="mx-col">
							<div class="mx-col-title"><span>${__("Source questions")}</span><span>${this.sources.length}</span></div>
							${this.sources.map((s) => this._sourceNode(s)).join("")
								|| `<div class="mx-none">${__("No sources yet.")}</div>`}
							<button class="add-page" data-act="add-source">${
								U.icon("i-plus", "sm")}${__("Add source question")}</button>
						</div>
						<div class="mx-col mx-col-mid">
							<div class="mx-col-title"><span>${__("Metric")}</span><span>${__("normalises once")}</span></div>
							${this._metricNode()}
						</div>
						<div class="mx-col">
							<div class="mx-col-title"><span>${__("Consumed by index")}</span><span>${this.indices.length}</span></div>
							${this.indices.map((i) => this._indexNode(i)).join("")
								|| `<div class="mx-none">${__("No index uses this metric yet.")}</div>`}
						</div>
					</div>
				</div>
			</section>
			<div data-inspector></div>
		</div>`;
	}

	_metricList() {
		const U = window.UCCMO;
		return U.pane({
			cls: "mx-list", title: __("Metrics"), icon: "i-metric", count: this.metrics.length,
			body: this.metrics.map((x) => `
				<button class="mx-item ${x.name === this.s.metric ? "selected" : ""}" data-metric="${U.esc(x.name)}">
					<span class="type-icon metric">${U.icon("i-metric", "sm")}</span>
					<span class="question-copy"><b>${U.esc(x.metric_name || x.name)}</b>
						<span class="eyebrow">${U.esc(x.name)}</span>
						<span class="mx-item-meta">
							${U.chip(__("{0} sources", [x.sources]), x.sourceless ? "warn" : "ok")}
							${U.chip(__("{0} index", [x.used_by]), x.used_by ? "" : "warn")}
						</span></span>
				</button>`).join("") || U.empty(__("No metrics defined yet.")),
		});
	}

	_sourceNode(s) {
		const U = window.UCCMO;
		const on = this.sel.type === "source" && this.sel.id === s.question;
		return `<button class="mx-node source ${on ? "selected" : ""}" data-node="source" data-id="${U.esc(s.question)}">
			<span class="mx-port out"></span>
			<div class="mx-node-top">
				<div><div class="mx-kind">${__("Question")}</div>
					<div class="mx-title">${U.esc((s.text || "").slice(0, 72))}</div></div>
				<span class="type-icon">${U.icon(window.UCCMOIcons.forQuestionType(s.question_type), "sm")}</span>
			</div>
			<div class="mx-sub">${U.esc(s.survey || "")} ${U.esc(s.version_number ? "v" + s.version_number : "")} · ${
				U.esc(s.question_type || "")}</div>
			<div class="mx-pills">${U.chip(__("{0} answers", [s.answers]), s.answers ? "ok" : "warn")}
				${U.chip(U.esc(s.normalisation || this.m.default_normalisation || ""), "")}</div>
		</button>`;
	}

	_metricNode() {
		const U = window.UCCMO;
		const on = this.sel.type === "metric";
		return `<button class="mx-node metric ${on ? "selected" : ""}" data-node="metric" data-id="${U.esc(this.m.name)}">
			<span class="mx-port in"></span><span class="mx-port out"></span>
			<div class="mx-node-top">
				<div><div class="mx-kind">${__("Metric")}</div>
					<div class="mx-title">${U.esc(this.m.metric_name || this.m.name)}</div></div>
				<span class="type-icon metric">${U.icon("i-metric", "sm")}</span>
			</div>
			<div class="mx-sub">${U.esc(this.m.name)}</div>
			<div class="mx-pills">${U.chip(U.esc(this.m.default_normalisation || __("No normalisation")), "primary")}
				${U.chip(__("Average eligible answers equally"), "")}</div>
		</button>`;
	}

	_indexNode(i) {
		const U = window.UCCMO;
		const on = this.sel.type === "index" && this.sel.id === i.parent;
		return `<button class="mx-node index ${on ? "selected" : ""}" data-node="index" data-id="${U.esc(i.parent)}">
			<span class="mx-port in"></span>
			<div class="mx-node-top">
				<div><div class="mx-kind">${__("Index")}</div>
					<div class="mx-title">${U.esc(i.label || i.parent)}</div></div>
				<span class="type-icon index">${U.icon("i-index", "sm")}</span>
			</div>
			<div class="mx-sub">${U.esc(i.parent)}</div>
			<div class="mx-pills">${U.chip(__("Weight {0}%", [i.weight || 0]), "")}</div>
		</button>`;
	}

	// Vanilla SVG Beziers, measured against the stage the nodes actually sit in -
	// the same approach node_canvas.js uses, and the same trap round-7 hit in
	// Objectives: every coordinate is relative to ONE box, and the columns must
	// really be separated or the curves collapse to a stub.
	_drawEdges() {
		const $inner = this.$el.find(".mx-stage-inner");
		const svg = this.$el.find("[data-edges]").get(0);
		const $labels = this.$el.find("[data-edge-labels]");
		const $metric = this.$el.find('.mx-node.metric');
		if (!svg || !$inner.length || !$metric.length) return;
		// getBoundingClientRect reports POST-transform pixels, so every delta is
		// divided by the zoom scale to get back into the stage's own unscaled
		// coordinate space - which is the space the SVG (inside the same
		// transformed stage) actually draws in. Without this the connectors
		// drift off the nodes the moment anyone zooms.
		const k = (this._zoom && this._zoom.scale) || 1;
		const box = $inner.get(0).getBoundingClientRect();
		svg.setAttribute("viewBox", `0 0 ${box.width / k} ${box.height / k}`);
		const mr = $metric.get(0).getBoundingClientRect();
		const mLeft = { x: (mr.left - box.left) / k, y: (mr.top + mr.height / 2 - box.top) / k };
		const mRight = { x: (mr.right - box.left) / k, y: (mr.top + mr.height / 2 - box.top) / k };
		let paths = "", labels = "";
		const curve = (a, b, cls) => {
			const c = Math.max(40, (b.x - a.x) / 2);
			paths += `<path class="mx-edge ${cls}" d="M ${a.x} ${a.y} C ${a.x + c} ${a.y}, ${
				b.x - c} ${b.y}, ${b.x} ${b.y}"></path>`;
		};
		const label = (a, b, text) => {
			labels += `<span class="mx-edge-label" style="left:${(a.x + b.x) / 2}px;top:${
				(a.y + b.y) / 2}px">${window.UCCMO.esc(text)}</span>`;
		};
		this.$el.find(".mx-node.source").each((i, el) => {
			const r = el.getBoundingClientRect();
			const a = { x: (r.right - box.left) / k, y: (r.top + r.height / 2 - box.top) / k };
			curve(a, mLeft, "src");
			const s = this.sources[i];
			if (s) label(a, mLeft, s.answers ? __("{0} eligible", [s.answers]) : __("No answers"));
		});
		this.$el.find(".mx-node.index").each((i, el) => {
			const r = el.getBoundingClientRect();
			const b = { x: (r.left - box.left) / k, y: (r.top + r.height / 2 - box.top) / k };
			curve(mRight, b, "idx");
			const n = this.indices[i];
			if (n) label(mRight, b, __("{0}% in index", [n.weight || 0]));
		});
		svg.innerHTML = paths;
		$labels.html(labels);
	}

	// --------------------------------------------------------- inspector ---
	_renderInspector() {
		const U = window.UCCMO;
		const $slot = this.$el.find("[data-inspector]");
		if (!$slot.length) return;
		const tabs = [{ key: "details", label: __("Details") },
					  { key: "calculation", label: __("Calculation") },
					  { key: "lineage", label: __("Lineage") }];
		let title, icon, body, footer;
		if (this.sel.type === "source") {
			const s = this.sources.find((x) => x.question === this.sel.id);
			if (!s) { this.sel = { type: "metric" }; return this._renderInspector(); }
			title = __("Source question"); icon = window.UCCMOIcons.forQuestionType(s.question_type);
			body = this.itab === "details"
				? U.field({ label: __("Question"), name: "sq", type: "textarea", value: s.text, locked: true,
							lockReason: __("Wording is managed in the Survey workspace.") })
					+ U.field({ label: __("Survey version"), name: "sv", value: s.survey_version || "", locked: true })
					+ U.field({ label: __("Type"), name: "st", value: s.question_type || "", locked: true })
					+ U.field({ label: __("Answers"), name: "sa", value: String(s.answers), locked: true })
					+ U.button({ label: __("Open in Survey workspace"), small: true, icon: "i-survey", act: "goto-survey" })
				: this.itab === "calculation"
				? `<div class="field"><label>${__("Normalisation for this source")}</label>
						<select data-f="src_norm">${NORMALISATIONS.map((n) =>
							`<option ${n === (s.normalisation || this.m.default_normalisation) ? "selected" : ""}>${
								U.esc(n)}</option>`).join("")}</select></div>
					<div class="help">${__("This is the only per-source setting that reaches a score. The engine averages every eligible answer equally; there is no source weight, so none is shown.")}</div>`
				: `<div class="mx-info"><div><span>${__("Source survey")}</span><b>${U.esc(s.survey_version || "")}</b></div>
					<div><span>${__("Feeds metric")}</span><b>${U.esc(this.m.metric_name || this.m.name)}</b></div>
					<div><span>${__("Then feeds")}</span><b>${this.indices.length
						? U.esc(this.indices.map((i) => i.parent).join(", ")) : __("no index yet")}</b></div></div>`;
			footer = U.footerActions([{ label: __("Remove from metric"), tone: "danger", icon: "i-trash", act: "rm-source" }]);
		} else if (this.sel.type === "index") {
			const i = this.indices.find((x) => x.parent === this.sel.id);
			title = __("Index relationship"); icon = "i-index";
			body = `<div class="mx-info">
					<div><span>${__("Index version")}</span><b>${U.esc(i.parent)}</b></div>
					<div><span>${__("Node")}</span><b>${U.esc(i.label || "")}</b></div>
					<div><span>${__("Metric weight")}</span><b>${U.esc(i.weight || 0)}%</b></div></div>
				<div class="help">${__("The weight belongs to the Index formula. Edit it in the Indices workspace, not here.")}</div>`;
			footer = U.footerActions([{ label: __("Open in Indices workspace"), icon: "i-index", act: "goto-index" }]);
		} else {
			title = __("Metric settings"); icon = "i-metric";
			body = this.itab === "details"
				? U.field({ label: __("Metric name"), name: "metric_name", value: this.m.metric_name || "" })
					+ U.field({ label: __("Metric code"), name: "metric_code", value: this.m.name, locked: true,
								lockReason: __("The code is the record's identity and cannot change.") })
					+ U.field({ label: __("Description"), name: "description", type: "textarea",
								value: this.m.description || "" })
					+ `<div class="mx-info">
						<div><span>${__("Source questions")}</span><b>${this.sources.length}</b></div>
						<div><span>${__("Survey versions")}</span><b>${this.m.survey_count}</b></div>
						<div><span>${__("Consumed by")}</span><b>${this.indices.length}</b></div></div>`
				: this.itab === "calculation"
				? U.field({ label: __("Default normalisation"), name: "default_normalisation", type: "select",
							value: this.m.default_normalisation, options: NORMALISATIONS })
					+ `<div class="field"><label>${__("Source contribution")}</label>
						<select disabled><option>${__("Average eligible answers equally")}</option></select></div>
					<div class="help">${__("Normalisation runs once, here at the metric layer. The Index applies the metric weight and never re-normalises.")}</div>
					<div class="published-lock-row">${U.icon("i-check", "xs")}<div>
						<b>${__("This is the real engine, not a placeholder")}</b><br>${
						__("aggregate_metric normalises each answer to 0-100 and takes a plain mean. There is no source weighting and no minimum sample rule, so neither is offered here.")}
					</div></div>`
				: `<div class="mx-info">
						<div><span>${__("Metric")}</span><b>${U.esc(this.m.name)}</b></div>
						<div><span>${__("Question sources")}</span><b>${this.sources.length}</b></div>
						<div><span>${__("Survey versions")}</span><b>${U.esc((this.m.survey_versions || []).join(", ") || "—")}</b></div>
						<div><span>${__("Index consumers")}</span><b>${this.indices.length}</b></div></div>
					<div class="help">${__("Objectives are governance and evidence lineage. They are never part of this scoring chain, so they are not drawn on this canvas.")}</div>`;
			footer = U.footerActions([{ label: __("Save metric"), tone: "primary", icon: "i-save", act: "save-metric" }]);
		}
		// Same collapse affordance the Survey inspector uses - one component, not
		// a second implementation of the same chevron (round-8 Item 1).
		$slot.html(U.inspector({ title, icon, tabs, tab: this.itab, body, footer,
			collapse: { act: "collapse-right", side: "right", collapsed: !!this.rightCollapsed,
						label: __("Collapse settings"), shortLabel: __("Settings") } }));
	}

	// ------------------------------------------- source drill-down (round 10) ---
	// ONE browser, two mounts: the Add-source drawer and the Source library tab
	// render the same three columns from the same methods and share one
	// selection set. Two implementations of this would drift on the first
	// eligibility change, and eligibility is the part that must not drift.
	//
	// Navigation state is per-mount (browsing in the drawer must not move the
	// library), but `picked` is shared, which is what makes a cross-survey
	// metric buildable: selections survive changing department, version, search
	// and filter.
	_nav(where) {
		this.navState = this.navState || {
			drawer: { category: null, version: null, search: "", filter: "all", showIncompatible: false },
			library: { category: null, version: null, search: "", filter: "all", showIncompatible: false },
		};
		return this.navState[where];
	}

	_browser(where) {
		const U = window.UCCMO;
		const n = this._nav(where);
		return `<div class="source-browser" data-where="${where}">
			<div class="sb-col sb-types">
				<div class="sb-head">${__("1 · Survey type")}</div>
				<div class="sb-list" data-sb-categories>${U.empty(__("Loading…"))}</div>
			</div>
			<div class="sb-col sb-versions">
				<div class="sb-head">${__("2 · Survey and version")}</div>
				<div class="sb-list" data-sb-versions>${
					U.empty(__("Select a survey type to continue."))}</div>
			</div>
			<div class="sb-col sb-questions">
				<div class="sb-head" data-sb-qhead>${__("3 · Questions")}</div>
				<div class="sb-filters">
					<input type="text" data-sb-search value="${U.esc(n.search)}"
						placeholder="${__("Search within this survey…")}">
					<select data-sb-filter>
						<option value="all" ${n.filter === "all" ? "selected" : ""}>${__("All eligible")}</option>
						<option value="has" ${n.filter === "has" ? "selected" : ""}>${__("Has answers")}</option>
						<option value="none" ${n.filter === "none" ? "selected" : ""}>${__("No answers")}</option>
						<option value="added" ${n.filter === "added" ? "selected" : ""}>${__("Already added")}</option>
					</select>
					<label class="sb-toggle"><input type="checkbox" data-sb-incompatible ${
						n.showIncompatible ? "checked" : ""}>${__("Show incompatible")}</label>
				</div>
				<div class="sb-list" data-sb-questions>${
					U.empty(__("Select a survey version to view its questions."))}</div>
			</div>
		</div>`;
	}

	_loadCategories(where) {
		const U = window.UCCMO;
		const $c = this.$el.find(`[data-where="${where}"] [data-sb-categories]`);
		this.app.call(XAPI + "source_categories", {}).then((rows) => {
			if (!$c.length) return;
			if (!rows || !rows.length) return $c.html(U.empty(__("No surveys exist yet.")));
			const n = this._nav(where);
			$c.html(rows.map((r) => `
				<button class="sb-item ${r.key === n.category ? "selected" : ""}" data-sb-cat="${U.esc(r.key)}">
					<span class="type-icon">${U.icon("i-survey", "sm")}</span>
					<span class="question-copy"><b>${U.esc(r.label)}</b>
						<span class="eyebrow">${__("{0} surveys · {1} versions", [r.surveys, r.versions])}</span></span>
				</button>`).join(""));
		});
	}

	_loadVersions(where) {
		const U = window.UCCMO;
		const n = this._nav(where);
		const $v = this.$el.find(`[data-where="${where}"] [data-sb-versions]`);
		$v.html(U.empty(__("Loading…")));
		this.app.call(XAPI + "source_versions", { category: n.category }).then((rows) => {
			if (!$v.length) return;
			if (!rows || !rows.length) return $v.html(U.empty(__("No survey versions in this group.")));
			$v.html(rows.map((r) => `
				<button class="sb-item ${r.name === n.version ? "selected" : ""}" data-sb-ver="${U.esc(r.name)}">
					<span class="type-icon">${U.icon("i-page", "sm")}</span>
					<span class="question-copy"><b>${U.esc(r.survey_title)}</b>
						<span class="eyebrow">${U.esc(r.name)} · v${U.esc(r.version_number)}</span>
						<span class="sb-meta">${U.chip(U.esc(r.status), r.status === "Published" ? "ok" : "")}
							${U.chip(__("{0} questions", [r.question_count]), "")}
							${U.chip(__("{0} answers", [r.answer_count]), r.answer_count ? "ok" : "warn")}</span></span>
				</button>`).join(""));
		});
	}

	_loadQuestions(where) {
		const U = window.UCCMO;
		const n = this._nav(where);
		const $q = this.$el.find(`[data-where="${where}"] [data-sb-questions]`);
		if (!n.version) return $q.html(U.empty(__("Select a survey version to view its questions.")));
		$q.html(U.empty(__("Loading…")));
		this.app.call(XAPI + "eligible_questions", {
			metric_code: this.s.metric, survey_version: n.version,
			search: n.search, response_filter: n.filter,
			show_incompatible: n.showIncompatible ? 1 : 0,
		}).then((rows) => {
			if (!$q.length) return;
			this.$el.find(`[data-where="${where}"] [data-sb-qhead]`)
				.text(__("3 · {0} — {1} questions", [n.version, (rows || []).length]));
			if (!rows || !rows.length) {
				return $q.html(U.empty(n.search
					? __("No questions match this search.")
					: n.showIncompatible
						? __("This survey version has no answer-bearing questions.")
						: __("No questions in this survey are compatible with the metric's current normalisation.")));
			}
			$q.html(rows.map((r) => {
				const on = this.picked.has(r.name);
				const dis = !r.eligible;
				const tone = r.state === "eligible" ? "ok"
					: r.state === "no_response_data" ? "warn"
					: r.state === "already_connected" ? "" : "warn";
				const label = r.state === "eligible" ? __("Compatible")
					: r.state === "no_response_data" ? __("No answers yet")
					: r.state === "already_connected" ? __("Already added") : __("Incompatible");
				return `<label class="sb-question ${dis ? "disabled" : ""} ${on ? "picked" : ""}">
					<input type="checkbox" data-pick="${U.esc(r.name)}" ${on ? "checked" : ""} ${
						dis ? "disabled" : ""}>
					<span class="type-icon">${U.icon(window.UCCMOIcons.forQuestionType(r.question_type), "sm")}</span>
					<span class="question-copy"><b>${U.esc(r.question_text || r.name)}</b>
						<span class="eyebrow">${U.esc(r.question_type || "")} · ${
							__("{0} answers", [r.answer_count])}</span>
						${r.reason ? `<span class="eyebrow">${U.esc(r.reason)}${r.suggested_normalisation
							? " " + __("Try: {0}", [r.suggested_normalisation]) : ""}</span>` : ""}</span>
					${U.chip(label, tone)}
				</label>`;
			}).join(""));
		});
	}

	// Footer says how many SURVEY VERSIONS are represented, not just how many
	// questions - the cross-survey count is the thing this workspace exists for.
	_pickedSummary() {
		const versions = new Set();
		this.picked.forEach((q) => versions.add((this._pickedVersion || {})[q] || "?"));
		return { questions: this.picked.size, versions: versions.size };
	}

	_renderPicked() {
		const s = this._pickedSummary();
		this.$el.find("[data-sb-count]").text(s.questions
			? __("{0} questions selected across {1} survey version(s)", [s.questions, s.versions])
			: __("Nothing selected yet."));
		this.$el.find('[data-act="add-picked"]').prop("disabled", !s.questions);
		this.$el.find('[data-act="clear-picked"]').prop("disabled", !s.questions);
	}

	_addPicked() {
		const names = [...this.picked];
		if (!names.length) return;
		this.app.call(XAPI + "add_metric_sources", {
			metric_code: this.s.metric, questions: JSON.stringify(names),
		}).then((r) => {
			if (!r) return;
			// Failed items stay selected so they can be reviewed, per the brief.
			this.picked = new Set((r.failed || []).map((f) => f.question));
			if ((r.failed || []).length) {
				frappe.msgprint({
					title: __("Some sources were not added"), indicator: "orange",
					message: (r.failed || []).map((f) => `${f.question}: ${f.error}`).join("<br>"),
				});
			} else {
				this._closeDrawer();
			}
			this.app.toast(__("{0} source(s) added", [(r.added || []).length]));
			this.app.state.metricsTab = "build";
			this.sel = { type: "metric" };
			this._fitted = null;
			this._load();
		});
	}

	_library() {
		const U = window.UCCMO;
		return `<div class="mx-library-wrap">
			${this._browser("library")}
			<div class="source-selection-footer">
				<span class="help" data-sb-count>${__("Nothing selected yet.")}</span>
				<span>${U.button({ label: __("Clear selection"), small: true, act: "clear-picked" })}
					${U.button({ label: __("Add selected sources"), tone: "primary", small: true,
								 icon: "i-plus", act: "add-picked" })}</span>
			</div>
		</div>`;
	}

	_openDrawer() {
		const U = window.UCCMO;
		this.$el.find(".mx-build").append(`
			<div class="mx-drawer-back" data-drawer>
				<aside class="mx-drawer wide">
					<header class="pane-head">
						<div class="pane-title-with-icon">${U.icon("i-plus", "sm")}<strong>${
							__("Add source questions")}</strong></div>
						${U.button({ label: __("Close"), small: true, act: "close-drawer" })}
					</header>
					<div class="sb-intro">
						<div>${__("Browse by survey type, choose a survey version, then select its questions.")}</div>
						<div class="eyebrow">${__("1 Survey type › 2 Survey and version › 3 Questions · selections remain while browsing other surveys.")}</div>
					</div>
					${this._browser("drawer")}
					<footer class="source-selection-footer">
						<span class="help" data-sb-count>${__("Nothing selected yet.")}</span>
						<span>${U.button({ label: __("Clear selection"), small: true, act: "clear-picked" })}
							${U.button({ label: __("Add selected sources"), tone: "primary", small: true,
										 icon: "i-plus", act: "add-picked" })}</span>
					</footer>
				</aside>
			</div>`);
		this._loadCategories("drawer");
		this._renderPicked();
	}

	// Closing discards a draft selection deliberately - it is scoped to the
	// drawer session, and keeping it would silently re-apply on the next open.
	_closeDrawer() { this.$el.find("[data-drawer]").remove(); }

	// -------------------------------------------------------- validation ---
	// Actionable, per the brief: every row says what to DO, and the checks are
	// computed from the same data the canvas draws, so the two can never disagree.
	_checks() {
		const m = this.m, src = this.sources, idx = this.indices;
		const noAnswers = src.filter((s) => !s.answers);
		const dupes = src.length - new Set(src.map((s) => s.question)).size;
		const missingNorm = src.filter((s) => !(s.normalisation || m.default_normalisation));
		const noVersion = src.filter((s) => !s.survey_version);
		return [
			{ ok: !!src.length, title: __("Metric has at least one source question"),
			  detail: src.length ? __("{0} source question(s) connected.", [src.length])
								 : __("Nothing feeds this metric, so it scores nothing."),
			  act: src.length ? null : { label: __("Add source"), act: "add-source" } },
			{ ok: !!m.default_normalisation, title: __("Metric normalisation is defined"),
			  detail: m.default_normalisation
				? __("Default: {0}.", [m.default_normalisation])
				: __("Without a default, a source with no override cannot be scored.") },
			{ ok: !missingNorm.length, title: __("Every source resolves to a normalisation"),
			  detail: missingNorm.length
				? __("{0} source(s) have neither an override nor a metric default.", [missingNorm.length])
				: __("All sources normalise to 0-100.") },
			{ ok: !noAnswers.length, title: __("Source questions have response data"),
			  detail: noAnswers.length
				? __("{0} has no submitted answers, so it contributes nothing.", [noAnswers[0].survey_version || noAnswers[0].question])
				: __("Every source has at least one answer.") },
			{ ok: !dupes, title: __("No duplicate source question"),
			  detail: dupes ? __("{0} duplicate row(s) found.", [dupes]) : __("Each question appears once.") },
			{ ok: !noVersion.length, title: __("All referenced survey versions resolve"),
			  detail: noVersion.length
				? __("{0} source(s) point at a question whose version is missing.", [noVersion.length])
				: __("Every source resolves to a real survey version.") },
			{ ok: !!idx.length, title: __("Metric is consumed by an index"),
			  detail: idx.length ? __("Used by {0}.", [idx.map((i) => i.parent).join(", ")])
								 : __("Nothing consumes this metric, so it reaches no Criterion 7 result."),
			  act: idx.length ? null : { label: __("Open Indices"), act: "goto-index-ws" } },
			{ ok: true, title: __("Calculation method is explicit"),
			  detail: __("Eligible answers are averaged equally. No unsupported source weighting is shown.") },
		];
	}

	_validation() {
		const U = window.UCCMO;
		const checks = this._checks();
		const passed = checks.filter((c) => c.ok).length;
		const first = checks.find((c) => !c.ok);
		return `<div class="mx-validation">
			${U.pane({ title: __("Validation summary"), icon: "i-check", body: `
				<div class="big-score">${passed}/${checks.length}</div>
				<div class="help">${__("Checks passed for this metric.")}</div>
				${first ? `<div class="published-lock-row" style="margin-top:12px">${U.icon("i-warning", "xs")}<div>
					<b>${U.esc(first.title)}</b><br>${U.esc(first.detail)}</div></div>`
					: `<div class="published-lock-row" style="margin-top:12px">${U.icon("i-check", "xs")}<div>
					<b>${__("Nothing to review")}</b><br>${__("This metric is ready to feed an index.")}</div></div>`}
				${U.button({ label: __("Run validation again"), tone: "primary", icon: "i-check", act: "revalidate" })}` })}
			${U.pane({ title: __("Validation checks"), icon: "i-filter", count: checks.length, body:
				checks.map((c) => `<div class="mx-check">
					<span class="type-icon ${c.ok ? "" : "warn"}">${U.icon(c.ok ? "i-check" : "i-warning", "sm")}</span>
					<div><b>${U.esc(c.title)}</b><div class="eyebrow">${U.esc(c.detail)}</div></div>
					${c.act ? U.button({ label: c.act.label, small: true, act: c.act.act })
							: U.chip(c.ok ? __("Passed") : __("Review"), c.ok ? "ok" : "warn")}
				</div>`).join("") })}
		</div>`;
	}

	// ----------------------------------------------------------- actions ---
	_preview() {
		this.app.call(XAPI + "preview_metric", { metric_code: this.s.metric }).then((r) => {
			if (!r) return;
			const U = window.UCCMO;
			const d = new frappe.ui.Dialog({
				title: __("Calculation preview"),
				fields: [{ fieldtype: "HTML", fieldname: "out" }],
			});
			d.fields_dict.out.$wrapper.html(`<div class="ucc-mo"><div class="ucc-mo-metrics">
				<div class="published-lock-row">${U.icon("i-lock", "xs")}<div>
					<b>${__("Preview only")}</b><br>${
					__("This does not publish and creates no evidence snapshot. It runs the same aggregate_metric the real calculation uses.")}</div></div>
				<div class="mx-preview">
					<div><span>${__("Eligible answers")}</span><b>${r.scored_count}</b></div>
					<div><span>${__("Metric score")}</span><b>${r.value === null ? "—" : Number(r.value).toFixed(1)}</b></div>
					<div><span>${__("Unscoreable")}</span><b>${r.unscoreable}</b></div>
				</div>
				<div class="mx-info" style="margin-top:10px">
					<div><span>${__("Calculation")}</span><b>${__("Average eligible answers equally")}</b></div>
					<div><span>${__("Normalisation")}</span><b>${U.esc(this.m.default_normalisation || "—")}</b></div>
					<div><span>${__("Contributing versions")}</span><b>${U.esc((r.source_versions || []).join(", ") || "—")}</b></div>
					<div><span>${__("Consumed by")}</span><b>${U.esc(this.indices.map((i) => i.parent).join(", ") || __("no index"))}</b></div>
				</div></div></div>`);
			d.show();
		});
	}

	_newMetric() {
		frappe.prompt([
			{ fieldname: "metric_code", fieldtype: "Data", label: __("Metric code"), reqd: 1 },
			{ fieldname: "metric_name", fieldtype: "Data", label: __("Metric name") },
			{ fieldname: "default_normalisation", fieldtype: "Select", label: __("Default normalisation"),
			  options: NORMALISATIONS.join("\n"), default: NORMALISATIONS[0] },
		], (v) => this.app.call(XAPI + "new_metric", v).then((name) => {
			if (!name) return;
			this.s.metric = name;
			this.sel = { type: "metric" };
			this.app.toast(__("Metric created. Add the questions that feed it."));
			this.render();
		}), __("New metric"), __("Create"));
	}
	_wire() {
		const $el = this.$el;
		$el.off("click.mo input.mo change.mo");
		$el.on("click.mo", "[data-metric]", (e) => {
			this.s.metric = $(e.currentTarget).data("metric");
			this.sel = { type: "metric" };
			this._load();
		});
		$el.on("click.mo", "[data-node]", (e) => {
			this.sel = { type: $(e.currentTarget).data("node"), id: $(e.currentTarget).data("id") };
			this.itab = "details";
			this.$el.find(".mx-node").removeClass("selected");
			$(e.currentTarget).addClass("selected");
			this._renderInspector();
		});
		$el.on("click.mo", "[data-itab]", (e) => {
			this.itab = $(e.currentTarget).data("itab");
			this._renderInspector();
		});
		$el.on("click.mo", '[data-act="new-metric"]', () => this._newMetric());
		$el.on("click.mo", '[data-act="preview"]', () => this._preview());
		$el.on("click.mo", '[data-act="zoom-fit"]', () => this._zoom && this._zoom.fit());
		$el.on("click.mo", '[data-act="zoom-in"]', () => this._zoom && this._zoom.zoomIn());
		$el.on("click.mo", '[data-act="zoom-out"]', () => this._zoom && this._zoom.zoomOut());
		$el.on("click.mo", '[data-act="zoom-reset"]', () => this._zoom && this._zoom.reset());
		$el.on("click.mo", '[data-act="collapse-right"]', () => {
			this.rightCollapsed = !this.rightCollapsed;
			this.$el.find(".mx-build").toggleClass("right-collapsed", !!this.rightCollapsed);
			this._renderInspector();
		});
		$el.on("click.mo", '[data-act="fit"]', () => {
			this.$el.find("[data-stage]").get(0).scrollTo({ left: 0, top: 0, behavior: "smooth" });
			requestAnimationFrame(() => this._drawEdges());
		});
		$el.on("click.mo", '[data-act="add-source"]', () => this._openDrawer());
		$el.on("click.mo", '[data-act="close-drawer"]', () => this._closeDrawer());
		$el.on("click.mo", "[data-drawer]", (e) => {
			if (e.target === e.currentTarget) this._closeDrawer();
		});
		$el.on("click.mo", '[data-act="add-picked"]', () => this._addPicked());
		$el.on("click.mo", '[data-act="revalidate"]', () => { this._load(); this.app.toast(__("Validation re-run")); });
		$el.on("click.mo", '[data-act="rm-source"]', () => {
			const q = this.sel.id;
			frappe.confirm(__("Remove this question from the metric? Existing published results are not affected."), () =>
				this.app.call(XAPI + "remove_metric_source", { metric_code: this.s.metric, question: q })
					.then(() => { this.sel = { type: "metric" }; this.app.toast(__("Source removed")); this._load(); }));
		});
		$el.on("click.mo", '[data-act="save-metric"]', () => {
			this.app.call(XAPI + "save_metric", {
				metric_code: this.s.metric,
				metric_name: $el.find('[data-f="metric_name"]').val(),
				default_normalisation: this.m.default_normalisation,
				description: $el.find('[data-f="description"]').val(),
			}).then(() => { this.app.toast(__("Metric saved")); this._load(); });
		});
		$el.on("change.mo", '[data-f="default_normalisation"]', (e) => {
			this.app.call(XAPI + "save_metric", {
				metric_code: this.s.metric, default_normalisation: $(e.target).val(),
			}).then(() => { this.app.toast(__("Normalisation updated")); this._load(); });
		});
		$el.on("change.mo", '[data-f="src_norm"]', (e) => {
			this.app.call(XAPI + "set_source_normalisation", {
				metric_code: this.s.metric, question: this.sel.id, normalisation: $(e.target).val(),
			}).then(() => { this.app.toast(__("Normalisation updated")); this._load(); });
		});
		$el.on("click.mo", '[data-act="goto-survey"]', () => {
			const s = this.sources.find((x) => x.question === this.sel.id);
			if (!s) return;
			this.app.ws = "surveys";
			this.app.state.surveyVersion = s.survey_version;
			this.app.state.question = s.question;
			this.app.render();
		});
		$el.on("click.mo", '[data-act="goto-index"]', () => {
			this.app.ws = "indices";
			this.app.state.indexVersion = this.sel.id;
			this.app.render();
		});
		$el.on("click.mo", '[data-act="goto-index-ws"]', () => { this.app.ws = "indices"; this.app.render(); });
		// --- drill-down browser, shared by the drawer and the library tab ---
		$el.on("click.mo", "[data-sb-cat]", (e) => {
			const where = $(e.currentTarget).closest("[data-where]").data("where");
			const n = this._nav(where);
			n.category = $(e.currentTarget).data("sb-cat");
			n.version = null;                       // a new group invalidates the version
			$(e.currentTarget).closest("[data-sb-categories]").find(".sb-item").removeClass("selected");
			$(e.currentTarget).addClass("selected");
			this.$el.find(`[data-where="${where}"] [data-sb-questions]`)
				.html(window.UCCMO.empty(__("Select a survey version to view its questions.")));
			this._loadVersions(where);
		});
		$el.on("click.mo", "[data-sb-ver]", (e) => {
			const where = $(e.currentTarget).closest("[data-where]").data("where");
			this._nav(where).version = $(e.currentTarget).data("sb-ver");
			$(e.currentTarget).closest("[data-sb-versions]").find(".sb-item").removeClass("selected");
			$(e.currentTarget).addClass("selected");
			this._loadQuestions(where);
		});
		// Debounced: a keystroke per query would hammer the server on a big site.
		$el.on("input.mo", "[data-sb-search]", (e) => {
			const where = $(e.currentTarget).closest("[data-where]").data("where");
			this._nav(where).search = e.target.value;
			clearTimeout(this._sbT);
			this._sbT = setTimeout(() => this._loadQuestions(where), 220);
		});
		$el.on("change.mo", "[data-sb-filter]", (e) => {
			const where = $(e.currentTarget).closest("[data-where]").data("where");
			this._nav(where).filter = e.target.value;
			this._loadQuestions(where);
		});
		$el.on("change.mo", "[data-sb-incompatible]", (e) => {
			const where = $(e.currentTarget).closest("[data-where]").data("where");
			this._nav(where).showIncompatible = e.target.checked;
			this._loadQuestions(where);
		});
		// Selection survives every navigation change - that is what makes a
		// cross-survey metric possible. Only Clear, or a successful add, empties it.
		$el.on("change.mo", "[data-pick]", (e) => {
			const where = $(e.currentTarget).closest("[data-where]").data("where");
			const q = $(e.currentTarget).data("pick");
			this._pickedVersion = this._pickedVersion || {};
			if (e.currentTarget.checked) {
				this.picked.add(q);
				this._pickedVersion[q] = this._nav(where).version;
			} else {
				this.picked.delete(q);
				delete this._pickedVersion[q];
			}
			$(e.currentTarget).closest(".sb-question").toggleClass("picked", e.currentTarget.checked);
			this._renderPicked();
		});
		$el.on("click.mo", '[data-act="clear-picked"]', () => {
			this.picked.clear();
			this._pickedVersion = {};
			this.$el.find("[data-pick]").prop("checked", false);
			this.$el.find(".sb-question").removeClass("picked");
			this._renderPicked();
		});
		$(window).off("resize.mx").on("resize.mx", () => {
			clearTimeout(this._rt);
			this._rt = setTimeout(() => this._drawEdges(), 120);
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
						if (!this.s.indexVersion) {
						this.$el.html(`${window.UCCMO.contextBar({
							eyebrow: __("Indices workspace"), title: __("No indices yet"),
							actions: [{ label: __("New index"), tone: "primary", icon: "i-plus", act: "new-index" }],
						})}<div class="workarea">${window.UCCMO.empty(
							__("Start from a standard index template, then adjust its weights."),
							{ label: __("New index"), tone: "primary", act: "new-index" })}</div>`);
						return this.$el.off("click.mo").on("click.mo", '[data-act="new-index"]', () => this._newIndex());
					}
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
					// Round-9 Item 4: this workspace had NO way to create an index.
					// The endpoints existed (list_index_templates,
					// create_index_from_template) - only the affordance was never
					// ported from the old Index Studio.
					{ label: __("New index"), tone: "primary", icon: "i-plus", act: "new-index" },
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
			<div class="workarea"><div class="index-layout" style="${tab === "formula" ? "" : "grid-template-columns:1fr"}">
				<section class="pane"><header class="pane-head">
					<div class="pane-title-with-icon">${U.icon("i-index", "sm")}<strong>${
						tab === "formula" ? __("Formula") : tab === "calculate" ? __("Calculate") : __("Results")}</strong></div>
					${tab === "formula" ? `<div class="mx-tools">${window.UCCZoom.controls()}</div>` : ""}
				</header><div class="pane-body">${
					tab === "formula" ? this._formula() :
					tab === "calculate" ? this._calculate() : this._results()}</div></section>
				${tab === "formula" ? `<div data-node-editor></div>` : ""}
			</div></div>`);
		this._mountPicker();
		this._wire();
		// The node editor is a Formula-tab concept - node selection (this.sel)
		// only means anything against the formula tree. Calculate/Results have
		// no node to select, so on 2026-08-01 QA they kept showing whatever the
		// editor last rendered on Formula (stale, or the "select a node"
		// placeholder) - confusing chrome unrelated to either tab. Scoped to
		// match every other workspace's inspector (Survey/Objectives/Metrics all
		// already gate theirs on their own "primary" local tab the same way).
		if (tab === "formula") {
			this._renderEditor();
			// The formula tree draws no SVG, so zoom here is pure presentation -
			// there is no coordinate contract to honour and nothing to redraw.
			requestAnimationFrame(() => {
				const $surface = this.$el.find(".formula-surface");
				this._zoom = window.UCCZoom.attach($surface.parent().get(0), $surface.get(0),
					() => this._drawTreeEdges());
				this._drawTreeEdges();
				if (this._zoom && this._fitted !== this.s.indexVersion) {
					this._fitted = this.s.indexVersion;
					this._zoom.fit();
				}
			});
		}
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

	// Renders EVERY node, not just the ones reachable from a root.
	//
	// Round-4 Item 9, reproduced: this used to walk down from nodes with a falsy
	// parent_key and render nothing else. A version whose nodes all carry a
	// parent_key - no root - produced a completely empty canvas with four real
	// nodes in the data, no error and nothing to click, which is exactly the
	// reported "formula canvas is stuck, cannot be clicked". Nothing was
	// capturing input; there was nothing there. A dangling or cyclic parent did
	// the quieter version of the same thing: 7 nodes in, 4 drawn, no warning.
	//
	// index_engine.validate_structure catches all three (no root, multiple
	// roots, dangling parents, cycles) - but only when you press Validate or
	// Publish, so a Draft reaches this renderer unchecked. The UI therefore has
	// to be total: draw the tree where there is one, and put whatever is left
	// over in a clearly-labelled group rather than dropping it on the floor.
	// Round-11 Item 2: real connectors on the formula tree.
	//
	// ORG-CHART elbows, not the Beziers used on Objectives/Metrics. Those two
	// are left-to-right flows between separate columns, where a curve reads as
	// "flows into". This tree is `justify-items: center` - a parent sits ABOVE
	// its children, all centred on the same axis - so the shape that reads
	// correctly is the org-chart one: down from the parent, across a shared
	// horizontal rail, then down into each child. (First attempt assumed a
	// left-indented file tree and produced stubs pointing the wrong way; the
	// layout is centred, so this follows the layout rather than the assumption.)
	//
	// Coordinates go through the SAME divide-by-scale correction as the other
	// two canvases (see mo_zoom.js) - the bug class that has bitten this project
	// repeatedly, so the contract is honoured rather than rediscovered.
	_drawTreeEdges() {
		const surface = this.$el.find(".formula-surface").get(0);
		const svg = this.$el.find("[data-tree-edges]").get(0);
		if (!surface || !svg) return;
		const k = (this._zoom && this._zoom.scale) || 1;
		const box = surface.getBoundingClientRect();
		svg.setAttribute("viewBox", `0 0 ${box.width / k} ${box.height / k}`);
		const at = {};
		this.$el.find(".tree-row [data-node]").each((_, el) => {
			const r = el.getBoundingClientRect();
			at[el.dataset.node] = {
				cx: (r.left + r.width / 2 - box.left) / k,
				top: (r.top - box.top) / k,
				bottom: (r.bottom - box.top) / k,
			};
		});
		const byParent = {};
		this.nodes.forEach((n) => (byParent[n.parent_key || ""] ||= []).push(n));
		let paths = "";
		Object.keys(byParent).forEach((pk) => {
			const parent = at[pk];
			if (!parent) return;                     // root row, or a collapsed branch
			const kids = byParent[pk].map((n) => at[n.node_key]).filter(Boolean);
			if (!kids.length) return;
			// Rail sits midway between the parent's bottom and the nearest child.
			const firstTop = Math.min(...kids.map((c) => c.top));
			const rail = parent.bottom + (firstTop - parent.bottom) / 2;
			paths += `<path class="tree-edge" d="M ${parent.cx} ${parent.bottom} L ${parent.cx} ${rail}"></path>`;
			const xs = kids.map((c) => c.cx).concat([parent.cx]);
			paths += `<path class="tree-edge" d="M ${Math.min(...xs)} ${rail} L ${Math.max(...xs)} ${rail}"></path>`;
			kids.forEach((c) => {
				paths += `<path class="tree-edge" d="M ${c.cx} ${rail} L ${c.cx} ${c.top}"></path>`;
			});
		});
		svg.innerHTML = paths;
	}

	// Creates a Draft version from one of the standard templates, via the
	// existing create_index_from_template - the same starter graph the old Index
	// Studio used, so a new index arrives with real nodes rather than empty.
	_newIndex() {
		this.app.call(IAPI + "list_index_templates", {}).then((templates) => {
			if (!templates || !templates.length) {
				return frappe.msgprint({ title: __("No templates"), indicator: "orange",
					message: __("No index templates are defined on this site.") });
			}
			frappe.prompt([{
				fieldname: "template_code", fieldtype: "Select", reqd: 1,
				label: __("Start from template"),
				options: templates.map((t) => t.code + " — " + t.name).join("\n"),
			}], (v) => {
				const code = String(v.template_code).split(" — ")[0];
				this.app.call(IAPI + "create_index_from_template", { template_code: code })
					.then((name) => {
						if (!name) return;
						this.s.indexVersion = name;
						this.sel = null;
						this._fitted = null;
						this.app.toast(__("Draft index created from {0}", [code]));
						this.render();
					});
			}, __("New index"), __("Create draft"));
		});
	}

	_formula() {
		const U = window.UCCMO;
		const byParent = {};
		this.nodes.forEach((n) => (byParent[n.parent_key || ""] ||= []).push(n));
		const seen = new Set();
		// Round-9 Item 3: the same chevron the panes use, on individual nodes.
		// U._collapseButton is the round-2 component pane()/inspector() already
		// call - reused here rather than a second chevron implementation. On a
		// TREE, collapsing a node means hiding its descendants, so the button
		// only appears on nodes that actually have children.
		this._collapsed = this._collapsed || new Set();
		const row = (n, depth) => {
			seen.add(n.node_key);
			const kids = (byParent[n.node_key] || []).length;
			const shut = this._collapsed.has(n.node_key);
			return `<div class="tree-row" style="padding-left:${depth * 18}px">
				${kids ? U._collapseButton({ act: "toggle-node", side: shut ? "left" : "right",
					collapsed: shut, label: shut ? __("Expand {0}", [n.label || n.node_key])
											   : __("Collapse {0}", [n.label || n.node_key]),
					shortLabel: "" }).replace('data-act="toggle-node"',
						`data-act="toggle-node" data-key="${U.esc(n.node_key)}"`)
					: `<span class="tree-spacer"></span>`}
				${U.node({
					key: n.node_key, title: n.label || n.node_key,
					kicker: n.node_type, meta: n.source_metric || "",
					kind: n.node_type === "Metric" ? "metric" : n.node_type === "Index" ? "index" : "",
					selected: this.sel === n.node_key,
					style: "width:auto",
				})}
				<span class="eyebrow">${n.weight ? n.weight + "%" : ""}</span>
			</div>`;
		};
		// `seen` also makes the walk cycle-proof. A cycle cannot be reached from
		// a root today (every node in one has a parent, so none is a root), but
		// that is a property of the data shape, not something this should rely
		// on to avoid hanging the tab.
		const draw = (key, depth) => (byParent[key] || [])
			.filter((n) => !seen.has(n.node_key))
			// A collapsed node keeps its own row and drops its subtree. seen still
			// records the whole branch, so collapsing never pushes children into
			// the "not connected to a root" group.
			.map((n) => {
				const r = row(n, depth);
				// Always walk the subtree, even when collapsed: the walk is what
				// records `seen`, and a hidden branch must not then be reported
				// as "not connected to a root". Collapsing only drops the MARKUP.
				const sub = draw(n.node_key, depth + 1);
				return r + (this._collapsed.has(n.node_key) ? "" : sub);
			}).join("");

		const tree = draw("", 0);
		const orphans = this.nodes.filter((n) => !seen.has(n.node_key));
		if (!tree && !orphans.length) {
			return `<div class="tree formula-surface">${U.empty(__("This version has no nodes yet."))}</div>`;
		}
		return `<div class="tree formula-surface"><svg class="tree-edges" data-tree-edges></svg>${tree}${orphans.length ? `
			<div class="published-lock-row" style="max-width:520px">${U.icon("i-warning", "xs")}<div>
				<b>${__("{0} node(s) are not connected to a root", [orphans.length])}</b><br>${
				__("Their parent is missing, is another unconnected node, or every node has a parent so there is no root. They are shown below and can still be edited; Validate explains what to fix.")}
			</div></div>
			${orphans.map((n) => row(n, 0)).join("")}` : ""}</div>`;
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
		$el.on("click.mo", '[data-act="zoom-fit"]', () => this._zoom && this._zoom.fit());
		$el.on("click.mo", '[data-act="zoom-in"]', () => this._zoom && this._zoom.zoomIn());
		$el.on("click.mo", '[data-act="zoom-out"]', () => this._zoom && this._zoom.zoomOut());
		$el.on("click.mo", '[data-act="zoom-reset"]', () => this._zoom && this._zoom.reset());
		$el.on("click.mo", '[data-act="toggle-node"]', (e) => {
			e.stopPropagation();          // never let the chevron select the node
			const k = $(e.currentTarget).data("key");
			this._collapsed = this._collapsed || new Set();
			if (this._collapsed.has(k)) this._collapsed.delete(k); else this._collapsed.add(k);
			this._draw();
		});
		$el.on("click.mo", '[data-act="new-index"]', () => this._newIndex());
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
			<div class="workarea">${tab === "overview" ? `<div class="dashboard-layout">
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
			</div>` : `<div class="pane" style="height:100%"><div class="pane-body">${
				U.empty(__("This tab is not built yet. See Overview for the current evidence view."))}</div></div>`}</div>`);
		this._wire();
		// Overview's Results/main/side dashboard is the only content that
		// exists for this workspace right now (2026-08-01 QA Bug C: Narrative
		// and Lineage previously reused Overview's markup and never repainted
		// for their own tab, since _fill() ignored the tab argument entirely -
		// switching tabs silently changed nothing). Rather than leave that
		// stale copy in place, an honest placeholder replaces it until
		// Narrative/Lineage get real content of their own.
		if (tab === "overview") this._fill(tab);
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
