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
		.ucc-sb-chip:hover{border-color:var(--primary,#4a63e7)}
		.ucc-sb-list{min-height:220px;display:flex;flex-direction:column;gap:9px}
		.ucc-sb-empty{border:2px dashed var(--border-color,#cbd4df);border-radius:10px;padding:28px;text-align:center;color:var(--text-muted,#8b95a5)}
		.ucc-sb-q{border:1px solid var(--border-color,#e2e6ea);border-radius:9px;padding:10px 12px;display:grid;grid-template-columns:18px 20px 1fr auto;gap:9px;align-items:start;background:var(--fg-color,#fff)}
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
		.ucc-sb-pq{padding:12px 0;border-bottom:1px solid #eee}
		/* Preview mirrors www/survey.html's grid so what the builder shows is what
		   the respondent gets. Same rule: never grid-auto-flow:dense. The mobile
		   toggle is a fixed-width sheet, not a narrow viewport, so the collapse is
		   keyed off .mobile here rather than a media query. */
		/* The grid is per PAGE, same as www/survey.html - a survey with no Page
		   Break is one page, i.e. one grid. Class, not [hidden]: display:grid
		   would otherwise win. */
		.ucc-sb-page{display:none}
		.ucc-sb-page.active{display:grid;grid-template-columns:repeat(12,1fr);column-gap:20px}
		.ucc-sb-pagenav{display:flex;align-items:center;gap:8px;margin-top:14px;
			padding-top:10px;border-top:1px solid var(--border-color,#e2e6ea)}
		.ucc-sb-pagepos{font-size:11px;color:#8b95a5;margin-left:auto}
		.ucc-sb-pq,.ucc-sb-sec{grid-column:1/-1}
		.ucc-sb-w8{grid-column:span 8}
		.ucc-sb-w6{grid-column:span 6}
		.ucc-sb-w4{grid-column:span 4}
		.ucc-sb-sheet.mobile .ucc-sb-pq{grid-column:1/-1}
		.ucc-sb-cond{font-size:11px;color:#8b95a5;margin-bottom:6px}
		.ucc-sb-pq label.q{display:block;font-weight:600;margin-bottom:6px}
		/* Item 2: same star markup/classes as the public form's, so the preview
		   looks like what a respondent actually sees. Real radios underneath
		   (visually hidden, not display:none) keep native label-click and
		   keyboard behaviour; only the visual is a star, not the stored value. */
		.ucc-stars{position:relative;display:flex;gap:2px}
		.ucc-star-input{position:absolute;opacity:0;width:1px;height:1px;overflow:hidden}
		.ucc-star{font-size:24px;line-height:1;cursor:pointer;color:#d9d9d9;user-select:none}
		.ucc-star.filled{color:#e0a832}
		/* Item 3: same widgets as the public form, same reasoning: duplicated
		   here because a Desk page bundle and a standalone www/ template load
		   separately, with no shared CSS mechanism to reuse instead. */
		.ucc-rank{list-style:none;margin:0;padding:0;border:1px solid var(--border-color,#e2e6ea);border-radius:8px;overflow:hidden}
		.ucc-rank li{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--fg-color,#fff);
			border-bottom:1px solid var(--border-color,#eef2f7);cursor:grab}
		.ucc-rank li:last-child{border-bottom:0}
		.ucc-rank li.dragging{opacity:.4}
		.ucc-rank-handle{color:var(--text-muted,#98a1af)}
		.ucc-slider-wrap{display:flex;align-items:center;gap:12px;max-width:360px}
		.ucc-slider{flex:1}
		.ucc-slider-out{font-weight:600;min-width:2.4em;text-align:right}
		.ucc-nps-row{position:relative;display:flex;gap:4px;flex-wrap:wrap}
		.ucc-nps-input{position:absolute;opacity:0;width:1px;height:1px;overflow:hidden}
		.ucc-nps-btn{width:32px;height:32px;display:flex;align-items:center;justify-content:center;
			border:1px solid var(--border-color,#d9d9d9);border-radius:6px;cursor:pointer;font-size:12px}
		.ucc-nps-btn.selected{background:var(--primary,#4a63e7);color:#fff;border-color:var(--primary,#4a63e7)}
		.ucc-nps-ends{display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted,#8b95a5);margin-top:4px;max-width:380px}
		.ucc-grid{border-collapse:collapse;font-size:12px;width:100%}
		.ucc-grid th,.ucc-grid td{border:1px solid var(--border-color,#e2e6ea);padding:6px 9px}
		.ucc-grid th{background:var(--bg-light-gray,#eef2f7);font-size:11px}
		.ucc-grid td:first-child{text-align:left;font-weight:500}
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
		this.$undo = $(`<button class="btn btn-default btn-sm" disabled>${__("Undo")}</button>`).appendTo($tb).on("click", () => this._undo());
		this.$redo = $(`<button class="btn btn-default btn-sm" disabled>${__("Redo")}</button>`).appendTo($tb).on("click", () => this._redo());
		// Item 4: the public link had no UI at all - a published version with an
		// open campaign gave no way to see or copy the URL respondents use. It
		// lives next to the toolbar so it is visible the moment a version loads.
		this.$link = $('<div class="ucc-sb-link" style="display:none"></div>').appendTo($main);
		this.$bulk = $('<div class="ucc-sb-bulkbar"></div>').appendTo($main);
		this.$banner = $('<div class="ucc-sb-banner" style="display:none"></div>').appendTo($main);
		const $grid = $('<div class="ucc-sb-grid"></div>').appendTo($main);
		this.$palette = $(`<div class="ucc-sb-panel"><h5>${__("Question Types")}</h5><div class="ucc-sb-body"><div class="ucc-sb-palette"></div></div></div>`).appendTo($grid).find(".ucc-sb-palette");
		this.$list = $(`<div class="ucc-sb-panel"><h5>${__("Questions")}</h5><div class="ucc-sb-body"><div class="ucc-sb-list"></div></div></div>`).appendTo($grid).find(".ucc-sb-list");
		this.$inspector = $(`<div class="ucc-sb-panel"><h5>${__("Inspector")}</h5><div class="ucc-sb-body"></div></div>`).appendTo($grid).find(".ucc-sb-body");
		this._renderPalette();
		this._renderInspector();
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
				return this.$link.append(
					$(`<span class="ucc-sb-linkoff">${frappe.utils.escape_html(r.reason || "")}</span>`)
				);
			}
			const more = r.more ? ` <span class="ucc-sb-linkoff">${__("(+{0} more open campaign)", [r.more])}</span>` : "";
			this.$link.append(`<span class="ucc-sb-linklabel">${__("Public link")}</span>`);
			this.$link.append($(`<a href="${frappe.utils.escape_html(r.url)}" target="_blank" rel="noopener">${frappe.utils.escape_html(r.url)}</a>`));
			$(`<button class="btn btn-xs btn-default">${__("Copy")}</button>`).appendTo(this.$link)
				.on("click", () => {
					// frappe.utils.copy_to_clipboard already handles the
					// clipboard API + textarea fallback and shows its own alert.
					frappe.utils.copy_to_clipboard(r.url);
				});
			this.$link.append(more);
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
	_createVersion() {
		const survey = this.version ? this.version.survey : null;
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
		frappe.prompt(
			[{ fieldname: "survey", fieldtype: "Link", options: "UCC Survey", label: __("Survey"), reqd: 1 }],
			(v) => go(v.survey),
			__("New Survey Version"),
			__("Create")
		);
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
			const mapLink = !this.unmapped ? ""
				: isGap
					? `<span class="ucc-sb-maplink gap" data-q="${q.name}">${__("Not linked to an objective — link it")} →</span>`
					: `<span class="ucc-sb-maplink" data-q="${q.name}">${__("Linked to an objective")} →</span>`;
			const $q = $(`
				<div class="ucc-sb-q ${this.selected === q.name ? "selected" : ""} ${isGap ? "gap" : ""}" draggable="${this.editable}" data-index="${i}" data-name="${q.name}">
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

	// Identical to www/survey.html's split: a page is the run of questions
	// between two Page Break markers, and a survey with no break is one page.
	// Deliberately a second copy of five lines rather than a shared module: the
	// only way to literally share it is a JS file loaded on BOTH surfaces, and
	// the guest form is not allowed to gain an external bundle. Kept
	// character-for-character alike so a change to one is obvious in the other.
	// ponytail: 5 duplicated lines; extract only if the public page ever gets a
	// bundle for another reason.
	_pages() {
		const pages = [[]];
		this.questions.forEach((q) => {
			if (q.question_type === "Page Break") { pages.push([]); return; }
			pages[pages.length - 1].push(q);
		});
		const kept = pages.filter((p) => p.length);
		return kept.length ? kept : [[]];
	}

	_preview() {
		let mobile = false;
		const pages = this._pages();
		let n = 0;   // numbering skips markers and never restarts per page
		const form = pages.map((page, pi) => {
			const body = page.map((q) => {
				if (q.question_type === "Section Heading") return `<h4 class="ucc-sb-sec">${frappe.utils.escape_html(q.question_text || "")}</h4>`;
				n += 1;
				const logic = q.display_logic && q.display_logic !== LOGIC_MODES[0]
					? `<div class="ucc-sb-cond">${__("Shown only when an earlier answer matches")}</div>` : "";
				return `<div class="ucc-sb-pq ${WIDTH_CLASS[q.layout_width] || ""}"><label class="q">${n}. ${frappe.utils.escape_html(q.question_text || "")} ${q.is_required ? '<span class="ucc-sb-req">*</span>' : ""}</label>${logic}${this._previewInput(q)}</div>`;
			}).join("");
			return `<div class="ucc-sb-page${pi === 0 ? " active" : ""}" data-page="${pi}">${body}</div>`;
		}).join("");
		const nav = pages.length > 1 ? `<div class="ucc-sb-pagenav">
			<button class="btn btn-xs btn-default ucc-sb-back">${__("Back")}</button>
			<button class="btn btn-xs btn-primary ucc-sb-next">${__("Next")}</button>
			<span class="ucc-sb-pagepos"></span></div>` : "";
		this._sheet(mobile, `<h5>${__("Preview")} — <span class="ucc-sb-vp"></span></h5>
			<button class="btn btn-xs btn-default ucc-sb-toggle" style="margin-bottom:10px">${__("Toggle desktop / mobile")}</button>
			<div class="ucc-sb-previewform">${form}</div>${nav}`);
		const setvp = () => { this._modal.find(".ucc-sb-sheet").toggleClass("mobile", mobile); this._modal.find(".ucc-sb-vp").text(mobile ? __("Mobile") : __("Desktop")); };
		setvp();
		this._modal.find(".ucc-sb-toggle").on("click", () => { mobile = !mobile; setvp(); });
		// Real pagination, like the respondent's form: one page at a time. No
		// required-check on Next here - Preview collects nothing and submits
		// nothing, so blocking the builder from looking at page 2 would be theatre.
		if (pages.length > 1) {
			let current = 0;
			const showPage = (i) => {
				current = i;
				this._modal.find(".ucc-sb-page").each((n2, el) => $(el).toggleClass("active", n2 === i));
				this._modal.find(".ucc-sb-back").prop("disabled", i === 0);
				this._modal.find(".ucc-sb-next").prop("disabled", i === pages.length - 1);
				this._modal.find(".ucc-sb-pagepos").text(__("Page {0} of {1}", [i + 1, pages.length]));
				this._modal.find(".ucc-sb-sheet").scrollTop(0);
			};
			this._modal.find(".ucc-sb-back").on("click", () => showPage(current - 1));
			this._modal.find(".ucc-sb-next").on("click", () => showPage(current + 1));
			showPage(0);
		}
		// Item 2: fill stars up to the checked one. Delegated once per preview
		// render rather than per-star, since the sheet's HTML is rebuilt fresh
		// each time _preview() runs.
		this._modal.find(".ucc-sb-previewform").on("change", ".ucc-star-input", (e) => {
			const $group = $(e.target).closest(".ucc-stars");
			const checkedN = +$(e.target).data("n");
			$group.find(".ucc-star").each((_, el) => $(el).toggleClass("filled", +$(el).data("n") <= checkedN));
		});
		// Item 3: Slider live value, same "input" (not "change") reasoning as
		// the public form — fires continuously while dragging.
		this._modal.find(".ucc-sb-previewform").on("input", ".ucc-slider", (e) => {
			$(e.target).siblings(".ucc-slider-out").text(e.target.value);
		});
		// NPS: highlight the one checked button, same as the public form.
		this._modal.find(".ucc-sb-previewform").on("change", ".ucc-nps-input", (e) => {
			const $group = $(e.target).closest(".ucc-nps-row");
			$group.find("input.ucc-nps-input").each((_, inp) => {
				$group.find(`label[for="${inp.id}"]`).toggleClass("selected", inp.checked);
			});
		});
		// Item 3: Ranking reorder. Same live-move-during-dragover approach as
		// the public form; jQuery delegation here to match this file's style.
		let $draggedLi = null;
		const $form = this._modal.find(".ucc-sb-previewform");
		$form.on("dragstart", ".ucc-rank li", (e) => {
			$draggedLi = $(e.currentTarget).addClass("dragging");
			e.originalEvent.dataTransfer.setData("text/plain", "");
		});
		$form.on("dragend", ".ucc-rank li", (e) => { $(e.currentTarget).removeClass("dragging"); $draggedLi = null; });
		$form.on("dragover", ".ucc-rank li", (e) => {
			e.preventDefault();
			const $li = $(e.currentTarget);
			if (!$draggedLi || $li.is($draggedLi)) return;
			const $items = $li.parent().children();
			if ($items.index($draggedLi) < $items.index($li)) $draggedLi.insertAfter($li);
			else $draggedLi.insertBefore($li);
		});
	}

	_previewInput(q) {
		const choices = q.choices || [];
		switch (q.question_type) {
			case "Paragraph": return '<textarea class="form-control" rows="2"></textarea>';
			// Item 2: star widget, not numbered radios. Real radios underneath
			// (visually hidden) so this stays a native, keyboard-operable form
			// control — only the visual changed, same as the public form.
			case "Rating":
				return choices.length
					? `<div class="ucc-stars">${choices.map((c, i) => {
						const id = `pv_star_${q.name}_${i}`;
						return `<input type="radio" class="ucc-star-input" name="pv_${q.name}" id="${id}" data-n="${i + 1}">` +
							`<label for="${id}" class="ucc-star" data-n="${i + 1}" title="${frappe.utils.escape_html(c.choice_label || "")}">★</label>`;
					}).join("")}</div>`
					: '<input class="form-control" disabled placeholder="(no choices configured)">';
			// Investigation finding: Likert Matrix had no case here either - as
			// unimplemented as the others were. One shared renderer for all
			// three grid types; only the per-cell input differs (radio vs
			// checkbox), matching "reuse B's work" for Checkbox Grid.
			case "Likert Matrix": case "Multiple Choice Grid": case "Checkbox Grid":
				return this._renderGridPreview(q, choices);
			case "Single Choice": case "Yes / No":
				return choices.map((c) => `<label style="display:block;font-weight:400"><input type="radio" name="pv_${q.name}"> ${frappe.utils.escape_html(c.choice_label)}</label>`).join("") || '<input class="form-control">';
			case "Multiple Choice":
				return choices.map((c) => `<label style="display:block;font-weight:400"><input type="checkbox"> ${frappe.utils.escape_html(c.choice_label)}</label>`).join("");
			case "Dropdown":
				return `<select class="form-control"><option></option>${choices.map((c) => `<option>${frappe.utils.escape_html(c.choice_label)}</option>`).join("")}</select>`;
			case "Date": return '<input type="date" class="form-control">';
			case "Number": return '<input type="number" class="form-control">';
			case "Email": return '<input type="email" class="form-control">';
			// NPS: had no case at all, so it fell through to the generic default
			// (a free-text box) - same broken pattern Ranking/Slider/File Upload
			// had. A real 0-10 button row, fixed scale (not driven by choices,
			// same as Slider - NPS is not in CHOICE_TYPES).
			case "NPS":
				return `<div class="ucc-nps">
					<div class="ucc-nps-row">${Array.from({ length: 11 }, (_, n) => {
						const id = `pv_nps_${q.name}_${n}`;
						return `<input type="radio" class="ucc-nps-input" name="pv_${q.name}" id="${id}"><label for="${id}" class="ucc-nps-btn">${n}</label>`;
					}).join("")}</div>
					<div class="ucc-nps-ends"><span>${__("Not at all likely")}</span><span>${__("Extremely likely")}</span></div>
				</div>`;
			// Item 3: a real range input, matching the public form's widget.
			case "Slider":
				return `<div class="ucc-slider-wrap"><input type="range" class="ucc-slider" min="0" max="100" step="1" value="50">
					<output class="ucc-slider-out">50</output></div>`;
			// Item 3: a real drag-to-reorder list. Same interaction the public
			// form uses; this preview never submits anywhere so there is no
			// value to read back, only the reordering itself.
			case "Ranking":
				return choices.length
					? `<ul class="ucc-rank">${choices.map((c) => `<li draggable="true"><span class="ucc-rank-handle">⠿</span> ${frappe.utils.escape_html(c.choice_label)}</li>`).join("")}</ul>`
					: '<p class="text-muted" style="font-size:12px">(no choices configured)</p>';
			// Item 3: a real file picker (harmless here - Preview never submits
			// anywhere). The public form deliberately does NOT get this yet; see
			// the file-upload security note before this checkpoint's report.
			case "File Upload":
				return '<input type="file" class="form-control">';
			default: return '<input class="form-control">';
		}
	}

	// Shared by Likert Matrix, Multiple Choice Grid and Checkbox Grid: rows
	// (matrix_rows, one statement per line) down the side, columns (choices,
	// the SAME table every simple choice type already uses) across the top.
	// Preview never submits anywhere, so this is visual only - no name/value
	// wiring needed the way the public form's version requires.
	_renderGridPreview(q, columns) {
		const rows = (q.matrix_rows || "").split("\n").map((s) => s.trim()).filter(Boolean);
		if (!rows.length || !columns.length) {
			return `<p class="text-muted" style="font-size:12px">${__("(configure grid rows and columns in the Inspector)")}</p>`;
		}
		const multi = MULTI_MATRIX_TYPES.has(q.question_type);
		const head = columns.map((c) => `<th>${frappe.utils.escape_html(c.choice_label)}</th>`).join("");
		const body = rows.map((r, ri) => `<tr><td>${frappe.utils.escape_html(r)}</td>${
			columns.map(() => `<td style="text-align:center"><input type="${multi ? "checkbox" : "radio"}" name="pv_${q.name}_r${ri}"></td>`).join("")
		}</tr>`).join("");
		return `<table class="ucc-grid"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
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
			<div class="form-group"><label>${__("Width")}</label><select class="form-control" data-f="layout_width" ${dis}>${opt(WIDTHS, q.layout_width || WIDTHS[0])}</select>
				<div class="text-muted" style="font-size:11px;margin-top:4px">${__("Side-by-side on a wide screen; always full width on a phone. Preview shows the real result.")}</div></div>
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
