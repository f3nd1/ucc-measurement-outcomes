#!/usr/bin/env node
// Permanent regression check for the Bug 1 QA finding (2026-08-01): the
// Measurement Outcomes workbench overflowed the viewport because its shell
// was sized from a getBoundingClientRect() measurement taken while Frappe's
// own page wrapper was still display:none (frappe.container.add_page() calls
// .hide() before on_page_load runs - verified against pageview.js/
// container.js, v15.83.0). display:none ancestors make every rect zero, so
// the offset committed as 12px against a real chrome height of ~150-160px.
//
// There is no bench here to click through by hand every time, and this repo
// has no JS test harness otherwise (see CLAUDE.md) - pure logic ships as
// bench-free Python. This one check is deliberately the exception: the bug
// was a DOM/layout timing bug, which pure logic cannot see. It is NOT part
// of the standard `test_*.py` suite and is not run by check_repo.sh; run it
// by hand after touching mo_ui.js's mount()/refit() or the .ucc-mo height
// rule in ucc_mo.bundle.css.
//
// Requires Playwright. Not a repo dependency (this app ships with none) -
// install it yourself, or point NODE_PATH at a Playwright already on the
// box, e.g.:
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/qa_page_overflow.js
//
// It mocks only the one piece of real Frappe behaviour the bug depended on
// (page wrapper starts display:none, is shown later) at a plausible chrome
// height (~158px, the figure Felix measured live on ucc-sms-v2.orb.local).
// It is not a substitute for the real bench - it catches this one class of
// regression cheaply, nothing more.

const path = require("path");
const { chromium } = require("playwright");

const REPO_ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(REPO_ROOT, "frappe-app/ucc_measurement_outcomes/ucc_measurement_outcomes/public");
const MO_UI_JS = path.join(PUBLIC, "js/mo_ui.js");
const MO_ICONS_JS = path.join(PUBLIC, "js/mo_icons.js");
const MO_CSS = path.join(PUBLIC, "css/ucc_mo.bundle.css");

// Real jQuery is a hooks.py app_include_js dependency in Frappe Desk, but
// pulling in a real build here means either a network fetch (this sandbox's
// proxy 403s code.jquery.com - and a real bench has no guarantee of outbound
// access either) or vendoring a copy into the repo for one dev-only script.
// mount()/refit() touch exactly six jQuery methods, so a same-sized inline
// shim removes the dependency instead of working around it.
async function installJqueryShim(page) {
	await page.addScriptTag({
		content: `
			window.$ = function (arg) {
				let el;
				if (arg === window) {
					el = window;
				} else if (typeof arg === "string") {
					// mount() calls $(\`<div class="ucc-mo">\${html}</div>\`) - a jQuery
					// HTML-string constructor, not a selector lookup (nothing here is
					// queried by CSS selector).
					const tmp = document.createElement("div");
					tmp.innerHTML = arg.trim();
					el = tmp.firstElementChild;
				} else {
					el = arg; // already a DOM node
				}
				const handlers = {};
				return {
					length: 1,
					get: (i) => (i === 0 ? el : undefined),
					empty: function () { if (el.innerHTML !== undefined) el.innerHTML = ""; return this; },
					addClass: function (c) { el.classList && el.classList.add(c); return this; },
					appendTo: function (target) { (target.get ? target.get(0) : target).appendChild(el); return this; },
					off: function (evt) {
						const base = evt.split(".")[0];
						if (handlers[base]) { window.removeEventListener(base, handlers[base]); delete handlers[base]; }
						return this;
					},
					on: function (evt, fn) {
						const base = evt.split(".")[0];
						handlers[base] = fn;
						window.addEventListener(base, fn);
						return this;
					},
				};
			};
		`,
	});
}

async function main() {
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

	await page.setContent("<!doctype html><html><head></head><body></body></html>");
	await installJqueryShim(page);
	await page.addScriptTag({ path: MO_ICONS_JS });
	await page.addScriptTag({ path: MO_UI_JS });
	await page.addStyleTag({ path: MO_CSS });

	const result = await page.evaluate(() => {
		// Minimal stubs for the two Frappe globals mount()/refit() touch.
		window.frappe = { utils: { escape_html: (s) => String(s) } };
		window.__ = (s) => s;

		// --- mock Frappe chrome: fixed navbar + page head, ~158px total, the
		// figure measured live against the real bench for Bug 1. -------------
		const chrome = document.createElement("div");
		chrome.innerHTML =
			'<div style="position:fixed;top:0;left:0;right:0;height:56px;background:#fff;"></div>' +
			'<div style="height:56px;"></div>' + // spacer under the fixed navbar
			'<div style="height:102px;"></div>'; // page head / breadcrumb block
		document.body.appendChild(chrome);

		// --- mock frappe.container.add_page(): wrapper created .hide()'d
		// BEFORE the page script runs, exactly like the real container. -------
		const wrapper = document.createElement("div");
		wrapper.style.display = "none";
		const main = document.createElement("div");
		wrapper.appendChild(main);
		document.body.appendChild(wrapper);

		// --- on_page_load-equivalent: mount() while still hidden. -------------
		const $root = window.UCCMO.mount({ main }, "<div class=\"app\"><div style=\"height:2000px\"></div></div>");
		const offsetAfterMountWhileHidden = $root.get(0).style.getPropertyValue("--ucc-mo-offset");

		// --- on_page_show-equivalent: container shows the wrapper, THEN
		// fires the show hook that calls refit(). --------------------------
		wrapper.style.display = "";
		window.UCCMO.refit($root);
		const offsetAfterShow = $root.get(0).style.getPropertyValue("--ucc-mo-offset");

		const docOverflow = document.documentElement.scrollHeight - window.innerHeight;

		// --- prove the check is meaningful: replay the OLD buggy behaviour
		// (commit a measurement taken while hidden) and confirm it WOULD have
		// overflowed, so a future refit()/mount() rewrite that reintroduces
		// early measurement fails this script instead of silently shipping. -
		wrapper.style.display = "none";
		const bogusWrapper = document.createElement("div");
		bogusWrapper.style.display = "none";
		const bogusMain = document.createElement("div");
		bogusWrapper.appendChild(bogusMain);
		document.body.appendChild(bogusWrapper);
		const $bogusRoot = window.UCCMO.mount({ main: bogusMain }, "<div class=\"app\"></div>");
		// Simulate the pre-fix code path directly: it measured top<=0 and
		// still committed `top + 12` = "12px" regardless of the guard added
		// in the fix. refit() itself now refuses this - so this reproduces
		// the OLD unguarded write, not a call refit() would ever make today.
		$bogusRoot.get(0).style.setProperty("--ucc-mo-offset", "12px");
		bogusWrapper.style.display = "";
		const bogusOverflow = document.documentElement.scrollHeight - window.innerHeight;
		bogusWrapper.remove();

		return { offsetAfterMountWhileHidden, offsetAfterShow, docOverflow, bogusOverflow };
	});

	await browser.close();

	const failures = [];
	if (result.offsetAfterMountWhileHidden !== "") {
		failures.push(
			`mount() committed --ucc-mo-offset="${result.offsetAfterMountWhileHidden}" while the page ` +
			`wrapper was still display:none. refit()'s top<=0 guard should have refused this.`
		);
	}
	if (!result.offsetAfterShow || !/^\d+px$/.test(result.offsetAfterShow) || parseInt(result.offsetAfterShow, 10) < 100) {
		failures.push(
			`After showing the wrapper and calling refit(), --ucc-mo-offset was ` +
			`"${result.offsetAfterShow}" - expected a realistic chrome measurement (>=100px).`
		);
	}
	if (result.docOverflow > 1) {
		failures.push(
			`Document overflows the viewport by ${result.docOverflow}px after mount+show+refit. ` +
			`This is the exact symptom of Bug 1 (2026-08-01 QA).`
		);
	}
	if (result.bogusOverflow <= 1) {
		failures.push(
			`Sanity check failed: replaying the OLD buggy 12px-while-hidden offset did not ` +
			`reproduce an overflow (${result.bogusOverflow}px). This check may no longer be testing ` +
			`anything real - re-verify against the mocked chrome height.`
		);
	}

	if (failures.length) {
		console.error("qa_page_overflow: FAIL\n" + failures.map((f) => "  - " + f).join("\n"));
		process.exit(1);
	}
	console.log(
		`qa_page_overflow: PASS ` +
		`(offset while hidden: none committed; offset after show: ${result.offsetAfterShow}; ` +
		`doc overflow: ${result.docOverflow}px; bogus-offset overflow reproduced: ${result.bogusOverflow}px)`
	);
}

main().catch((e) => {
	console.error("qa_page_overflow: ERROR", e);
	process.exit(1);
});
