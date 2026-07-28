// Copyright (c) 2026, United Ceres College and contributors
// Shared empty-state: a short message plus an optional primary action, so an
// empty page reads as "nothing here yet, do this" instead of looking broken.
// Used by Survey Builder, Mapping Studio, Index Studio and Dashboard Studio.

window.UCCEmptyState = {
	// el: DOM element to fill. opts: {message, actionLabel, onAction}
	//
	// The empty state is rendered as a CHILD and the .ucc-empty class is never
	// put on `el` itself. It used to be, and that class carries display:flex —
	// so any container that hosts an empty state and is later reused for real
	// content kept the flex display forever, silently beating whatever layout
	// that container was supposed to have. It cost the Survey Builder its
	// 12-column Questions grid: .ucc-empty on .ucc-sb-list overrode
	// display:grid, every card stacked full width, and the width classes looked
	// broken while being perfectly correct.
	//
	// Callers clear with .empty() and nothing else, which is exactly why the
	// class must not live on the element they clear. As a child it goes when
	// the content goes, for every caller, including ones not written yet.
	render(el, opts) {
		if (!el) return;
		this._injectStyle();
		const $box = $('<div class="ucc-empty"></div>').appendTo($(el).empty());
		$('<div class="ucc-empty-msg"></div>').text(opts.message || "").appendTo($box);
		if (opts.actionLabel && opts.onAction) {
			$('<button class="btn btn-primary btn-sm"></button>')
				.text(opts.actionLabel)
				.appendTo($box)
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
			gap:10px;padding:26px;text-align:center;width:100%}
		.ucc-empty-msg{color:var(--text-muted,#8b95a5);font-size:12px;max-width:340px}
		`;
		document.head.appendChild(el);
	},
};
