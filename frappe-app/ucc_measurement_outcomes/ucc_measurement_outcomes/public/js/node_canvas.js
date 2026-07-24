// Copyright (c) 2026, United Ceres College and contributors
// Reusable node canvas: draggable nodes, pan-free zoom, bezier connectors,
// click-to-select. Ported from the prototype's vanilla SVG approach (no D3).
// Shared by Mapping Studio (checkpoint 4) and Index Studio (checkpoint 5).

window.UCCNodeCanvas = class UCCNodeCanvas {
	// container: a DOM element to render into.
	// opts.onSelect(node): called when a node is clicked.
	// opts.onMove(node): called after a node is dragged (optional).
	constructor(container, opts = {}) {
		this.container = container;
		this.onSelect = opts.onSelect || function () {};
		this.onMove = opts.onMove || function () {};
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
		.ucc-nc-shell{position:relative;height:600px;overflow:hidden;border-radius:8px;
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
		.ucc-nc-tools{position:absolute;right:10px;top:10px;display:flex;gap:5px;z-index:5}
		.ucc-nc-tools button{width:30px;height:30px;border-radius:7px;border:1px solid var(--border-color,#e2e6ea);background:var(--card-bg,#fff);cursor:pointer}
		.ucc-nc-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-muted,#8b95a5);font-size:12px}
		`;
		const el = document.createElement("style");
		el.id = "ucc-nc-style";
		el.textContent = css;
		document.head.appendChild(el);
	}

	_build() {
		this.container.classList.add("ucc-nc-shell");
		this.container.innerHTML = `
			<div class="ucc-nc-tools">
				<button data-z="in">+</button><button data-z="out">−</button><button data-z="reset">↺</button>
			</div>
			<div class="ucc-nc-stage"><svg class="ucc-nc-edges"></svg></div>
			<div class="ucc-nc-empty">${frappe.utils.escape_html(__("No nodes to show"))}</div>`;
		this.stage = this.container.querySelector(".ucc-nc-stage");
		this.svg = this.container.querySelector(".ucc-nc-edges");
		this.emptyEl = this.container.querySelector(".ucc-nc-empty");
		this.container.querySelector('[data-z="in"]').onclick = () => this.zoom(0.1);
		this.container.querySelector('[data-z="out"]').onclick = () => this.zoom(-0.1);
		this.container.querySelector('[data-z="reset"]').onclick = () => { this.scale = 1; this.render(); };
	}

	setGraph(nodes, edges) {
		this.nodes = nodes || [];
		this.edges = edges || [];
		this.selected = null;
		this.render();
	}

	zoom(delta) {
		this.scale = Math.max(0.6, Math.min(1.6, this.scale + delta));
		this.render();
	}

	render() {
		this.stage.querySelectorAll(".ucc-nc-node").forEach((n) => n.remove());
		this.stage.style.transform = `scale(${this.scale})`;
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
