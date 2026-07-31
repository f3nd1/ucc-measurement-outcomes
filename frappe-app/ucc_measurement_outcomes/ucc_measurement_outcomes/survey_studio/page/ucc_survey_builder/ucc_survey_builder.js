// Copyright (c) 2026, United Ceres College and contributors
// Survey Builder Desk Page. Palette + drag insert/reorder + inspector, plus
// editorial conveniences: bulk paste, multi-select bulk actions, undo/redo of
// structural actions, and desktop/mobile preview. Persists via whitelisted API.

frappe.pages["ucc-survey-builder"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("UCC Survey Builder"),
		single_column: true,
	});
	// Frappe can swallow exceptions thrown from on_page_load, which hides a
	// half-built page behind a clean console. Surface it loudly instead.
	try {
		wrapper.ucc = new SurveyBuilder(page);
	} catch (e) {
		console.error("[UCC] ucc-survey-builder failed to initialise:", e);
		frappe.msgprint({title: __("Page failed to load"), indicator: "red",
			message: __("ucc-survey-builder could not initialise: ") + (e && e.message ? e.message : e)});
		throw e;
	}
};

// Finding 2: Desk pages are constructed once, so a deep link arriving on a
// second visit would be ignored if route_options were only read in the
// constructor. on_page_show runs on every visit.
frappe.pages["ucc-survey-builder"].on_page_show = function (wrapper) {
	if (!wrapper.ucc) return;
	// Same stale-list bug fixed earlier this session in Mapping/Dashboard
	// Studio: a version created elsewhere (or by "+ New Version" itself,
	// before this callback existed) would not appear until a full reload.
	wrapper.ucc._loadVersionList();
	wrapper.ucc.applyRouteOptions();
};

// Item 1: colours reuse the .indicator-pill classes already used throughout
// this app (coverage panel, Mapping Studio groups) rather than new ones.
const VERSION_STATUS_COLOR = { Draft: "gray", "In Review": "orange", Published: "green", Closed: "gray" };

const QUESTION_TYPES = [
	"Short Text", "Paragraph", "Email", "Number", "Date", "Rating",
	"Single Choice", "Multiple Choice", "Dropdown", "Yes / No", "Likert Matrix",
	"NPS", "Ranking", "Slider", "File Upload", "Section Heading", "Page Break",
	"Multiple Choice Grid", "Checkbox Grid",
];
// Markers, not questions: no answer, so nothing to make conditional and nothing
// to widen. Page Break splits the public form into pages - the same marker-type
// mechanism sectioning already uses, so multi-page needs no page field at all.
const MARKER_TYPES = new Set(["Section Heading", "Page Break"]);
const LOGIC_MODES = ["Always Show", "Show If Previous Answer Matches"];
const LOGIC_OPERATORS = ["equals", "not equals", "contains"];
const CHOICE_TYPES = new Set([
	"Rating", "Single Choice", "Multiple Choice", "Dropdown", "Yes / No",
	"Likert Matrix", "Ranking", "Multiple Choice Grid", "Checkbox Grid",
]);
// Investigation finding: Likert Matrix had no rendering case anywhere and no
// schema field for rows either - it was exactly as unimplemented as Ranking/
// Slider/NPS were before tonight, not a working pattern to copy from. Fixed
// as part of building the two new grid types: all three share one renderer
// (_renderGrid), so Likert Matrix's gap closes as a side effect rather than a
// second, separately-scoped fix.
const MATRIX_TYPES = new Set(["Likert Matrix", "Multiple Choice Grid", "Checkbox Grid"]);
// Only Checkbox Grid allows more than one selection per row.
const MULTI_MATRIX_TYPES = new Set(["Checkbox Grid"]);
// Layout width: presentation only, and only in Preview + the public form. The
// question list below stays a 1D management list - it is for finding and
// reordering questions, not for showing what the respondent sees.
// Must match layout_width's Select options and the WIDTHS map in www/survey.html.
const WIDTHS = ["Full Width", "Two Thirds", "Half", "One Third"];
const WIDTH_CLASS = { "Two Thirds": "ucc-sb-w8", "Half": "ucc-sb-w6", "One Third": "ucc-sb-w4" };
const SPAN_OF = { "Full Width": 12, "Two Thirds": 8, "Half": 6, "One Third": 4 };
// Spans the 12-column grid actually offers, widest first. Snapping to these
// four is the point: free widths would break the mobile collapse and the
// "presentation only" property that lets width be edited after publish.
const SPANS = [[12, "Full Width"], [8, "Two Thirds"], [6, "Half"], [4, "One Third"]];

// Palette icons: [sprite name, text fallback]. Frappe's own sprite first (no new
// files, no icon library), but the sprite's contents cannot be enumerated
// without a bench - so instead of guessing and shipping invisible chips, each
// entry carries a glyph and iconFor() checks whether the symbol is actually in
// the page before using it. A wrong or missing sprite name costs nothing.
// name === null means "no sprite icon fits, use the glyph" (NPS, Slider).
const TYPE_ICON = {
	"Short Text": ["edit", "Aa"],
	"Paragraph": ["small-message", "¶"],
	"Email": ["mail", "@"],
	"Number": ["number", "#"],
	"Date": ["calendar", "31"],
	"Rating": ["star", "★"],
	"Single Choice": ["circle", "◉"],
	"Multiple Choice": ["check-square", "☑"],
	"Dropdown": ["select", "▾"],
	"Yes / No": ["check", "✓"],
	"Likert Matrix": ["grid", "▦"],
	"NPS": [null, "0–10"],
	"Ranking": ["sort-ascending", "↕"],
	"Slider": [null, "⇔"],
	"File Upload": ["attachment", "⇧"],
	"Section Heading": ["text", "§"],
	"Page Break": ["insert-below", "⏎"],
	"Multiple Choice Grid": ["grid", "▤"],
	"Checkbox Grid": ["grid", "▣"],
};

// Copy, without assuming frappe.utils.copy_to_clipboard exists. It is not
// documented API and this session has already lost four rounds to unverified
// symbols; a Copy button that throws would leave no way to get the link at all.
// Native clipboard first, Frappe's helper second, and a prompt() the user can
// copy out of as the floor - every branch ends with the link reachable.
function copyLink(url) {
	const done = () => frappe.show_alert({ message: __("Link copied"), indicator: "green" });
	if (navigator.clipboard && navigator.clipboard.writeText) {
		return navigator.clipboard.writeText(url).then(done, () => window.prompt(__("Copy this link:"), url));
	}
	if (frappe.utils && frappe.utils.copy_to_clipboard) {
		return frappe.utils.copy_to_clipboard(url);
	}
	window.prompt(__("Copy this link:"), url);
}

// Frappe injects its sprite inline, so every available icon really is an element
// with id="icon-<name>". That makes "is this icon real?" a one-line DOM lookup
// rather than a guess against a file this session cannot read.
function iconFor(type) {
	const [name, glyph] = TYPE_ICON[type] || [null, "?"];
	if (name && document.getElementById("icon-" + name) && frappe.utils.icon) {
		return frappe.utils.icon(name, "sm");
	}
	return `<span class="ucc-sb-glyph">${frappe.utils.escape_html(glyph)}</span>`;
}

// Display-logic UI removed per decision V1: the fields exist in the schema but
// nothing executes them yet. Re-add the controls together with the logic
// engine (which must include a server-side logic-aware required check).
const API = "ucc_measurement_outcomes.api.builder.";
// Campaign creation lives with the rest of the campaign code, not in builder.py.
const CAPI = "ucc_measurement_outcomes.api.campaign.";

class SurveyBuilder {
	constructor(page) {
		this.page = page;
		this.version = null;
		this.versionItems = [];
		this.questions = [];
		this.editable = false;
		this.selected = null;
		this.dragIndex = null;
		this.selection = new Set();
		this.history = [];
		this.future = [];
		this._injectStyle();
		this._buildLayout();
		this.applyRouteOptions();
	}

	// Finding 2: single entry point for deep links. Idempotent — it clears
	// route_options, so the extra call from on_page_show is a harmless no-op.
	applyRouteOptions() {
		const opts = frappe.route_options || {};
		frappe.route_options = {};
		if (opts.question) this._pendingQuestion = opts.question;
		if (opts.survey_version) {
			this.load(opts.survey_version);
		} else if (opts.new_version_for) {
			// Arrived from the UCC Survey form (ucc_survey.js) right after the
			// survey was created. It has no versions yet, so there is nothing to
			// load — mint the first draft instead of showing an empty picker.
			this._createVersion(opts.new_version_for);
		} else {
			this._applyPendingQuestion();
		}
	}

	_applyPendingQuestion() {
		if (!this._pendingQuestion) return;
		const q = this.questions.find((x) => x.name === this._pendingQuestion);
		this._pendingQuestion = null;
		if (q) this._select(q.name);
	}

	_injectStyle() {
		if (document.getElementById("ucc-sb-style")) return;
		const css = `
		.ucc-sb-grid{display:grid;grid-template-columns:210px 1fr 320px;gap:14px;align-items:stretch;margin-top:12px}
		/* Collapsed Inspector: the Questions grid gets its 320px back, which is
		   what makes a half-width card actually look half-width in this panel. */
		.ucc-sb-grid.inspector-hidden{grid-template-columns:210px 1fr}
		.ucc-sb-grid.inspector-hidden .ucc-sb-inspectorpanel{display:none}
		.ucc-sb-panel{background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e6ea);border-radius:10px;
			display:flex;flex-direction:column;overflow:hidden}
		.ucc-sb-panel h5{margin:0;padding:11px 13px;border-bottom:1px solid var(--border-color,#e2e6ea);font-size:12px;flex:0 0 auto}
		/* Finding 4: all three columns used to scroll together, so editing
		   question 20 of 24 scrolled the palette and inspector out of view.
		   Each panel is now its own flex column: header fixed, body scrolls on
		   its own. The grid's height is measured in JS (_layoutColumns) rather
		   than assumed via position:sticky, which would depend on Frappe's own
		   scroll container and navbar offset — neither verifiable without a
		   bench. Native drag-and-drop is untouched by this: dragstart/dragover/
		   drop fire on the elements themselves and are not affected by an
		   ancestor's overflow. */
		.ucc-sb-body{padding:12px;flex:1 1 auto;min-height:0;overflow-y:auto}
		.ucc-sb-toolbar{display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap}
		.ucc-sb-bulkbar{display:none;gap:6px;align-items:center;background:#eef3fb;border:1px solid #d5e1f0;border-radius:8px;padding:6px 10px;margin-top:8px;font-size:12px}
		.ucc-sb-bulkbar.show{display:flex}
		.ucc-sb-palette{display:grid;grid-template-columns:1fr 1fr;gap:6px}
		.ucc-sb-chip{border:1px solid var(--border-color,#e2e6ea);border-radius:8px;padding:8px 6px;font-size:11px;text-align:center;cursor:grab;user-select:none;background:var(--fg-color,#fff)}
		/* Icon ABOVE the label, never instead of it: the sprite name for a given
		   type is unverified without a bench, so a chip must still read if its
		   icon never resolves. */
		.ucc-sb-chip .icon{display:block;margin:0 auto 4px;color:var(--text-muted,#8b95a5)}
		.ucc-sb-glyph{display:block;font-size:14px;line-height:1;margin-bottom:4px;color:var(--text-muted,#8b95a5)}
		.ucc-sb-chiplabel{display:block;line-height:1.25}
		.ucc-sb-link{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:12px;
			background:var(--card-bg,#f7f9fc);border:1px solid var(--border-color,#e2e6ea);border-radius:8px;padding:7px 10px}
		.ucc-sb-link a{word-break:break-all}
		.ucc-sb-linklabel{font-weight:600;color:var(--text-muted,#8b95a5)}
		.ucc-sb-linkoff{color:var(--text-muted,#8b95a5)}
		/* Visually unmistakable against the public link above it: amber, dashed,
		   with its own pill. Nobody should be able to copy the wrong one at a
		   glance. The preview PAGE carries the same warning, because that is what
		   survives the URL being pasted somewhere else. */
		.ucc-sb-previewlink{background:#fff6e0;border-color:#d8a72a;border-style:dashed}
		.ucc-sb-previewpill{background:#d8a72a;color:#fff;border-radius:20px;padding:1px 8px;
			font-size:10px;font-weight:700;letter-spacing:.5px}
		.ucc-sb-chip:hover{border-color:var(--primary,#4a63e7)}
		/* Item A: the Questions panel IS the layout. Same 12-column grid the
		   respondent's page uses, so a width change is manipulated where it is
		   seen. Reorder is untouched by this: drops still target CARDS, the
		   handler still passes one integer index, and the sequence is still
		   linear - CSS Grid only decides where that sequence wraps. If this ever
		   misbehaves the revert is this one line back to flex. */
		.ucc-sb-list{min-height:220px;display:grid;grid-template-columns:repeat(12,1fr);gap:9px}
		.ucc-sb-q,.ucc-sb-empty,.ucc-sb-list > .ucc-empty{grid-column:1/-1}
		.ucc-sb-w8{grid-column:span 8}
		.ucc-sb-w6{grid-column:span 6}
		.ucc-sb-w4{grid-column:span 4}
		.ucc-sb-empty{border:2px dashed var(--border-color,#cbd4df);border-radius:10px;padding:28px;text-align:center;color:var(--text-muted,#8b95a5)}
		.ucc-sb-q{position:relative;border:1px solid var(--border-color,#e2e6ea);border-radius:9px;padding:10px 12px;display:grid;grid-template-columns:18px 20px 1fr auto;gap:9px;align-items:start;background:var(--fg-color,#fff)}
		/* A card at One Third is ~250px in this panel, where the 4-column card
		   interior crowds. Below that the checkbox/handle/actions wrap under the
		   title instead of squeezing it. */
		.ucc-sb-q.ucc-sb-w4{grid-template-columns:18px 20px 1fr;row-gap:4px}
		.ucc-sb-q.ucc-sb-w4 .ucc-sb-actions{grid-column:1/-1;justify-content:flex-end}
		/* The width grip. col-resize cursor, and it sits ON the card edge so the
		   drag reads as "make this narrower/wider" rather than "move this". */
		.ucc-sb-grip{position:absolute;right:-5px;top:11px;width:8px;height:30px;border-radius:3px;
			background:var(--primary,#4a63e7);opacity:0;cursor:col-resize;z-index:2}
		.ucc-sb-q:hover .ucc-sb-grip{opacity:.3}
		.ucc-sb-grip:hover,.ucc-sb-grip.dragging{opacity:.75}
		.ucc-sb-q.selected{border-color:var(--primary,#4a63e7);box-shadow:0 0 0 2px rgba(74,99,231,.12)}
		.ucc-sb-q.dragging{opacity:.4}
		.ucc-sb-handle{cursor:grab;color:var(--text-muted,#98a1af)}
		.ucc-sb-qtitle{font-size:13px;font-weight:600}
		.ucc-sb-qmeta{font-size:10px;color:var(--text-muted,#8b95a5);margin-top:4px}
		.ucc-sb-tag{display:inline-block;border:1px solid var(--border-color,#e2e6ea);border-radius:20px;padding:1px 7px;margin-right:5px;font-size:10px}
		.ucc-sb-banner{background:#fff4df;border:1px solid #ecd6aa;color:#715824;border-radius:8px;padding:9px 12px;font-size:12px;margin-top:10px}
		.ucc-sb-req{color:var(--red,#b94848)}
		/* finding 3: same red-flag language the Mapping canvas uses for a gap */
		.ucc-sb-q.gap{border-color:#e0b4b4;background:#fdf6f6}
		.ucc-sb-maplink{margin-left:6px;font-size:10px;cursor:pointer;color:var(--text-muted,#8b95a5);text-decoration:underline dotted}
		.ucc-sb-maplink:hover{color:var(--primary,#4a63e7)}
		.ucc-sb-maplink.gap{color:var(--red,#b94848)}
		.ucc-sb-iconbtn{border:0;background:transparent;cursor:pointer;color:var(--text-muted,#8b95a5);padding:3px 5px;border-radius:6px}
		.ucc-sb-iconbtn:hover{background:var(--bg-light-gray,#eef2f7)}
		.ucc-sb-modal{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;align-items:flex-start;justify-content:center;z-index:1050;padding:24px;overflow:auto}
		.ucc-sb-modal.show{display:flex}
		.ucc-sb-sheet{background:#fff;border-radius:12px;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);width:min(680px,96vw)}
		.ucc-sb-sheet.mobile{width:390px}
		.ucc-sb-sheet-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-color,#e2e6ea)}
		.ucc-sb-sheet-body{padding:18px}
		/* Preview's markup and styling are now the respondent page's own:
		   UCCSurveyForm renders it and public/css/ucc_survey_form.bundle.css styles it (loaded
		   into Desk via app_include_css). The ~45 lines of .ucc-sb-pq / .ucc-sb-page
		   / .ucc-stars / .ucc-nps / .ucc-grid lookalikes that used to live here
		   are deleted - there is one stylesheet now, not two that drift.
		   The mobile toggle stays a Desk concern: the sheet is a fixed-width
		   modal, not a narrow viewport, so the sheet's @media rule cannot fire.
		   This reproduces its one effect. */
		.ucc-sb-sheet.mobile .ucc-survey .ucc-q{grid-column:1/-1}
		`;
		const el = document.createElement("style");
		el.id = "ucc-sb-style";
		el.textContent = css;
		document.head.appendChild(el);
	}

	_buildLayout() {
		const $main = $(this.page.main).empty();
		this.$trail = $('<div></div>').appendTo($main);   // finding 1
		// Item 1: replaces the plain Link field with a picker showing each
		// version's status as a coloured pill, a checkmark on the active one, an
		// edit affordance, and a "+ New Version" footer action — modelled on a
		// picker Felix described from elsewhere (nothing in this app already had
		// this shape; see version_picker.js for what was actually found).
		const $pickerLabel = $(`<label style="display:block;font-size:12px;color:var(--text-muted,#8b95a5);margin-bottom:3px">${__("Survey Version")}</label>`).appendTo($main);
		const $picker = $('<div></div>').appendTo($main);
		this.picker = new window.UCCVersionPicker($picker.get(0), {
			statusColor: VERSION_STATUS_COLOR,
			placeholder: __("Pick a survey version…"),
			onSelect: (name) => this.load(name),
			onEdit: (name) => frappe.set_route("Form", "UCC Survey Version", name),
			onCreate: () => this._createVersion(),
		});
		this._loadVersionList();
		const $tb = $('<div class="ucc-sb-toolbar"></div>').appendTo($main);
		$(`<button class="btn btn-default btn-sm">${__("Bulk paste")}</button>`).appendTo($tb).on("click", () => this._openBulk());
		$(`<button class="btn btn-default btn-sm">${__("Preview")}</button>`).appendTo($tb).on("click", () => this._preview());
		// No collapse pattern existed anywhere in this app to reuse - checked
		// Mapping, Index and Dashboard Studio and the shared components. This is
		// the minimum: one class on the grid container, so the columns are still
		// declared in one place (CSS) rather than computed in JS.
		// Theme is SITE-WIDE, not per-version, so it lives in its own Single rather
		// than in this version-scoped page - a colour control sitting beside a
		// version picker would imply per-survey theming and invite "why did
		// changing survey B recolour survey A". This is just the way in.
		$(`<button class="btn btn-default btn-sm" title="${__("Colours and font for the public survey page (site-wide)")}">${__("Theme…")}</button>`)
			.appendTo($tb).on("click", () => frappe.set_route("Form", "UCC Survey Theme"));
		this.$inspectorToggle = $(`<button class="btn btn-default btn-sm" title="${__("Show or hide the Inspector")}">☰</button>`)
			.appendTo($tb).on("click", () => this._toggleInspector());
		// The only route to responses used to be the word "Analyse" in the
		// five-step bar - a small grey label that reads as a progress marker, not
		// a way in, and Felix could not find results at all from here. This is a
		// second, obvious door; the bar is untouched.
		//
		// Hidden until there is something to look at: a "View Responses" button
		// that opens an empty analytics page is worse than no button, because it
		// teaches you the feature is broken rather than that you have no data.
		this.$responses = $(`<button class="btn btn-primary btn-sm">${
			__("View Responses")}</button>`).appendTo($tb).hide()
			.on("click", () => this._openResponses());
		this.$undo = $(`<button class="btn btn-default btn-sm" disabled>${__("Undo")}</button>`).appendTo($tb).on("click", () => this._undo());
		this.$redo = $(`<button class="btn btn-default btn-sm" disabled>${__("Redo")}</button>`).appendTo($tb).on("click", () => this._redo());
		// Item 4: the public link had no UI at all - a published version with an
		// open campaign gave no way to see or copy the URL respondents use. It
		// lives next to the toolbar so it is visible the moment a version loads.
		this.$link = $('<div class="ucc-sb-link" style="display:none"></div>').appendTo($main);
		this.$preview = $('<div class="ucc-sb-link ucc-sb-previewlink" style="display:none"></div>').appendTo($main);
		this.$bulk = $('<div class="ucc-sb-bulkbar"></div>').appendTo($main);
		this.$banner = $('<div class="ucc-sb-banner" style="display:none"></div>').appendTo($main);
		const $grid = $('<div class="ucc-sb-grid"></div>').appendTo($main);
		this.$palette = $(`<div class="ucc-sb-panel"><h5>${__("Question Types")}</h5><div class="ucc-sb-body"><div class="ucc-sb-palette"></div></div></div>`).appendTo($grid).find(".ucc-sb-palette");
		this.$list = $(`<div class="ucc-sb-panel"><h5>${__("Questions")}</h5><div class="ucc-sb-body"><div class="ucc-sb-list"></div></div></div>`).appendTo($grid).find(".ucc-sb-list");
		this.$inspectorPanel = $(`<div class="ucc-sb-panel ucc-sb-inspectorpanel"><h5>${__("Inspector")}</h5><div class="ucc-sb-body"></div></div>`).appendTo($grid);
		this.$inspector = this.$inspectorPanel.find(".ucc-sb-body");
		this._renderPalette();
		this._renderInspector();
		try {
			if (localStorage.getItem("ucc-sb-inspector-hidden") === "1") this._toggleInspector(true);
		} catch (e) { /* private mode - just start expanded */ }
		// Finding 1: before a version is picked, load() never runs, so the list
		// had no drop handlers and no message — dragging silently did nothing.
		// Say why instead of looking broken.
		if (window.UCCEmptyState) {
			window.UCCEmptyState.render(this.$list.get(0), {
				message: __("Pick a survey to start building questions."),
			});
		}
		this.$next = $('<div></div>').appendTo($main);   // item 2
		this._renderTrail();
		this._modal = $('<div class="ucc-sb-modal"><div class="ucc-sb-sheet"></div></div>').appendTo(document.body);
		this.$grid = $grid;
		this._layoutColumns();
		// Debounced: the banner (editable/read-only) and bulk bar both change the
		// grid's vertical offset, and resize is otherwise noisy.
		let t;
		$(window).on("resize.ucc-sb", () => { clearTimeout(t); t = setTimeout(() => this._layoutColumns(), 120); });
	}

	// Finding 4: measured, not guessed. A fixed pixel offset for Frappe's own
	// navbar/page-head would be a number this session cannot verify without a
	// bench; getBoundingClientRect reads the real position the grid actually
	// ended up at, so it is correct regardless of Frappe's chrome height.
	_layoutColumns() {
		if (!this.$grid || !this.$grid.length) return;
		const top = this.$grid.get(0).getBoundingClientRect().top;
		const bottomMargin = 24;
		this.$grid.css("height", `calc(100vh - ${Math.max(0, Math.round(top))}px - ${bottomMargin}px)`);
	}

	// Finding 1: show where this page sits in the chain.
	_renderTrail() {
		if (!window.UCCTrail) return console.warn("[UCC] trail.js not loaded - run: bench build --app ucc_measurement_outcomes && bench restart");
		// Item 1: this page is stage 1. It knows its own question count, and the
		// unmapped count it already loaded for the question flags (no new call).
		// Every signal below is gated on loaded state, so before a version is
		// picked the map was empty and the stepper rendered five neutral stages —
		// no state at all, which is the one thing a stepper exists to show. An
		// unpicked page states what it is waiting for instead.
		const stages = {};
		stages[1] = this.version
			? { done: this.questions.length > 0, note: this.questions.length ? null : __("no questions yet") }
			: { note: __("pick a survey version to start") };
		if (this.unmapped) {
			const n = this.unmapped.size;
			stages[2] = n === 0
				? { done: true }
				: { note: __("{0} questions still need objectives", [n]) };
		}
		window.UCCTrail.render(this.$trail.get(0), {
			current: 1,
			context: this.version
				? `${this.version.survey_title || this.version.survey} · V${this.version.version_number}`
				: null,
			routeOptions: this.version ? { survey_version: this.version.name } : {},
			stages: stages,
		});
		this._renderNext();
	}

	// Item 2: forward action — the next stage is mapping those questions.
	_renderNext() {
		if (!window.UCCTrail || !this.$next) return;
		if (!this.version) {
			return window.UCCTrail.renderNext(this.$next.get(0), {
				blocked: __("Pick a survey first"),
			});
		}
		if (!this.questions.length) {
			return window.UCCTrail.renderNext(this.$next.get(0), {
				blocked: __("Add at least one question before mapping"),
			});
		}
		const n = this.unmapped ? this.unmapped.size : 0;
		window.UCCTrail.renderNext(this.$next.get(0), {
			label: n
				? __("Next: map these {0} questions →", [n])
				: __("Next: build an index from these metrics →"),
			page: n ? "mapping-studio" : "index-studio",
			routeOptions: { survey_version: this.version.name },
		});
	}

	// Collapsing the Inspector is what makes the Questions grid usable: at
	// 210px/1fr/320px the middle column is too narrow for a half-width card to
	// look meaningfully different from a full-width one. Remembered, because a
	// collapse that resets on every page load is one nobody uses.
	_toggleInspector(hidden) {
		if (hidden === undefined) hidden = !this.$grid.hasClass("inspector-hidden");
		this.$grid.toggleClass("inspector-hidden", hidden);
		this.$inspectorToggle.toggleClass("btn-primary", hidden).toggleClass("btn-default", !hidden);
		try { localStorage.setItem("ucc-sb-inspector-hidden", hidden ? "1" : "0"); } catch (e) { /* private mode */ }
		this._layoutColumns();   // the columns just changed width
	}

	_renderPalette() {
		this.$palette.empty();
		QUESTION_TYPES.forEach((t) => {
			const $c = $(`<div class="ucc-sb-chip" draggable="true" title="${frappe.utils.escape_html(t)}">${iconFor(t)}<span class="ucc-sb-chiplabel">${frappe.utils.escape_html(t)}</span></div>`);
			$c.on("dragstart", (e) => e.originalEvent.dataTransfer.setData("newType", t));
			this.$palette.append($c);
		});
	}

	// --- promise wrapper over whitelisted calls ---
	_call(method, args) {
		return new Promise((resolve) => frappe.call({ method: API + method, args, callback: (r) => resolve(r.message) }));
	}

	load(version) {
		this._call("get_survey_builder", { survey_version: version }).then((m) => {
			if (!m) return;
			this.version = m.version;
			this.questions = m.questions || [];
			this.editable = !!m.editable;
			this.selected = null;
			this.selection.clear();
			this.history = [];
			this.future = [];
			this._updateUndo();
			this.page.set_title(`${__("UCC Survey Builder")} — ${frappe.utils.escape_html(this.version.survey_title || "")} v${frappe.utils.escape_html(this.version.version_number || "")}`);
			this.$banner.toggle(!this.editable).text(__("This version is {0} and cannot be edited.", [this.version.status]));
			this._renderQuestions();
			this._renderInspector();
			this._renderBulkBar();
			this._renderTrail();
			this._applyPendingQuestion();   // finding 2: arrived via deep link
			this._loadCoverage();           // finding 3: mapping status
			this._renderPublicLink();       // item 4: /survey?token=… link surface
			this._renderResponses();        // the way in to what was collected
			this._renderPreviewLink();      // item C: /survey?preview=… author link
			// The banner above just toggled, which moves the grid's top offset.
			this._layoutColumns();
			this.picker.setItems(this.versionItems || [], this.version.name);
		});
	}

	// Item 1: the picker's list, fetched once and refetched on page show and
	// right after "+ New Version" — same stale-list defect fixed earlier this
	// session in Mapping/Dashboard Studio (a list built once in a constructor
	// never reflects anything created afterwards).
	// Reason-or-link, never a dead control: a Draft version, a version with no
	// campaign, and a campaign that is Closed each say what is missing.
	_renderPublicLink() {
		if (!this.version) return this.$link.hide();
		this._call("public_link", { survey_version: this.version.name }).then((r) => {
			if (!r) return this.$link.hide();
			this.$link.show().empty();
			if (!r.url) {
				this.$link.append(
					$(`<span class="ucc-sb-linkoff">${frappe.utils.escape_html(r.reason || "")}</span>`)
				);
				// Fix 4: "No campaign points at this version yet" was a dead end —
				// true, and with nothing to do about it. Attach the action to it.
				// Only when there is no campaign at all: a Closed or Draft one
				// already exists and reopening it is a decision to make on that
				// record, not a side effect of a button called "Start collecting".
				if (!r.campaign && this.version.status === "Published") {
					$(`<button class="btn btn-xs btn-primary">${__("Start collecting")}</button>`)
						.appendTo(this.$link).on("click", () => this._startCollecting());
				}
				return;
			}
			const more = r.more ? ` <span class="ucc-sb-linkoff">${__("(+{0} more open campaign)", [r.more])}</span>` : "";
			this.$link.append(`<span class="ucc-sb-linklabel">${__("Public link")}</span>`);
			this.$link.append($(`<a href="${frappe.utils.escape_html(r.url)}" target="_blank" rel="noopener">${frappe.utils.escape_html(r.url)}</a>`));
			$(`<button class="btn btn-xs btn-default">${__("Copy")}</button>`).appendTo(this.$link)
				.on("click", () => copyLink(r.url));
			this.$link.append(more);
		});
	}

	// Fix 4: turn a published version into a live campaign without going near the
	// Survey Tracking form.
	//
	// educ_sg makes Survey Tracking.survey_name mandatory, and the 2026-07-26
	// decision is that it STAYS mandatory — this app will not write stub planning
	// records into the institutional register, nor relax someone else's
	// constraint. So one field is genuinely a human choice and cannot be
	// defaulted away. Everything else (the version, the Open status, the public
	// token) is set server-side and never shown, and the field is asked for in
	// our words with its real Link target read off the live meta.
	_startCollecting() {
		frappe.call({
			method: CAPI + "collection_setup",
			args: { survey_version: this.version.name },
			callback: (r) => {
				if (!r.message) return;
				const f = r.message;
				const d = new frappe.ui.Dialog({
					title: __("Start collecting responses"),
					fields: [
						{ fieldname: "planning_record", fieldtype: f.fieldtype,
						  options: f.options, label: f.label, reqd: 1,
						  description: __("The existing planning record this collection belongs to. Required by Survey Management — a campaign has to be traceable to something that was planned.") },
					],
					primary_action_label: __("Open the survey"),
					primary_action: (v) => {
						frappe.call({
							method: CAPI + "start_collecting",
							args: { survey_version: this.version.name,
									planning_record: v.planning_record },
							callback: (res) => {
								if (!res.message) return;
								d.hide();
								frappe.show_alert({ indicator: "green", message: __(
									"Campaign {0} created — the public link is now live", [res.message.campaign]) });
								// The link surface is the thing that just changed.
								this._renderPublicLink();
							},
						});
					},
				});
				d.show();
			},
		});
	}

	// Responses are the point of publishing, so the count is on the button
	// itself - "View Responses (23)" answers "did anyone reply?" without a click.
	_renderResponses() {
		if (!this.version) return this.$responses.hide();
		this._call("response_summary", { survey_version: this.version.name }).then((r) => {
			if (!r || !r.responses) return this.$responses.hide();
			this._responseCampaign = r.campaign;
			this.$responses.show().text(__("View Responses ({0})", [r.responses]));
		});
	}

	_openResponses() {
		// Campaign Analytics is where response data lives today. Deep-link to the
		// right campaign rather than dropping the user on a picker: with several
		// campaigns on a site, "which one is mine" is exactly the navigation
		// problem this button exists to remove.
		if (this._responseCampaign) frappe.route_options = { campaign: this._responseCampaign };
		frappe.set_route("ucc-campaign-analytics");
	}

	// Item C: deliberately unlike the public link. Different colour, dashed
	// border, its own label, and always present - a preview needs no campaign,
	// no token and no Published status, so this is the one link a Draft has.
	//
	// It is NOT anonymous: opening it needs a Desk login with read permission on
	// the version, re-checked server-side. That is the point rather than a
	// limitation - an anonymous preview token would be a second unauthenticated
	// path to unpublished survey content guarded by nothing but a secret string.
	_renderPreviewLink() {
		if (!this.version) return this.$preview.hide();
		this._call("preview_link", { survey_version: this.version.name }).then((r) => {
			if (!r || !r.url) return this.$preview.hide();
			this.$preview.show().empty();
			this.$preview.append(`<span class="ucc-sb-previewpill">${__("PREVIEW")}</span>`);
			this.$preview.append(`<span class="ucc-sb-linkoff">${__("Collects nothing. Needs a login — do not send to respondents.")}</span>`);
			$(`<button class="btn btn-xs btn-default">${__("Copy")}</button>`).appendTo(this.$preview)
				.on("click", () => copyLink(r.url));
			$(`<a class="btn btn-xs btn-default" href="${frappe.utils.escape_html(r.url)}" target="_blank" rel="noopener">${__("Open ↗")}</a>`)
				.appendTo(this.$preview);
		});
	}

	_loadVersionList() {
		frappe.call({
			method: API + "list_versions",
			callback: (r) => {
				this.versionItems = (r.message || []).map((v) => ({
					name: v.name, status: v.status,
					label: `${v.survey_title} · V${v.version_number}`,
				}));
				this.picker.setItems(this.versionItems, this.version ? this.version.name : null);
			},
		});
	}

	// Item 1: "+ New Version" needs to know which Survey. If one is already
	// loaded, default to it — the common case is "start a new draft of what
	// I'm looking at" — otherwise ask. Deliberately blank (see new_version's
	// docstring): "Copy to version..." already exists for bringing questions
	// across, so auto-copying here would duplicate content nobody asked to
	// duplicate.
	// forSurvey: supplied by applyRouteOptions when we were sent here for a
	// specific survey. Same path as "a version is already loaded" — known
	// survey, no prompt.
	_createVersion(forSurvey) {
		const survey = forSurvey || (this.version ? this.version.survey : null);
		const go = (surveyName) => {
			frappe.call({
				method: API + "new_version",
				args: { survey: surveyName },
				callback: (r) => {
					if (!r.message) return;
					frappe.show_alert({ indicator: "green", message: __("New draft version created") });
					this._loadVersionList();
					this.load(r.message);
				},
			});
		};
		if (survey) return go(survey);

		// Fix 3: a version needs a survey, and the only way to make one used to
		// be the raw Desk form. A UCC Survey is a title — so ask for the title
		// here. Not frappe.prompt: these two fields are alternatives, and prompt
		// has no way to say "one of these, not both".
		const d = new frappe.ui.Dialog({
			title: __("New Survey Version"),
			fields: [
				{ fieldname: "survey", fieldtype: "Link", options: "UCC Survey",
				  label: __("Existing survey") },
				{ fieldtype: "Section Break" },
				{ fieldname: "title", fieldtype: "Data", label: __("…or start a new survey"),
				  description: __("Type a title and both the survey and its first draft version are created.") },
			],
			primary_action_label: __("Create"),
			primary_action: (v) => {
				const title = (v.title || "").trim();
				if (!v.survey && !title) {
					return frappe.msgprint(__("Pick an existing survey, or type a title for a new one."));
				}
				if (v.survey && title) {
					return frappe.msgprint(__("One or the other — pick an existing survey, or type a new title, not both."));
				}
				d.hide();
				// Same callback either way: new_survey_with_version returns the
				// VERSION name, exactly like new_version.
				if (!title) return go(v.survey);
				this._call("new_survey_with_version", { title }).then((name) => {
					if (!name) return;
					frappe.show_alert({ indicator: "green", message: __("Survey created with its first draft version") });
					this._loadVersionList();
					this.load(name);
				});
			},
		});
		d.show();
	}

	// Finding 3: mapping status comes from the SAME whitelisted method Mapping
	// Studio uses (api.mapping.mapping_coverage) — one source of truth, not a
	// second implementation of "is this question mapped".
	_loadCoverage() {
		frappe.call({
			method: "ucc_measurement_outcomes.api.mapping.mapping_coverage",
			args: { survey_version: this.version.name },
			callback: (r) => {
				if (!r.message) return;
				this.unmapped = new Set(r.message.questions_without_objective || []);
				this._renderQuestions();
				this._renderTrail();   // finding 5: badge reflects the same count
			},
		});
	}

	_reload() { return this.version ? Promise.resolve(this.load(this.version.name)) : Promise.resolve(); }

	_renderQuestions() {
		this.$list.empty();
		this._wireListDrop();
		if (!this.questions.length) {
			// Finding 1: drag-to-insert is wired here, but it isn't discoverable and
			// gives no feedback if it fails. Offer an explicit button as well.
			const $drop = $(`<div class="ucc-sb-empty"></div>`).appendTo(this.$list);
			if (window.UCCEmptyState) {
				window.UCCEmptyState.render($drop.get(0), {
					message: __("Drag a question type here, or:"),
					actionLabel: this.editable ? __("+ Add your first question") : null,
					onAction: this.editable ? () => this._addQuestion("Short Text", 0) : null,
				});
			} else {
				$drop.text(__("Drag a question type here"));
			}
			return;
		}
		this.questions.forEach((q, i) => {
			const tags = [q.question_type, q.is_required ? __("Required") : null].filter(Boolean)
				.map((t) => `<span class="ucc-sb-tag">${frappe.utils.escape_html(t)}</span>`).join("");
			// Finding 3: same fact, same flag as Mapping Studio's table and canvas.
			// Also finding 2: this label is the hop into Mapping Studio.
			const isGap = this.unmapped && this.unmapped.has(q.name);
			// Markers are not answerable and have no width of their own.
			const width = MARKER_TYPES.has(q.question_type) ? "" : (WIDTH_CLASS[q.layout_width] || "");
			const mapLink = !this.unmapped ? ""
				: isGap
					? `<span class="ucc-sb-maplink gap" data-q="${q.name}">${__("Not linked to an objective — link it")} →</span>`
					: `<span class="ucc-sb-maplink" data-q="${q.name}">${__("Linked to an objective")} →</span>`;
			const $q = $(`
				<div class="ucc-sb-q ${width} ${this.selected === q.name ? "selected" : ""} ${isGap ? "gap" : ""}" draggable="${this.editable}" data-index="${i}" data-name="${q.name}">
					<span class="ucc-sb-grip" title="${__("Drag to change width")}"></span>
					<input type="checkbox" class="ucc-sb-check" ${this.selection.has(q.name) ? "checked" : ""}>
					<div class="ucc-sb-handle">⋮⋮</div>
					<div class="ucc-sb-main">
						<div class="ucc-sb-qtitle">${i + 1}. ${frappe.utils.escape_html(q.question_text || "")} ${q.is_required ? '<span class="ucc-sb-req">*</span>' : ""}</div>
						<div class="ucc-sb-qmeta">${tags}${mapLink}</div>
					</div>
					<div class="ucc-sb-actions">
						<button class="ucc-sb-iconbtn" data-act="dup" title="${__("Duplicate")}">⧉</button>
						<button class="ucc-sb-iconbtn" data-act="del" title="${__("Delete")}">⌫</button>
					</div>
				</div>`);
			$q.find(".ucc-sb-maplink").on("click", (e) => {
				e.stopPropagation();
				frappe.route_options = { survey_version: this.version.name, question: q.name };
				frappe.set_route("mapping-studio");
			});
			$q.find(".ucc-sb-check").on("change", (e) => { e.target.checked ? this.selection.add(q.name) : this.selection.delete(q.name); this._renderBulkBar(); });
			$q.find(".ucc-sb-main").on("click", () => this._select(q.name));
			$q.find('[data-act="dup"]').on("click", (e) => { e.stopPropagation(); this._duplicate(q.name); });
			$q.find('[data-act="del"]').on("click", (e) => { e.stopPropagation(); this._delete(q.name); });
			if (this.editable) this._wireQuestionDrag($q);
			if (!MARKER_TYPES.has(q.question_type)) this._wireWidthResize($q, q);
			this.$list.append($q);
		});
	}

	_renderBulkBar() {
		const n = this.selection.size;
		this.$bulk.toggleClass("show", n > 0 && this.editable);
		this._layoutColumns();   // the bulk bar showing/hiding moves the grid's offset
		if (!n) return;
		this.$bulk.empty().append(`<span>${__("{0} selected", [n])}</span>`);
		$(`<button class="btn btn-xs btn-danger">${__("Delete")}</button>`).appendTo(this.$bulk).on("click", () => this._bulkDelete());
		$(`<button class="btn btn-xs btn-default">${__("Copy to version…")}</button>`).appendTo(this.$bulk).on("click", () => this._bulkCopy());
		$(`<button class="btn btn-xs btn-default">${__("Clear")}</button>`).appendTo(this.$bulk).on("click", () => { this.selection.clear(); this._renderQuestions(); this._renderBulkBar(); });
	}

	_wireQuestionDrag($q) {
		$q.on("dragstart", (e) => { this.dragIndex = +$q.data("index"); $q.addClass("dragging"); e.originalEvent.dataTransfer.setData("moveIndex", this.dragIndex); });
		$q.on("dragend", () => $q.removeClass("dragging"));
		$q.on("dragover", (e) => e.preventDefault());
		$q.on("drop", (e) => {
			e.preventDefault(); e.stopPropagation();
			const dt = e.originalEvent.dataTransfer;
			const newType = dt.getData("newType");
			const to = +$q.data("index");
			if (newType) return this._addQuestion(newType, to);
			const from = +dt.getData("moveIndex");
			if (Number.isInteger(from) && from !== to) this._reorder(from, to);
		});
	}

	_wireListDrop() {
		this.$list.off("dragover drop");
		this.$list.on("dragover", (e) => e.preventDefault());
		this.$list.on("drop", (e) => {
			// Finding 1 (root cause): the strict target check swallowed drops onto
			// the empty-state placeholder — i.e. exactly when the list is empty and
			// the user most needs drag-to-insert to work. Accept those too.
			const onList = e.target === this.$list.get(0);
			const onPlaceholder = !this.questions.length && $(e.target).closest(".ucc-sb-empty").length > 0;
			if (!onList && !onPlaceholder) return;
			const newType = e.originalEvent.dataTransfer.getData("newType");
			if (newType) this._addQuestion(newType, this.questions.length);
		});
	}

	_guardEditable() {
		if (this.editable) return true;
		frappe.show_alert({ message: __("This version is read-only."), indicator: "orange" });
		return false;
	}

	// --- undo/redo (structural actions only) ---
	// ponytail: id-based history; a delete's undo re-creates with a NEW id which
	// the action tracks for its own redo. Deeply interleaved undo across recreated
	// items can desync — acceptable for typical linear edit/undo/redo use.
	_record(action) { this.history.push(action); this.future = []; this._updateUndo(); }
	_updateUndo() { this.$undo.prop("disabled", !this.history.length); this.$redo.prop("disabled", !this.future.length); }
	_undo() { const a = this.history.pop(); if (!a) return; Promise.resolve(a.undo()).then(() => { this.future.push(a); this._reload(); }); }
	_redo() { const a = this.future.pop(); if (!a) return; Promise.resolve(a.redo()).then(() => { this.history.push(a); this._reload(); }); }

	_addQuestion(type, index) {
		if (!this._guardEditable()) return;
		this._call("add_question", { survey_version: this.version.name, question_type: type, sequence: index }).then((name) => {
			if (!name) return;
			const st = { name };
			this._record({ undo: () => this._call("delete_question", { question: st.name }), redo: () => this._call("add_question", { survey_version: this.version.name, question_type: type, sequence: index }).then((nm) => { st.name = nm; }) });
			this.selected = name; this.load(this.version.name);
		});
	}

	_reorder(from, to) {
		if (!this._guardEditable()) return;
		const oldNames = this.questions.map((q) => q.name);
		const newNames = oldNames.slice();
		newNames.splice(to, 0, newNames.splice(from, 1)[0]);
		this._call("reorder_questions", { survey_version: this.version.name, ordered: JSON.stringify(newNames) }).then(() => {
			this._record({ undo: () => this._call("reorder_questions", { survey_version: this.version.name, ordered: JSON.stringify(oldNames) }), redo: () => this._call("reorder_questions", { survey_version: this.version.name, ordered: JSON.stringify(newNames) }) });
			this.load(this.version.name);
		});
	}

	_duplicate(name) {
		if (!this._guardEditable()) return;
		this._call("duplicate_question", { question: name }).then((nm) => {
			if (!nm) return;
			const st = { name: nm };
			this._record({ undo: () => this._call("delete_question", { question: st.name }), redo: () => this._call("duplicate_question", { question: name }).then((n2) => { st.name = n2; }) });
			this.selected = nm; this.load(this.version.name);
		});
	}

	_snapshot(name) {
		const q = this.questions.find((x) => x.name === name) || {};
		return {
			question_text: q.question_text, question_type: q.question_type, help_text: q.help_text,
			is_required: q.is_required, sequence: q.sequence,
			display_logic: q.display_logic, display_logic_config: q.display_logic_config,
			// Undo-of-delete restores from this snapshot, so anything create_question
			// accepts has to be in it - matrix_rows was missed when the grid types
			// landed, which silently emptied a restored grid's rows.
			matrix_rows: q.matrix_rows, layout_width: q.layout_width,
			choices: q.choices || [],
		};
	}

	_delete(name) {
		if (!this._guardEditable()) return;
		frappe.confirm(__("Delete this question?"), () => {
			const snap = this._snapshot(name);
			this._call("delete_question", { question: name }).then(() => {
				const st = { name };
				this._record({
					undo: () => this._call("create_question", { survey_version: this.version.name, payload: JSON.stringify(snap) }).then((nm) => { st.name = nm; }),
					redo: () => this._call("delete_question", { question: st.name }),
				});
				if (this.selected === name) this.selected = null;
				this.load(this.version.name);
			});
		});
	}

	_bulkDelete() {
		if (!this._guardEditable()) return;
		const names = [...this.selection];
		const snaps = names.map((n) => this._snapshot(n));
		frappe.confirm(__("Delete {0} questions?", [names.length]), () => {
			this._call("bulk_delete_questions", { names: JSON.stringify(names) }).then(() => {
				const st = { names };
				this._record({
					undo: () => Promise.all(snaps.map((s) => this._call("create_question", { survey_version: this.version.name, payload: JSON.stringify(s) }))).then((nm) => { st.names = nm; }),
					redo: () => this._call("bulk_delete_questions", { names: JSON.stringify(st.names) }),
				});
				this.selection.clear(); this.load(this.version.name);
			});
		});
	}

	_bulkCopy() {
		const names = [...this.selection];
		frappe.prompt(
			[{ fieldname: "target", fieldtype: "Link", options: "UCC Survey Version", label: __("Target version"), reqd: 1 }],
			(v) => {
				this._call("copy_questions_to_version", { names: JSON.stringify(names), target_version: v.target }).then((created) => {
					frappe.show_alert({ message: __("Copied {0} questions", [(created || []).length]), indicator: "green" });
				});
			}, __("Copy questions to version"), __("Copy"));
	}

	_openBulk() {
		if (!this._guardEditable()) return;
		this._sheet(false, `<h5>${__("Bulk paste questions")}</h5>
			<p class="text-muted" style="font-size:12px">${__("One per line: question | type | options")}</p>
			<textarea class="form-control ucc-sb-bulktext" rows="8" placeholder="The orientation was clear | Rating | 1,2,3,4,5"></textarea>
			<button class="btn btn-primary btn-sm ucc-sb-bulkgo" style="margin-top:10px">${__("Create questions")}</button>`);
		this._modal.find(".ucc-sb-bulkgo").on("click", () => {
			const text = this._modal.find(".ucc-sb-bulktext").val();
			this._call("bulk_paste_questions", { survey_version: this.version.name, text }).then((created) => {
				this._closeSheet();
				if (created && created.length) {
					const st = { names: created };
					const redo = () => this._call("bulk_paste_questions", { survey_version: this.version.name, text }).then((nm) => { st.names = nm; });
					this._record({ undo: () => this._call("bulk_delete_questions", { names: JSON.stringify(st.names) }), redo });
					frappe.show_alert({ message: __("Created {0} questions", [created.length]), indicator: "green" });
				}
				this.load(this.version.name);
			});
		});
	}


	// Item A: width is dragged HERE, in the Questions panel, on the real grid.
	//
	// The collision this has to solve: a mousedown inside a draggable="true"
	// element starts an HTML5 drag as soon as the pointer moves, so grabbing the
	// grip would otherwise begin a reorder. Fixed by turning draggable off for
	// exactly as long as the grip is held. Deliberately NOT fixed by moving
	// draggable onto the ⋮⋮ handle - that changes how the verified reorder
	// behaves for a cosmetic gain.
	//
	// Reorder is otherwise untouched: this handler stops propagation, so no
	// dragstart, drop or index arithmetic sees it at all.
	_wireWidthResize($card, q) {
		const $grip = $card.find(".ucc-sb-grip");
		$grip.on("mousedown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			$card.attr("draggable", false);
			$grip.addClass("dragging");
			const startX = e.clientX;
			const colWidth = (this.$list.width() || 1) / 12;
			const startSpan = SPAN_OF[q.layout_width] || 12;
			let width = q.layout_width || WIDTHS[0];
			const move = (ev) => {
				const wanted = startSpan + (ev.clientX - startX) / colWidth;
				// Nearest span the grid actually offers, not the nearest column:
				// there is no pixel width field and there must not be one.
				const [, label] = SPANS.reduce((best, s) =>
					Math.abs(s[0] - wanted) < Math.abs(best[0] - wanted) ? s : best);
				if (label === width) return;
				width = label;
				$card.removeClass("ucc-sb-w8 ucc-sb-w6 ucc-sb-w4").addClass(WIDTH_CLASS[label] || "");
			};
			const up = () => {
				document.removeEventListener("mousemove", move);
				document.removeEventListener("mouseup", up);
				$grip.removeClass("dragging");
				$card.attr("draggable", this.editable);   // hand reorder straight back
				// One save per drag, on release - never one per pixel.
				if (width !== (q.layout_width || WIDTHS[0])) this._applyWidth(q.name, width);
			};
			document.addEventListener("mousemove", move);
			document.addEventListener("mouseup", up);
		});
	}

	// Preview is the REAL respondent page now: same renderer (UCCSurveyForm),
	// same stylesheet (public/css/ucc_survey_form.bundle.css), same payload shape. What used to
	// be here - a per-type widget switch, a grid renderer, and a second copy of
	// the page-split rule - is deleted, not refactored. Layout editing moved to
	// the Questions panel, so this is pure preview again.
	//
	// preview_payload is the AUTHOR's gate (logged in + read permission on the
	// version), never the respondent's, and it passes no onSubmit - so the form
	// renders without a submit button and has no token to submit with.
	_preview() {
		if (!this.version) return frappe.msgprint(__("Pick a survey version first."));
		if (!window.UCCSurveyForm) {
			return frappe.msgprint(__("Preview assets are not loaded. Run: bench build --app ucc_measurement_outcomes && bench restart"));
		}
		let mobile = false;
		frappe.call({
			method: "ucc_measurement_outcomes.api.public.preview_payload",
			args: { survey_version: this.version.name },
			callback: (r) => {
				if (!r.message) return;
				this._sheet(mobile, `<h5>${__("Preview")} — <span class="ucc-sb-vp"></span></h5>
					<button class="btn btn-xs btn-default ucc-sb-toggle" style="margin-bottom:10px">${__("Toggle desktop / mobile")}</button>
					<div class="ucc-survey ucc-sb-previewform"></div>`);
				const setvp = () => {
					this._modal.find(".ucc-sb-sheet").toggleClass("mobile", mobile);
					this._modal.find(".ucc-sb-vp").text(mobile ? __("Mobile") : __("Desktop"));
				};
				setvp();
				this._modal.find(".ucc-sb-toggle").on("click", () => { mobile = !mobile; setvp(); });
				window.UCCSurveyForm.render(this._modal.find(".ucc-sb-previewform").get(0), r.message, {});
			},
		});
	}


	_sheet(mobile, html) {
		const $s = this._modal.find(".ucc-sb-sheet").toggleClass("mobile", !!mobile);
		$s.html(`<div class="ucc-sb-sheet-head"><b>${__("UCC Survey Builder")}</b><button class="ucc-sb-iconbtn ucc-sb-close">✕</button></div><div class="ucc-sb-sheet-body">${html}</div>`);
		this._modal.addClass("show");
		this._modal.find(".ucc-sb-close").on("click", () => this._closeSheet());
	}
	_closeSheet() { this._modal.removeClass("show"); }

	_select(name) { this.selected = name; this._renderQuestions(); this._renderInspector(); }

	// Conditional display. Only questions EARLIER in the list are offered as the
	// controller, which is what makes a cycle impossible - there is nothing to
	// detect, because a backwards-only rule cannot form one. Markers get no
	// controls at all: they have no answer to hide.
	_logicFields(q, dis, opt) {
		if (MARKER_TYPES.has(q.question_type)) return "";
		const earlier = this.questions
			.slice(0, this.questions.findIndex((x) => x.name === q.name))
			.filter((x) => !MARKER_TYPES.has(x.question_type));
		if (!earlier.length) {
			return `<div class="text-muted" style="font-size:11px;margin-top:10px">${__("The first question cannot depend on an earlier answer.")}</div>`;
		}
		let rule = {};
		try { rule = JSON.parse(q.display_logic_config || "{}") || {}; } catch (e) { rule = {}; }
		const mode = q.display_logic || LOGIC_MODES[0];
		const qOpts = earlier.map((x, i) => {
			const label = `${i + 1}. ${(x.question_text || "").slice(0, 60)}`;
			return `<option value="${frappe.utils.escape_html(x.name)}" ${x.name === rule.question ? "selected" : ""}>${frappe.utils.escape_html(label)}</option>`;
		}).join("");
		return `
			<hr style="margin:14px 0">
			<div class="form-group"><label>${__("Show This Question")}</label>
				<select class="form-control" data-f="display_logic" ${dis}>${opt(LOGIC_MODES, mode)}</select></div>
			<div class="ucc-sb-logic" style="${mode === LOGIC_MODES[0] ? "display:none" : ""}">
				<div class="form-group"><label>${__("When")}</label><select class="form-control" data-f="logic_question" ${dis}>${qOpts}</select></div>
				<div class="form-group"><label>${__("Is")}</label><select class="form-control" data-f="logic_operator" ${dis}>${opt(LOGIC_OPERATORS, rule.operator || "equals")}</select></div>
				<div class="form-group"><label>${__("This Value")}</label><input type="text" class="form-control" data-f="logic_value" value="${frappe.utils.escape_html(rule.value == null ? "" : String(rule.value))}" ${dis}></div>
				<div class="text-muted" style="font-size:11px">${__("Hidden questions are never required and their answers are not stored. The server re-checks this at submit time.")}</div>
			</div>`;
	}

	_renderInspector() {
		const q = this.questions.find((x) => x.name === this.selected);
		if (!q) { this.$inspector.html(`<p class="text-muted" style="font-size:12px">${__("Select a question to edit its wording, type, options and display logic.")}</p>`); return; }
		const opt = (arr, val) => arr.map((o) => `<option ${o === val ? "selected" : ""}>${frappe.utils.escape_html(o)}</option>`).join("");
		const choicesText = (q.choices || []).map((c) => (c.choice_value ? `${c.choice_label}|${c.choice_value}` : c.choice_label)).join("\n");
		const dis = this.editable ? "" : "disabled";
		this.$inspector.html(`
			<div class="form-group"><label>${__("Question")}</label><textarea class="form-control" data-f="question_text" ${dis}>${frappe.utils.escape_html(q.question_text || "")}</textarea></div>
			<div class="form-group"><label>${__("Help Text")}</label><textarea class="form-control" data-f="help_text" ${dis}>${frappe.utils.escape_html(q.help_text || "")}</textarea></div>
			<div class="form-group"><label>${__("Type")}</label><select class="form-control" data-f="question_type" ${dis}>${opt(QUESTION_TYPES, q.question_type)}</select></div>
			<div class="checkbox"><label><input type="checkbox" data-f="is_required" ${q.is_required ? "checked" : ""} ${dis}> ${__("Required")}</label></div>
			<div class="form-group"><label>${__("Width")}</label><select class="form-control" data-f="layout_width">${opt(WIDTHS, q.layout_width || WIDTHS[0])}</select>
				<div class="text-muted" style="font-size:11px;margin-top:4px">${__("Side-by-side on a wide screen; always full width on a phone. Preview shows the real result.")}</div></div>
			${this.editable ? "" : `<button class="btn btn-default btn-sm btn-block ucc-sb-applywidth">${__("Apply Width")}</button>
			<div class="text-muted" style="font-size:11px;margin-top:4px">${__("Width is presentation only, so it stays editable after publishing. Wording, type and choices are frozen.")}</div>`}
			<div class="form-group ucc-sb-matrix" style="${MATRIX_TYPES.has(q.question_type) ? "" : "display:none"}"><label>${__("Grid Rows (statements, one per line)")}</label><textarea class="form-control" data-f="matrix_rows" rows="3" ${dis}>${frappe.utils.escape_html(q.matrix_rows || "")}</textarea></div>
			<div class="form-group ucc-sb-choices" style="${CHOICE_TYPES.has(q.question_type) ? "" : "display:none"}"><label class="ucc-sb-choices-label">${MATRIX_TYPES.has(q.question_type) ? __("Grid Columns (response options, one per line, optional |value)") : __("Choices (one per line, optional |value)")}</label><textarea class="form-control" data-f="choices" rows="4" ${dis}>${frappe.utils.escape_html(choicesText)}</textarea></div>
			${this._logicFields(q, dis, opt)}
			${this.editable ? `<button class="btn btn-primary btn-sm btn-block ucc-sb-apply">${__("Apply Changes")}</button>` : ""}
		`);
		this.$inspector.find('[data-f="display_logic"]').on("change", (e) => {
			this.$inspector.find(".ucc-sb-logic").toggle(e.target.value !== LOGIC_MODES[0]);
		});
		this.$inspector.find('[data-f="question_type"]').on("change", (e) => {
			const isMatrix = MATRIX_TYPES.has(e.target.value);
			this.$inspector.find(".ucc-sb-choices").toggle(CHOICE_TYPES.has(e.target.value));
			this.$inspector.find(".ucc-sb-matrix").toggle(isMatrix);
			this.$inspector.find(".ucc-sb-choices-label").text(
				isMatrix ? __("Grid Columns (response options, one per line, optional |value)") : __("Choices (one per line, optional |value)")
			);
		});
		this.$inspector.find(".ucc-sb-apply").on("click", () => this._apply(q.name));
		this.$inspector.find(".ucc-sb-applywidth").on("click", () =>
			this._applyWidth(q.name, this.$inspector.find('[data-f="layout_width"]').val()));
	}

	// The one edit a frozen version accepts. Sends layout_width ALONE - not the
	// whole inspector payload - so nothing else can ride along and be rejected
	// (or, worse, quietly differ). versioning.presentation_only_change() is what
	// actually decides; this just keeps the request honest.
	_applyWidth(name, width) {
		this._call("update_question", { question: name, payload: JSON.stringify({ layout_width: width }) })
			.then((ok) => {
				if (!ok) return;
				const q = this.questions.find((x) => x.name === name);
				if (q) q.layout_width = width;
				this._renderQuestions();
				frappe.show_alert({ message: __("Width updated"), indicator: "green" });
			});
	}

	_apply(name) {
		if (!this._guardEditable()) return;
		const val = (f) => this.$inspector.find(`[data-f="${f}"]`);
		const choices = val("choices").val().split("\n").map((s) => s.trim()).filter(Boolean).map((line, i) => {
			const [label, value] = line.split("|").map((x) => x.trim());
			return { choice_label: label, choice_value: value || null, sequence: i };
		});
		const payload = {
			question_text: val("question_text").val(), help_text: val("help_text").val(),
			question_type: val("question_type").val(), is_required: val("is_required").is(":checked") ? 1 : 0,
			choices, matrix_rows: val("matrix_rows").val(),
			layout_width: val("layout_width").val(),
		};
		const mode = val("display_logic").val();
		if (mode) {
			payload.display_logic = mode;
			payload.display_logic_config = mode === LOGIC_MODES[0] ? null : JSON.stringify({
				question: val("logic_question").val(),
				operator: val("logic_operator").val(),
				value: val("logic_value").val(),
			});
		}
		this._call("update_question", { question: name, payload: JSON.stringify(payload) }).then(() => {
			frappe.show_alert({ message: __("Question updated"), indicator: "green" });
			this.load(this.version.name);
		});
	}
}
