// Copyright (c) 2026, United Ceres College and contributors
// Reusable "which version am I editing" picker: status pill per entry, a
// checkmark on the active one, an edit affordance, a count footer, and a
// "+ New" action — modelled on a picker Felix described from elsewhere.
//
// It was NOT already built anywhere in this app: Dashboard Studio's own
// "Index Version" control is a bare <select> inside UCCFilterBar, and every
// other version field in the app (Survey Builder, Index Studio) is a plain
// frappe.ui.form.make_control Link. So this is one new shared component,
// built the same way UCCTrail/UCCFilterBar/UCCEmptyState/UCCNodeCanvas were:
// vanilla JS, one injected stylesheet, no framework — so the next page that
// needs this (Index Studio's own version picker is the obvious next adopter)
// does not get a second implementation.

window.UCCVersionPicker = class UCCVersionPicker {
	// container: DOM element.
	// opts.statusColor: {status: "green"|"orange"|"gray"|"red"|"blue"} — reuses
	//   the .indicator-pill colour classes already used throughout this app
	//   (coverage panel, Mapping Studio groups) rather than inventing new ones.
	// opts.onSelect(name), opts.onCreate(), opts.onEdit(name) (omit to hide the
	//   edit affordance), opts.newLabel, opts.placeholder.
	constructor(container, opts = {}) {
		this.container = container;
		this.statusColor = opts.statusColor || {};
		this.onSelect = opts.onSelect || function () {};
		this.onCreate = opts.onCreate || null;
		this.onEdit = opts.onEdit || null;
		this.newLabel = opts.newLabel || __("+ New");
		this.placeholder = opts.placeholder || __("Pick…");
		this.items = [];
		this.current = null;
		this.open = false;
		this._injectStyle();
		this._build();
		this._onDocClick = (e) => {
			if (this.open && !this.container.contains(e.target)) this._close();
		};
		document.addEventListener("click", this._onDocClick);
	}

	destroy() {
		document.removeEventListener("click", this._onDocClick);
	}

	_injectStyle() {
		if (document.getElementById("ucc-vp-style")) return;
		const el = document.createElement("style");
		el.id = "ucc-vp-style";
		el.textContent = `
		.ucc-vp{position:relative;display:inline-block;max-width:100%}
		.ucc-vp-trigger{display:flex;align-items:center;gap:8px;width:100%;max-width:360px;
			border:1px solid var(--border-color,#d9e0ea);border-radius:8px;background:var(--card-bg,#fff);
			padding:7px 10px;cursor:pointer;text-align:left;font-size:12px}
		.ucc-vp-trigger:hover{border-color:var(--primary,#4a63e7)}
		.ucc-vp-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
		.ucc-vp-title.muted{font-weight:400;color:var(--text-muted,#8b95a5)}
		.ucc-vp-caret{color:var(--text-muted,#98a1af);font-size:10px}
		.ucc-vp-panel{position:absolute;z-index:60;top:calc(100% + 4px);left:0;width:340px;max-width:90vw;
			background:var(--card-bg,#fff);border:1px solid var(--border-color,#d9e0ea);border-radius:10px;
			box-shadow:0 12px 30px rgba(23,41,77,.14);display:none;overflow:hidden}
		.ucc-vp-panel.show{display:block}
		.ucc-vp-list{max-height:280px;overflow-y:auto}
		.ucc-vp-item{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;font-size:12px}
		.ucc-vp-item:hover{background:var(--bg-light-gray,#eef2f7)}
		.ucc-vp-item.current{background:#eef3ff}
		.ucc-vp-check{width:14px;flex:0 0 auto;color:var(--primary,#4a63e7);font-weight:700}
		.ucc-vp-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.ucc-vp-edit{border:0;background:transparent;cursor:pointer;color:var(--text-muted,#8b95a5);
			padding:2px 5px;border-radius:5px;flex:0 0 auto}
		.ucc-vp-edit:hover{background:var(--bg-light-gray,#eef2f7);color:var(--primary,#4a63e7)}
		.ucc-vp-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;
			padding:8px 10px;border-top:1px solid var(--border-color,#e2e6ea);font-size:11px;
			color:var(--text-muted,#8b95a5)}
		.ucc-vp-new{border:0;background:transparent;color:var(--primary,#4a63e7);cursor:pointer;
			font-size:12px;font-weight:600;padding:2px 4px}
		.ucc-vp-new:hover{text-decoration:underline}
		.ucc-vp-empty{padding:14px 10px;font-size:12px;color:var(--text-muted,#8b95a5);text-align:center}
		`;
		document.head.appendChild(el);
	}

	_build() {
		this.container.classList.add("ucc-vp");
		this.container.innerHTML =
			`<button type="button" class="ucc-vp-trigger">
				<span class="ucc-vp-title muted"></span>
				<span class="ucc-vp-pill"></span>
				<span class="ucc-vp-caret">▾</span>
			</button>
			<div class="ucc-vp-panel">
				<div class="ucc-vp-list"></div>
				<div class="ucc-vp-footer">
					<span class="ucc-vp-count"></span>
					${this.onCreate ? `<button type="button" class="ucc-vp-new">${frappe.utils.escape_html(this.newLabel)}</button>` : ""}
				</div>
			</div>`;
		this.$trigger = this.container.querySelector(".ucc-vp-trigger");
		this.$panel = this.container.querySelector(".ucc-vp-panel");
		this.$list = this.container.querySelector(".ucc-vp-list");
		this.$title = this.container.querySelector(".ucc-vp-title");
		this.$pill = this.container.querySelector(".ucc-vp-pill");
		this.$count = this.container.querySelector(".ucc-vp-count");
		this.$trigger.addEventListener("click", (e) => { e.stopPropagation(); this._toggle(); });
		const $new = this.container.querySelector(".ucc-vp-new");
		if ($new) $new.addEventListener("click", (e) => { e.stopPropagation(); this._close(); this.onCreate(); });
	}

	_pillClass(status) {
		return this.statusColor[status] || "gray";
	}

	_toggle() { this.open ? this._close() : this._openPanel(); }
	_openPanel() { this.open = true; this.$panel.classList.add("show"); }
	_close() { this.open = false; this.$panel.classList.remove("show"); }

	// items: [{name, label, status}], current: name or null.
	setItems(items, current) {
		this.items = items || [];
		this.current = current || null;
		this._renderTrigger();
		this._renderList();
	}

	_renderTrigger() {
		const item = this.items.find((i) => i.name === this.current);
		this.$title.textContent = item ? item.label : this.placeholder;
		this.$title.classList.toggle("muted", !item);
		this.$pill.innerHTML = item
			? `<span class="indicator-pill ${this._pillClass(item.status)}">${frappe.utils.escape_html(item.status || "")}</span>`
			: "";
	}

	_renderList() {
		if (!this.items.length) {
			this.$list.innerHTML = `<div class="ucc-vp-empty">${__("Nothing yet.")}</div>`;
		} else {
			this.$list.innerHTML = this.items.map((i) => {
				const isCurrent = i.name === this.current;
				return `<div class="ucc-vp-item ${isCurrent ? "current" : ""}" data-name="${frappe.utils.escape_html(i.name)}">
					<span class="ucc-vp-check">${isCurrent ? "✓" : ""}</span>
					<span class="ucc-vp-name">${frappe.utils.escape_html(i.label)}</span>
					<span class="indicator-pill ${this._pillClass(i.status)}">${frappe.utils.escape_html(i.status || "")}</span>
					${this.onEdit ? `<button type="button" class="ucc-vp-edit" title="${__("Edit")}" data-edit="${frappe.utils.escape_html(i.name)}">✎</button>` : ""}
				</div>`;
			}).join("");
		}
		this.$count.textContent = __("{0} version(s)", [this.items.length]);
		this.$list.querySelectorAll(".ucc-vp-item").forEach((el) => {
			el.addEventListener("click", () => {
				this._close();
				this.onSelect(el.dataset.name);
			});
		});
		if (this.onEdit) {
			this.$list.querySelectorAll(".ucc-vp-edit").forEach((el) => {
				el.addEventListener("click", (e) => {
					e.stopPropagation();
					this._close();
					this.onEdit(el.dataset.edit);
				});
			});
		}
	}
};
