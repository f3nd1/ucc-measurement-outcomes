// Copyright (c) 2026, United Ceres College and contributors
// Reusable dashboard filter bar. Renders a row of labelled selects, populated
// via setOptions(), and fires onChange with the current values. Shared across
// Dashboard Studio views (and available to other pages).

window.UCCFilterBar = class UCCFilterBar {
	// container: DOM element. fields: [{name, label}]. onChange(values): callback.
	constructor(container, opts = {}) {
		this.container = container;
		this.fields = opts.fields || [];
		this.onChange = opts.onChange || function () {};
		this.values = {};
		this.selects = {};
		this._render();
	}

	_render() {
		this.container.innerHTML = "";
		this.container.style.display = "flex";
		this.container.style.flexWrap = "wrap";
		this.container.style.gap = "10px";
		this.fields.forEach((f) => {
			const wrap = document.createElement("div");
			wrap.innerHTML =
				'<label style="display:block;font-size:11px;color:var(--text-muted,#8b95a5)">' +
				frappe.utils.escape_html(f.label) + "</label>";
			const sel = document.createElement("select");
			sel.className = "form-control input-sm";
			sel.style.width = "auto";
			sel.innerHTML = '<option value=""></option>';
			sel.addEventListener("change", () => {
				this.values[f.name] = sel.value;
				this.onChange(this.get());
			});
			wrap.appendChild(sel);
			this.container.appendChild(wrap);
			this.selects[f.name] = sel;
		});
	}

	setOptions(name, options) {
		const sel = this.selects[name];
		if (!sel) return;
		const current = sel.value;
		sel.innerHTML =
			'<option value=""></option>' +
			(options || [])
				.map((o) => '<option value="' + frappe.utils.escape_html(String(o)) + '">' + frappe.utils.escape_html(String(o)) + "</option>")
				.join("");
		if (options && options.indexOf(current) !== -1) sel.value = current;
	}

	get() {
		const out = {};
		Object.keys(this.values).forEach((k) => {
			if (this.values[k]) out[k] = this.values[k];
		});
		return out;
	}
};
