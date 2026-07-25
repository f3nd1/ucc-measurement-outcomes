// Copyright (c) 2026, United Ceres College and contributors
// Shared empty-state: a short message plus an optional primary action, so an
// empty page reads as "nothing here yet, do this" instead of looking broken.
// Used by Survey Builder, Mapping Studio, Index Studio and Dashboard Studio.

window.UCCEmptyState = {
	// el: DOM element to fill. opts: {message, actionLabel, onAction}
	render(el, opts) {
		if (!el) return;
		this._injectStyle();
		const $el = $(el).empty().addClass("ucc-empty");
		$('<div class="ucc-empty-msg"></div>').text(opts.message || "").appendTo($el);
		if (opts.actionLabel && opts.onAction) {
			$('<button class="btn btn-primary btn-sm"></button>')
				.text(opts.actionLabel)
				.appendTo($el)
				.on("click", opts.onAction);
		}
	},

	_injectStyle() {
		if (document.getElementById("ucc-empty-style")) return;
		const el = document.createElement("style");
		el.id = "ucc-empty-style";
		// flex-direction/gap also apply when this is rendered into the canvas's
		// own .ucc-nc-empty slot, which is already display:flex and centred.
		el.textContent = `
		.ucc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;
			gap:10px;padding:26px;text-align:center}
		.ucc-empty-msg{color:var(--text-muted,#8b95a5);font-size:12px;max-width:340px}
		`;
		document.head.appendChild(el);
	},
};
