// Copyright (c) 2026, United Ceres College and contributors
// Reusable node canvas: draggable nodes, zoom + drag-to-pan, bezier connectors,
// click-to-select. Ported from the prototype's vanilla SVG approach (no D3).
// Shared by Mapping Studio (checkpoint 4) and Index Studio (checkpoint 5).

window.UCCNodeCanvas = class UCCNodeCanvas {
	// container: a DOM element to render into.
	// opts.onSelect(node): called when a node is clicked.
	// opts.onMove(node): called after a node is dragged (optional).
	// opts.onConnect(fromId, toId): called when a node's port is dragged onto
	//   another node. Only nodes with `port: true` grow a port, so a canvas
	//   without this callback behaves exactly as it did before.
	// opts.onEdgeClick(a, b): called when a connector is clicked.
	constructor(container, opts = {}) {
		this.container = container;
		this.onSelect = opts.onSelect || function () {};
		this.onMove = opts.onMove || function () {};
		this.onConnect = opts.onConnect || null;
		this.onEdgeClick = opts.onEdgeClick || null;
		this.nodes = [];
		this.edges = [];
		this.scale = 1;
		this.selected = null;
		this._injectStyle();
		this._build();
	}

	_injectStyle() {
		if (document.getElementById("ucc-nc-style")) return;
		const css = `
		/* auto, not hidden: a column of 40 question nodes is taller than any
		   canvas, and with no pan control the overflow was simply unreachable.
		   render() sizes the stage to its content so this has something to
		   scroll. Nothing moves for a canvas whose nodes already fit. */
		.ucc-nc-shell{position:relative;height:600px;overflow:auto;border-radius:8px;
			background:radial-gradient(circle at 1px 1px,var(--border-color,#dbe1e8) 1px,transparent 0);background-size:20px 20px}
		.ucc-nc-stage{position:absolute;inset:0;transform-origin:0 0}
		.ucc-nc-edges{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
		.ucc-nc-node{position:absolute;width:172px;border-radius:11px;border:1px solid var(--border-color,#cfd7e2);
			background:var(--card-bg,#fff);padding:10px 11px;box-shadow:0 6px 18px rgba(23,41,77,.09);cursor:move;user-select:none}
		.ucc-nc-node:hover,.ucc-nc-node.selected{outline:2px solid rgba(74,99,231,.32);border-color:var(--primary,#4a63e7)}
		.ucc-nc-type{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted,#7a8698)}
		.ucc-nc-node b{font-size:12px;display:block;line-height:1.3;margin-top:2px}
		.ucc-nc-node small{font-size:10px;color:var(--text-muted,#8b95a5);display:block;margin-top:4px}
		.ucc-nc-node.source{border-left:5px solid #237a57}
		.ucc-nc-node.question{border-left:5px solid #237a57}
		.ucc-nc-node.objective{border-left:5px solid #2f8196}
		.ucc-nc-node.clause{border-left:5px solid #bf6b45}
		.ucc-nc-node.metric{border-left:5px solid #5972a9}
		.ucc-nc-node.dimension{border-left:5px solid #6f58a8}
		.ucc-nc-node.index{border-left:5px solid #b58a45}
		.ucc-nc-node.gap{border:1px dashed #b94848;border-left:5px solid #b94848;background:#fbeaea}
		.ucc-nc-tools{position:absolute;right:10px;top:10px;display:flex;gap:5px;z-index:5}
		.ucc-nc-shell{cursor:grab}
		.ucc-nc-panning{cursor:grabbing}
		.ucc-nc-tools button{width:30px;height:30px;border-radius:7px;border:1px solid var(--border-color,#e2e6ea);background:var(--card-bg,#fff);cursor:pointer}
		.ucc-nc-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted,#8b95a5);font-size:12px}
		/* The port is a CHILD of the node, and the node's whole surface starts a
		   move on mousedown. One stopPropagation on the port settles it — the
		   same collision the Questions panel's width grip has, but easier here
		   because these are ordinary bubbling mouse events rather than the HTML5
		   drag-and-drop the reorder uses. */
		.ucc-nc-port{position:absolute;right:-7px;top:50%;margin-top:-7px;width:14px;height:14px;
			border-radius:50%;background:var(--card-bg,#fff);border:2px solid #2f8196;cursor:crosshair;z-index:2}
		.ucc-nc-port:hover{background:#2f8196}
		.ucc-nc-node.droptarget{outline:2px dashed #2f8196;outline-offset:2px}
		/* The visible connector is 2px, which is not a click target. A second
		   transparent path under it carries the click. Both selectors are
		   class+element so the hit path wins on specificity rather than order. */
		.ucc-nc-edges path{pointer-events:none}
		.ucc-nc-edges path.ucc-nc-edge-hit{stroke:transparent;stroke-width:14;fill:none;
			pointer-events:stroke;cursor:pointer}
		.ucc-nc-edge-del{pointer-events:all;cursor:pointer}
		.ucc-nc-edge-del circle{fill:var(--card-bg,#fff);stroke:#b0bac6;stroke-width:1.5}
		.ucc-nc-edge-del path{stroke:#8793a5;stroke-width:1.8;stroke-linecap:round;fill:none}
		.ucc-nc-edge-del:hover circle{fill:#fbeaea;stroke:#b94848}
		.ucc-nc-edge-del:hover path{stroke:#b94848}
		`;
		const el = document.createElement("style");
		el.id = "ucc-nc-style";
		el.textContent = css;
		document.head.appendChild(el);
	}

	_build() {
		this.container.classList.add("ucc-nc-shell");
		this.container.innerHTML = `
			<!-- +/- next to a node canvas reads as add/remove node. They are zoom;
			     say so, since shape and position alone say the wrong thing. -->
			<div class="ucc-nc-tools">
				<button data-z="in" title="${__("Zoom in")}" aria-label="${__("Zoom in")}">+</button>
				<button data-z="out" title="${__("Zoom out")}" aria-label="${__("Zoom out")}">−</button>
				<button data-z="reset" title="${__("Reset view")}" aria-label="${__("Reset view")}">↺</button>
			</div>
			<div class="ucc-nc-stage"><svg class="ucc-nc-edges"></svg></div>
			<div class="ucc-nc-empty">${frappe.utils.escape_html(__("Nothing here yet."))}</div>`;
		this.stage = this.container.querySelector(".ucc-nc-stage");
		this.svg = this.container.querySelector(".ucc-nc-edges");
		this.emptyEl = this.container.querySelector(".ucc-nc-empty");
		this.container.querySelector('[data-z="in"]').onclick = () => this.zoom(0.1);
		this.container.querySelector('[data-z="out"]').onclick = () => this.zoom(-0.1);
		this.container.querySelector('[data-z="reset"]').onclick = () => {
			this.scale = 1; this.panX = 0; this.panY = 0; this.render();
		};
		this._makePannable();
	}

	setGraph(nodes, edges) {
		this.nodes = nodes || [];
		this.edges = edges || [];
		this.selected = null;
		this.render();
	}

	// Finding 2: an empty canvas said only "No nodes to show" with no way in.
	// Callers set a message (and optionally an action) for their empty state.
	setEmpty(opts) {
		opts = opts || {};
		// Degrade to plain text if the shared component didn't load: a missing
		// enhancement must not throw and abort the caller's page setup.
		if (!window.UCCEmptyState) {
			this.emptyEl.textContent = opts.message || "";
			return;
		}
		window.UCCEmptyState.render(this.emptyEl, opts);
	}

	_transform() {
		return `translate(${this.panX || 0}px, ${this.panY || 0}px) scale(${this.scale})`;
	}

	// Drag the empty background to pan, the same convention mo_zoom.js uses on the
	// other canvases. This canvas was built "pan-free" (its own header said so),
	// so a node dragged past the edge could not be reached at all. Anything
	// interactive keeps its own gesture - a node drag must never become a pan.
	_makePannable() {
		const INTERACTIVE = ".ucc-nc-node, .ucc-nc-port, .ucc-nc-edge-del, .ucc-nc-tools, button, a, input, select, textarea, label";
		let on = false, sx = 0, sy = 0, ox = 0, oy = 0;
		this.container.addEventListener("mousedown", (e) => {
			if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
			on = true;
			sx = e.clientX; sy = e.clientY;
			ox = this.panX || 0; oy = this.panY || 0;
			this.container.classList.add("ucc-nc-panning");
			e.preventDefault();
		});
		document.addEventListener("mousemove", (e) => {
			if (!on) return;
			this.panX = ox + (e.clientX - sx);
			this.panY = oy + (e.clientY - sy);
			// Translation only. _drawEdges measures everything relative to the
			// stage's OWN box, which moves with it, so the endpoints stay correct
			// and the divide-by-scale contract is untouched.
			this.stage.style.transform = this._transform();
		});
		document.addEventListener("mouseup", () => {
			if (!on) return;
			on = false;
			this.container.classList.remove("ucc-nc-panning");
		});
	}

	// Frame every node in view - the same job UCCZoom.fit does elsewhere, done in
	// THIS canvas's scale/pan state so there is still exactly one transform here.
	fit() {
		if (!this.nodes.length) return;
		const box = this.container.getBoundingClientRect();
		if (!box.width || !box.height) return;
		const pad = 24;
		const w = Math.max(...this.nodes.map((n) => n.x || 0)) + 200 + pad * 2;
		const h = Math.max(...this.nodes.map((n) => n.y || 0)) + 120 + pad * 2;
		this.scale = Math.max(0.6, Math.min(1.6, Math.min(box.width / w, box.height / h)));
		this.panX = 0;
		this.panY = 0;
		this.render();
	}

	zoom(delta) {
		this.scale = Math.max(0.6, Math.min(1.6, this.scale + delta));
		this.render();
	}

	render() {
		this.stage.querySelectorAll(".ucc-nc-node").forEach((n) => n.remove());
		this.stage.style.transform = this._transform();
		this.emptyEl.style.display = this.nodes.length ? "none" : "flex";
		this.nodes.forEach((n) => {
			const el = document.createElement("div");
			el.className = `ucc-nc-node ${n.type || ""}${this.selected === n.id ? " selected" : ""}`;
			el.dataset.id = n.id;
			el.style.left = (n.x || 0) + "px";
			el.style.top = (n.y || 0) + "px";
			el.innerHTML = `<div class="ucc-nc-type">${frappe.utils.escape_html(n.type || "")}</div>
				<b>${frappe.utils.escape_html(n.title || "")}</b>
				${n.sub ? `<small>${frappe.utils.escape_html(n.sub)}</small>` : ""}`;
			if (this.onConnect && n.port) {
				const port = document.createElement("div");
				port.className = "ucc-nc-port";
				port.title = __("Drag to connect");
				el.appendChild(port);
				this._makeConnectable(port, n);
			}
			this._makeDraggable(el, n);
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				this.selected = n.id;
				this.stage.querySelectorAll(".ucc-nc-node").forEach((x) => x.classList.remove("selected"));
				el.classList.add("selected");
				this.onSelect(n);
			});
			this.stage.appendChild(el);
		});
		// The stage is position:absolute;inset:0, so absolutely-positioned
		// children never grow it and the shell had nothing to scroll. Explicit
		// width/height win over right/bottom when over-constrained, and the
		// scale() transform is accounted for by the browser's own overflow
		// calculation, so this needs no scale arithmetic of its own.
		const extent = (axis, pad) => this.nodes.reduce((m, n) => Math.max(m, (n[axis] || 0) + pad), 0);
		this.stage.style.width = this.nodes.length ? extent("x", 200) + "px" : "";
		this.stage.style.height = this.nodes.length ? extent("y", 120) + "px" : "";
		requestAnimationFrame(() => this._drawEdges());
	}

	_drawEdges() {
		this.svg.innerHTML =
			'<defs><marker id="ucc-nc-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">' +
			'<path d="M0,0 L8,3 L0,6 Z" fill="#8793a5"></path></marker></defs>';
		const box = this.stage.getBoundingClientRect();
		this.edges.forEach(([a, b]) => {
			const A = this.stage.querySelector(`[data-id="${a}"]`);
			const B = this.stage.querySelector(`[data-id="${b}"]`);
			if (!A || !B) return;
			const ar = A.getBoundingClientRect();
			const br = B.getBoundingClientRect();
			const x1 = (ar.right - box.left) / this.scale;
			const y1 = (ar.top + ar.height / 2 - box.top) / this.scale;
			const x2 = (br.left - box.left) / this.scale;
			const y2 = (br.top + br.height / 2 - box.top) / this.scale;
			const c = Math.max(60, (x2 - x1) / 2);
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`);
			path.setAttribute("fill", "none");
			path.setAttribute("stroke", "#8793a5");
			path.setAttribute("stroke-width", "2");
			path.setAttribute("marker-end", "url(#ucc-nc-arrow)");
			this.svg.appendChild(path);
			if (!this.onEdgeClick) return;
			const hit = path.cloneNode();
			hit.setAttribute("class", "ucc-nc-edge-hit");
			hit.removeAttribute("marker-end");
			hit.addEventListener("click", () => this.onEdgeClick(a, b));
			this.svg.appendChild(hit);
			this._edgeDeleteButton(path, a, b);
		});
	}

	// Click-the-line-to-delete is a gesture nobody discovers. A visible ×  at the
	// connector's midpoint says the connector is removable. Always drawn, not
	// hover-only: hover-only affordances do not exist on touch, and being unable
	// to see the control was the whole complaint.
	_edgeDeleteButton(path, a, b) {
		// The real midpoint of the curve, not the midpoint of its endpoints -
		// a bezier between two far-apart nodes bulges well away from that.
		const mid = path.getPointAtLength(path.getTotalLength() / 2);
		const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
		g.setAttribute("class", "ucc-nc-edge-del");
		g.setAttribute("transform", `translate(${mid.x},${mid.y})`);
		g.innerHTML =
			'<circle r="8"></circle>' +
			'<path d="M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2"></path>';
		const label = document.createElementNS("http://www.w3.org/2000/svg", "title");
		label.textContent = __("Remove this mapping");
		g.appendChild(label);
		g.addEventListener("click", (e) => { e.stopPropagation(); this.onEdgeClick(a, b); });
		this.svg.appendChild(g);
	}

	// Drag from a port onto another node. elementFromPoint rather than hit-testing
	// rects by hand: the stage is scaled by a transform, and the browser already
	// knows where things visually are.
	_makeConnectable(port, node) {
		port.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();          // ...or the node starts a move instead
			const box = this.stage.getBoundingClientRect();
			const at = (ev) => [(ev.clientX - box.left) / this.scale,
								(ev.clientY - box.top) / this.scale];
			const [x1, y1] = at(e);
			const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
			line.setAttribute("fill", "none");
			line.setAttribute("stroke", "#2f8196");
			line.setAttribute("stroke-width", "2");
			line.setAttribute("stroke-dasharray", "5 4");
			this.svg.appendChild(line);
			let target = null;

			const move = (ev) => {
				const [x2, y2] = at(ev);
				line.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);
				const over = document.elementFromPoint(ev.clientX, ev.clientY);
				const el = over && over.closest(".ucc-nc-node");
				const id = el && el.dataset.id !== node.id ? el.dataset.id : null;
				if (id === target) return;
				this.stage.querySelectorAll(".droptarget").forEach((x) => x.classList.remove("droptarget"));
				target = id;
				if (el && id) el.classList.add("droptarget");
			};
			const up = () => {
				document.removeEventListener("mousemove", move);
				document.removeEventListener("mouseup", up);
				line.remove();
				this.stage.querySelectorAll(".droptarget").forEach((x) => x.classList.remove("droptarget"));
				if (target) this.onConnect(node.id, target);
			};
			document.addEventListener("mousemove", move);
			document.addEventListener("mouseup", up);
		});
	}

	_makeDraggable(el, node) {
		el.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			const sx = e.clientX;
			const sy = e.clientY;
			const ox = node.x || 0;
			const oy = node.y || 0;
			const move = (ev) => {
				node.x = ox + (ev.clientX - sx) / this.scale;
				node.y = oy + (ev.clientY - sy) / this.scale;
				el.style.left = node.x + "px";
				el.style.top = node.y + "px";
				this._drawEdges();
			};
			const up = () => {
				document.removeEventListener("mousemove", move);
				document.removeEventListener("mouseup", up);
				this.onMove(node);
			};
			document.addEventListener("mousemove", move);
			document.addEventListener("mouseup", up);
		});
	}
};
