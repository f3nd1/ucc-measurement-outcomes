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
	// Every node kind across the three canvases, so fit() works without each
	// caller re-stating its own markup.
	NODES: "[data-node], [data-map-node], .map-node, .mx-node, .node",
	MIN: 0.5,
	MAX: 2,
	STEP: 0.15,

	// Controls markup. Rendered by the caller into its own canvas head so each
	// toolbar keeps its own layout, but the buttons are named here so all three
	// canvases use the same data-act vocabulary.
	controls() {
		const I = window.UCCMOIcons;
		return `<span class="mx-zoom">
			<button class="mini" data-act="zoom-fit" title="${__("Fit all nodes in view")}" aria-label="${
				__("Fit all nodes in view")}">${I.icon("i-target", "sm")}</button>
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
			// Fit every node into the viewport. Deliberately built on the SAME
			// scale/x/y state and the SAME _apply() path the buttons use, so the
			// connector redraw (and its divide-by-scale correction) happens here
			// too rather than needing a second code path that could drift.
			fit(selector) {
				const nodes = stage.querySelectorAll(selector || window.UCCZoom.NODES);
				if (!nodes.length) return;
				// Measure in the stage's own unscaled space, so fitting is not
				// affected by whatever zoom happens to be applied right now.
				const k = this.scale;
				const sb = stage.getBoundingClientRect();
				let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
                nodes.forEach((n) => {
					const q = n.getBoundingClientRect();
					l = Math.min(l, (q.left - sb.left) / k);
					t = Math.min(t, (q.top - sb.top) / k);
					r = Math.max(r, (q.right - sb.left) / k);
					b = Math.max(b, (q.bottom - sb.top) / k);
				});
				const w = r - l, h = b - t;
				if (w <= 0 || h <= 0) return;
				const vp = viewport.getBoundingClientRect();
				const pad = 24;
				const next = Math.min(window.UCCZoom.MAX, Math.max(window.UCCZoom.MIN,
					Math.min((vp.width - pad * 2) / w, (vp.height - pad * 2) / h)));
				this.scale = next;
				// Centre the node bounding box in the viewport.
				this.x = (vp.width - w * next) / 2 - l * next;
				this.y = (vp.height - h * next) / 2 - t * next;
				viewport.scrollTop = 0;
				viewport.scrollLeft = 0;
				this._apply();
			},
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
		// Ctrl/Cmd + wheel zooms. Bare wheel is left to the browser so the pane
		// scrolls exactly as it always did - measured: with anything to scroll it
		// scrolls (73px when zoomed to 1.3x, 200px with a tall column).
		//
		// The round-9 report was still right, though, and the measurement is why:
		// when the stage FITS its viewport there is no scrollable overflow, and
		// the workbench shell is overflow:hidden by design, so the wheel moved
		// nothing anywhere - it felt broken even though the handler was correct.
		// So when an axis has nothing to scroll, the wheel pans that axis instead.
		// The wheel always moves the canvas; it just never steals a real scroll.
		const canScroll = (el, dy) => {
			const room = el.scrollHeight - el.clientHeight;
			if (room <= 1) return false;
			return dy > 0 ? el.scrollTop < room - 1 : el.scrollTop > 1;
		};
		const wheel = (e) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				c.zoomTo(c.scale + (e.deltaY < 0 ? window.UCCZoom.STEP : -window.UCCZoom.STEP));
				return;
			}
			if (canScroll(viewport, e.deltaY)) return;   // real scroll wins, untouched
			e.preventDefault();
			if (e.shiftKey) c.x -= e.deltaY; else c.y -= e.deltaY;
			c._apply();
		};

		viewport.addEventListener("mousedown", down);
		viewport.addEventListener("wheel", wheel, { passive: false });
		document.addEventListener("mousemove", move);
		document.addEventListener("mouseup", up);
		c._apply();
		return c;
	},
};
