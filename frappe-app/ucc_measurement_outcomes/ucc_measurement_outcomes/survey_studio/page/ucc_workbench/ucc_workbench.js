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

	// frappe.call fires `callback` ONLY on success. With no error handler, a
	// server-side throw left this promise PENDING FOREVER: every
	// `.then(() => { toast(...); this._load(); })` in all five workspaces simply
	// never ran, so a failed write showed no toast, no refresh and no stale-data
	// warning - the screen just kept showing what it had. That is
	// indistinguishable from "it saved but the view did not refresh", which is
	// exactly the ambiguity the 2026-08-02 objectives report ran into.
	//
	// `error` now settles it. It resolves rather than rejects so the existing
	// `if (!r) return;` guards keep working, and `ok` is what a caller checks
	// before claiming success - Frappe still raises its own error dialog, so
	// this adds no second message, only an end to the silent hang.
	call(method, args) {
		return new Promise((resolve) => {
			let settled = false;
			const done = (v) => { if (!settled) { settled = true; resolve(v); } };
			frappe.call({
				method, args,
				callback: (r) => { this.lastCallOk = true; done(r.message); },
				error: () => { this.lastCallOk = false; done(undefined); },
				always: () => done(undefined),
			});
		});
	}

	// True when the most recent call() came back from the server successfully.
	// A write that claims "Saved" without checking this is claiming something it
	// does not know.
	get ok() { return this.lastCallOk !== false; }

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
					// Reorder lives here rather than as a drag gesture: it is
					// keyboard-reachable, and the grip this replaces was decorative.
					? [{ act: "q-up", icon: "i-chevron-up", title: __("Move up") },
					   { act: "q-down", icon: "i-chevron-down", title: __("Move down") },
					   { act: "dup", icon: "i-copy", title: __("Duplicate") },
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
		$el.on("click.mo", '[data-act="q-up"]', (e) =>
			this._moveQuestion($(e.currentTarget).data("q"), -1));
		$el.on("click.mo", '[data-act="q-down"]', (e) =>
			this._moveQuestion($(e.currentTarget).data("q"), 1));
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

	// Reordering. The old Survey Builder had drag-and-drop and this workspace had
	// nothing - not even the endpoint call - so `reorder_questions` had exactly
	// two callers, both on the page being retired. Move up / Move down is the
	// accessible form of the same operation and the one the old page lacked.
	//
	// It moves within the FULL question list, not the current page: `sequence` is
	// version-wide and _resequence keeps it dense, so a question at the top of a
	// page moving up genuinely crosses the Page Break above it. Clamping to the
	// page would make the buttons lie about what sequence means.
	_moveQuestion(name, dir) {
		if (!this.editable) return;
		const order = this.questions.map((q) => q.name);
		const at = order.indexOf(name);
		const to = at + dir;
		if (at < 0 || to < 0 || to >= order.length) return;
		order.splice(to, 0, order.splice(at, 1)[0]);
		this.app.call(BAPI + "reorder_questions", {
			survey_version: this.s.surveyVersion, ordered: JSON.stringify(order),
		}).then(() => {
			if (!this.app.ok) {
				return this.app.toast(__("Could not reorder - nothing was saved."), "red");
			}
			this.s.question = name;      // keep the moved question selected
			this._load();
		});
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
			// Cross-survey, unlike the two above. Coverage's drill-down needs it
			// and it is the only place "reached by a DIFFERENT survey" exists.
			this.app.call(MAPI + "objective_usage"),
		]).then(([ov, cov, masters, usage]) => {
			this.rows = (ov && ov.questions) || [];
			this.coverage = cov || {};
			this.masters = masters || { objectives: [] };
			this.usage = (usage && usage.usage) || {};
			// Fresh server state: a browsed candidate that has since been linked
			// now arrives in q.objectives on its own account, and one that was
			// not linked is not a pending intent any more.
			this._extra = null;
			// A jump out of Coverage into Map carries its objective through app
			// state, because switching tabs re-renders the whole workspace and
			// throws this instance (and `_extra` with it) away.
			if (this.s.objectiveFocus) {
				this._extra = this.sel = this.s.objectiveFocus;
				this.s.objectiveFocus = null;
			}
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
		// A objective picked through "Browse all" comes first: the user asked for
		// that one specifically, so it must not be pushed out by the 5-item cap.
		if (this._extra && linked.indexOf(this._extra) === -1) nearby.push(this._extra);
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
			${U.tabs([{ key: "map", label: __("Map") },
					  { key: "coverage", label: __("Coverage") }], tab)}
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
		// Only Coverage reaches here: Map renders itself and Governance is gone.
		// Frappe's own document history on UCC Question Mapping still records
		// every change - that is the audit evidence, and it never depended on a
		// tab of ours.
		return tab === "coverage" ? this._coverageTab() : "";
	}

	// ---------------------------------------------------------- coverage ---
	// A drill-down, not a wall of chips. The chip wall it replaces capped at 40
	// of 97 with "+57 more" and no way to reach the rest, and every chip was a
	// dead label: you could see that an objective was unreached and do nothing
	// about it. Left = the whole register, searchable; right = one objective's
	// real evidence, with a way into Map.
	_coverageObjectives() {
		const q = (this.covQuery || "").trim().toLowerCase();
		const idle = new Set(this.coverage.unmapped_objectives || []);
		return (this.masters.objectives || []).map((o) => {
			const uses = this.usage[o.name] || [];
			return {
				code: o.name,
				detail: o,
				label: o.objective_name || o.objective || o.description || o.objective_description || "",
				clause: o.clause_or_criterion || "",
				uses,
				// Two different truths, deliberately both shown: reached by ANY
				// survey (uses) and reached by THIS version (idle). Collapsing
				// them is how "unreached" ends up meaning neither one.
				inSurvey: !idle.has(o.name),
			};
		}).filter((o) => !q
			|| o.code.toLowerCase().indexOf(q) !== -1
			|| String(o.label).toLowerCase().indexOf(q) !== -1
			|| String(o.clause).toLowerCase().indexOf(q) !== -1);
	}

	_coverageRows(list) {
		const U = window.UCCMO;
		if (!list.length) {
			return U.empty(this.covQuery
				? __("No objective matches “{0}”.", [this.covQuery])
				: __("The objective register is empty on this site."));
		}
		return list.map((o) => `
			<button class="queue-item cov-item ${o.code === this.covSel ? "selected" : ""}" data-cov="${U.esc(o.code)}">
				<span class="outline-icon">${U.icon("i-target", "xs")}</span>
				<span class="question-copy"><strong>${U.esc(o.code)}</strong>
					<span class="eyebrow">${U.esc(o.label || o.clause || __("No name in register"))}</span></span>
				${o.uses.length
					? U.chip(o.uses.length === 1 ? __("1 question")
												 : __("{0} questions", [o.uses.length]), "ok")
					: U.chip(__("Not reached"), "warn")}
			</button>`).join("");
	}

	_coverageDetail(list) {
		const U = window.UCCMO;
		const o = list.find((x) => x.code === this.covSel)
			|| this._coverageObjectives().find((x) => x.code === this.covSel);
		if (!o) {
			return U.empty(__("Pick an objective to see which questions evidence it."));
		}
		const bySurvey = {};
		o.uses.forEach((u) => {
			const key = u.survey_title || u.survey || __("Unknown survey");
			(bySurvey[key] = bySurvey[key] || []).push(u);
		});
		const groups = Object.keys(bySurvey).sort().map((title) => `
			<div class="cov-group">
				<div class="section-label">${U.esc(title)}</div>
				${bySurvey[title].map((u) => `
					<button class="queue-item cov-use" data-cov-q="${U.esc(u.question)}"
							data-cov-obj="${U.esc(o.code)}" data-cov-ver="${U.esc(u.survey_version)}"
							title="${__("Open this question in Map")}">
						<span class="outline-icon">${U.icon("i-survey", "xs")}</span>
						<span class="question-copy">${U.esc((u.question_text || u.question).slice(0, 90))}
							<span class="eyebrow">${U.esc(u.survey_version)}${
								u.version_number ? " · v" + U.esc(u.version_number) : ""}</span></span>
						${u.survey_version === this.s.surveyVersion
							? U.chip(__("This version"), "") : ""}
					</button>`).join("")}
			</div>`).join("");
		return `
			<div class="cov-detail-head">
				<div>
					<div class="eyebrow">${__("Objective")}</div>
					<h3>${U.esc(o.code)}</h3>
					${o.label ? `<div class="cov-name">${U.esc(o.label)}</div>` : ""}
				</div>
				${o.uses.length ? U.chip(o.uses.length === 1 ? __("Reached by 1 question")
															: __("Reached by {0} questions", [o.uses.length]), "ok")
								: U.chip(__("No question maps to this"), "warn")}
			</div>
			<div class="cov-facts">
				${o.clause ? `<span class="stat"><b>${U.esc(o.clause)}</b> <span>${__("clause / criterion")}</span></span>` : ""}
				${o.detail.status ? `<span class="stat"><b>${U.esc(o.detail.status)}</b> <span>${__("status")}</span></span>` : ""}
				<span class="stat"><b>${o.inSurvey ? __("Yes") : __("No")}</b> <span>${
					__("reached by this survey version")}</span></span>
			</div>
			<div class="cov-actions">
				${U.button({ label: o.uses.length ? __("Map another question to this")
											      : __("Map a question to this objective"),
							 tone: "primary", small: true, icon: "i-link", act: "cov-map" })}
				${U.button({ label: __("Open in register"), small: true, icon: "i-target", act: "cov-register" })}
			</div>
			${o.uses.length ? groups : U.empty(
				__("No question evidences this objective yet, in any survey."))}`;
	}

	_coverageTab() {
		const U = window.UCCMO;
		const c = this.coverage.counts || {};
		const list = this._coverageObjectives();
		const total = (this.masters.objectives || []).length;
		return `<div class="coverage-shell">
			<section class="pane coverage-list">
				<header class="pane-head">
					<div class="pane-title-with-icon">${U.icon("i-target", "sm")}<strong>${
						__("Objective register")}</strong><span class="count">${list.length}/${total}</span></div>
				</header>
				<div class="cov-search"><input type="search" data-cov-search
					placeholder="${__("Search code, name or clause…")}" value="${U.esc(this.covQuery || "")}"></div>
				<div class="pane-body" data-cov-rows>${this._coverageRows(list)}</div>
			</section>
			<section class="pane coverage-detail">
				<header class="pane-head">
					<div class="pane-title-with-icon">${U.icon("i-link", "sm")}<strong>${
						__("Evidence")}</strong></div>
					<span>${__("{0}/{1} questions mapped · {2}/{3} objectives reached by this survey",
						[c.questions_mapped || 0, c.questions || 0,
						 c.objectives_used || 0, c.objectives || 0])}</span>
				</header>
				<div class="pane-body" data-cov-detail>${this._coverageDetail(list)}</div>
			</section>
		</div>`;
	}

	_wire() {
		const $el = this.$el;
		// Namespace-only, not "click.mo": Coverage's search box binds `input.mo`
		// too, and off("click.mo") would leave a second one behind on every
		// redraw.
		$el.off(".mo");
		$el.on("click.mo", "[data-q]", (e) => {
			this.s.question = $(e.currentTarget).data("q");
			this.sel = "question";
			this._draw();
		});
		$el.on("click.mo", '[data-act="collapse-right"]', () => {
			this.rightCollapsed = !this.rightCollapsed;
			this.$el.find(".objective-shell").toggleClass("right-collapsed", !!this.rightCollapsed);
			this._renderNodeEditor();
		});
		// --- Coverage drill-down. Every one of these has markup in
		// _coverageTab; the dead [data-act="go-unmapped"] / [data-objective]
		// pair removed in v0.33.0 did not, which is the whole reason that tab
		// was a wall of unclickable chips.
		$el.on("input.mo", "[data-cov-search]", (e) => {
			this.covQuery = $(e.currentTarget).val();
			// Only the list and the count are redrawn: re-rendering the pane
			// would take the focus and the caret with it on every keystroke.
			const list = this._coverageObjectives();
			$el.find("[data-cov-rows]").html(this._coverageRows(list));
			$el.find(".coverage-list .count").text(
				list.length + "/" + ((this.masters.objectives || []).length));
		});
		$el.on("click.mo", "[data-cov]", (e) => {
			this.covSel = $(e.currentTarget).data("cov");
			$el.find("[data-cov]").removeClass("selected");
			$(e.currentTarget).addClass("selected");
			$el.find("[data-cov-detail]").html(this._coverageDetail(this._coverageObjectives()));
		});
		$el.on("click.mo", "[data-cov-q]", (e) => {
			const $b = $(e.currentTarget);
			this._gotoMap($b.data("cov-obj"), $b.data("cov-q"), $b.data("cov-ver"));
		});
		$el.on("click.mo", '[data-act="cov-map"]', () => this._gotoMap(this.covSel));
		$el.on("click.mo", '[data-act="cov-register"]', () =>
			frappe.set_route("Form", "Survey Objective", this.covSel));
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

	// Coverage -> Map. The tab switch re-renders the workspace from scratch, so
	// the objective travels through app state and `_load` picks it up; setting
	// `this._extra` here would be thrown away with this instance.
	_gotoMap(objective, question, version) {
		if (!objective) return;
		this.s.objectiveFocus = objective;
		// An objective's evidence can live in another survey entirely, which is
		// the point of the cross-survey usage query. Follow it there rather than
		// landing on a question the current version does not contain.
		if (version && version !== this.s.surveyVersion) this.s.surveyVersion = version;
		if (question) this.s.gotoArg = question;
		this.s.objectivesTab = "map";
		this.app.render();
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
				// Bug 1 (2026-08-02). This USED to read
				//     q.objectives = (q.objectives || []).concat([]);
				// which copies the array and appends nothing, so the browsed
				// objective never reached the canvas and the pane kept saying
				// "No objectives in view yet". `_extra` was written here and read
				// nowhere, which is why the dead concat went unnoticed.
				//
				// q.objectives is SERVER state - it means "linked". A browsed
				// objective is not linked yet ("browsing is not committing"), so
				// it is held separately and _focusObjectives shows it as a
				// candidate. Writing it into q.objectives would draw it as
				// already-mapped and be wiped by the next _load() anyway.
				this._extra = v.objective;
				this._draw();
			},
		});
		d.show();
	}

	_link() {
		this.app.call(MAPI + "connect_nodes", { a: "q:" + this.s.question, b: "o:" + this.sel })
			.then((r) => {
				// Three outcomes, not two. A failed call used to be reported as
				// "Already linked" - the same blue toast a genuine no-op gets -
				// because both arrive here with a falsy r. Saying "already done"
				// when nothing happened is what makes a mapping look like it
				// vanished.
				if (!this.app.ok) {
					return this.app.toast(__("Could not link - the server refused. Nothing was saved."), "red");
				}
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
		}).then(() => {
			if (!this.app.ok) {
				return this.app.toast(__("Could not save the mapping - nothing was written."), "red");
			}
			this.app.toast(__("Mapping saved"));
			this._load();
		});
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
			// The Formula Builder edits a LOCAL draft and saves on an explicit
			// action, so a slider drag is not 40 writes. this.nodes stays the
			// server's copy; this.draft is what the screen shows.
			this._resetDraft();
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
				{ value: this.draft.length, label: __("nodes") },
				{ value: this.draft.filter((n) => n.node_type === "Metric").length, label: __("metrics") },
				{ value: this.results.length, label: __("results") },
			], tab === "formula" ? this._balanceMessage() : published ? null : {
				text: __("Draft. Publish this version before results can be calculated — a result must tie to a frozen formula."),
				tone: "warn", icon: "i-warning",
			})}
			<div class="workarea ucc-mo-indices"><div class="index-layout fx-layout" style="${tab === "formula" ? "" : "grid-template-columns:1fr"}">
				<section class="pane"><header class="pane-head">
					<div class="pane-title-with-icon">${U.icon("i-index", "sm")}<strong>${
						tab === "formula" ? __("Formula") : tab === "calculate" ? __("Calculate") : __("Results")}</strong></div>
				</header><div class="pane-body">${
					tab === "formula" ? this._formula() :
					tab === "calculate" ? this._calculate() : this._results()}</div></section>
				${tab === "formula" ? `<div class="formula-inspector" data-node-editor></div>` : ""}
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

	// ======================================================= FORMULA BUILDER ===
	// The node canvas is gone as the primary editor. An index formula is a
	// weighted composition - Metrics -> Index, or Metrics -> Dimension -> Index -
	// and a graph spent the pane on connector lines all converging into one node
	// while answering none of the questions actually asked of it: which metrics
	// are in, what each contributes, whether it totals 100, what is broken.
	//
	// The presentation adapts to the SHAPE of the formula rather than offering a
	// mode switch nobody should have to think about:
	//   flat metrics        -> weighted table
	//   any Dimension node  -> expandable hierarchy
	//   one metric at 100%  -> single-metric card
	// "Allocate" is a second VIEW of the same draft, not a second data model.
	//
	// Weights are Percent (0-100) on UCC Index Node, so they are edited as
	// percentages with whatever precision the field carries - no forced 5% steps.

	// Leaving with unsaved weights loses them silently otherwise. One guard, on
	// the two ways out of this pane: the browser, and switching index version.
	_guardUnsaved(go) {
		if (!this.dirty) return go();
		frappe.confirm(__("This formula has unsaved changes. Leave without saving?"), go);
	}

	_resetDraft() {
		this.draft = (this.nodes || []).map((n) => Object.assign({}, n));
		this.dirty = false;
		// The browser's own guard, so a reload or a closed tab is not a silent
		// loss. Registered once; it reads this.dirty live.
		if (!this._unloadGuard) {
			this._unloadGuard = (e) => {
				if (!this.dirty) return;
				e.preventDefault();
				e.returnValue = "";
			};
			window.addEventListener("beforeunload", this._unloadGuard);
		}
		this.expanded = this.expanded || new Set();
		this.locked = this.locked || new Set();
		this.fxView = this.fxView || "formula";
	}

	_root() { return this.draft.find((n) => !n.parent_key); }
	_kids(key) { return this.draft.filter((n) => (n.parent_key || "") === (key || "")); }
	_node(key) { return this.draft.find((n) => n.node_key === key); }
	_topLevel() { const r = this._root(); return r ? this._kids(r.node_key) : this._kids(""); }
	_hasDimensions() { return this.draft.some((n) => n.node_type === "Dimension"); }

	_isSingleMetric() {
		const top = this._topLevel();
		return top.length === 1 && top[0].node_type === "Metric" && (top[0].weight || 0) === 100
			&& !this._kids(top[0].node_key).length;
	}

	// Mirror of index_engine.effective_weights. PREVIEW ONLY - validate_index
	// returns the authoritative map and the server recomputes it before saving,
	// publishing or calculating.
	_effective() {
		const out = {};
		const walk = (key, share) => {
			const kids = this._kids(key);
			const total = kids.reduce((s, k) => s + (k.weight || 0), 0);
			kids.forEach((k) => {
				const v = total ? share * ((k.weight || 0) / total) : 0;
				out[k.node_key] = v;
				walk(k.node_key, v);
			});
		};
		const r = this._root();
		if (r) { out[r.node_key] = 100; walk(r.node_key, 100); }
		return out;
	}

	_metricFact(code) {
		return ((this.builder && this.builder.metrics) || []).find((m) => m.name === code) || null;
	}

	// One component's state, as a word first and a colour second.
	_statusFor(n) {
		if (n.node_type === "Dimension") {
			const kids = this._kids(n.node_key);
			if (!kids.length) return { tone: "attention", label: __("No metrics") };
			const total = kids.reduce((s, k) => s + (k.weight || 0), 0);
			if (Math.abs(total - 100) > 1e-6) {
				return { tone: "invalid", label: __("Children {0}%", [this._pct(total)]) };
			}
		}
		if (!n.parent_key) return { tone: "ready", label: __("Index") };
		if (n.node_type === "Metric" && !n.source_metric) {
			return { tone: "invalid", label: __("No metric") };
		}
		if (!(n.weight || 0)) return { tone: "attention", label: __("Weight required") };
		const fact = n.source_metric && this._metricFact(n.source_metric);
		if (n.source_metric && !fact) return { tone: "invalid", label: __("Metric missing") };
		if (fact && !fact.source_count) return { tone: "attention", label: __("No source data") };
		return { tone: "ready", label: __("Ready") };
	}

	_pct(v) {
		const n = Math.round((v || 0) * 100) / 100;
		return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
	}

	_totalTop() { return this._topLevel().reduce((s, n) => s + (n.weight || 0), 0); }

	_balanceMessage() {
		const total = this._totalTop();
		if (!this._topLevel().length) {
			return { text: __("This formula has no components yet. Add a metric to begin."), tone: "warn", icon: "i-warning" };
		}
		const off = Math.round((total - 100) * 100) / 100;
		if (off === 0) {
			const problems = this._componentProblems();
			return problems.length
				? { text: __("Weights balance at 100%, but {0} component(s) need attention.", [problems.length]),
					tone: "warn", icon: "i-warning" }
				: { text: __("Formula is balanced and ready for validation."), tone: "", icon: "i-check" };
		}
		return off < 0
			? { text: __("{0}% remains unallocated.", [this._pct(-off)]), tone: "warn", icon: "i-warning" }
			: { text: __("Formula is overallocated by {0}%.", [this._pct(off)]), tone: "warn", icon: "i-warning" };
	}

	// Client-side preview of api.index_studio.validate_index's `problems`. The
	// server list is what Validate shows; this drives the row badges live while
	// editing, which is the whole point of a draft.
	_componentProblems() {
		const out = [];
		this.draft.forEach((n) => {
			if (!n.parent_key) return;
			const st = this._statusFor(n);
			if (st.tone !== "ready") out.push({ key: n.node_key, label: n.label || n.node_key, message: st.label });
		});
		return out;
	}

	_formula() {
		const U = window.UCCMO;
		if (!this.draft.length) {
			return `<div class="fx-main">${U.empty(
				__("This index version has no components yet."),
				this.editable ? { label: __("Add metric"), tone: "primary", act: "fx-add-metric" } : null)}</div>`;
		}
		const body = this.fxView === "allocate" ? this._allocationView()
			: this._isSingleMetric() ? this._singleMetricView()
			: this._hasDimensions() ? this._hierarchyView() : this._flatView();
		return `<div class="fx-main" style="position:relative">
			${this.editable ? "" : `<div class="review-banner">${U.icon("i-lock", "xs")}<span>${
				__("This index version is published and protected. Create a new version to change its formula.")
			}</span>${U.button({ label: __("Create new version"), small: true, tone: "primary", act: "fx-new-version" })}</div>`}
			${this._summaryStrip()}
			${this._compositionBar()}
			<div class="formula-scroll" data-formula-scroll>${body}</div>
			${this._drawer ? this._addMetricDrawer() : ""}
		</div>`;
	}

	_summaryStrip() {
		const U = window.UCCMO;
		const top = this._topLevel();
		const components = this.draft.filter((n) => n.parent_key).length;
		const problems = this._componentProblems();
		const total = this._totalTop();
		const tone = Math.abs(total - 100) < 1e-6 ? "ok" : "warn";
		const item = (label, value, cls) => `<div class="sum-item">
			<span class="sum-label">${label}</span>
			<span class="sum-value ${cls || ""}" ${cls ? 'aria-live="polite"' : ""}>${value}</span></div>`;
		return `<div class="formula-summary">
			${item(__("Components"), components)}
			${item(__("Total weight"), this._pct(total) + "%", tone)}
			${item(__("Ready"), components - problems.length, "ok")}
			${item(__("Need attention"), problems.length, problems.length ? "warn" : "")}
			<span class="spacer"></span>
			${this.dirty ? `<span class="eyebrow"><span class="unsaved-dot"></span>${__("Unsaved changes")}</span>` : ""}
			<span class="segmented" role="tablist" aria-label="${__("Formula view")}">
				${["formula", "allocate"].map((k) => `<button type="button" role="tab" class="${
					this.fxView === k ? "active" : ""}" data-fx-view="${k}" aria-selected="${
					this.fxView === k ? "true" : "false"}">${
					k === "formula" ? __("Formula") : __("Allocate")}</button>`).join("")}
			</span>
			${this.editable ? U.button({ label: __("Add metric"), small: true, tone: "primary", icon: "i-plus", act: "fx-add-metric" }) : ""}
			${this.editable ? U.button({ label: __("Add dimension"), small: true, icon: "i-plus", act: "fx-add-dimension" }) : ""}
			${this.editable ? U.button({ label: __("Save formula"), small: true, tone: this.dirty ? "primary" : "", icon: "i-save", act: "fx-save" }) : ""}
		</div>`;
	}

	// One segment per TOP-LEVEL component: for a flat formula that is each
	// metric, for a granular one each dimension. Segments are buttons, not
	// decorative divs - they select, and they are reachable by keyboard.
	_compositionBar() {
		const U = window.UCCMO;
		const top = this._topLevel();
		const total = this._totalTop();
		const shown = Math.min(total, 100);
		const palette = ["#2859d9", "#6941c6", "#0b7285", "#087a52", "#9d5c00", "#8f4bb8", "#3f6fd8", "#1f7a6a"];
		const segs = top.map((n, i) => {
			const w = n.weight || 0;
			if (!w) return "";
			const pctOfBar = (w / Math.max(total, 100)) * 100;
			const name = n.label || n.node_key;
			return `<button type="button" class="composition-segment ${this.sel === n.node_key ? "selected" : ""}"
				style="width:${pctOfBar}%;background:${palette[i % palette.length]}"
				data-segment="${U.esc(n.node_key)}"
				title="${U.esc(name)} — ${this._pct(w)}%"
				aria-label="${U.esc(name)}, ${this._pct(w)}%">${pctOfBar > 9 ? U.esc(name) : ""}${
					pctOfBar > 16 ? " · " + this._pct(w) + "%" : ""}</button>`;
		}).join("");
		const rest = total < 100
			? `<span class="composition-rest">${__("{0}% unallocated", [this._pct(100 - total)])}</span>` : "";
		return `<div class="composition-bar" role="group" aria-label="${__("Weight composition")}">${segs}${rest}</div>`;
	}

	_headRow(withSources) {
		return `<div class="formula-head">
			<span></span><span>${__("Component")}</span>${withSources ? `<span>${__("Sources")}</span>` : ""}
			<span>${__("Weight")}</span><span style="text-align:right">${__("Effective")}</span>
			<span>${__("Status")}</span><span style="text-align:right">${__("Actions")}</span></div>`;
	}

	_flatView() {
		const eff = this._effective();
		return this._headRow(true)
			+ this._topLevel().map((n, i, arr) => this._componentRow(n, eff, i, arr.length)).join("");
	}

	_componentRow(n, eff, i, count) {
		const U = window.UCCMO;
		const st = this._statusFor(n);
		const fact = n.source_metric && this._metricFact(n.source_metric);
		return `<div class="formula-row ${this.sel === n.node_key ? "selected" : ""}" data-component="${U.esc(n.node_key)}">
			<span class="fx-grip" aria-hidden="true">⠿</span>
			<div class="fx-name">
				<div class="fx-title">${U.esc(n.label || n.node_key)}</div>
				<div class="fx-code">${U.esc(n.source_metric || n.node_type)}</div>
			</div>
			<div class="fx-count">${fact ? fact.source_count : "—"}</div>
			${this._weightEditor(n)}
			<div class="fx-effective">${this._pct(eff[n.node_key])}%</div>
			<div><span class="fx-status ${st.tone}">${st.label}</span></div>
			<div class="fx-actions">
				${U.button({ label: "↑", small: true, act: "fx-up", disabled: !this.editable || i === 0, title: __("Move up") })}
				${U.button({ label: "↓", small: true, act: "fx-down", disabled: !this.editable || i === count - 1, title: __("Move down") })}
				${U.button({ label: "×", small: true, act: "fx-remove", disabled: !this.editable, title: __("Remove from index") })}
			</div>
		</div>`;
	}

	_weightEditor(n) {
		const U = window.UCCMO;
		const w = n.weight || 0;
		const name = U.esc(n.label || n.node_key);
		if (!this.editable) {
			return `<div class="weight-editor"><b>${this._pct(w)}</b><span class="pct">%</span></div>`;
		}
		return `<div class="weight-editor">
			<input type="range" min="0" max="100" step="0.5" value="${w}"
				data-weight="${U.esc(n.node_key)}" aria-label="${__("Weight for {0}, percent", [name])}">
			<input type="number" class="weight-num" min="0" max="100" step="0.01" value="${this._pct(w)}"
				data-weight-num="${U.esc(n.node_key)}" aria-label="${__("Weight for {0}, percent", [name])}">
			<span class="pct">%</span>
		</div>`;
	}

	_hierarchyView() {
		const U = window.UCCMO;
		const eff = this._effective();
		const top = this._topLevel();
		return top.map((n, i) => {
			if (n.node_type !== "Dimension") return this._componentRow(n, eff, i, top.length);
			const kids = this._kids(n.node_key);
			const childTotal = kids.reduce((s, k) => s + (k.weight || 0), 0);
			const open = this.expanded.has(n.node_key);
			const st = this._statusFor(n);
			return `<div class="dimension-row ${this.sel === n.node_key ? "selected" : ""}">
				<button type="button" class="dimension-head" data-dimension="${U.esc(n.node_key)}"
						aria-expanded="${open ? "true" : "false"}">
					<span class="dim-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
					<div class="fx-name">
						<div class="fx-title">${U.esc(n.label || n.node_key)}</div>
						<div class="fx-code">${__("{0} metric(s) · children total {1}%", [kids.length, this._pct(childTotal)])}</div>
					</div>
					<div class="fx-count">${this._pct(n.weight || 0)}%</div>
					<div class="fx-effective">${this._pct(eff[n.node_key])}%</div>
					<div><span class="fx-status ${st.tone}">${st.label}</span></div>
					<div class="fx-actions"></div>
				</button>
				${open ? `<div class="dimension-children">${this._headRow(true)}${
					kids.map((k, j) => this._componentRow(k, eff, j, kids.length)).join("")
					|| `<div class="fx-note">${__("No metrics in this dimension yet.")}</div>`}</div>` : ""}
			</div>`;
		}).join("");
	}

	_singleMetricView() {
		const U = window.UCCMO;
		const n = this._topLevel()[0];
		const fact = n.source_metric && this._metricFact(n.source_metric);
		const st = this._statusFor(n);
		return `<div class="single-metric" data-component="${U.esc(n.node_key)}">
			<div class="sm-eyebrow">${__("Formula")}</div>
			<div class="sm-metric">${U.esc(n.label || n.node_key)}</div>
			<div class="fx-code">${U.esc(n.source_metric || __("no metric attached"))}${
				fact ? " · " + __("{0} source question(s)", [fact.source_count]) : ""}</div>
			<div class="sm-weight">${__("100% of this index")}</div>
			<div><span class="fx-status ${st.tone}" style="margin-top:8px">${st.label}</span></div>
			<p class="sm-help">${__("This Index is calculated entirely from one Metric.")}</p>
			<div class="sm-actions">
				${this.editable ? U.button({ label: __("Change metric"), small: true, act: "fx-change-metric" }) : ""}
				${U.button({ label: __("Open metric"), small: true, act: "goto-metric" })}
				${this.editable ? U.button({ label: __("Convert to multi-metric formula"), small: true, tone: "primary", act: "fx-add-metric" }) : ""}
			</div>
		</div>`;
	}

	// Allocation edits the SAME draft: no second data model, no second save path.
	_allocationView() {
		const U = window.UCCMO;
		const eff = this._effective();
		const total = this._totalTop();
		const top = this._topLevel();
		const lanes = top.map((n) => {
			const w = n.weight || 0;
			const st = this._statusFor(n);
			const locked = this.locked.has(n.node_key);
			return `<div class="allocation-lane ${this.sel === n.node_key ? "selected" : ""}" data-component="${U.esc(n.node_key)}">
				<div class="lane-name">
					<div class="fx-title">${U.esc(n.label || n.node_key)}</div>
					<div class="fx-code">${U.esc(n.source_metric || n.node_type)} · ${
						__("effective {0}%", [this._pct(eff[n.node_key])])}</div>
				</div>
				<button type="button" class="lane-step" data-step="-1" data-key="${U.esc(n.node_key)}"
					aria-label="${__("Decrease weight for {0}", [U.esc(n.label || n.node_key)])}" ${
					this.editable && !locked ? "" : "disabled"}>−</button>
				<input type="number" class="weight-num" min="0" max="100" step="0.01" value="${this._pct(w)}"
					data-weight-num="${U.esc(n.node_key)}" ${this.editable && !locked ? "" : "disabled"}
					aria-label="${__("Weight for {0}, percent", [U.esc(n.label || n.node_key)])}">
				<button type="button" class="lane-step" data-step="1" data-key="${U.esc(n.node_key)}"
					aria-label="${__("Increase weight for {0}", [U.esc(n.label || n.node_key)])}" ${
					this.editable && !locked ? "" : "disabled"}>+</button>
				<div><span class="fx-status ${st.tone}">${st.label}</span></div>
				<button type="button" class="lane-lock ${locked ? "on" : ""}" data-lock="${U.esc(n.node_key)}"
					aria-pressed="${locked ? "true" : "false"}"
					title="${__("Lock this weight during auto-balance")}">${locked ? "🔒" : "🔓"}</button>
				<div class="lane-bar"><div class="lane-fill" style="width:${Math.min(100, w)}%"></div></div>
			</div>`;
		}).join("");
		const msg = Math.abs(total - 100) < 1e-6 ? __("Balanced at 100%")
			: total < 100 ? __("{0}% allocated, {1}% remaining", [this._pct(total), this._pct(100 - total)])
			: __("{0}% allocated, reduce by {1}%", [this._pct(total), this._pct(total - 100)]);
		return `<div class="fx-note" aria-live="polite" style="margin-bottom:8px">${msg}</div>
			${this.editable ? U.button({ label: __("Auto-balance"), small: true, act: "fx-balance" }) : ""}
			<div style="margin-top:8px">${lanes}</div>`;
	}

	// ---- editing -----------------------------------------------------------

	_setWeight(key, value) {
		const n = this._node(key);
		if (!n || !this.editable) return;
		const v = Math.max(0, Math.min(100, parseFloat(value) || 0));
		if (n.weight === v) return;
		n.weight = v;
		this.dirty = true;
		this._refreshNumbers();
	}

	// Patch the numbers in place rather than re-rendering: a full redraw on every
	// slider step would drop focus mid-drag and lose the caret while typing.
	_refreshNumbers() {
		const eff = this._effective();
		const U = window.UCCMO;
		this.$el.find("[data-component]").each((_, el) => {
			const k = el.getAttribute("data-component");
			$(el).find(".fx-effective").text(this._pct(eff[k]) + "%");
			$(el).find(".lane-fill").css("width", Math.min(100, this._node(k) ? (this._node(k).weight || 0) : 0) + "%");
			const st = this._statusFor(this._node(k) || {});
			$(el).find(".fx-status").attr("class", "fx-status " + st.tone).text(st.label);
		});
		// The summary, composition bar and status strip all read the same totals.
		this.$el.find(".formula-summary").replaceWith(this._summaryStrip());
		this.$el.find(".composition-bar").replaceWith(this._compositionBar());
		const msg = this._balanceMessage();
		this.$el.find(".status-message").attr("class", "status-message " + (msg.tone || ""))
			.html(U.icon(msg.icon, "xs") + U.esc(msg.text));
		this._renderEditor();
	}

	_selectComponent(key) {
		this.sel = key;
		this.$el.find(".formula-row, .dimension-row, .allocation-lane").removeClass("selected");
		this.$el.find(`[data-component="${key}"]`).addClass("selected").closest(".dimension-row").addClass("selected");
		this.$el.find(".composition-segment").removeClass("selected");
		this.$el.find(`[data-segment="${key}"]`).addClass("selected");
		const row = this.$el.find(`[data-component="${key}"]`).get(0);
		if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
		this._renderEditor();
	}

	_move(key, dir) {
		const n = this._node(key);
		if (!n || !this.editable) return;
		const sibs = this._kids(n.parent_key || "");
		const at = sibs.indexOf(n);
		const to = at + dir;
		if (to < 0 || to >= sibs.length) return;
		// Order is the child-table row order save_nodes writes; it is display and
		// evidence order only - compute_index never reads it.
		const a = this.draft.indexOf(sibs[at]);
		const b = this.draft.indexOf(sibs[to]);
		this.draft.splice(b, 0, this.draft.splice(a, 1)[0]);
		this.dirty = true;
		this._draw();
	}

	_removeComponent(key) {
		const n = this._node(key);
		if (!n || !this.editable) return;
		const kids = this._kids(key);
		const ask = kids.length
			? __("Remove {0} and its {1} child metric(s) from this formula? The metrics themselves are not deleted - only their place in this index.", [n.label || key, kids.length])
			: __("Remove {0} from this formula? The metric itself is not deleted.", [n.label || key]);
		frappe.confirm(ask, () => {
			const doomed = new Set([key]);
			let grew = true;
			while (grew) {
				grew = false;
				this.draft.forEach((x) => {
					if (x.parent_key && doomed.has(x.parent_key) && !doomed.has(x.node_key)) {
						doomed.add(x.node_key); grew = true;
					}
				});
			}
			this.draft = this.draft.filter((x) => !doomed.has(x.node_key));
			this.sel = null;
			this.dirty = true;
			this._draw();
		});
	}

	_stepWeight(key, dir) {
		const n = this._node(key);
		if (!n) return;
		this._setWeight(key, (n.weight || 0) + dir * 5);
		this.$el.find(`[data-weight-num="${key}"]`).val(this._pct(this._node(key).weight));
		this.$el.find(`[data-weight="${key}"]`).val(this._node(key).weight);
	}

	_autoBalance() {
		const top = this._topLevel();
		if (!top.length) return;
		const locked = top.filter((n) => this.locked.has(n.node_key));
		const free = top.filter((n) => !this.locked.has(n.node_key));
		if (!free.length) {
			return frappe.msgprint(__("Every component is locked. Unlock at least one to balance."));
		}
		const lockedTotal = locked.reduce((s, n) => s + (n.weight || 0), 0);
		const remaining = 100 - lockedTotal;
		if (remaining < 0) {
			return frappe.msgprint(__("Locked weights already total {0}%. Unlock or reduce one before balancing.", [this._pct(lockedTotal)]));
		}
		const share = Math.round((remaining / free.length) * 100) / 100;
		const preview = free.map((n) => `${n.label || n.node_key}: ${this._pct(n.weight || 0)}% → ${this._pct(share)}%`).join("<br>");
		// Never silently overwrite: show exactly what changes first.
		frappe.confirm(
			__("Distribute {0}% equally across {1} unlocked component(s)?", [this._pct(remaining), free.length])
			+ (locked.length ? "<br><br><b>" + __("Kept:") + "</b><br>"
				+ locked.map((n) => `${n.label || n.node_key}: ${this._pct(n.weight || 0)}%`).join("<br>") : "")
			+ "<br><br><b>" + __("Changes:") + "</b><br>" + preview,
			() => {
				free.forEach((n) => { n.weight = share; });
				// Absorb the rounding remainder on the last free lane so the total
				// is exactly 100 rather than 99.99.
				const drift = 100 - this._totalTop();
				if (Math.abs(drift) > 1e-9) free[free.length - 1].weight = Math.round((free[free.length - 1].weight + drift) * 100) / 100;
				this.dirty = true;
				this._draw();
			});
	}

	// ---- add metric / add dimension ----------------------------------------
	//
	// BACKEND RULES this drawer enforces, all confirmed against the real model:
	//   * The same metric MAY appear under different dimensions - nothing forbids
	//     it and it is meaningful (one metric feeding two dimensions). Under the
	//     SAME parent it is a duplicate, which validate_index reports as an error,
	//     so the drawer refuses it there.
	//   * A metric may be consumed by any number of indices: source_metric is a
	//     plain Link and `used_by` counts them.
	//   * UCC Metric Definition has NO status field, so there is no published /
	//     draft distinction to gate on. The real gate is `source_count` - a metric
	//     with no source questions scores nothing - and that is shown, not blocked.
	// Duplicates are detected on the metric CODE (the docname), never the label.

	_openAddMetric() {
		this._drawer = { parent: this._dimensionParent() };
		this._picked = new Set();
		this._drawerSearch = "";
		this._draw();
	}

	// Where a new metric lands: inside the selected dimension if one is selected,
	// otherwise directly under the index root.
	_dimensionParent() {
		const sel = this.sel && this._node(this.sel);
		if (sel && sel.node_type === "Dimension") return sel.node_key;
		if (sel && sel.parent_key) {
			const p = this._node(sel.parent_key);
			if (p && p.node_type === "Dimension") return p.node_key;
		}
		const root = this._root();
		return root ? root.node_key : "";
	}

	_addMetricDrawer() {
		const U = window.UCCMO;
		const parentKey = this._drawer.parent;
		const parent = this._node(parentKey);
		const siblings = new Set(this._kids(parentKey).map((n) => n.source_metric).filter(Boolean));
		const q = (this._drawerSearch || "").toLowerCase();
		const rows = ((this.builder && this.builder.metrics) || []).filter((m) =>
			!q || (m.name + " " + (m.metric_name || "")).toLowerCase().indexOf(q) !== -1);
		return `<aside class="fx-drawer" role="dialog" aria-label="${__("Add metrics to the formula")}">
			<header class="pane-head">
				<div class="pane-title-with-icon">${U.icon("i-metric", "sm")}<strong>${__("Add metric")}</strong>
					<span class="count">${__("into {0}", [U.esc(parent && parent.node_type === "Dimension"
						? (parent.label || parentKey) : __("the index"))])}</span></div>
				${U.button({ label: "×", small: true, act: "fx-close-drawer", title: __("Close") })}
			</header>
			<div class="add-search" style="margin:8px 12px 0">${U.icon("i-search", "sm")}
				<input type="text" data-metric-search placeholder="${__("Search metrics…")}"
					value="${U.esc(this._drawerSearch || "")}" aria-label="${__("Search metrics")}"></div>
			<div class="drawer-scroll">${rows.length ? rows.map((m) => {
				const already = siblings.has(m.name);
				const picked = this._picked.has(m.name);
				return `<div class="drawer-metric ${already ? "disabled" : ""} ${picked ? "picked" : ""}"
						data-pick-metric="${U.esc(m.name)}" role="checkbox"
						aria-checked="${picked ? "true" : "false"}" aria-disabled="${already ? "true" : "false"}">
					<span>${already ? "✓" : picked ? "☑" : "☐"}</span>
					<div style="min-width:0">
						<div class="fx-title">${U.esc(m.metric_name || m.name)}</div>
						<div class="fx-code">${U.esc(m.name)} · ${__("{0} source question(s)", [m.source_count])}${
							m.effective_normalisation ? " · " + U.esc(m.effective_normalisation) : ""}</div>
					</div>
					<span class="fx-status ${already ? "ready" : m.source_count ? "ready" : "attention"}">${
						already ? __("Already included") : m.source_count ? __("Available") : __("No sources")}</span>
				</div>`;
			}).join("") : U.empty(__("No metrics match that search."))}</div>
			<footer class="pane-foot" style="padding:8px 12px">
				${U.button({ label: __("Add {0} metric(s)", [this._picked.size]), tone: "primary",
							 small: true, act: "fx-confirm-metrics", disabled: !this._picked.size })}
				${U.button({ label: __("Cancel"), small: true, act: "fx-close-drawer" })}
			</footer>
		</aside>`;
	}

	_confirmAddMetrics() {
		const parentKey = this._drawer.parent;
		let last = null;
		this._picked.forEach((code) => {
			// Keys must be unique across the version: save_nodes replaces the whole
			// child table, so a collision silently drops a node.
			let key = (parentKey + "_" + code).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
			let i = 1;
			while (this.draft.some((n) => n.node_key === key)) key = key + "_" + (++i);
			const meta = this._metricFact(code);
			this.draft.push({
				node_key: key, node_type: "Metric", parent_key: parentKey,
				label: (meta && meta.metric_name) || code, source_metric: code,
				// 0% deliberately: silently rebalancing everyone else's weights to
				// make room is not something an editor should do behind your back.
				weight: 0,
			});
			last = key;
		});
		this._drawer = null;
		this._picked = new Set();
		this.dirty = true;
		this.sel = last;
		this._draw();
	}

	_addDimension() {
		const root = this._root();
		if (!root) return frappe.msgprint(__("This version has no index node to add a dimension to."));
		const d = new frappe.ui.Dialog({
			title: __("Add a dimension"),
			fields: [
				{ fieldname: "label", fieldtype: "Data", label: __("Dimension name"), reqd: 1 },
				{ fieldname: "code", fieldtype: "Data", label: __("Code"),
				  description: __("Optional. Used as the node key; generated from the name if left blank.") },
				{ fieldname: "weight", fieldtype: "Percent", label: __("Weight in index (%)"), default: 0 },
			],
			primary_action_label: __("Add dimension"),
			primary_action: (v) => {
				d.hide();
				let key = (v.code || v.label).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
				let i = 1;
				while (this.draft.some((n) => n.node_key === key)) key = key + "_" + (++i);
				this.draft.push({
					node_key: key, node_type: "Dimension", parent_key: root.node_key,
					label: v.label, weight: v.weight || 0, source_metric: null,
				});
				this.expanded.add(key);
				this.sel = key;
				this.dirty = true;
				this._draw();
			},
		});
		d.show();
	}

	// ---- persistence -------------------------------------------------------

	_saveFormula() {
		if (!this.editable) return;
		this.app.call(IAPI + "save_nodes", {
			index_version: this.s.indexVersion, nodes: JSON.stringify(this.draft),
		}).then(() => {
			if (!this.app.ok) {
				return this.app.toast(__("The server refused the formula - nothing was saved."), "red");
			}
			this.dirty = false;
			this.app.toast(__("Formula saved"));
			// Reload rather than trust the local copy: the server is the canonical
			// shape, and save_nodes may normalise what it stored.
			this._load();
		});
	}

	_newVersion() {
		this.app.call(IAPI + "new_version_from", { index_version: this.s.indexVersion }).then((name) => {
			if (!this.app.ok || !name) {
				return this.app.toast(__("Could not create a new version."), "red");
			}
			this.app.toast(__("Created {0}", [name]));
			this.s.indexVersion = name;
			this.render();
		});
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

	// The inspector reflects whatever is selected: the index itself, a dimension,
	// or one metric component. It never edits a metric's own sources or
	// normalisation - those belong to the Metrics workspace, and duplicating them
	// here would be a second place to change one fact.
	_renderEditor() {
		const U = window.UCCMO;
		const $slot = this.$el.find("[data-node-editor]");
		if (!$slot.length) return;
		const n = this.sel && this._node(this.sel);
		if (!n) return $slot.html(this._indexInspector());
		return $slot.html(n.node_type === "Dimension" ? this._dimensionInspector(n) : this._metricInspector(n));
	}

	_facts(pairs) {
		const U = window.UCCMO;
		return `<div class="insp-facts">${pairs.map(([k, v, cls]) =>
			`<div><div class="k">${k}</div><div class="v ${cls || ""}">${v}</div></div>`).join("")}</div>`;
	}

	_indexInspector() {
		const U = window.UCCMO;
		const b = this.builder || {};
		const total = this._totalTop();
		const problems = this._componentProblems();
		const balanced = Math.abs(total - 100) < 1e-6;
		return U.inspector({
			title: b.index || __("Index"), icon: "i-index",
			body: this._facts([
				[__("Index code"), U.esc(b.index || "—")],
				[__("Version"), U.esc(b.name || "—")],
				[__("Status"), U.esc(b.status || "—")],
				[__("Formula type"), this._isSingleMetric() ? __("Single metric")
					: this._hasDimensions() ? __("Dimension hierarchy") : __("Flat weighted")],
				[__("Components"), this.draft.filter((x) => x.parent_key).length],
				[__("Total weight"), this._pct(total) + "%", balanced ? "" : "purple"],
			])
			+ `<div class="help">${balanced && !problems.length
				? __("Balanced and ready for validation.")
				: __("{0} component(s) need attention. Validate for the server's full list.", [problems.length || 1])}</div>`
			+ (problems.length ? `<div class="section-label">${__("Needs attention")}</div>`
				+ problems.map((p) => `<button type="button" class="problem-jump" data-component-jump="${U.esc(p.key)}">
					<b>${U.esc(p.label)}</b><span>${U.esc(p.message)}</span></button>`).join("") : ""),
			footer: this.editable
				? U.footerActions([
					{ label: __("Save formula"), tone: "primary", icon: "i-save", act: "fx-save" },
					{ label: __("Validate"), icon: "i-check", act: "validate" },
				])
				: U.footerActions([{ label: __("Create new version"), tone: "primary", icon: "i-plus", act: "fx-new-version" }]),
		});
	}

	_dimensionInspector(n) {
		const U = window.UCCMO;
		const kids = this._kids(n.node_key);
		const childTotal = kids.reduce((s, k) => s + (k.weight || 0), 0);
		const eff = this._effective();
		return U.inspector({
			title: n.label || n.node_key, icon: "i-index",
			body: U.field({ label: __("Dimension name"), name: "label", value: n.label, locked: !this.editable })
				+ U.field({ label: __("Weight in index (%)"), name: "weight", type: "number",
							value: n.weight, locked: !this.editable })
				+ this._facts([
					[__("Code"), U.esc(n.node_key)],
					[__("Child metrics"), kids.length],
					[__("Child weight total"), this._pct(childTotal) + "%",
					 Math.abs(childTotal - 100) < 1e-6 ? "" : "purple"],
					[__("Effective contribution"), this._pct(eff[n.node_key]) + "%", "purple"],
				])
				+ (Math.abs(childTotal - 100) > 1e-6 && kids.length
					? `<div class="published-lock-row"><b>${__("Child weights total {0}%", [this._pct(childTotal)])}</b><br>${
						__("Allocate the remaining {0}%. A balanced index total does not make this valid.", [this._pct(100 - childTotal)])}</div>`
					: ""),
			footer: this.editable
				? U.footerActions([
					{ label: __("Apply"), tone: "primary", icon: "i-save", act: "fx-apply-node" },
					{ label: __("Add child metric"), icon: "i-plus", act: "fx-add-metric" },
					{ label: __("Remove dimension"), icon: "i-trash", act: "fx-remove-selected" },
				])
				: "",
		});
	}

	_metricInspector(n) {
		const U = window.UCCMO;
		const eff = this._effective();
		const fact = n.source_metric && this._metricFact(n.source_metric);
		const trace = n.source_metric && this.sources[n.source_metric];
		const parent = n.parent_key && this._node(n.parent_key);
		const st = this._statusFor(n);
		return U.inspector({
			title: n.label || n.node_key, icon: "i-metric",
			body: U.field({ label: __("Label"), name: "label", value: n.label, locked: !this.editable })
				+ U.field({ label: __("Weight in parent (%)"), name: "weight", type: "number",
							value: n.weight, locked: !this.editable })
				+ this._facts([
					[__("Metric code"), U.esc(n.source_metric || "—")],
					[__("Effective in index"), this._pct(eff[n.node_key]) + "%", "purple"],
					[__("Source questions"), fact ? fact.source_count : "—"],
					[__("Normalisation"), U.esc((fact && fact.effective_normalisation) || "—")],
					[__("Parent"), U.esc(parent && parent.node_type === "Dimension" ? (parent.label || parent.node_key) : __("Index"))],
					[__("Status"), `<span class="fx-status ${st.tone}">${st.label}</span>`],
				])
				+ (trace && trace.questions.length
					? `<div class="section-label">${__("Fed by {0} question(s)", [trace.questions.length])}</div>${this._byVersion(trace)}`
					: `<div class="published-lock-row"><b>${__("Nothing feeds this node")}</b><br>${
						__("This metric has no survey questions as sources, so it will score nothing.")}</div>`)
				+ `<div class="help">${__("Objectives are never part of the formula. They travel with the result as evidence lineage.")}</div>`,
			footer: this.editable
				? U.footerActions([
					{ label: __("Apply"), tone: "primary", icon: "i-save", act: "fx-apply-node" },
					{ label: __("Open metric"), icon: "i-metric", act: "goto-metric" },
					{ label: __("Remove"), icon: "i-trash", act: "fx-remove-selected" },
				])
				: U.footerActions([{ label: __("Open metric"), icon: "i-metric", act: "goto-metric" }]),
		});
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
		// --- selection -----------------------------------------------------
		$el.on("click.mo", "[data-component]", (e) => {
			if ($(e.target).closest("input, button.lane-step, .lane-lock, .fx-actions").length) return;
			this._selectComponent($(e.currentTarget).data("component"));
		});
		$el.on("click.mo", "[data-segment]", (e) =>
			this._selectComponent($(e.currentTarget).data("segment")));
		$el.on("click.mo", "[data-component-jump]", (e) =>
			this._selectComponent($(e.currentTarget).data("component-jump")));
		$el.on("click.mo", "[data-dimension]", (e) => {
			const k = $(e.currentTarget).data("dimension");
			if (this.expanded.has(k)) this.expanded.delete(k); else this.expanded.add(k);
			this.sel = k;
			this._draw();
		});

		// --- view toggle ---------------------------------------------------
		$el.on("click.mo", "[data-fx-view]", (e) => {
			// Same draft, different presentation. Nothing is saved or reloaded.
			this.fxView = $(e.currentTarget).data("fx-view");
			this._draw();
		});

		// --- weight editing ------------------------------------------------
		// `input` for the slider so the numbers move with the thumb; `change` for
		// the numeric box so a half-typed "1" is not read as 1%.
		$el.on("input.mo", "[data-weight]", (e) => {
			const k = $(e.currentTarget).data("weight");
			this._setWeight(k, e.currentTarget.value);
			$el.find(`[data-weight-num="${k}"]`).val(this._pct(this._node(k).weight));
		});
		$el.on("change.mo", "[data-weight-num]", (e) => {
			const k = $(e.currentTarget).data("weight-num");
			this._setWeight(k, e.currentTarget.value);
			$el.find(`[data-weight="${k}"]`).val(this._node(k).weight);
			e.currentTarget.value = this._pct(this._node(k).weight);
		});
		$el.on("click.mo", "[data-step]", (e) =>
			this._stepWeight($(e.currentTarget).data("key"), parseInt($(e.currentTarget).data("step"), 10)));
		$el.on("click.mo", "[data-lock]", (e) => {
			const k = $(e.currentTarget).data("lock");
			if (this.locked.has(k)) this.locked.delete(k); else this.locked.add(k);
			this._draw();
		});

		// --- structure -----------------------------------------------------
		$el.on("click.mo", '[data-act="fx-up"]', (e) =>
			this._move($(e.currentTarget).closest("[data-component]").data("component"), -1));
		$el.on("click.mo", '[data-act="fx-down"]', (e) =>
			this._move($(e.currentTarget).closest("[data-component]").data("component"), 1));
		$el.on("click.mo", '[data-act="fx-remove"]', (e) =>
			this._removeComponent($(e.currentTarget).closest("[data-component]").data("component")));
		$el.on("click.mo", '[data-act="fx-remove-selected"]', () => this._removeComponent(this.sel));
		$el.on("click.mo", '[data-act="fx-add-metric"], [data-act="fx-change-metric"]', () => this._openAddMetric());
		$el.on("click.mo", '[data-act="fx-add-dimension"]', () => this._addDimension());
		$el.on("click.mo", '[data-act="fx-balance"]', () => this._autoBalance());
		$el.on("click.mo", '[data-act="fx-save"]', () => this._saveFormula());
		$el.on("click.mo", '[data-act="fx-new-version"]', () => this._newVersion());
		$el.on("click.mo", '[data-act="fx-apply-node"]', () => {
			const n = this._node(this.sel);
			if (!n) return;
			n.label = $el.find('[data-f="label"]').val() || n.label;
			const w = parseFloat($el.find('[data-f="weight"]').val());
			if (!isNaN(w)) n.weight = Math.max(0, Math.min(100, w));
			this.dirty = true;
			this._draw();
		});

		// --- add-metric drawer ---------------------------------------------
		$el.on("click.mo", '[data-act="fx-close-drawer"]', () => { this._drawer = null; this._draw(); });
		$el.on("click.mo", "[data-pick-metric]", (e) => {
			const code = $(e.currentTarget).data("pick-metric");
			if ($(e.currentTarget).hasClass("disabled")) return;
			this._picked = this._picked || new Set();
			if (this._picked.has(code)) this._picked.delete(code); else this._picked.add(code);
			this._draw();
		});
		$el.on("input.mo", "[data-metric-search]", (e) => {
			this._drawerSearch = e.currentTarget.value;
			this._draw();
			this.$el.find("[data-metric-search]").focus().val(this._drawerSearch);
		});
		$el.on("click.mo", '[data-act="fx-confirm-metrics"]', () => this._confirmAddMetrics());

		$el.on("click.mo", '[data-act="new-index"]', () => this._newIndex());
		$el.on("click.mo", '[data-act="validate"]', () => {
			// Server-side is authoritative. The row badges are a live preview of
			// the same rules; this is the verdict.
			if (this.dirty) {
				return frappe.confirm(
					__("Validation runs against the SAVED formula, and this draft has unsaved changes. Save first?"),
					() => this._saveFormula());
			}
			this.app.call(IAPI + "validate_index", { index_version: this.s.indexVersion }).then((r) => {
				if (!r) return;
				const U = window.UCCMO;
				// Each problem names its own component - a bare "invalid" tells
				// nobody which row to fix, which is the whole point of `problems`.
				const perComponent = (r.problems || []).map((p) =>
					`<div style="margin:2px 0"><b>${U.esc(p.label)}</b> — ${U.esc(p.message)}</div>`).join("");
				frappe.msgprint({
					title: r.valid ? __("Valid") : __("Not valid"),
					indicator: r.valid ? "green" : "red",
					message: (r.issues || []).map((i) => `<div>${U.esc(i)}</div>`).join("")
						+ (perComponent ? `<div style="margin-top:8px"><b>${__("By component")}</b></div>` + perComponent : "")
						+ (r.warnings || []).map((w) => `<div style="color:#9d5c00">${U.esc(w)}</div>`).join("")
						|| __("Weights valid."),
				});
			});
		});
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
		const k = this.data.kpis || {};
		this.$el.html(`
			${U.contextBar({
				eyebrow: __("Criterion 7 workspace"),
				title: __("Outcome evidence"),
				status: __("Frozen snapshots"),
				statusTone: "ok", statusIcon: "i-lock",
				actions: [{ label: __("Export"), icon: "i-save", act: "export" }],
			})}
			${/* One tab, because there is one thing here. "Evidence narrative"
				and a second "Lineage" were tab labels with nothing behind them -
				no endpoint, no DocType, no field, never specified anywhere - and
				until 2026-08-01 they silently repainted this tab's own content
				(QA Bug C), then an honest placeholder after it. Deleted
				2026-08-11. What was called "Overview" IS the lineage report:
				api/lineage.get_lineage over the frozen UCC Score Breakdown
				snapshot, which is what the label now says.

				The active key is passed literally rather than through
				app.tab(): with one tab there is nothing to choose, and reading
				state would let a stale in-session "overview" render the strip
				with nothing marked active. */""}
			${U.tabs([{ key: "lineage", label: __("Lineage") }], "lineage")}
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
		this._fill();
	}

	_fill() {
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
