// Copyright (c) 2026, United Ceres College and contributors
//
// The Measurement Outcomes icon set: 35 SVG symbols lifted VERBATIM from the
// design prototype (ucc_measurement_outcomes_compact_v3.html), not redrawn.
// Redrawing is how an icon set stops matching its own reference.
//
// One <svg> sprite injected once into <body>; every icon is then <use href="#i-x">.
// Ids keep the prototype's i- prefix so a selector written against the artifact
// still finds them here.
//
// Field-type icons are the load-bearing ones: the brief requires a consistent
// icon per supported question type, and UCCMOIcons.forQuestionType maps this
// app's real QUESTION_TYPES onto them.

window.UCCMOIcons = {
	SPRITE_ID: "ucc-mo-sprite",

	// UCC Survey Question.question_type -> symbol id. Every type the Survey
	// Builder offers must resolve, or a row renders with no icon at all - so
	// `icon()` falls back to i-text rather than emitting a broken <use>.
	BY_TYPE: {
		"Short Text": "i-text",
		"Long Text": "i-paragraph",
		"Paragraph": "i-paragraph",
		"Email": "i-email",
		"Number": "i-text",
		"Date": "i-calendar",
		"Rating": "i-star",
		"Single Choice": "i-single",
		"Multiple Choice": "i-multiple",
		"Dropdown": "i-dropdown",
		"Yes / No": "i-single",
		"NPS": "i-nps",
		"Slider": "i-nps",
		"Likert Matrix": "i-matrix",
		"Multiple Choice Grid": "i-grid",
		"Checkbox Grid": "i-grid",
		"File Upload": "i-upload",
		"Section Heading": "i-page",
	},

	forQuestionType(type) {
		return this.BY_TYPE[type] || "i-text";
	},

	// `cls` takes the prototype's own icon sizes: "" (16px), "sm" (14), "xs" (12).
	icon(id, cls) {
		return `<svg class="icon ${cls || ""}"><use href="#${id}"></use></svg>`;
	},

	inject() {
		if (document.getElementById(this.SPRITE_ID)) return;
		const el = document.createElement("div");
		el.id = this.SPRITE_ID;
		el.setAttribute("aria-hidden", "true");
		el.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
		el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
	<symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></symbol>
	<symbol id="i-survey" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M9 8h6M9 12h6M9 16h4"></path></symbol>
	<symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1"></circle></symbol>
	<symbol id="i-metric" viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"></path></symbol>
	<symbol id="i-index" viewBox="0 0 24 24"><path d="M5 18h14M7 15V9M12 15V5M17 15v-3"></path></symbol>
	<symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-6"></path></symbol>
	<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"></path></symbol>
	<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></symbol>
	<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></symbol>
	<symbol id="i-history" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6M12 7v5l3 2"></path></symbol>
	<symbol id="i-chevron-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"></path></symbol>
	<symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"></path></symbol>
	<symbol id="i-email" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></symbol>
	<symbol id="i-text" viewBox="0 0 24 24"><path d="M5 6h14M12 6v12M8 18h8"></path></symbol>
	<symbol id="i-paragraph" viewBox="0 0 24 24"><path d="M13 5H9a4 4 0 0 0 0 8h4M13 5v14M17 5v14"></path></symbol>
	<symbol id="i-star" viewBox="0 0 24 24"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"></path></symbol>
	<symbol id="i-single" viewBox="0 0 24 24"><circle cx="7" cy="7" r="2"></circle><circle cx="7" cy="17" r="2"></circle><path d="M12 7h7M12 17h7"></path></symbol>
	<symbol id="i-multiple" viewBox="0 0 24 24"><rect x="4" y="4" width="5" height="5" rx="1"></rect><rect x="4" y="15" width="5" height="5" rx="1"></rect><path d="M13 7h7M13 18h7M5.5 6.5l1 1 2-2"></path></symbol>
	<symbol id="i-dropdown" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m9 10 3 3 3-3"></path></symbol>
	<symbol id="i-nps" viewBox="0 0 24 24"><path d="M4 18V6M4 18h16M8 14l3-4 3 2 4-6"></path></symbol>
	<symbol id="i-matrix" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18M3 15h18M9 3v18M15 3v18"></path></symbol>
	<symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"></path></symbol>
	<symbol id="i-page" viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 9h8M8 13h8"></path></symbol>
	<symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></symbol>
	<symbol id="i-copy" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path></symbol>
	<symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></symbol>
	<symbol id="i-save" viewBox="0 0 24 24"><path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6"></path></symbol>
	<symbol id="i-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"></path></symbol>
	<symbol id="i-unlink" viewBox="0 0 24 24"><path d="m3 3 18 18M10 13a5 5 0 0 0 5.5 1M13 8l.5-.5a5 5 0 0 1 7 7l-1 1M11 16l-.5.5a5 5 0 0 1-7-7l1-1"></path></symbol>
	<symbol id="i-filter" viewBox="0 0 24 24"><path d="M4 5h16l-6 7v5l-4 2v-7z"></path></symbol>
	<symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"></path></symbol>
	<symbol id="i-warning" viewBox="0 0 24 24"><path d="M12 4 2.5 20h19L12 4Z"></path><path d="M12 9v5M12 17h.01"></path></symbol>
	<symbol id="i-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"></path></symbol>
	<symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></symbol>
	<symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path></symbol>
</svg>`;
		document.body.appendChild(el);
	},
};
