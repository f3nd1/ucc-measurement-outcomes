// Copyright (c) 2026, United Ceres College and contributors
// Survey Builder Desk Page. Palette + drag insert/reorder + inspector, plus
// editorial conveniences: bulk paste, multi-select bulk actions, undo/redo of
// structural actions, and desktop/mobile preview. Persists via whitelisted API.

frappe.pages["survey-builder"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Survey Builder"),
		single_column: true,
	});
	new SurveyBuilder(page);
};

const QUESTION_TYPES = [
	"Short Text", "Paragraph", "Email", "Number", "Date", "Rating",
	"Single Choice", "Multiple Choice", "Dropdown", "Yes / No", "Likert Matrix",
	"NPS", "Ranking", "Slider", "File Upload", "Section Heading",
];
const CHOICE_TYPES = new Set([
	"Rating", "Single Choice", "Multiple Choice", "Dropdown", "Yes / No",
	"Likert Matrix", "Ranking",
]);
// Display-logic UI removed per decision V1: the fields exist in the schema but
// nothing executes them yet. Re-add the controls together with the logic
// engine (which must include a server-side logic-aware required check).
const API = "ucc_measurement_outcomes.api.builder.";

class SurveyBuilder {
	constructor(page) {
		this.page = page;
		this.version = null;
		this.questions = [];
		this.editable = false;
		this.selected = null;
		this.dragIndex = null;
		this.selection = new Set();
		this.history = [];
		this.future = [];
		this._injectStyle();
		this._buildLayout();
		const preset = (frappe.route_options && frappe.route_options.survey_version) || null;
		frappe.route_options = {};
		if (preset) this.versionField.set_value(preset);
	}

	_injectStyle() {
		if (document.getElementById("ucc-sb-style")) return;
		const css = `
		.ucc-sb-grid{display:grid;grid-template-columns:210px 1fr 320px;gap:14px;align-items:start;margin-top:12px}
		.ucc-sb-panel{background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e6ea);border-radius:10px}
		.ucc-sb-panel h5{margin:0;padding:11px 13px;border-bottom:1px solid var(--border-color,#e2e6ea);font-size:12px}
		.ucc-sb-body{padding:12px}
		.ucc-sb-toolbar{display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap}
		.ucc-sb-bulkbar{display:none;gap:6px;align-items:center;background:#eef3fb;border:1px solid #d5e1f0;border-radius:8px;padding:6px 10px;margin-top:8px;font-size:12px}
		.ucc-sb-bulkbar.show{display:flex}
		.ucc-sb-palette{display:grid;grid-template-columns:1fr 1fr;gap:6px}
		.ucc-sb-chip{border:1px solid var(--border-color,#e2e6ea);border-radius:8px;padding:8px 6px;font-size:11px;text-align:center;cursor:grab;user-select:none;background:var(--fg-color,#fff)}
		.ucc-sb-chip:hover{border-color:var(--primary,#4a63e7)}
		.ucc-sb-list{min-height:220px;display:flex;flex-direction:column;gap:9px}
		.ucc-sb-empty{border:2px dashed var(--border-color,#cbd4df);border-radius:10px;padding:28px;text-align:center;color:var(--text-muted,#8b95a5)}
		.ucc-sb-q{border:1px solid var(--border-color,#e2e6ea);border-radius:9px;padding:10px 12px;display:grid;grid-template-columns:18px 20px 1fr auto;gap:9px;align-items:start;background:var(--fg-color,#fff)}
		.ucc-sb-q.selected{border-color:var(--primary,#4a63e7);box-shadow:0 0 0 2px rgba(74,99,231,.12)}
		.ucc-sb-q.dragging{opacity:.4}
		.ucc-sb-handle{cursor:grab;color:var(--text-muted,#98a1af)}
		.ucc-sb-qtitle{font-size:13px;font-weight:600}
		.ucc-sb-qmeta{font-size:10px;color:var(--text-muted,#8b95a5);margin-top:4px}
		.ucc-sb-tag{display:inline-block;border:1px solid var(--border-color,#e2e6ea);border-radius:20px;padding:1px 7px;margin-right:5px;font-size:10px}
		.ucc-sb-banner{background:#fff4df;border:1px solid #ecd6aa;color:#715824;border-radius:8px;padding:9px 12px;font-size:12px;margin-top:10px}
		.ucc-sb-req{color:var(--red,#b94848)}
		.ucc-sb-iconbtn{border:0;background:transparent;cursor:pointer;color:var(--text-muted,#8b95a5);padding:3px 5px;border-radius:6px}
		.ucc-sb-iconbtn:hover{background:var(--bg-light-gray,#eef2f7)}
		.ucc-sb-modal{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;align-items:flex-start;justify-content:center;z-index:1050;padding:24px;overflow:auto}
		.ucc-sb-modal.show{display:flex}
		.ucc-sb-sheet{background:#fff;border-radius:12px;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);width:min(680px,96vw)}
		.ucc-sb-sheet.mobile{width:390px}
		.ucc-sb-sheet-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-color,#e2e6ea)}
		.ucc-sb-sheet-body{padding:18px}
		.ucc-sb-pq{padding:12px 0;border-bottom:1px solid #eee}
		.ucc-sb-pq label.q{display:block;font-weight:600;margin-bottom:6px}
		`;
		const el = document.createElement("style");
		el.id = "ucc-sb-style";
		el.textContent = css;
		document.head.appendChild(el);
	}

	_buildLayout() {
		const $main = $(this.page.main).empty();
		const $picker = $('<div style="max-width:360px"></div>').appendTo($main);
		this.versionField = frappe.ui.form.make_control({
			parent: $picker.get(0),
			df: {
				fieldtype: "Link", options: "UCC Survey Version", label: __("Survey Version"), reqd: 1,
				change: () => { const v = this.versionField.get_value(); if (v) this.load(v); },
			},
			render_input: true,
		});
		const $tb = $('<div class="ucc-sb-toolbar"></div>').appendTo($main);
		$(`<button class="btn btn-default btn-sm">${__("Bulk paste")}</button>`).appendTo($tb).on("click", () => this._openBulk());
		$(`<button class="btn btn-default btn-sm">${__("Preview")}</button>`).appendTo($tb).on("click", () => this._preview());
		this.$undo = $(`<button class="btn btn-default btn-sm" disabled>${__("Undo")}</button>`).appendTo($tb).on("click", () => this._undo());
		this.$redo = $(`<button class="btn btn-default btn-sm" disabled>${__("Redo")}</button>`).appendTo($tb).on("click", () => this._redo());
		this.$bulk = $('<div class="ucc-sb-bulkbar"></div>').appendTo($main);
		this.$banner = $('<div class="ucc-sb-banner" style="display:none"></div>').appendTo($main);
		const $grid = $('<div class="ucc-sb-grid"></div>').appendTo($main);
		this.$palette = $(`<div class="ucc-sb-panel"><h5>${__("Question Types")}</h5><div class="ucc-sb-body"><div class="ucc-sb-palette"></div></div></div>`).appendTo($grid).find(".ucc-sb-palette");
		this.$list = $(`<div class="ucc-sb-panel"><h5>${__("Questions")}</h5><div class="ucc-sb-body"><div class="ucc-sb-list"></div></div></div>`).appendTo($grid).find(".ucc-sb-list");
		this.$inspector = $(`<div class="ucc-sb-panel"><h5>${__("Inspector")}</h5><div class="ucc-sb-body"></div></div>`).appendTo($grid).find(".ucc-sb-body");
		this._renderPalette();
		this._renderInspector();
		this._modal = $('<div class="ucc-sb-modal"><div class="ucc-sb-sheet"></div></div>').appendTo(document.body);
	}

	_renderPalette() {
		this.$palette.empty();
		QUESTION_TYPES.forEach((t) => {
			const $c = $(`<div class="ucc-sb-chip" draggable="true">${frappe.utils.escape_html(t)}</div>`);
			$c.on("dragstart", (e) => e.originalEvent.dataTransfer.setData("newType", t));
			this.$palette.append($c);
		});
	}

	// --- promise wrapper over whitelisted calls ---
	_call(method, args) {
		return new Promise((resolve) => frappe.call({ method: API + method, args, callback: (r) => resolve(r.message) }));
	}

	load(version) {
		this._call("get_survey_builder", { survey_version: version }).then((m) => {
			if (!m) return;
			this.version = m.version;
			this.questions = m.questions || [];
			this.editable = !!m.editable;
			this.selected = null;
			this.selection.clear();
			this.history = [];
			this.future = [];
			this._updateUndo();
			this.page.set_title(`${__("Survey Builder")} — ${frappe.utils.escape_html(this.version.survey_title || "")} v${frappe.utils.escape_html(this.version.version_number || "")}`);
			this.$banner.toggle(!this.editable).text(__("This version is {0} and cannot be edited.", [this.version.status]));
			this._renderQuestions();
			this._renderInspector();
			this._renderBulkBar();
		});
	}

	_reload() { return this.version ? Promise.resolve(this.load(this.version.name)) : Promise.resolve(); }

	_renderQuestions() {
		this.$list.empty();
		this._wireListDrop();
		if (!this.questions.length) {
			this.$list.append(`<div class="ucc-sb-empty">${__("Drag a question type here")}</div>`);
			return;
		}
		this.questions.forEach((q, i) => {
			const tags = [q.question_type, q.is_required ? __("Required") : null].filter(Boolean)
				.map((t) => `<span class="ucc-sb-tag">${frappe.utils.escape_html(t)}</span>`).join("");
			const $q = $(`
				<div class="ucc-sb-q ${this.selected === q.name ? "selected" : ""}" draggable="${this.editable}" data-index="${i}" data-name="${q.name}">
					<input type="checkbox" class="ucc-sb-check" ${this.selection.has(q.name) ? "checked" : ""}>
					<div class="ucc-sb-handle">⋮⋮</div>
					<div class="ucc-sb-main">
						<div class="ucc-sb-qtitle">${i + 1}. ${frappe.utils.escape_html(q.question_text || "")} ${q.is_required ? '<span class="ucc-sb-req">*</span>' : ""}</div>
						<div class="ucc-sb-qmeta">${tags}</div>
					</div>
					<div class="ucc-sb-actions">
						<button class="ucc-sb-iconbtn" data-act="dup" title="${__("Duplicate")}">⧉</button>
						<button class="ucc-sb-iconbtn" data-act="del" title="${__("Delete")}">⌫</button>
					</div>
				</div>`);
			$q.find(".ucc-sb-check").on("change", (e) => { e.target.checked ? this.selection.add(q.name) : this.selection.delete(q.name); this._renderBulkBar(); });
			$q.find(".ucc-sb-main").on("click", () => this._select(q.name));
			$q.find('[data-act="dup"]').on("click", (e) => { e.stopPropagation(); this._duplicate(q.name); });
			$q.find('[data-act="del"]').on("click", (e) => { e.stopPropagation(); this._delete(q.name); });
			if (this.editable) this._wireQuestionDrag($q);
			this.$list.append($q);
		});
	}

	_renderBulkBar() {
		const n = this.selection.size;
		this.$bulk.toggleClass("show", n > 0 && this.editable);
		if (!n) return;
		this.$bulk.empty().append(`<span>${__("{0} selected", [n])}</span>`);
		$(`<button class="btn btn-xs btn-danger">${__("Delete")}</button>`).appendTo(this.$bulk).on("click", () => this._bulkDelete());
		$(`<button class="btn btn-xs btn-default">${__("Copy to version…")}</button>`).appendTo(this.$bulk).on("click", () => this._bulkCopy());
		$(`<button class="btn btn-xs btn-default">${__("Clear")}</button>`).appendTo(this.$bulk).on("click", () => { this.selection.clear(); this._renderQuestions(); this._renderBulkBar(); });
	}

	_wireQuestionDrag($q) {
		$q.on("dragstart", (e) => { this.dragIndex = +$q.data("index"); $q.addClass("dragging"); e.originalEvent.dataTransfer.setData("moveIndex", this.dragIndex); });
		$q.on("dragend", () => $q.removeClass("dragging"));
		$q.on("dragover", (e) => e.preventDefault());
		$q.on("drop", (e) => {
			e.preventDefault(); e.stopPropagation();
			const dt = e.originalEvent.dataTransfer;
			const newType = dt.getData("newType");
			const to = +$q.data("index");
			if (newType) return this._addQuestion(newType, to);
			const from = +dt.getData("moveIndex");
			if (Number.isInteger(from) && from !== to) this._reorder(from, to);
		});
	}

	_wireListDrop() {
		this.$list.off("dragover drop");
		this.$list.on("dragover", (e) => e.preventDefault());
		this.$list.on("drop", (e) => {
			if (e.target !== this.$list.get(0)) return;
			const newType = e.originalEvent.dataTransfer.getData("newType");
			if (newType) this._addQuestion(newType, this.questions.length);
		});
	}

	_guardEditable() {
		if (this.editable) return true;
		frappe.show_alert({ message: __("This version is read-only."), indicator: "orange" });
		return false;
	}

	// --- undo/redo (structural actions only) ---
	// ponytail: id-based history; a delete's undo re-creates with a NEW id which
	// the action tracks for its own redo. Deeply interleaved undo across recreated
	// items can desync — acceptable for typical linear edit/undo/redo use.
	_record(action) { this.history.push(action); this.future = []; this._updateUndo(); }
	_updateUndo() { this.$undo.prop("disabled", !this.history.length); this.$redo.prop("disabled", !this.future.length); }
	_undo() { const a = this.history.pop(); if (!a) return; Promise.resolve(a.undo()).then(() => { this.future.push(a); this._reload(); }); }
	_redo() { const a = this.future.pop(); if (!a) return; Promise.resolve(a.redo()).then(() => { this.history.push(a); this._reload(); }); }

	_addQuestion(type, index) {
		if (!this._guardEditable()) return;
		this._call("add_question", { survey_version: this.version.name, question_type: type, sequence: index }).then((name) => {
			if (!name) return;
			const st = { name };
			this._record({ undo: () => this._call("delete_question", { question: st.name }), redo: () => this._call("add_question", { survey_version: this.version.name, question_type: type, sequence: index }).then((nm) => { st.name = nm; }) });
			this.selected = name; this.load(this.version.name);
		});
	}

	_reorder(from, to) {
		if (!this._guardEditable()) return;
		const oldNames = this.questions.map((q) => q.name);
		const newNames = oldNames.slice();
		newNames.splice(to, 0, newNames.splice(from, 1)[0]);
		this._call("reorder_questions", { survey_version: this.version.name, ordered: JSON.stringify(newNames) }).then(() => {
			this._record({ undo: () => this._call("reorder_questions", { survey_version: this.version.name, ordered: JSON.stringify(oldNames) }), redo: () => this._call("reorder_questions", { survey_version: this.version.name, ordered: JSON.stringify(newNames) }) });
			this.load(this.version.name);
		});
	}

	_duplicate(name) {
		if (!this._guardEditable()) return;
		this._call("duplicate_question", { question: name }).then((nm) => {
			if (!nm) return;
			const st = { name: nm };
			this._record({ undo: () => this._call("delete_question", { question: st.name }), redo: () => this._call("duplicate_question", { question: name }).then((n2) => { st.name = n2; }) });
			this.selected = nm; this.load(this.version.name);
		});
	}

	_snapshot(name) {
		const q = this.questions.find((x) => x.name === name) || {};
		return {
			question_text: q.question_text, question_type: q.question_type, help_text: q.help_text,
			is_required: q.is_required, sequence: q.sequence,
			display_logic: q.display_logic, display_logic_config: q.display_logic_config,
			choices: q.choices || [],
		};
	}

	_delete(name) {
		if (!this._guardEditable()) return;
		frappe.confirm(__("Delete this question?"), () => {
			const snap = this._snapshot(name);
			this._call("delete_question", { question: name }).then(() => {
				const st = { name };
				this._record({
					undo: () => this._call("create_question", { survey_version: this.version.name, payload: JSON.stringify(snap) }).then((nm) => { st.name = nm; }),
					redo: () => this._call("delete_question", { question: st.name }),
				});
				if (this.selected === name) this.selected = null;
				this.load(this.version.name);
			});
		});
	}

	_bulkDelete() {
		if (!this._guardEditable()) return;
		const names = [...this.selection];
		const snaps = names.map((n) => this._snapshot(n));
		frappe.confirm(__("Delete {0} questions?", [names.length]), () => {
			this._call("bulk_delete_questions", { names: JSON.stringify(names) }).then(() => {
				const st = { names };
				this._record({
					undo: () => Promise.all(snaps.map((s) => this._call("create_question", { survey_version: this.version.name, payload: JSON.stringify(s) }))).then((nm) => { st.names = nm; }),
					redo: () => this._call("bulk_delete_questions", { names: JSON.stringify(st.names) }),
				});
				this.selection.clear(); this.load(this.version.name);
			});
		});
	}

	_bulkCopy() {
		const names = [...this.selection];
		frappe.prompt(
			[{ fieldname: "target", fieldtype: "Link", options: "UCC Survey Version", label: __("Target version"), reqd: 1 }],
			(v) => {
				this._call("copy_questions_to_version", { names: JSON.stringify(names), target_version: v.target }).then((created) => {
					frappe.show_alert({ message: __("Copied {0} questions", [(created || []).length]), indicator: "green" });
				});
			}, __("Copy questions to version"), __("Copy"));
	}

	_openBulk() {
		if (!this._guardEditable()) return;
		this._sheet(false, `<h5>${__("Bulk paste questions")}</h5>
			<p class="text-muted" style="font-size:12px">${__("One per line: question | type | options")}</p>
			<textarea class="form-control ucc-sb-bulktext" rows="8" placeholder="The orientation was clear | Rating | 1,2,3,4,5"></textarea>
			<button class="btn btn-primary btn-sm ucc-sb-bulkgo" style="margin-top:10px">${__("Create questions")}</button>`);
		this._modal.find(".ucc-sb-bulkgo").on("click", () => {
			const text = this._modal.find(".ucc-sb-bulktext").val();
			this._call("bulk_paste_questions", { survey_version: this.version.name, text }).then((created) => {
				this._closeSheet();
				if (created && created.length) {
					const st = { names: created };
					const redo = () => this._call("bulk_paste_questions", { survey_version: this.version.name, text }).then((nm) => { st.names = nm; });
					this._record({ undo: () => this._call("bulk_delete_questions", { names: JSON.stringify(st.names) }), redo });
					frappe.show_alert({ message: __("Created {0} questions", [created.length]), indicator: "green" });
				}
				this.load(this.version.name);
			});
		});
	}

	_preview() {
		let mobile = false;
		const form = this.questions.map((q, i) => {
			if (q.question_type === "Section Heading") return `<h4>${frappe.utils.escape_html(q.question_text || "")}</h4>`;
			return `<div class="ucc-sb-pq"><label class="q">${i + 1}. ${frappe.utils.escape_html(q.question_text || "")} ${q.is_required ? '<span class="ucc-sb-req">*</span>' : ""}</label>${this._previewInput(q)}</div>`;
		}).join("");
		this._sheet(mobile, `<h5>${__("Preview")} — <span class="ucc-sb-vp"></span></h5>
			<button class="btn btn-xs btn-default ucc-sb-toggle" style="margin-bottom:10px">${__("Toggle desktop / mobile")}</button>
			<div class="ucc-sb-previewform">${form}</div>`);
		const setvp = () => { this._modal.find(".ucc-sb-sheet").toggleClass("mobile", mobile); this._modal.find(".ucc-sb-vp").text(mobile ? __("Mobile") : __("Desktop")); };
		setvp();
		this._modal.find(".ucc-sb-toggle").on("click", () => { mobile = !mobile; setvp(); });
	}

	_previewInput(q) {
		const choices = (q.choices || []).map((c) => c.choice_label);
		switch (q.question_type) {
			case "Paragraph": return '<textarea class="form-control" rows="2"></textarea>';
			case "Rating": case "Single Choice": case "Yes / No":
				return choices.map((c) => `<label style="display:block;font-weight:400"><input type="radio" name="pv_${q.name}"> ${frappe.utils.escape_html(c)}</label>`).join("") || '<input class="form-control">';
			case "Multiple Choice":
				return choices.map((c) => `<label style="display:block;font-weight:400"><input type="checkbox"> ${frappe.utils.escape_html(c)}</label>`).join("");
			case "Dropdown":
				return `<select class="form-control"><option></option>${choices.map((c) => `<option>${frappe.utils.escape_html(c)}</option>`).join("")}</select>`;
			case "Date": return '<input type="date" class="form-control">';
			case "Number": return '<input type="number" class="form-control">';
			case "Email": return '<input type="email" class="form-control">';
			default: return '<input class="form-control">';
		}
	}

	_sheet(mobile, html) {
		const $s = this._modal.find(".ucc-sb-sheet").toggleClass("mobile", !!mobile);
		$s.html(`<div class="ucc-sb-sheet-head"><b>${__("Survey Builder")}</b><button class="ucc-sb-iconbtn ucc-sb-close">✕</button></div><div class="ucc-sb-sheet-body">${html}</div>`);
		this._modal.addClass("show");
		this._modal.find(".ucc-sb-close").on("click", () => this._closeSheet());
	}
	_closeSheet() { this._modal.removeClass("show"); }

	_select(name) { this.selected = name; this._renderQuestions(); this._renderInspector(); }

	_renderInspector() {
		const q = this.questions.find((x) => x.name === this.selected);
		if (!q) { this.$inspector.html(`<p class="text-muted" style="font-size:12px">${__("Select a question to edit its wording, type, options and display logic.")}</p>`); return; }
		const opt = (arr, val) => arr.map((o) => `<option ${o === val ? "selected" : ""}>${frappe.utils.escape_html(o)}</option>`).join("");
		const choicesText = (q.choices || []).map((c) => (c.choice_value ? `${c.choice_label}|${c.choice_value}` : c.choice_label)).join("\n");
		const dis = this.editable ? "" : "disabled";
		this.$inspector.html(`
			<div class="form-group"><label>${__("Question")}</label><textarea class="form-control" data-f="question_text" ${dis}>${frappe.utils.escape_html(q.question_text || "")}</textarea></div>
			<div class="form-group"><label>${__("Help Text")}</label><textarea class="form-control" data-f="help_text" ${dis}>${frappe.utils.escape_html(q.help_text || "")}</textarea></div>
			<div class="form-group"><label>${__("Type")}</label><select class="form-control" data-f="question_type" ${dis}>${opt(QUESTION_TYPES, q.question_type)}</select></div>
			<div class="checkbox"><label><input type="checkbox" data-f="is_required" ${q.is_required ? "checked" : ""} ${dis}> ${__("Required")}</label></div>
			<div class="form-group ucc-sb-choices" style="${CHOICE_TYPES.has(q.question_type) ? "" : "display:none"}"><label>${__("Choices (one per line, optional |value)")}</label><textarea class="form-control" data-f="choices" rows="4" ${dis}>${frappe.utils.escape_html(choicesText)}</textarea></div>
			${this.editable ? `<button class="btn btn-primary btn-sm btn-block ucc-sb-apply">${__("Apply Changes")}</button>` : ""}
		`);
		this.$inspector.find('[data-f="question_type"]').on("change", (e) => this.$inspector.find(".ucc-sb-choices").toggle(CHOICE_TYPES.has(e.target.value)));
		this.$inspector.find(".ucc-sb-apply").on("click", () => this._apply(q.name));
	}

	_apply(name) {
		if (!this._guardEditable()) return;
		const val = (f) => this.$inspector.find(`[data-f="${f}"]`);
		const choices = val("choices").val().split("\n").map((s) => s.trim()).filter(Boolean).map((line, i) => {
			const [label, value] = line.split("|").map((x) => x.trim());
			return { choice_label: label, choice_value: value || null, sequence: i };
		});
		const payload = {
			question_text: val("question_text").val(), help_text: val("help_text").val(),
			question_type: val("question_type").val(), is_required: val("is_required").is(":checked") ? 1 : 0,
			choices,
		};
		this._call("update_question", { question: name, payload: JSON.stringify(payload) }).then(() => {
			frappe.show_alert({ message: __("Question updated"), indicator: "green" });
			this.load(this.version.name);
		});
	}
}
