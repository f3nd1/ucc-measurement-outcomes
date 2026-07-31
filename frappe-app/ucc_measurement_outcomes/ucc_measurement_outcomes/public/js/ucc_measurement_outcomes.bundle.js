// Copyright (c) 2026, United Ceres College and contributors
//
// Entry point for this app's shared front-end components.
//
// WHY THIS FILE EXISTS: assets under /assets/<app>/ are served with
// Cache-Control: max-age=31536000 (one year). That is correct Frappe
// behaviour — core assets are safe to cache that hard because esbuild gives
// them content-hashed filenames, so any change produces a NEW url.
//
// Referencing plain files (…/js/node_canvas.js) in app_include_js opts out of
// that hashing: the url never changes, so every browser that has loaded the
// file keeps its copy for a year regardless of bench build / clear-cache /
// restart. That produced a real bug — a cached node_canvas.js without
// setEmpty() made canvas.setEmpty() a TypeError, killing Mapping and Index
// Studio mid-construction while pages with newly-added filenames worked.
//
// esbuild only bundles files matching *.bundle.js, so this file is what makes
// the app's shared JS hashed and therefore cache-safe. Add new shared
// components here rather than adding another absolute path to app_include_js.

import "./node_canvas.js";
import "./filter_bar.js";
import "./empty_state.js";
import "./trail.js";
import "./version_picker.js";
// The respondent form renderer, so the Survey Builder's Preview renders the
// real page rather than a parallel approximation of it. Same file the website
// loads via ucc_survey_form.bundle.js; never on the same page as that one.
import "./survey_form.js";
// Measurement Outcomes redesign: the icon sprite and the component library the
// five workspaces render with. Bundled for the same cache-safety reason as
// everything above - mo_ui.js will change often, and a year-cached copy of a
// component library is the worst version of this bug.
import "./mo_icons.js";
import "./mo_ui.js";
