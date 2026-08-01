// Copyright (c) 2026, United Ceres College and contributors
//
// Measurement Outcomes component library (Phase 1 of the redesign).
//
// Every component here renders the design prototype's own markup and class
// names. Nothing invents a new visual language, and nothing renders a Frappe
// widget: the brief's rule is that Frappe supplies infrastructure (routing,
// auth, permissions, endpoints, audit) and the visible markup is ours.
//
// These are string builders, not stateful widgets. The workspaces own their
// state; this owns how a thing LOOKS. That split is why the same questionRow()
// serves the Survey canvas and the Objectives queue without either knowing
// about the other.
//
// esc() is used on every interpolated value. Question wording, objective names
// and metric labels are all user-entered, and this markup is assembled as HTML
// strings - so escaping is not a formality here, it is the only thing between
// stored text and the DOM.

window.UCCMO = {
	esc(v) {
		return frappe.utils.escape_html(v === null || v === undefined ? "" : String(v));
	},

	icon(id, cls) {
		return window.UCCMOIcons.icon(id, cls);
	},

	// --------------------------------------------------------------- mount ---
	// The prototype is a whole document at height:100vh. Inside Desk the shell
	// must stop above Frappe's navbar and page head, and those heights are not
	// knowable from CSS - so they are measured, never assumed.
	//
	// WHY THIS CANNOT MEASURE AT mount()-CALL TIME. Verified against Frappe's
	// own source (frappe/public/js/frappe/views/pageview.js, v15.83.0):
	// frappe.views.Page's constructor calls frappe.container.add_page(), which
	// creates the page wrapper with .hide() - display:none - BEFORE running the
	// page's own script and triggering on_page_load. Only afterwards does
	// frappe.container.change_to() call .show() and fire the "show" event that
	// on_page_show listens for. So mount() - called from on_page_load - always
	// runs while its own ancestor is display:none, and getBoundingClientRect()
	// on any element inside a display:none ancestor returns an all-zero rect.
	// That is the entire bug: top measured as 0, offset committed as 12,
	// against a real Frappe-chrome height of ~150-160px depending on the site
	// (navbar, dev-mode banner, page-container padding all vary by install).
	//
	// Fix: measure on_page_show (the page is guaranteed visible by then,
	// confirmed by the same source - it fires from inside the "show" handler
	// AFTER .show() runs) and on resize, never at mount time. A measurement
	// that still comes back at the origin (top <= 0) means the page is not
	// actually visible yet regardless of which hook called this, so it is
	// refused rather than committed - a bad value living in a CSS variable is
	// invisible until someone measures a real overflow, same as this bug was.
	refit($root) {
		if (!$root || !$root.length) return;
		const top = $root.get(0).getBoundingClientRect().top;
		if (top <= 0) return;
		$root.get(0).style.setProperty("--ucc-mo-offset", Math.round(top + 12) + "px");
	},

	mount(page, html) {
		window.UCCMOIcons.inject();
		const $host = $(page.main).empty().addClass("ucc-mo-host");
		const $root = $(`<div class="ucc-mo">${html}</div>`).appendTo($host);
		// Best-effort immediate attempt: harmless if it fails the top<=0 guard
		// above, and covers the (non-Frappe-page) case of embedding this
		// somewhere already visible.
		this.refit($root);
		let t;
		$(window).off("resize.ucc-mo").on("resize.ucc-mo", () => {
			clearTimeout(t);
			t = setTimeout(() => this.refit($root), 100);
		});
		return $root;
	},

	// ------------------------------------------------------------ level 1 ---
	// The five workspaces are PARALLEL, not five steps. No progress bar, no
	// numbering, no implied order - that was the explicit instruction, and the
	// old stepper is not reinstated anywhere in this file.
	WORKSPACES: [
		{ key: "surveys", label: "Surveys", icon: "i-survey" },
		{ key: "objectives", label: "Objectives", icon: "i-target" },
		{ key: "metrics", label: "Metrics", icon: "i-metric" },
		{ key: "indices", label: "Indices", icon: "i-index" },
		{ key: "criterion7", label: "Criterion 7", icon: "i-chart" },
	],

	workspaceNav(current, counts) {
		counts = counts || {};
		const btns = this.WORKSPACES.map((w) => {
			const n = counts[w.key];
			return `<button class="workspace-btn ${w.key === current ? "active" : ""}" data-ws="${w.key}">
				${this.icon(w.icon)}<span>${__(w.label)}</span>${
				n === undefined || n === null ? "" : `<span class="count">${this.esc(n)}</span>`}
			</button>`;
		}).join("");
		return `<nav class="workspace-nav">${btns}</nav>`;
	},

	// ------------------------------------------------------------ level 2 ---
	// Workspace name, record, version, status, two or three actions. The record
	// title appears HERE and nowhere else on the screen - repeating it in a pane
	// header is exactly the noise this bar exists to remove.
	//
	// o.picker: true swaps the static title text for an empty mount slot
	// (data-ctx-picker) instead of rendering the record name as plain text.
	// contextBar only builds the slot - the caller mounts window.UCCVersionPicker
	// into it, because that component needs a live DOM element to attach to and
	// this function returns a string. See survey/index workspace _draw() for the
	// mount + destroy-before-remount pattern, required because _draw() replaces
	// this whole bar's HTML on nearly every interaction.
	contextBar(o) {
		const status = o.status
			? this.chip(o.status, o.statusTone || "ok", o.statusIcon)
			: "";
		const title = o.picker
			? `<div class="context-picker" data-ctx-picker></div>`
			: `<span class="context-copy">${this.esc(o.title || __("Nothing selected"))}</span>
				${o.version ? `<span class="version">${this.esc(o.version)}</span>` : ""}`;
		return `<div class="context-bar">
			<div class="context-main">
				<div class="eyebrow">${this.esc(o.eyebrow || "")}</div>
				<div class="title-row">
					${title}
					${status}
				</div>
			</div>
			<div class="context-actions">${(o.actions || []).map((a) => this.button(a)).join("")}</div>
		</div>`;
	},

	// Mounts window.UCCVersionPicker (public/js/version_picker.js, already used
	// by the old Survey Builder - reused here rather than building a second
	// picker) into a contextBar's data-ctx-picker slot.
	//
	// `holder` is whatever object owns the picker's lifetime (a workspace
	// instance); `holder._ctxPicker` is destroyed before a new one replaces it,
	// because _draw() rebuilds the context bar's HTML on nearly every click and
	// UCCVersionPicker registers a document click listener in its constructor
	// that only unregisters via .destroy() - never recreating it leaks one
	// listener per render, and never destroying the old one leaks the rest.
	mountPicker(holder, $root, opts, items, current) {
		if (holder._ctxPicker) holder._ctxPicker.destroy();
		const el = $root.find("[data-ctx-picker]").get(0);
		if (!el) return null;
		holder._ctxPicker = new window.UCCVersionPicker(el, opts);
		holder._ctxPicker.setItems(items, current);
		return holder._ctxPicker;
	},

	// ------------------------------------------------------------ level 3 ---
	tabs(items, current) {
		return `<div class="tabs-bar"><div class="tabs">${items.map((t) =>
			`<button class="tab ${t.key === current ? "active" : ""}" data-tab="${t.key}">${
				__(t.label)}</button>`).join("")}</div></div>`;
	},

	// ------------------------------------------------------------ level 4 ---
	// ONE strip, not four summary cards. Entries with `ws` are actionable: the
	// brief's example is clicking "5 unmapped" to land in the Objectives queue,
	// and a statistic you can act on is worth more than four you can only read.
	statusStrip(stats, message) {
		const cells = stats.map((s) => {
			const body = `<b>${this.esc(s.value)}</b> <span>${__(s.label)}</span>`;
			return s.ws
				? `<button class="stat status-link" data-goto="${s.ws}" ${
					s.arg ? `data-arg="${this.esc(s.arg)}"` : ""} title="${
					__("Open in {0}", [__(s.wsLabel || s.ws)])}">${body}</button>`
				: `<span class="stat">${body}</span>`;
		}).join('<span class="stat-divider"></span>');
		return `<div class="status-strip">${cells}${
			message ? `<span class="status-message ${message.tone || ""}">${
				message.icon ? this.icon(message.icon, "xs") : ""}${this.esc(message.text)}</span>` : ""}</div>`;
	},

	// ---------------------------------------------------------- primitives ---
	button(a) {
		if (a.html) return a.html;
		const cls = ["btn", a.tone || "", a.small ? "small" : "", a.iconOnly ? "icon-only" : ""]
			.filter(Boolean).join(" ");
		return `<button class="${cls}" data-act="${a.act || ""}" ${
			a.disabled ? "disabled" : ""} title="${this.esc(a.title || a.label || "")}">${
			a.icon ? this.icon(a.icon, "sm") : ""}${a.iconOnly ? "" : __(a.label || "")}</button>`;
	},

	// Tone is semantic, per the brief's colour table: green = published/valid/
	// linked, amber = incomplete/below target, red = destructive or a genuine
	// error, purple = metric. Nothing here colours a thing merely to decorate it.
	chip(text, tone, icon) {
		return `<span class="chip ${tone || ""}">${
			icon ? this.icon(icon, "xs") : '<span class="status-dot"></span>'}${this.esc(text)}</span>`;
	},

	// o.collapse: {act, label, collapsed, side: "left"|"right"} - renders the
	// prototype's own collapse mechanism (verified against the artifact's real
	// markup, not approximated): a .hide-collapsed wrapper around the title, a
	// .mini chevron button OUTSIDE it (so it survives collapsing), and a
	// .collapse-label sibling the prototype's own CSS shows only once
	// .pane carries .collapsed - a "narrow vertical control" the brief requires,
	// not a squished header, which is what collapsing produced before this
	// wired the real mechanism instead of only shrinking the grid column.
	pane(o) {
		const collapsed = !!(o.collapse && o.collapse.collapsed);
		return `<section class="pane ${o.cls || ""} ${collapsed ? "collapsed" : ""}">
			<header class="pane-head">
				<div class="hide-collapsed pane-title-with-icon">${o.icon ? this.icon(o.icon, "sm") : ""}<span>${
					__(o.title)}</span>${o.count === undefined ? "" : `<span class="count">${this.esc(o.count)}</span>`}</div>
				<div class="hide-collapsed">${(o.actions || []).map((a) => this.button(Object.assign({ small: true }, a))).join("")}</div>
				${o.collapse ? this._collapseButton(o.collapse) : ""}
			</header>
			<div class="pane-body ${o.bodyCls || ""}">${o.body || ""}</div>
		</section>`;
	},

	_collapseButton(c) {
		const closedIcon = c.side === "right" ? "i-chevron-left" : "i-chevron-right";
		const openIcon = c.side === "right" ? "i-chevron-right" : "i-chevron-left";
		return `<button class="mini" data-act="${c.act}" aria-label="${this.esc(c.label)}" title="${
			this.esc(c.label)}">${this.icon(c.collapsed ? closedIcon : openIcon, "sm")}</button>
			<span class="collapse-label">${this.esc(c.shortLabel || c.label)}</span>`;
	},

	// The inspector is the brief's central interaction rule: it must always match
	// the selected object and never keep a previous selection's settings. Callers
	// re-render it wholesale for that reason - there is no partial update path.
	inspector(o) {
		const tabs = (o.tabs || []).map((t) =>
			`<button class="inspector-tab ${t.key === o.tab ? "active" : ""}" data-itab="${t.key}">${
				__(t.label)}</button>`).join("");
		// .active is the prototype's own mechanism: it pre-renders one inspector
		// per node type and shows the matching one. This renders exactly one, so
		// the one rendered is always the active one - but the class stays rather
		// than deleting the display:none rule, so the prototype still describes
		// what is happening.
		const collapsed = !!(o.collapse && o.collapse.collapsed);
		return `<section class="pane inspector-panel active ${collapsed ? "collapsed" : ""}">
			<header class="pane-head">
				<div class="hide-collapsed pane-title-with-icon">${o.icon ? this.icon(o.icon, "sm") : ""}<span>${
					__(o.title)}</span></div>
				${o.collapse ? this._collapseButton(o.collapse) : ""}
			</header>
			${tabs ? `<div class="inspector-tabs">${tabs}</div>` : ""}
			<div class="pane-body">${o.body || ""}${
				// INSIDE pane-body, not beside it. The prototype's footer is
				// position:sticky with negative margins that break out of
				// pane-body's own padding - as a sibling it renders in the right
				// place by accident and stops sticking the moment the body scrolls,
				// which is the one thing it exists to do.
				o.footer ? `<div class="inspector-footer">${o.footer}</div>` : ""}</div>
		</section>`;
	},

	// Sticky footer, per "do not make users scroll to find Save".
	footerActions(actions) {
		return actions.map((a) => this.button(a)).join("");
	},

	field(o) {
		const lock = o.locked
			? `<span class="field-lock" title="${this.esc(o.lockReason || "")}">${
				this.icon("i-lock", "xs")}${__("Protected")}</span>`
			: "";
		let control;
		if (o.type === "textarea") {
			control = `<textarea data-f="${o.name}" rows="${o.rows || 3}" ${
				o.locked ? "disabled" : ""} placeholder="${this.esc(o.placeholder || "")}">${
				this.esc(o.value)}</textarea>`;
		} else if (o.type === "select") {
			control = `<select data-f="${o.name}" ${o.locked ? "disabled" : ""}>${
				(o.options || []).map((v) => {
					const val = v.value === undefined ? v : v.value;
					const lab = v.label === undefined ? v : v.label;
					return `<option value="${this.esc(val)}" ${
						String(val) === String(o.value) ? "selected" : ""}>${this.esc(lab)}</option>`;
				}).join("")}</select>`;
		} else if (o.type === "switch") {
			control = `<div class="switch-row"><button class="switch ${o.value ? "on" : ""}" data-f="${
				o.name}" ${o.locked ? "disabled" : ""}></button><span>${__(o.switchLabel || "")}</span></div>`;
		} else {
			control = `<input data-f="${o.name}" type="${o.type || "text"}" ${
				o.locked ? "disabled" : ""} value="${this.esc(o.value)}" placeholder="${
				this.esc(o.placeholder || "")}">`;
		}
		return `<div class="field">
			<label>${__(o.label)}${lock}</label>
			${control}
			${o.help ? `<div class="help">${this.esc(o.help)}</div>` : ""}
		</div>`;
	},

	// One row shape for a question wherever it appears. `state` is the objective
	// mapping status, and it is amber-not-red on purpose: an unmapped question is
	// incomplete, not broken, and red is reserved for real errors.
	questionRow(q, o) {
		o = o || {};
		const mapped = (q.objectives || []).length > 0;
		return `<div class="question-row ${o.selected ? "selected" : ""}" data-q="${this.esc(q.name)}">
			<span class="drag" title="${__("Drag to reorder")}">${o.editable ? "⋮⋮" : ""}</span>
			<span class="type-icon">${this.icon(window.UCCMOIcons.forQuestionType(q.question_type))}</span>
			<div class="question-copy">
				<div class="question">${o.index === undefined ? "" : o.index + ". "}${
					this.esc(q.question_text || __("Untitled question"))}${
					q.is_required ? ' <span class="warn">*</span>' : ""}</div>
				<div class="question-meta">
					<span>${this.esc(q.question_type || "")}</span>
					<span class="map-dot ${mapped ? "ok" : ""}"></span>
					<span>${mapped ? this.esc((q.objectives || []).join(", ")) : __("No objective")}</span>
					${q.correction_reason ? `<span class="chip warning" title="${
						this.esc(q.correction_reason)}">${__("wording corrected")}</span>` : ""}
				</div>
			</div>
			<div class="row-actions">${(o.actions || []).map((a) =>
				`<button class="mini" data-act="${a.act}" data-q="${this.esc(q.name)}" title="${
					this.esc(a.title)}">${this.icon(a.icon, "sm")}</button>`).join("")}</div>
		</div>`;
	},

	node(o) {
		return `<div class="node ${o.kind || ""} ${o.selected ? "selected" : ""}" data-node="${
			this.esc(o.key)}" style="${o.style || ""}">
			<div class="node-kicker">${this.esc(o.kicker || "")}</div>
			<div class="node-title">${this.esc(o.title)}</div>
			${o.meta ? `<div class="node-meta">${this.esc(o.meta)}</div>` : ""}
		</div>`;
	},

	empty(text, action) {
		return `<div class="mapping-empty"><div>${this.esc(text)}</div>${
			action ? this.button(Object.assign({ small: true }, action)) : ""}</div>`;
	},

	// Searchable popover, used by the Add-question type picker. Kept generic so
	// the brief's "do not show everything by default" rule has one implementation
	// rather than one per workspace.
	popover(o) {
		return `<div class="add-popover ${o.open ? "open" : ""}" data-pop="${o.key}">
			<div class="add-search">${this.icon("i-search", "sm")}<input type="text" data-pop-search
				placeholder="${this.esc(o.placeholder || __("Search…"))}"></div>
			<div class="type-grid">${o.items.map((it) =>
				// <strong> and a bare <span>, matching the prototype's own markup
				// exactly (not <b>/<small>): .type-btn strong and .type-btn span are
				// its real selectors (10px / 9px). <small> here compounded on top of
				// that 9px via the browser's UA default (small{font-size:.875em}),
				// landing at 7.875px that nobody chose - 17 elements, one for every
				// entry in TYPES, all from this one call site.
				`<button class="type-btn" data-pick="${this.esc(it.value)}" data-label="${
					this.esc((it.label + " " + (it.help || "")).toLowerCase())}">
					<span class="type-icon">${this.icon(it.icon)}</span>
					<div><strong>${this.esc(it.label)}</strong>${it.help ? `<span>${this.esc(it.help)}</span>` : ""}</div>
				</button>`).join("")}</div>
		</div>`;
	},

	// Wires a popover's search box to filter its own grid. One place, so every
	// picker in the app filters identically.
	wirePopover($root, key) {
		const $pop = $root.find(`[data-pop="${key}"]`);
		$pop.find("[data-pop-search]").on("input", (e) => {
			const q = (e.target.value || "").toLowerCase().trim();
			$pop.find(".type-btn").each((_, el) => {
				el.style.display = !q || el.dataset.label.indexOf(q) !== -1 ? "" : "none";
			});
		});
		return $pop;
	},
};
