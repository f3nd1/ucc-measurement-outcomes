// Copyright (c) 2026, United Ceres College and contributors
// Mapping Studio: pick a version, see each question's objective + metric mapping
// in a table, edit it via whitelisted methods, and view a selected question's
// lineage on the shared node canvas (window.UCCNodeCanvas).

frappe.pages["mapping-studio"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Mapping Studio"),
		single_column: true,
	});
	// Frappe can swallow exceptions thrown from on_page_load, which hides a
	// half-built page behind a clean console. Surface it loudly instead.
	try {
		wrapper.ucc = new MappingStudio(page);
	} catch (e) {
		console.error("[UCC] mapping-studio failed to initialise:", e);
		frappe.msgprint({title: __("Page failed to load"), indicator: "red",
			message: __("mapping-studio could not initialise: ") + (e && e.message ? e.message : e)});
		throw e;
	}
};

// Finding 2: see survey_builder — pages construct once, on_page_show runs every visit.
frappe.pages["mapping-studio"].on_page_show = function (wrapper) {
	if (!wrapper.ucc) return;
	// Objectives and metrics can be created while this page sits constructed in
	// the background; pick them up on the way back in.
	wrapper.ucc._loadMasters();
	wrapper.ucc.applyRouteOptions();
};

const MAPI = "ucc_measurement_outcomes.api.mapping.";
const XAPI = "ucc_measurement_outcomes.api.extract.";
const srcLabel = (s) => `${s.name} (${s.rows})`;

class MappingStudio {
	constructor(page) {
		this.page = page;
		this.rows = [];
		this.masters = { objectives: [], standards: [], metrics: [] };
		this.selected = null;
		this.filter = "all";
		this._injectStyle();
		this._build();
		this._loadMasters();
		this.applyRouteOptions();
	}

	// The inspector's Objective and Standard dropdowns are built from this list.
	// It used to be fetched once, in the constructor, and never again - and the
	// constructor runs on on_page_load, which fires once per session. So any
	// UCC Objective created after the page was first opened (by extraction, or
	// by anyone in another tab) could not appear in the dropdown until a full
	// browser reload, which reads as "the data is missing" rather than "the list
	// is stale". Refetch instead of caching for the session.
	_loadMasters() {
		frappe.call({
			method: MAPI + "mapping_masters",
			callback: (r) => {
				if (!r.message) return;
				this.masters = r.message;
				// An inspector already on screen is holding the old option list.
				const q = this.selected && this.rows.find((x) => x.name === this.selected);
				if (q) this._renderInspector(q);
			},
		});
	}

	// Finding 2: deep-link entry point (idempotent, clears route_options).
	applyRouteOptions() {
		const opts = frappe.route_options || {};
		frappe.route_options = {};
		if (opts.question) this._pendingQuestion = opts.question;
		if (opts.survey_version) {
			this.versionField.set_value(opts.survey_version);   // triggers load()
		} else {
			this._applyPendingQuestion();
		}
	}

	_applyPendingQuestion() {
		if (!this._pendingQuestion) return;
		const name = this._pendingQuestion;
		this._pendingQuestion = null;
		if (this.rows.some((r) => r.name === name)) this._select(name);
	}

	// This page had NO stylesheet - every .ucc-map-* class it referenced was
	// undefined, so it rendered as Bootstrap defaults with nothing carrying
	// visual weight. That is most of why four panels read as equal.
	_injectStyle() {
		if (document.getElementById("ucc-map-style")) return;
		const el = document.createElement("style");
		el.id = "ucc-map-style";
		el.textContent = `
		.ucc-map-chain{display:flex;align-items:stretch;gap:6px;flex-wrap:wrap;
			border:1px solid #d9e0ea;border-radius:10px;background:#f7f9fc;padding:12px 14px}
		.ucc-map-link{flex:1;min-width:150px;padding:6px 10px;border-radius:8px;cursor:pointer}
		.ucc-map-link:hover{background:#e7edf6}
		.ucc-map-link .k{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#8b95a5}
		.ucc-map-link .v{font-size:22px;font-weight:700;line-height:1.2;color:#1f272e}
		.ucc-map-link .v .of{font-size:13px;font-weight:600;color:#97a1b0}
		.ucc-map-link .s{font-size:11px;color:#8b95a5;margin-top:3px}
		.ucc-map-arrow{align-self:center;color:#c3c9cf;font-size:16px}
		.ucc-map-track{height:5px;background:#e4e9f1;border-radius:99px;overflow:hidden;margin-top:5px}
		.ucc-map-track span{display:block;height:100%;border-radius:99px;background:#237a57}
		.ucc-map-track span.warn{background:#c99a2e}
		.ucc-map-track span.bad{background:#b94848}
		.ucc-map-secondary{font-size:11px;color:#8a6d1f;margin-top:6px;padding-left:4px}
		.ucc-map-views{display:flex;gap:4px;margin-bottom:8px}
		.ucc-map-views button.active{background:#17294d;color:#fff}
		.ucc-map-filter{font-size:11px;color:#8b95a5;margin-bottom:8px}
		/* Indentation is what makes the chain structural: objective is the
		   heading, its questions sit inside it. */
		.ucc-map-group{border:1px solid #e2e6ea;border-radius:9px;margin-bottom:10px;overflow:hidden}
		.ucc-map-group.gap{border-color:#e0b4b4}
		.ucc-map-group.idle{border-style:dashed}
		.ucc-map-ghead{display:flex;align-items:center;gap:8px;padding:8px 12px;
			background:#f2f5f9;font-weight:600;font-size:12px}
		.ucc-map-group.gap .ucc-map-ghead{background:#fdf6f6;color:#b94848}
		.ucc-map-ghead .cl{font-weight:400;font-size:11px;color:#8b95a5}
		.ucc-map-ghead .n{margin-left:auto;font-size:11px;color:#8b95a5}
		.ucc-map-qrow{display:flex;align-items:center;gap:8px;padding:7px 12px 7px 26px;
			border-top:1px solid #eef2f7;font-size:12px;cursor:pointer}
		.ucc-map-qrow:hover{background:#f7f9fc}
		.ucc-map-qrow.sel{background:#eef3ff;box-shadow:inset 3px 0 0 #3d55d4}
		/* No underline: this text is not a link any more. It used to carry
		   ucc-map-q-link, and being flex:1 it WAS the row - so a click on a
		   question navigated to Survey Builder and could never reach _select,
		   which is what opens the objective editor. The deep link is now the ↗
		   at the end of the row, and the row body selects. */
		.ucc-map-qtext{flex:1}
		.ucc-map-cfilter{font-size:11px;color:#6b7684;margin:0 0 0 10px;font-weight:400;cursor:pointer}
		.ucc-map-cfilter input{vertical-align:-1px;margin-right:3px}
		.ucc-map-q-link{font-size:11px;color:#8b95a5;padding:0 2px;cursor:pointer}
		.ucc-map-qrow:hover .ucc-map-q-link{color:#3d55d4}
		.ucc-map-also{font-size:10px;color:#6f58a8;background:#f1edf9;border-radius:20px;padding:1px 8px;white-space:nowrap}
		.ucc-map-metrics{white-space:nowrap}
		.ucc-map-multi{font-size:11px;color:#6f58a8;background:#f1edf9;border-radius:7px;padding:7px 9px;margin:-6px 0 12px}
		`;
		document.head.appendChild(el);
	}

	_build() {
		const $main = $(this.page.main).empty();
		this.$trail = $('<div></div>').appendTo($main);   // finding 1
		const $picker = $('<div style="max-width:360px"></div>').appendTo($main);
		this.versionField = frappe.ui.form.make_control({
			parent: $picker.get(0),
			df: {
				fieldtype: "Link",
				options: "UCC Survey Version",
				// Finding 5: no reqd on a standalone picker (see survey_builder).
				label: __("Survey Version"),
				change: () => { const v = this.versionField.get_value(); if (v) this.load(v); },
			},
			render_input: true,
		});
		// Checkpoint D: 275 of 318 Survey Question Item rows carry an objective a
		// human decided on. Offer that as a starting point rather than making
		// people retype it — an explicit, previewed import, never a sync.
		$(`<button class="btn btn-default btn-sm" style="margin-top:8px">${
			__("Extract from Survey Management…")}</button>`)
			.appendTo($main).on("click", () => this._openExtract());
		this.$coverage = $('<div class="ucc-map-coverage" style="margin-top:12px"></div>').appendTo($main);
		const $grid = $('<div style="display:grid;grid-template-columns:1.4fr 320px;gap:14px;margin-top:12px"></div>').appendTo($main);
		const $left = $('<div></div>').appendTo($grid);
		// The canvas is genuinely good for one question's lineage but it was
		// never the work surface, and as a permanent panel it made four regions
		// of equal weight with no entry point. A toggle over the same selection.
		this.view = "list";
		const $views = $('<div class="ucc-map-views"></div>').appendTo($left);
		this.$viewList = $(`<button class="btn btn-default btn-xs active">${__("List")}</button>`)
			.appendTo($views).on("click", () => this._setView("list"));
		this.$viewCanvas = $(`<button class="btn btn-default btn-xs">${__("Canvas")}</button>`)
			.appendTo($views).on("click", () => this._setView("canvas"));
		// Its own filter, not this.filter: the list's filter is a drill-down from
		// the coverage header and switching views should not silently rewrite it.
		// Defaults ON — the canvas is a fix-the-gaps surface, and a survey's full
		// question list on it is a wall rather than a tool.
		this.canvasUnmappedOnly = true;
		this.$canvasFilter = $(`<label class="ucc-map-cfilter"><input type="checkbox" checked> ${
			__("Unmapped only")}</label>`).appendTo($views).hide();
		this.$canvasFilter.find("input").on("change", (e) => {
			this.canvasUnmappedOnly = e.target.checked;
			this._renderMap();
		});
		this.$table = $('<div class="ucc-map-table"></div>').appendTo($left);
		this.$canvas = $('<div style="height:420px;display:none"></div>').appendTo($left);
		this.$inspector = $('<div class="ucc-map-inspector"><p class="text-muted" style="font-size:12px">' +
			__("Select a question to edit its objective and metric mapping.") + "</p></div>").appendTo($grid);
		this.canvas = new window.UCCNodeCanvas(this.$canvas.get(0), {
			// Selecting a node on the canvas drives the same inspector the list
			// drives, so the canvas is a second way in and never a second editor.
			onSelect: (n) => { if (n.id.startsWith("q:")) this._select(n.id.slice(2)); },
			onConnect: (a, b) => this._connect(a, b),
			onEdgeClick: (a, b) => this._disconnect(a, b),
		});
		// Finding 2: say what to do instead of a bare "No nodes to show".
		this.canvas.setEmpty({ message: __("Pick a survey to see how its questions map to objectives.") });
		this.$next = $('<div></div>').appendTo($main);   // item 2
		this._renderTrail();
	}

	// Checkpoint D: pick a source, read what would be created, then commit.
	// Nothing is written until the second button.
	_openExtract() {
		if (!this.version) {
			return frappe.msgprint(__("Pick a Draft survey version first — that's where the extracted questions go."));
		}
		frappe.call({
			method: XAPI + "list_sources",
			callback: (r) => {
				const sources = r.message || [];
				if (!sources.length) {
					return frappe.msgprint(__("No Survey Management records have question-master rows to extract."));
				}
				const d = new frappe.ui.Dialog({
					title: __("Extract from Survey Management"),
					fields: [
						{ fieldname: "src", fieldtype: "Select", label: __("Source"), reqd: 1,
						  options: sources.map(srcLabel).join("\n") },
						{ fieldname: "out", fieldtype: "HTML" },
					],
					primary_action_label: __("Preview"),
					primary_action: () => this._previewExtract(d, sources),
				});
				d.show();
			},
		});
	}

	_previewExtract(d, sources) {
		const label = d.get_values().src;
		const chosen = sources.find((s) => srcLabel(s) === label) || sources[0];
		frappe.call({
			method: XAPI + "preview_extraction",
			args: { survey_version: this.version, survey_management: chosen.name },
			callback: (r) => {
				const p = r.message;
				if (!p) return;
				const c = p.counts;
				const rows = p.questions.slice(0, 40).map((q) =>
					`<tr><td>${frappe.utils.escape_html(q.question_text.slice(0, 80))}</td>
					 <td>${q.objectives.map((o) => frappe.utils.escape_html(o.label)).join("<br>")}</td>
					 <td>${q.exists ? __("already present") : __("new")}</td></tr>`).join("");
				d.fields_dict.out.$wrapper.html(`
					<div style="font-size:12px;margin-top:10px">
						<b>${__("Would create")}:</b>
						${c.questions - c.questions_already_present} ${__("questions")},
						${c.mappings} ${__("objective mappings")},
						${c.new_objectives} ${__("new objectives")}.<br>
						${c.questions_already_present} ${__("questions already exist and are reused")};
						${c.questions_multi_objective} ${__("carry more than one objective")};
						${c.skipped} ${__("source rows skipped")}.
						<table class="table table-bordered" style="margin-top:8px">
							<tr><th>${__("Question")}</th><th>${__("Objectives")}</th><th>${__("Status")}</th></tr>
							${rows}
						</table>
						${p.questions.length > 40 ? `<div class="text-muted">${
							__("showing first 40 of {0}", [p.questions.length])}</div>` : ""}
					</div>`);
				d.set_primary_action(__("Create these records"), () => {
					frappe.call({
						method: XAPI + "commit_extraction",
						args: { survey_version: this.version, survey_management: chosen.name },
						callback: (res) => {
							d.hide();
							frappe.show_alert({ indicator: "green", message: __(
								"{0} questions, {1} mappings, {2} objectives created",
								[res.message.questions_created, res.message.mappings_created,
								 res.message.objectives_created]) });
							// Extraction just created objectives - the inspector's
							// dropdown is now out of date by definition.
							this._loadMasters();
							this.load(this.version);
						},
					});
				});
			},
		});
	}

	// Finding 1: Survey Studio is upstream of this page — make that clickable.
	_renderTrail() {
		if (!window.UCCTrail) return console.warn("[UCC] trail.js not loaded - run: bench build --app ucc_measurement_outcomes && bench restart");
		// Item 1: stage 2. Knows the question count and the coverage numbers it
		// already loaded, plus how many distinct metrics exist for stage 3.
		// Same gate as Survey Builder: with nothing picked the map was empty and
		// the stepper showed no state. Say what it is waiting for.
		const stages = {};
		if (this.version) stages[1] = { done: this.rows.length > 0 };
		else stages[2] = { note: __("pick a survey version to see its coverage") };
		if (this.coverage) {
			const n = this.coverage.questions_without_objective.length;
			stages[2] = n === 0
				? { done: true }
				: { note: __("{0} questions still need objectives", [n]) };
			const metrics = new Set();
			this.rows.forEach((q) => (q.metrics || []).forEach((m) => metrics.add(m)));
			if (!metrics.size) {
				stages[3] = { blocked: __("needs mapped metrics (none yet)") };
			}
		}
		window.UCCTrail.render(this.$trail.get(0), {
			current: 2,
			context: this.version,
			routeOptions: this.version ? { survey_version: this.version } : {},
			stages: stages,
		});
		this._renderNext();
	}

	// Item 2: forward action — an index is built from mapped metrics, so the
	// button states that blocker rather than navigating to an empty canvas.
	_renderNext() {
		if (!window.UCCTrail || !this.$next) return;
		if (!this.version) {
			return window.UCCTrail.renderNext(this.$next.get(0), {
				blocked: __("Pick a survey first"),
			});
		}
		const metrics = this._metricCount();
		if (!metrics) {
			return window.UCCTrail.renderNext(this.$next.get(0), {
				blocked: __("Link at least one question to a metric first"),
			});
		}
		window.UCCTrail.renderNext(this.$next.get(0), {
			label: __("Next: build an index from these {0} metrics →", [metrics]),
			page: "index-studio",
			routeOptions: this._surveyContext(),
		});
	}

	load(version) {
		frappe.call({
			method: MAPI + "get_mapping_overview",
			args: { survey_version: version },
			callback: (r) => {
				if (!r.message) return;
				this.version = version;
				this.rows = r.message.questions || [];
				this.selected = null;
				this._renderTable();
				// The canvas is rebuilt from _loadCoverage below, not here: its
				// gap flags come from coverage, so building it now would draw the
				// previous version's gaps for one frame.
				this.$inspector.html('<p class="text-muted" style="font-size:12px">' +
					__("Select a question to edit its objective and metric mapping.") + "</p>");
				this._loadCoverage(() => this._renderMap());
				this._renderTrail();
				this._applyPendingQuestion();   // finding 2: arrived via deep link
			},
		});
	}

	// `then` exists so the canvas can be built AFTER coverage lands (its gap nodes
	// come from coverage) without coverage rebuilding the canvas every time it
	// refreshes. That unconditional rebuild is what deleted the question the user
	// had just mapped, so only the three callers that genuinely want a fresh
	// graph - version load, view switch, filter change - ask for one.
	_loadCoverage(then) {
		frappe.call({
			method: MAPI + "mapping_coverage",
			args: { survey_version: this.version },
			callback: (r) => {
				if (!r.message) return;
				this.coverage = r.message;
				this._renderCoverage();
				this._renderTable();   // finding 3: table flags depend on coverage
				this._renderTrail();   // finding 5: badge reflects the same count
				if (then) then();
			},
		});
	}

	// The chain, stated literally. This page's whole job is
	// Survey Management -> Objective -> Question, and that used to be inferable
	// only from a column in a flat table. Here it is the first thing on screen,
	// and it carries the coverage numbers the old separate panel held.
	_renderCoverage() {
		const c = this.coverage;
		const cnt = c.counts;
		const bar = (done, total, cls) => {
			const pct = total ? Math.round((done / total) * 100) : 0;
			return `<div class="ucc-map-track"><span class="${cls}" style="width:${pct}%"></span></div>`;
		};
		const unmapped = c.questions_without_objective.length;
		const idle = c.unmapped_objectives.length;
		const dupes = c.duplicate_questions.length;
		const noClause = c.questions_without_clause.length;

		this.$coverage.html(`
			<div class="ucc-map-chain">
				<div class="ucc-map-link" data-filter="all">
					<div class="k">${__("Source")}</div>
					<div class="v">${frappe.utils.escape_html(this.version || "—")}</div>
					<div class="s">${__("survey version")}</div>
				</div>
				<span class="ucc-map-arrow">→</span>
				<div class="ucc-map-link" data-filter="idle">
					<div class="k">${__("Objectives")}</div>
					<div class="v">${cnt.objectives_used}<span class="of">/${cnt.objectives}</span></div>
					${bar(cnt.objectives_used, cnt.objectives, idle ? "warn" : "ok")}
					<div class="s">${idle ? __("{0} with no question", [idle]) : __("all in use")}</div>
				</div>
				<span class="ucc-map-arrow">→</span>
				<div class="ucc-map-link" data-filter="unmapped">
					<div class="k">${__("Questions")}</div>
					<div class="v">${cnt.questions_mapped}<span class="of">/${cnt.questions}</span></div>
					${bar(cnt.questions_mapped, cnt.questions, unmapped ? "bad" : "ok")}
					<div class="s">${unmapped ? __("{0} need an objective", [unmapped]) : __("all mapped")}</div>
				</div>
			</div>
			${(dupes || noClause) ? `<div class="ucc-map-secondary">
				${dupes ? __("{0} duplicate question text", [dupes]) + " · " : ""}
				${noClause ? __("{0} with no clause", [noClause]) : ""}
			</div>` : ""}`);

		// Clicking a segment filters the list below — the header is the entry
		// point, not just a readout.
		this.$coverage.find("[data-filter]").on("click", (e) => {
			this.filter = $(e.currentTarget).data("filter");
			this._renderTable();
		});
	}

	// Decision (b): hand the downstream stage the survey context AND the counts
	// this page has already computed, so Index Studio can show stages 1-2
	// without a second mapping_coverage call. It is a snapshot taken at
	// navigation time, which is exactly what it claims to be.
	_surveyContext() {
		if (!this.version || !this.coverage) return {};
		return {
			survey_version: this.version,
			question_count: this.rows.length,
			unmapped_count: this.coverage.questions_without_objective.length,
		};
	}

	_metricCount() {
		const metrics = new Set();
		this.rows.forEach((q) => (q.metrics || []).forEach((m) => metrics.add(m)));
		return metrics.size;
	}

	_isUnmapped(name) {
		return this.coverage && this.coverage.questions_without_objective.indexOf(name) !== -1;
	}

	// Objective-first. The old layout was a flat list of questions with an
	// objective COLUMN, so the chain was a cell value you had to read sideways.
	// Here the objective is the heading and its questions nest under it, which
	// makes the relationship structural rather than inferred.
	_groups() {
		const byObjective = new Map();
		const unmapped = [];
		this.rows.forEach((q) => {
			// Checkpoint A: a question can carry several objectives. `objectives`
			// holds all of them; `objective` is only the first.
			const objs = (q.objectives && q.objectives.length) ? q.objectives
				: (q.objective ? [q.objective] : []);
			if (!objs.length || this._isUnmapped(q.name)) return unmapped.push(q);
			objs.forEach((o) => {
				if (!byObjective.has(o)) byObjective.set(o, []);
				byObjective.get(o).push({ q: q, alsoIn: objs.filter((x) => x !== o) });
			});
		});
		return { unmapped: unmapped, objectives: [...byObjective.entries()].sort() };
	}

	_questionRow(q, alsoIn, isGap) {
		const metrics = (q.metrics || []).length
			? (q.metrics || []).map((m) => `<span class="indicator-pill green ucc-map-metric-link" data-metric="${frappe.utils.escape_html(m)}" style="cursor:pointer" title="${__("Open in Index Studio")}">${frappe.utils.escape_html(m)} →</span>`).join(" ")
			: "";
		// A question under three objectives appears three times. Unmarked that
		// reads as a duplicate row, so say what it is.
		const also = (alsoIn && alsoIn.length)
			? `<span class="ucc-map-also" title="${__("Also mapped to")}: ${frappe.utils.escape_html(alsoIn.join(", "))}">⧉ ${__("also")} ${frappe.utils.escape_html(alsoIn.join(", "))}</span>`
			: "";
		return `<div class="ucc-map-qrow ${isGap ? "gap" : ""} ${this.selected === q.name ? "sel" : ""}" data-name="${q.name}">
			<span class="ucc-map-qtext">${frappe.utils.escape_html((q.question_text || "").slice(0, 90))}</span>
			${also}${metrics ? `<span class="ucc-map-metrics">${metrics}</span>` : ""}
			<span class="ucc-map-q-link" title="${__("Open in Survey Builder")}">↗</span>
		</div>`;
	}

	_renderTable() {
		if (this.view === "canvas") {
			this.$table.hide();
			this.$canvas.show();
			return;
		}
		this.$canvas.hide();
		this.$table.show();

		const g = this._groups();
		const filter = this.filter || "all";
		let html = "";

		// Gaps are pinned at the top and are the flat unmapped list, so the fast
		// "give everything an objective" pass the old table was good at survives.
		if (g.unmapped.length && filter !== "idle") {
			html += `<div class="ucc-map-group gap">
				<div class="ucc-map-ghead">⚠ ${__("No objective yet")} <span class="n">${g.unmapped.length}</span></div>
				${g.unmapped.map((q) => this._questionRow(q, null, true)).join("")}
			</div>`;
		}
		if (filter !== "unmapped") {
			g.objectives.forEach(([code, entries]) => {
				const clause = (entries[0].q.primary_clause || "");
				html += `<div class="ucc-map-group">
					<div class="ucc-map-ghead">${frappe.utils.escape_html(code)}
						${clause ? `<span class="cl">${frappe.utils.escape_html(clause)}</span>` : ""}
						<span class="n">${entries.length}</span></div>
					${entries.map((e) => this._questionRow(e.q, e.alsoIn, false)).join("")}
				</div>`;
			});
			// An objective with no question is a gap in the other direction.
			const idle = (this.coverage && this.coverage.unmapped_objectives) || [];
			if (idle.length && filter !== "unmapped") {
				html += `<div class="ucc-map-group idle">
					<div class="ucc-map-ghead">${__("Objectives with no question")} <span class="n">${idle.length}</span></div>
					<div class="ucc-map-qrow" style="cursor:default">${idle.map((o) => `<span class="indicator-pill gray" style="margin:2px">${frappe.utils.escape_html(o)}</span>`).join("")}</div>
				</div>`;
			}
		}
		if (!html) html = `<div class="text-muted" style="font-size:12px;padding:20px">${__("Nothing to show for this filter.")}</div>`;
		if (filter !== "all") {
			html = `<div class="ucc-map-filter">${__("Filtered")} · <a href="#" class="ucc-map-clear">${__("show everything")}</a></div>` + html;
		}
		this.$table.html(html);
		this.$table.find(".ucc-map-clear").on("click", (e) => {
			e.preventDefault();
			this.filter = "all";
			this._renderTable();
		});
		this.$table.find(".ucc-map-qrow[data-name]").on("click", (e) => this._select($(e.currentTarget).data("name")));
		this.$table.find(".ucc-map-metric-link").on("click", (e) => {
			e.stopPropagation();
			frappe.route_options = Object.assign(
				{ metric: $(e.currentTarget).data("metric") },
				this._surveyContext(),
			);
			frappe.set_route("index-studio");
		});
		this.$table.find(".ucc-map-q-link").on("click", (e) => {
			e.stopPropagation();
			frappe.route_options = {
				survey_version: this.version,
				question: $(e.currentTarget).closest("[data-name]").data("name"),
			};
			frappe.set_route("ucc-survey-builder");
		});
	}

	_setView(v) {
		this.view = v;
		this.$viewList.toggleClass("active", v === "list");
		this.$viewCanvas.toggleClass("active", v === "canvas");
		this.$canvasFilter.toggle(v === "canvas");
		this._renderTable();
		// Edges are drawn from getBoundingClientRect, which is all zeros while
		// the canvas is display:none - so a graph built in list view lands with
		// degenerate connectors. Build it once it is actually visible.
		if (v === "canvas") this._renderMap();
	}

	// The canvas: every question on the left, every objective on the right, one
	// edge per real mapping. Built server-side (api.mapping.mapping_canvas) so
	// the node ids the browser drops are ids the server issued - this is a write
	// surface, not a picture of one.
	_renderMap() {
		if (this.view !== "canvas") return;
		if (!this.version) {
			return this.canvas.setEmpty({ message: __("Pick a survey version to map its questions.") });
		}
		frappe.call({
			method: MAPI + "mapping_canvas",
			args: { survey_version: this.version, unmapped_only: this.canvasUnmappedOnly ? 1 : 0 },
			callback: (r) => {
				if (!r.message) return;
				this.canvas.setGraph(r.message.nodes, r.message.edges);
				if (!r.message.nodes.length) {
					this.canvas.setEmpty({ message: this.canvasUnmappedOnly
						? __("Every question has an objective. Untick “Unmapped only” to see the whole map.")
						: __("This version has no questions yet.") });
				}
			},
		});
	}

	_connect(a, b) {
		frappe.call({
			method: MAPI + "connect_nodes",
			args: { a, b },
			callback: (r) => {
				// null = that pair was already mapped. Saying "mapping created"
				// there would be a lie about a row that already existed.
				frappe.show_alert(r.message
					? { indicator: "green", message: __("Mapping created") }
					: { indicator: "blue", message: __("Already mapped") });
				// Patch the graph in place; do NOT rebuild it. Rebuilding runs
				// mapping_canvas again with unmapped_only still on, which removed
				// the question that was just mapped - so the reward for a
				// successful drag was the question vanishing. Felix hit exactly
				// this. The edge you drew stays drawn until you ask for a redraw.
				this._markConnected(a, b);
				this._afterMappingWrite();
			},
		});
	}

	// The connected question stops being a gap and grows the edge, locally. The
	// coverage header still comes from the server, so the numbers are truth and
	// the canvas is the working set - they are allowed to differ by the one thing
	// you are looking at.
	_markConnected(a, b) {
		const nodes = this.canvas.nodes;
		const q = a.startsWith("q:") ? a : b;
		const o = q === a ? b : a;
		nodes.forEach((n) => { if (n.id === q && n.type === "gap") n.type = "question"; });
		const has = this.canvas.edges.some(([x, y]) => x === q && y === o);
		if (!has) this.canvas.edges.push([q, o]);
		this.canvas.setGraph(nodes, this.canvas.edges);
	}

	// Every mapping write goes through here. A write must never leave the user
	// looking at a filter that hides its own result, and "unmapped" is precisely
	// the filter that excludes what they just did - so it is cleared rather than
	// left to make a correct mapping look like a lost question.
	_afterMappingWrite() {
		if (this.filter === "unmapped") this.filter = "all";
		this._loadCoverage();
	}

	_disconnect(a, b) {
		// Deleting the row discards whatever clause and notes it carried, which
		// is not recoverable and not visible on the connector being clicked.
		frappe.confirm(__("Remove this mapping? Any clause and notes on it go too."), () => {
			frappe.call({
				method: MAPI + "disconnect_nodes",
				args: { a, b },
				callback: () => {
					frappe.show_alert({ indicator: "green", message: __("Mapping removed") });
					// Removal is the one case where a rebuild is right: the
					// question becomes a gap, so unmapped-only should show it.
					this.load(this.version);
				},
			});
		});
	}

	_select(name) {
		this.selected = name;
		const q = this.rows.find((x) => x.name === name);
		if (!q) return;
		this._renderInspector(q);
		// Selection is what the list highlights; the canvas is the whole map now,
		// so selecting on it must NOT rebuild the graph underneath the pointer.
		if (this.view === "list") this._renderTable();
	}

	_renderInspector(q) {
		const opt = (arr, val, key) =>
			['<option value=""></option>'].concat(
				arr.map((o) => `<option value="${o.name}" ${o.name === val ? "selected" : ""}>${frappe.utils.escape_html(o.name)}</option>`)
			).join("");
		this.$inspector.html(`
			<h5 style="margin-top:0">${__("Objective Mapping")}</h5>
			<div class="form-group"><label>${__("Objective")}</label><select class="form-control" data-f="objective">${opt(this.masters.objectives, q.objective)}</select></div>
			${(q.objectives && q.objectives.length > 1)
				? `<div class="ucc-map-multi">${__("This question carries {0} objectives: {1}. The field above edits one at a time.",
					[q.objectives.length, frappe.utils.escape_html(q.objectives.join(", "))])}</div>`
				: ""}
			${this.masters.standards.length
				? `<div class="form-group"><label>${__("Standard")}</label><select class="form-control" data-f="standard">${opt(this.masters.standards, q.standard)}</select></div>`
				: `<input type="hidden" data-f="standard" value="${frappe.utils.escape_html(q.standard || "")}">`}
			<div class="form-group"><label>${__("Primary Clause")}</label><input class="form-control" data-f="primary_clause" value="${frappe.utils.escape_html(q.primary_clause || "")}"></div>
			<div class="form-group"><label>${__("Related Clauses")}</label><textarea class="form-control" data-f="related_clauses">${frappe.utils.escape_html(q.related_clauses || "")}</textarea></div>
			<button class="btn btn-primary btn-sm btn-block ucc-map-save">${__("Save Objective Mapping")}</button>
			<hr>
			<h5>${__("Metric Mapping")}</h5>
			<div class="form-group"><label>${__("Metric Code")}</label><input class="form-control" data-f="metric_code" placeholder="e.g. TEACHING_CLARITY"></div>
			<button class="btn btn-default btn-sm btn-block ucc-map-metric">${__("Add As Metric Source")}</button>
		`);
		this.$inspector.find(".ucc-map-save").on("click", () => this._saveMapping(q.name));
		this.$inspector.find(".ucc-map-metric").on("click", () => this._saveMetric(q.name));
	}

	_val(f) { return this.$inspector.find(`[data-f="${f}"]`).val(); }

	_saveMapping(name) {
		if (!this._val("objective")) {
			frappe.show_alert({ message: __("Objective is required."), indicator: "orange" });
			return;
		}
		frappe.call({
			method: MAPI + "upsert_question_mapping",
			args: {
				question: name,
				objective: this._val("objective"),
				standard: this._val("standard"),
				primary_clause: this._val("primary_clause"),
				related_clauses: this._val("related_clauses"),
			},
			callback: () => {
				frappe.show_alert({ message: __("Mapping saved"), indicator: "green" });
				// Same trap as the canvas: saving an objective from the inspector
				// while the list is filtered to "unmapped" hides the question that
				// was just mapped.
				if (this.filter === "unmapped") this.filter = "all";
				this.load(this.version);
			},
		});
	}

	_saveMetric(name) {
		const code = (this._val("metric_code") || "").trim();
		if (!code) { frappe.show_alert({ message: __("Enter a metric code."), indicator: "orange" }); return; }
		frappe.call({
			method: MAPI + "set_question_metric",
			args: { question: name, metric_code: code },
			callback: () => { frappe.show_alert({ message: __("Metric source added"), indicator: "green" }); this.load(this.version); },
		});
	}
}
