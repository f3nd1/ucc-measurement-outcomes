/* The respondent's survey form, as one renderer.
 *
 * Extracted from www/survey.html so the Survey Builder's Preview renders the
 * REAL page instead of a parallel approximation of it - which is what forced a
 * second copy of the page-split rule and still could not show real styling.
 * One renderer, one stylesheet (public/css/ucc_survey_form.bundle.css), two callers.
 *
 * The seam is deliberate: SUBMISSION IS NOT IN HERE. The fetch, the CSRF header
 * and the form-encoded body stay inline in www/survey.html and arrive as
 * opts.onSubmit, so the guest submission path is unchanged by this extraction
 * and cannot be reached from the Desk at all. Without an onSubmit there is no
 * submit button.
 *
 * Loaded per page on the website (survey.html's script block) and via the Desk
 * bundle for the builder - never via web_include_js, which would put it on every
 * website page for no reason.
 *
 * Plain ES5 and no dependencies, including no jQuery and no frappe globals: this
 * runs on a guest portal page where desk JS is not guaranteed to be loaded.
 *
 * UCCSurveyForm.render(root, survey, opts) -> { root, collect, showError, setBusy }
 *   survey : { title, questions: [...] } - the shape both public_survey_payload
 *            and preview_payload return
 *   opts   : { onSubmit(answers, api) }  - omit for a read-only render
 */
window.UCCSurveyForm = {
	render: function (root, survey, opts) {
		opts = opts || {};
		if (!root || !survey) return null;


		function esc(s) {
			return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
				return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
			});
		}

		// Shared by Likert Matrix, Multiple Choice Grid and Checkbox Grid: rows
		// (q.matrix_rows, one statement per line) down the side, columns (q.choices
		// - the SAME table every simple choice type already uses) across the top.
		// Only Checkbox Grid allows more than one selection per row.
		var MULTI_GRID_TYPES = ["Checkbox Grid"];
		function renderGrid(q, columns) {
			var name = q.name;
			var rows = (q.matrix_rows || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
			if (!rows.length || !columns.length) {
				// Same reasoning as Rating/Ranking with no choices configured: an
				// empty grid with a required flag would strand a respondent who has
				// nothing to answer, so this falls back to a real, answerable field.
				return '<textarea class="form-control" data-q="' + esc(name) + '" rows="2"></textarea>';
			}
			var multi = MULTI_GRID_TYPES.indexOf(q.question_type) !== -1;
			var head = columns.map(function (c) { return "<th>" + esc(c.choice_label) + "</th>"; }).join("");
			var body = rows.map(function (r, ri) {
				var cells = columns.map(function (c) {
					var v = c.choice_value != null && c.choice_value !== "" ? c.choice_value : c.choice_label;
					return '<td style="text-align:center"><input type="' + (multi ? "checkbox" : "radio") +
						'" name="q_' + esc(name) + "_r" + ri + '" value="' + esc(v) + '"></td>';
				}).join("");
				return "<tr data-row=\"" + ri + "\"><td>" + esc(r) + "</td>" + cells + "</tr>";
			}).join("");
			return '<table class="ucc-grid" data-q="' + esc(name) + '"><thead><tr><th></th>' + head +
				"</tr></thead><tbody>" + body + "</tbody></table>";
		}

		// Presentation only. Unset (every question that exists today) = full width,
		// i.e. exactly the single column this form has always rendered.
		var WIDTHS = { "Two Thirds": "ucc-w-8", "Half": "ucc-w-6", "One Third": "ucc-w-4" };
		function widthClass(q) {
			return WIDTHS[q.layout_width] || "";
		}

		function field(q) {
			var name = q.name;
			var choices = (q.choices || []);
			var opt = function (c, type) {
				var v = c.choice_value != null && c.choice_value !== "" ? c.choice_value : c.choice_label;
				return '<label class="ucc-opt"><input type="' + type + '" name="q_' + esc(name) + '" value="' + esc(v) + '"> ' + esc(c.choice_label) + "</label>";
			};
			switch (q.question_type) {
				case "Paragraph":
					return '<textarea class="form-control" data-q="' + esc(name) + '" rows="3"></textarea>';
				// Item 2: star widget, not numbered radios. The underlying stored
				// value is unchanged — still whichever choice_value/choice_label the
				// checked radio carries; collect() below reads input:checked exactly
				// as it did before, so nothing downstream of this markup changes.
				case "Rating":
					if (!choices.length) return '<input type="text" class="form-control" data-q="' + esc(name) + '">';
					return '<div class="ucc-stars" data-q="' + esc(name) + '">' + choices.map(function (c, i) {
						var v = c.choice_value != null && c.choice_value !== "" ? c.choice_value : c.choice_label;
						var id = "star_" + esc(name) + "_" + i;
						return '<input type="radio" class="ucc-star-input" name="q_' + esc(name) + '" value="' + esc(v) + '" id="' + id + '" data-n="' + (i + 1) + '">' +
							'<label for="' + id + '" class="ucc-star" data-n="' + (i + 1) + '" title="' + esc(c.choice_label) + '">★</label>';
					}).join("") + "</div>";
				// Investigation finding: Likert Matrix had no case here either -
				// as unimplemented as the others were, and no schema field for
				// rows existed anywhere. One shared renderer for all three grid
				// types; only the per-cell input differs (radio vs checkbox).
				case "Likert Matrix":
				case "Multiple Choice Grid":
				case "Checkbox Grid":
					return renderGrid(q, choices);
				// NPS: no case existed at all, so it fell through to the generic
				// default (a free-text box) - the same broken pattern Ranking/
				// Slider/File Upload had before tonight. Fixed the same way: a
				// real 0-10 button row, not free text. Fixed scale, not driven by
				// choices - NPS is not in this app's CHOICE_TYPES (no configurable
				// options), same as Slider.
				case "NPS":
					return '<div class="ucc-nps" data-q="' + esc(name) + '">' +
						'<div class="ucc-nps-row">' +
						Array.from({ length: 11 }, function (_, n) {
							var id = "nps_" + esc(name) + "_" + n;
							return '<input type="radio" class="ucc-nps-input" name="q_' + esc(name) + '" value="' + n + '" id="' + id + '">' +
								'<label for="' + id + '" class="ucc-nps-btn">' + n + "</label>";
						}).join("") +
						"</div>" +
						'<div class="ucc-nps-ends"><span>Not at all likely</span><span>Extremely likely</span></div>' +
						"</div>";
				case "Single Choice":
				case "Yes / No":
					return '<div data-q="' + esc(name) + '" data-multi="0">' + choices.map(function (c) { return opt(c, "radio"); }).join("") + "</div>";
				case "Multiple Choice":
					return '<div data-q="' + esc(name) + '" data-multi="1">' + choices.map(function (c) { return opt(c, "checkbox"); }).join("") + "</div>";
				case "Dropdown":
					return '<select class="form-control" data-q="' + esc(name) + '"><option value=""></option>' + choices.map(function (c) {
						var v = c.choice_value != null && c.choice_value !== "" ? c.choice_value : c.choice_label;
						return '<option value="' + esc(v) + '">' + esc(c.choice_label) + "</option>";
					}).join("") + "</select>";
				case "Number":
					return '<input type="number" class="form-control" data-q="' + esc(name) + '">';
				case "Date":
					return '<input type="date" class="form-control" data-q="' + esc(name) + '">';
				case "Email":
					return '<input type="email" class="form-control" data-q="' + esc(name) + '">';
				// Item 3: a real range input, not an empty box. The generic
				// [data-q] fallback in collect() below already reads its .value, so
				// no new collect() branch is needed for this one.
				case "Slider":
					return '<div class="ucc-slider-wrap"><input type="range" class="ucc-slider" data-q="' + esc(name) + '" min="0" max="100" step="1" value="50">' +
						'<output class="ucc-slider-out">50</output></div>';
				// Item 3: a real drag-to-reorder list, not a text box. Stored value
				// is the resulting order as a JSON array of choice values - the
				// SAME encoding decision V7 already made for multi-select answers
				// (to_text() in submission_utils.py JSON-encodes any list), reused
				// rather than inventing a second "sequence of values" format.
				case "Ranking":
					if (!choices.length) return '<p class="text-muted">(no choices configured)</p>';
					return '<ul class="ucc-rank" data-q="' + esc(name) + '">' + choices.map(function (c) {
						var v = c.choice_value != null && c.choice_value !== "" ? c.choice_value : c.choice_label;
						return '<li draggable="true" data-value="' + esc(v) + '"><span class="ucc-rank-handle">⠿</span> ' + esc(c.choice_label) + "</li>";
					}).join("") + "</ul>";
				// Item 3: File Upload is NOT wired here. A real guest-facing upload
				// needs its own rate-limited endpoint, size/type enforcement and a
				// storage decision (Frappe's File doctype, is_private) - scoped
				// separately, not bolted onto this endpoint tonight. Say so plainly
				// rather than rendering an empty box (or a silently-broken file
				// input that drops whatever was picked). The fallback IS a real
				// data-q textarea, not just a message: a required File Upload
				// question already exists as a possibility in the schema, and a
				// placeholder with nothing to fill in would strand a respondent
				// who can never satisfy it. Text is honest about the gap while
				// still letting a required question be answered.
				case "File Upload":
					return '<p class="text-muted" style="font-size:12px">' +
						"File attachments aren't collected through this form yet. If this is required, please describe what you would attach in the space below." +
						"</p><textarea class=\"form-control\" data-q=\"" + esc(name) + "\" rows=\"2\"></textarea>";
				case "Section Heading":
					return "";
				default:
					return '<input type="text" class="form-control" data-q="' + esc(name) + '">';
			}
		}

		// NOT a <form>. Frappe's web layout can already wrap page content in one,
		// and the HTML parser silently DROPS a nested form, reparenting its children
		// to the outer one - which is how a Submit button ended up doing a native
		// GET reload while our submit listener was bound to an element that no
		// longer existed. A div with a type="button" trigger cannot navigate at all.
		// Pages are the runs between "Page Break" markers - the same marker-type
		// mechanism sectioning already uses (decision V5), so multi-page needs no
		// page field, no page doctype and no change to sequence. A survey with no
		// Page Break is simply one page, which is exactly what it renders today.
		var pages = [[]];
		survey.questions.forEach(function (q) {
			if (q.question_type === "Page Break") { pages.push([]); return; }
			pages[pages.length - 1].push(q);
		});
		pages = pages.filter(function (p) { return p.length; });
		if (!pages.length) pages = [[]];

		var html = "<h2>" + esc(survey.title) + "</h2>";
		html += '<div id="ucc-form">';
		var n = 0;  // question numbering skips markers, and never restarts per page
		pages.forEach(function (page, pi) {
			html += '<div class="ucc-page' + (pi === 0 ? " active" : "") + '" data-page="' + pi + '">';
			page.forEach(function (q) {
				if (q.question_type === "Section Heading") {
					html += '<h4 class="ucc-sec" style="margin-top:18px">' + esc(q.question_text) + "</h4>";
					return;
				}
				n += 1;
				html += '<div class="ucc-q ' + widthClass(q) + '" data-question="' + esc(q.name) + '" data-type="' + esc(q.question_type) + '" data-required="' + (q.is_required ? 1 : 0) + '">';
				html += "<label>" + n + ". " + esc(q.question_text) + (q.is_required ? ' <span class="ucc-req">*</span>' : "") + "</label>";
				if (q.help_text) html += '<div class="help">' + esc(q.help_text) + "</div>";
				html += field(q);
				html += "</div>";
			});
			html += "</div>";
		});
		html += '<div id="ucc-error" class="alert alert-warning" style="display:none;margin-top:14px"></div>';
		html += '<div id="ucc-nav">';
		if (pages.length > 1) {
			html += '<button type="button" id="ucc-back" class="btn btn-default">Back</button>';
			html += '<button type="button" id="ucc-next" class="btn btn-primary">Next</button>';
			html += '<span id="ucc-progress" class="text-muted"></span>';
		}
		// No handler, no button: a Preview has nothing to submit to, so it must
		// not offer to. (Not the guarantee - see the note on the route in
		// www/survey.py; a preview render carries no token at all.)
		if (opts.onSubmit) html += '<button type="button" id="ucc-submit" class="btn btn-primary">Submit</button>';
		html += "</div></div>";
		root.innerHTML = html;

		// Item 2: fill stars up to whichever one is checked. Delegated on root (one
		// listener) rather than per-star, since the whole form is built once from a
		// template string with no per-element wiring elsewhere.
		root.addEventListener("change", function (e) {
			if (!e.target.classList.contains("ucc-star-input")) return;
			var group = e.target.closest(".ucc-stars");
			var checkedN = +e.target.getAttribute("data-n");
			Array.prototype.slice.call(group.querySelectorAll(".ucc-star")).forEach(function (label) {
				label.classList.toggle("filled", +label.getAttribute("data-n") <= checkedN);
			});
		});

		// Item 3: Slider - live value display. "input" fires continuously while
		// dragging the thumb; "change" only fires on release, which would leave the
		// number stale until the user let go.
		root.addEventListener("input", function (e) {
			if (!e.target.classList.contains("ucc-slider")) return;
			var out = e.target.parentElement.querySelector(".ucc-slider-out");
			if (out) out.textContent = e.target.value;
		});

		// NPS: highlight the one checked button, unlike stars which fill
		// cumulatively - NPS is a single selection, not a "how many".
		root.addEventListener("change", function (e) {
			if (!e.target.classList.contains("ucc-nps-input")) return;
			var group = e.target.closest(".ucc-nps");
			Array.prototype.slice.call(group.querySelectorAll(".ucc-nps-input")).forEach(function (inp) {
				var lbl = group.querySelector('label[for="' + inp.id + '"]');
				if (lbl) lbl.classList.toggle("selected", inp.checked);
			});
		});

		// Item 3: Ranking - reorder the dragged <li> live as it crosses another
		// item, the same "move the real node during dragover" approach used
		// nowhere else in this codebase but standard for native HTML5 list
		// reordering (this page has no jQuery, unlike the Desk builder, so this is
		// plain addEventListener rather than the .on() pattern used there).
		var draggedLi = null;
		root.addEventListener("dragstart", function (e) {
			var li = e.target.closest(".ucc-rank li");
			if (!li) return;
			draggedLi = li;
			li.classList.add("dragging");
			// Some browsers refuse to start a drag with no data set.
			e.dataTransfer.setData("text/plain", "");
		});
		root.addEventListener("dragend", function (e) {
			var li = e.target.closest(".ucc-rank li");
			if (li) li.classList.remove("dragging");
			draggedLi = null;
		});
		root.addEventListener("dragover", function (e) {
			var li = e.target.closest(".ucc-rank li");
			if (!li || !draggedLi || li === draggedLi) return;
			e.preventDefault();
			var list = li.parentElement;
			var items = Array.prototype.slice.call(list.children);
			if (items.indexOf(draggedLi) < items.indexOf(li)) list.insertBefore(draggedLi, li.nextSibling);
			else list.insertBefore(draggedLi, li);
		});
		root.addEventListener("drop", function (e) {
			if (e.target.closest(".ucc-rank")) e.preventDefault();
		});

		function collect(qEl) {
			var type = qEl.getAttribute("data-type");
			if (type === "Multiple Choice") {
				return Array.prototype.slice.call(qEl.querySelectorAll("input:checked")).map(function (el) { return el.value; });
			}
			if (["Single Choice", "Rating", "Yes / No", "NPS"].indexOf(type) !== -1) {
				var checked = qEl.querySelector("input:checked");
				return checked ? checked.value : null;
			}
			// Item 3: the order IS the answer - read the <li>s in their current DOM
			// order, which drag-reordering (wired on root below) has already put
			// into place. Nothing to check/uncheck; a list with choices in it is
			// always a complete ranking, same as a range input always has a value.
			if (type === "Ranking") {
				return Array.prototype.slice.call(qEl.querySelectorAll(".ucc-rank li")).map(function (li) {
					return li.getAttribute("data-value");
				});
			}
			// Grid: one entry per row, keyed by row index - the same shape
			// submission_utils.to_text()/has_value() on the server were extended to
			// handle. Checkbox Grid rows are arrays (0+ selections); the others are
			// a single value or null. If rows/columns were never configured,
			// renderGrid() fell back to a plain textarea instead of a table, so
			// there is no .ucc-grid here and this falls through to the generic
			// [data-q] read below.
			if (["Likert Matrix", "Multiple Choice Grid", "Checkbox Grid"].indexOf(type) !== -1) {
				var table = qEl.querySelector(".ucc-grid");
				if (table) {
					var grid = {};
					Array.prototype.slice.call(table.querySelectorAll("tr[data-row]")).forEach(function (tr) {
						var rowKey = "row_" + tr.getAttribute("data-row");
						if (type === "Checkbox Grid") {
							grid[rowKey] = Array.prototype.slice.call(tr.querySelectorAll("input:checked")).map(function (el) { return el.value; });
						} else {
							var checkedCell = tr.querySelector("input:checked");
							grid[rowKey] = checkedCell ? checkedCell.value : null;
						}
					});
					return grid;
				}
			}
			var input = qEl.querySelector("[data-q]");
			return input ? input.value : null;
		}

		// ---- conditional display -------------------------------------------------
		// A mirror of display_logic.py, deliberately: this copy decides what the
		// respondent SEES, that one decides what counts. submit_survey recomputes
		// visibility from the submitted answers and never trusts this, so the worst
		// a tampered browser can do is show itself questions it then has to answer.
		// Every rule below is the same rule, made the same way, including failing
		// closed on a broken one - so the two cannot disagree in normal use.
		var MARKERS = ["Section Heading", "Page Break"];

		// Mirrors has_value(): a grid counts as answered only when EVERY row is.
		function answered(v) {
			if (v == null) return false;
			if (typeof v === "string") return v.trim() !== "";
			if (Array.isArray(v)) return v.length > 0;
			if (typeof v === "object") {
				var ks = Object.keys(v);
				return ks.length > 0 && ks.every(function (k) { return answered(v[k]); });
			}
			return true;
		}

		function asList(v) {
			if (v == null) return [];
			if (Array.isArray(v)) return v.map(String);
			if (typeof v === "object") {
				return Object.keys(v).reduce(function (acc, k) { return acc.concat(asList(v[k])); }, []);
			}
			return [String(v)];
		}

		function ruleMatches(op, ans, val) {
			// An unanswered controlling question never satisfies a rule - not even
			// "not equals", which would otherwise show every negative branch on a
			// blank form.
			if (!answered(ans)) return false;
			var picked = asList(ans);
			var want = val == null ? "" : String(val);
			if (op === "contains") return picked.indexOf(want) !== -1;
			var isEq = picked.length === 1 && picked[0] === want;
			return op === "not equals" ? !isEq : isEq;
		}

		function parseRule(config) {
			if (!config) return null;
			try { config = typeof config === "string" ? JSON.parse(config) : config; } catch (e) { return null; }
			if (!config || !config.question) return null;
			return { question: config.question, operator: config.operator || "equals", value: config.value };
		}

		function currentAnswers() {
			var out = {};
			Array.prototype.slice.call(root.querySelectorAll(".ucc-q")).forEach(function (qEl) {
				out[qEl.getAttribute("data-question")] = collect(qEl);
			});
			return out;
		}

		// Returns the set of visible question names and applies it to the DOM.
		// Questions resolve in order and a rule may only point backwards, so one
		// pass settles a whole chain - and a question whose controller is itself
		// hidden goes with it rather than being left orphaned on the page.
		function applyLogic() {
			var answers = currentAnswers();
			var visible = {};
			survey.questions.forEach(function (q) {
				var vis;
				if (MARKERS.indexOf(q.question_type) !== -1) {
					vis = true;
				} else if (!q.display_logic || q.display_logic === "Always Show") {
					vis = true;
				} else {
					var rule = parseRule(q.display_logic_config);
					vis = !!(rule && visible[rule.question] &&
						ruleMatches(rule.operator, answers[rule.question], rule.value));
				}
				visible[q.name] = vis;
				var el = root.querySelector('.ucc-q[data-question="' + q.name + '"]');
				if (el) el.hidden = !vis;
			});
			return visible;
		}

		// Recompute on any interaction. One delegated listener on root covers every
		// input type on the form, including the ones wired above.
		root.addEventListener("change", applyLogic);
		root.addEventListener("input", applyLogic);
		applyLogic();

		// ---- paging --------------------------------------------------------------
		var pageEls = Array.prototype.slice.call(root.querySelectorAll(".ucc-page"));
		var current = 0;
		var backBtn = document.getElementById("ucc-back");
		var nextBtn = document.getElementById("ucc-next");
		var progressEl = document.getElementById("ucc-progress");
		var btn = document.getElementById("ucc-submit");
		var errEl = document.getElementById("ucc-error");
		function showError(msg) {
			errEl.textContent = msg;
			errEl.style.display = "block";
			if (btn) { btn.disabled = false; btn.textContent = "Submit"; }
		}

		// A required question that is currently hidden is not missing - that is the
		// whole point of the logic-aware check, and the server applies the same rule.
		function firstMissing(scope) {
			return Array.prototype.slice.call(scope.querySelectorAll(".ucc-q")).filter(function (qEl) {
				return !qEl.hidden && qEl.getAttribute("data-required") === "1" && !answered(collect(qEl));
			})[0];
		}

		function showPage(i) {
			current = i;
			pageEls.forEach(function (el, n) { el.classList.toggle("active", n === i); });
			if (backBtn) backBtn.style.display = i > 0 ? "" : "none";
			if (nextBtn) nextBtn.style.display = i < pageEls.length - 1 ? "" : "none";
			if (btn) btn.style.display = i === pageEls.length - 1 ? "" : "none";
			if (progressEl) progressEl.textContent = "Page " + (i + 1) + " of " + pageEls.length;
			errEl.style.display = "none";
			window.scrollTo(0, 0);
		}
		if (pageEls.length > 1) {
			backBtn.addEventListener("click", function () { showPage(current - 1); });
			nextBtn.addEventListener("click", function () {
				// Validate the page being left: at submit time the respondent can no
				// longer see the page an unanswered required question is on.
				if (firstMissing(pageEls[current])) {
					return showError("Please answer all required questions on this page.");
				}
				showPage(current + 1);
			});
		}
		showPage(0);

		// Everything a caller needs to submit, without knowing how the form is
		// built: which answers, and whether a required one is still missing.
		function collectAll() {
			var visible = applyLogic();
			var answers = [];
			var missing = false;
			Array.prototype.slice.call(root.querySelectorAll(".ucc-q")).forEach(function (qEl) {
				var name = qEl.getAttribute("data-question");
				// A hidden question's answer is not an answer: not sent, not
				// required. The server drops it too, so no metric can aggregate a
				// value from a branch the respondent never saw.
				if (!visible[name]) return;
				var val = collect(qEl);
				if (qEl.getAttribute("data-required") === "1" && !answered(val)) missing = true;
				answers.push({ question: name, value: val });
			});
			return { answers: answers, missing: missing };
		}

		var api = {
			root: root,
			collect: collectAll,
			showError: showError,
			setBusy: function (text) {
				if (!btn) return;
				btn.disabled = !!text;
				btn.textContent = text || "Submit";
			},
		};

		if (opts.onSubmit && btn) {
			btn.addEventListener("click", function () {
				errEl.style.display = "none";
				var out = collectAll();
				if (out.missing) return showError("Please answer all required questions.");
				opts.onSubmit(out.answers, api);
			});
		}
		return api;
	},
};
