// Copyright (c) 2026, United Ceres College and contributors
//
// UCCZoom: zoom + drag-to-pan for the workbench's three node canvases.
//
// ONE helper, not three implementations. The three canvases (Objectives
// _canvas/_drawLines, Metrics _drawEdges, Indices _formula) really are separate
// renderers with different markup, so sharing was a judgement call rather than
// an obvious win. It went this way for one concrete reason: TWO of the three
// draw SVG connectors from measured pixel coordinates, and zooming changes what
// those measurements mean. getBoundingClientRect() reports POST-transform
// pixels, so once a stage is scaled by k every measured delta is k times too
// large, and the connectors drift off the nodes - the exact class of coordinate
// bug this project has already shipped twice (round-7 Objectives, and the
// Metrics edge-label layer caught in test). Three copies of that divide-by-k
// contract is three chances to get it wrong; one `controller.scale` that every
// renderer divides by is one place to get it right.
//
// Cost, measured before deciding: this file is ~90 lines and each canvas needs
// ~4 lines (attach, three button handlers) plus a one-line `/ k` in the two
// that draw edges. Three separate versions would have been ~70 lines each with
// no shared contract. Sharing is both smaller and safer here.
//
// The transform lives on the STAGE; the viewport keeps its own overflow. Pan is
// translate, zoom is scale, transform-origin is 0 0 so the maths stays trivial.

window.UCCZoom = {
	MIN: 0.5,
	MAX: 2,
	STEP: 0.15,

	// Controls markup. Rendered by the caller into its own canvas head so each
	// toolbar keeps its own layout, but the buttons are named here so all three
	// canvases use the same data-act vocabulary.
	controls() {
		const I = window.UCCMOIcons;
		return `<span class="mx-zoom">
			<button class="mini" data-act="zoom-out" title="${__("Zoom out")}" aria-label="${__("Zoom out")}">${
				I.icon("i-minus", "sm")}</button>
			<button class="mini" data-act="zoom-reset" title="${__("Reset zoom")}" aria-label="${
				__("Reset zoom")}"><span data-zoom-level>100%</span></button>
			<button class="mini" data-act="zoom-in" title="${__("Zoom in")}" aria-label="${__("Zoom in")}">${
				I.icon("i-plus", "sm")}</button>
		</span>`;
	},

	// viewport: the scrolling box. stage: the element that actually gets scaled.
	// onChange: called after any zoom/pan so the caller can redraw connectors.
	attach(viewport, stage, onChange) {
		if (!viewport || !stage) return null;
		const c = {
			scale: 1, x: 0, y: 0,
			viewport, stage,
			_apply() {
				stage.style.transformOrigin = "0 0";
				stage.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
				const $lvl = viewport.closest(".pane") || viewport.parentElement;
				const lvl = $lvl && $lvl.querySelector("[data-zoom-level]");
				if (lvl) lvl.textContent = Math.round(this.scale * 100) + "%";
				if (onChange) onChange(this);
			},
			// Zoom about the viewport's centre, so the thing you were looking at
			// stays roughly where it was instead of flying off the top-left.
			zoomTo(next) {
				const k = Math.min(window.UCCZoom.MAX, Math.max(window.UCCZoom.MIN, next));
				if (k === this.scale) return;
				const r = viewport.getBoundingClientRect();
				const cx = r.width / 2, cy = r.height / 2;
				this.x = cx - ((cx - this.x) / this.scale) * k;
				this.y = cy - ((cy - this.y) / this.scale) * k;
				this.scale = k;
				this._apply();
			},
			zoomIn() { this.zoomTo(this.scale + window.UCCZoom.STEP); },
			zoomOut() { this.zoomTo(this.scale - window.UCCZoom.STEP); },
			reset() { this.scale = 1; this.x = 0; this.y = 0; this._apply(); },
			destroy() {
				viewport.removeEventListener("mousedown", down);
				viewport.removeEventListener("wheel", wheel);
				document.removeEventListener("mousemove", move);
				document.removeEventListener("mouseup", up);
			},
		};

		// Pan must never steal a node click. Anything interactive - a node, a
		// button, a form control - keeps its own gesture; panning is for the
		// empty canvas between them, which is the usual convention and the one
		// the brief asked for.
		const INTERACTIVE = "[data-node], [data-map-node], .map-node, .mx-node, .node, button, a, input, select, textarea, label";
		let panning = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = 0;

		const down = (e) => {
			if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
			panning = true; moved = 0;
			sx = e.clientX; sy = e.clientY; ox = c.x; oy = c.y;
			viewport.classList.add("mx-panning");
			e.preventDefault();
		};
		const move = (e) => {
			if (!panning) return;
			const dx = e.clientX - sx, dy = e.clientY - sy;
			moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
			c.x = ox + dx; c.y = oy + dy;
			c._apply();
		};
		const up = () => {
			if (!panning) return;
			panning = false;
			viewport.classList.remove("mx-panning");
		};
		// Ctrl/Cmd + wheel, not bare wheel: these canvases live inside panes that
		// still scroll, and hijacking the scroll wheel would break reaching nodes
		// below the fold. Same modifier every map and design tool uses.
		const wheel = (e) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			c.zoomTo(c.scale + (e.deltaY < 0 ? window.UCCZoom.STEP : -window.UCCZoom.STEP));
		};

		viewport.addEventListener("mousedown", down);
		viewport.addEventListener("wheel", wheel, { passive: false });
		document.addEventListener("mousemove", move);
		document.addEventListener("mouseup", up);
		c._apply();
		return c;
	},
};
