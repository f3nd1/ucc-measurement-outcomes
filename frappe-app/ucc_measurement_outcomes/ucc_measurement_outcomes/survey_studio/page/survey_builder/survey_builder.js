// Copyright (c) 2026, United Ceres College and contributors
// Survey Builder Desk Page. Ports the prototype's palette + drag-to-insert /
// drag-to-reorder + inspector, but persists through whitelisted API methods.

frappe.pages["survey-builder"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Survey Builder"),
		single_column: true,
	});
	new SurveyBuilder(page);
};

// Question types == the Select options on UCC Survey Question, used verbatim.
const QUESTION_TYPES = [
	"Short Text", "Paragraph", "Email", "Number", "Date", "Rating",
	"Single Choice", "Multiple Choice", "Dropdown", "Yes / No", "Likert Matrix",
	"NPS", "Ranking", "Slider", "File Upload", "Section Heading",
];
const CHOICE_TYPES = new Set([
	"Rating", "Single Choice", "Multiple Choice", "Dropdown", "Yes / No",
	"Likert Matrix", "Ranking",
]);
const DISPLAY_LOGIC = [
	"Always Show", "Show If Previous Answer Matches", "Skip To Section", "End Survey",
];
const API = "ucc_measurement_outcomes.api.builder.";

class SurveyBuilder {
	constructor(page) {
		this.page = page;
		this.version = null;
		this.questions = [];
		this.editable = false;
		this.selected = null;
		this.dragIndex = null;
		this._injectStyle();
		this._buildLayout();
		// Deep-link support: version form button sets frappe.route_options.
		const preset = (frappe.route_options && frappe.route_options.survey_version) || null;
		frappe.route_options = {};
		if (preset) {
			this.versionField.set_value(preset);
		}
	}

	_injectStyle() {
		if (document.getElementById("ucc-sb-style")) return;
		const css = `
		.ucc-sb-grid{display:grid;grid-template-columns:210px 1fr 320px;gap:14px;align-items:start;margin-top:12px}
		.ucc-sb-panel{background:var(--card-bg,#fff);border:1px solid var(--border-color,#e2e6ea);border-radius:10px}
		.ucc-sb-panel h5{margin:0;padding:11px 13px;border-bottom:1px solid var(--border-color,#e2e6ea);font-size:12px}
		.ucc-sb-body{padding:12px}
		.ucc-sb-palette{display:grid;grid-template-columns:1fr 1fr;gap:6px}
		.ucc-sb-chip{border:1px solid var(--border-color,#e2e6ea);border-radius:8px;padding:8px 6px;font-size:11px;text-align:center;cursor:grab;user-select:none;background:var(--fg-color,#fff)}
		.ucc-sb-chip:hover{border-color:var(--primary,#4a63e7)}
		.ucc-sb-list{min-height:220px;display:flex;flex-direction:column;gap:9px}
		.ucc-sb-empty{border:2px dashed var(--border-color,#cbd4df);border-radius:10px;padding:28px;text-align:center;color:var(--text-muted,#8b95a5)}
		.ucc-sb-q{border:1px solid var(--border-color,#e2e6ea);border-radius:9px;padding:10px 12px;display:grid;grid-template-columns:20px 1fr auto;gap:9px;align-items:start;background:var(--fg-color,#fff)}
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
		`;
		const el = document.createElement("style");
		el.id = "ucc-sb-style";
		el.textContent = css;
		document.head.appendChild(el);
	}

	_buildLayout() {
		const $main = $(this.page.main).empty();
		const $picker = $('<div class="ucc-sb-picker" style="max-width:360px"></div>').appendTo($main);
		this.versionField = frappe.ui.form.make_control({
			parent: $picker.get(0),
			df: {
				fieldtype: "Link",
				options: "UCC Survey Version",
				label: __("Survey Version"),
				reqd: 1,
				change: () => {
					const v = this.versionField.get_value();
					if (v) this.load(v);
				},
			},
			render_input: true,
		});
		this.$banner = $('<div class="ucc-sb-banner" style="display:none"></div>').appendTo($main);
		const $grid = $('<div class="ucc-sb-grid"></div>').appendTo($main);
		this.$palette = $(`<div class="ucc-sb-panel"><h5>${__("Question Types")}</h5><div class="ucc-sb-body"><div class="ucc-sb-palette"></div></div></div>`).appendTo($grid).find(".ucc-sb-palette");
		this.$list = $(`<div class="ucc-sb-panel"><h5>${__("Questions")}</h5><div class="ucc-sb-body"><div class="ucc-sb-list"></div></div></div>`).appendTo($grid).find(".ucc-sb-list");
		this.$inspector = $(`<div class="ucc-sb-panel"><h5>${__("Inspector")}</h5><div class="ucc-sb-body"></div></div>`).appendTo($grid).find(".ucc-sb-body");
		this._renderPalette();
		this._renderInspector();
	}

	_renderPalette() {
		this.$palette.empty();
		QUESTION_TYPES.forEach((t) => {
			const $c = $(`<div class="ucc-sb-chip" draggable="true">${frappe.utils.escape_html(t)}</div>`);
			$c.on("dragstart", (e) => e.originalEvent.dataTransfer.setData("newType", t));
			this.$palette.append($c);
		});
	}

	load(version) {
		frappe.call({
			method: API + "get_survey_builder",
			args: { survey_version: version },
			callback: (r) => {
				if (!r.message) return;
				this.version = r.message.version;
				this.questions = r.message.questions || [];
				this.editable = !!r.message.editable;
				this.selected = null;
				this.page.set_title(
					`${__("Survey Builder")} — ${frappe.utils.escape_html(this.version.survey_title || "")} v${frappe.utils.escape_html(this.version.version_number || "")}`
				);
				this.$banner.toggle(!this.editable).text(
					__("This version is {0} and cannot be edited.", [this.version.status])
				);
				this._renderQuestions();
				this._renderInspector();
			},
		});
	}

	_renderQuestions() {
		this.$list.empty();
		this._wireListDrop();
		if (!this.questions.length) {
			this.$list.append(`<div class="ucc-sb-empty">${__("Drag a question type here")}</div>`);
			return;
		}
		this.questions.forEach((q, i) => {
			const tags = [q.question_type, q.is_required ? __("Required") : null]
				.filter(Boolean)
				.map((t) => `<span class="ucc-sb-tag">${frappe.utils.escape_html(t)}</span>`)
				.join("");
			const $q = $(`
				<div class="ucc-sb-q ${this.selected === q.name ? "selected" : ""}" draggable="${this.editable}" data-index="${i}" data-name="${q.name}">
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
			$q.find(".ucc-sb-main").on("click", () => this._select(q.name));
			$q.find('[data-act="dup"]').on("click", (e) => { e.stopPropagation(); this._duplicate(q.name); });
			$q.find('[data-act="del"]').on("click", (e) => { e.stopPropagation(); this._delete(q.name); });
			if (this.editable) this._wireQuestionDrag($q);
			this.$list.append($q);
		});
	}

	_wireQuestionDrag($q) {
		$q.on("dragstart", (e) => {
			this.dragIndex = +$q.data("index");
			$q.addClass("dragging");
			e.originalEvent.dataTransfer.setData("moveIndex", this.dragIndex);
		});
		$q.on("dragend", () => $q.removeClass("dragging"));
		$q.on("dragover", (e) => e.preventDefault());
		$q.on("drop", (e) => {
			e.preventDefault();
			e.stopPropagation();
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

	_addQuestion(type, index) {
		if (!this._guardEditable()) return;
		frappe.call({
			method: API + "add_question",
			args: { survey_version: this.version.name, question_type: type, sequence: index },
			callback: (r) => { if (r.message) { this.selected = r.message; this.load(this.version.name); } },
		});
	}

	_reorder(from, to) {
		if (!this._guardEditable()) return;
		const names = this.questions.map((q) => q.name);
		const [moved] = names.splice(from, 1);
		names.splice(to, 0, moved);
		frappe.call({
			method: API + "reorder_questions",
			args: { survey_version: this.version.name, ordered: JSON.stringify(names) },
			callback: () => this.load(this.version.name),
		});
	}

	_duplicate(name) {
		if (!this._guardEditable()) return;
		frappe.call({
			method: API + "duplicate_question",
			args: { question: name },
			callback: (r) => { if (r.message) { this.selected = r.message; this.load(this.version.name); } },
		});
	}

	_delete(name) {
		if (!this._guardEditable()) return;
		frappe.confirm(__("Delete this question?"), () => {
			frappe.call({
				method: API + "delete_question",
				args: { question: name },
				callback: () => { if (this.selected === name) this.selected = null; this.load(this.version.name); },
			});
		});
	}

	_select(name) {
		this.selected = name;
		this._renderQuestions();
		this._renderInspector();
	}

	_renderInspector() {
		const q = this.questions.find((x) => x.name === this.selected);
		if (!q) {
			this.$inspector.html(`<p class="text-muted" style="font-size:12px">${__("Select a question to edit its wording, type, options and display logic.")}</p>`);
			return;
		}
		const opt = (arr, val) =>
			arr.map((o) => `<option ${o === val ? "selected" : ""}>${frappe.utils.escape_html(o)}</option>`).join("");
		const choicesText = (q.choices || [])
			.map((c) => (c.choice_value ? `${c.choice_label}|${c.choice_value}` : c.choice_label))
			.join("\n");
		const dis = this.editable ? "" : "disabled";
		this.$inspector.html(`
			<div class="form-group"><label>${__("Question")}</label><textarea class="form-control" data-f="question_text" ${dis}>${frappe.utils.escape_html(q.question_text || "")}</textarea></div>
			<div class="form-group"><label>${__("Help Text")}</label><textarea class="form-control" data-f="help_text" ${dis}>${frappe.utils.escape_html(q.help_text || "")}</textarea></div>
			<div class="form-group"><label>${__("Type")}</label><select class="form-control" data-f="question_type" ${dis}>${opt(QUESTION_TYPES, q.question_type)}</select></div>
			<div class="checkbox"><label><input type="checkbox" data-f="is_required" ${q.is_required ? "checked" : ""} ${dis}> ${__("Required")}</label></div>
			<div class="form-group ucc-sb-choices" style="${CHOICE_TYPES.has(q.question_type) ? "" : "display:none"}"><label>${__("Choices (one per line, optional |value)")}</label><textarea class="form-control" data-f="choices" rows="4" ${dis}>${frappe.utils.escape_html(choicesText)}</textarea></div>
			<div class="form-group"><label>${__("Display Logic")}</label><select class="form-control" data-f="display_logic" ${dis}>${opt(DISPLAY_LOGIC, q.display_logic || "Always Show")}</select></div>
			<div class="form-group ucc-sb-logiccfg" style="${q.display_logic && q.display_logic !== "Always Show" ? "" : "display:none"}"><label>${__("Logic Condition")}</label><textarea class="form-control" data-f="display_logic_config" ${dis}>${frappe.utils.escape_html(q.display_logic_config || "")}</textarea></div>
			${this.editable ? `<button class="btn btn-primary btn-sm btn-block ucc-sb-apply">${__("Apply Changes")}</button>` : ""}
		`);
		// Live toggles for the type-dependent + logic-dependent fields.
		this.$inspector.find('[data-f="question_type"]').on("change", (e) => {
			this.$inspector.find(".ucc-sb-choices").toggle(CHOICE_TYPES.has(e.target.value));
		});
		this.$inspector.find('[data-f="display_logic"]').on("change", (e) => {
			this.$inspector.find(".ucc-sb-logiccfg").toggle(e.target.value !== "Always Show");
		});
		this.$inspector.find(".ucc-sb-apply").on("click", () => this._apply(q.name));
	}

	_apply(name) {
		if (!this._guardEditable()) return;
		const val = (f) => this.$inspector.find(`[data-f="${f}"]`);
		const choices = val("choices").val().split("\n").map((s) => s.trim()).filter(Boolean)
			.map((line, i) => {
				const [label, value] = line.split("|").map((x) => x.trim());
				return { choice_label: label, choice_value: value || null, sequence: i };
			});
		const payload = {
			question_text: val("question_text").val(),
			help_text: val("help_text").val(),
			question_type: val("question_type").val(),
			is_required: val("is_required").is(":checked") ? 1 : 0,
			display_logic: val("display_logic").val(),
			display_logic_config: val("display_logic_config").val(),
			choices: choices,
		};
		frappe.call({
			method: API + "update_question",
			args: { question: name, payload: JSON.stringify(payload) },
			callback: () => {
				frappe.show_alert({ message: __("Question updated"), indicator: "green" });
				this.load(this.version.name);
			},
		});
	}
}
