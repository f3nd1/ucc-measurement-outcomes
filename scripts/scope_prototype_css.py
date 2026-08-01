"""Scope the prototype's CSS under .ucc-mo, mechanically.

Transcribing 28KB of CSS by hand is how a design system drifts from its own
reference on day one, so this reads the artifact and rewrites selectors. It also
means re-running it against a new prototype is one command, not a day.

Rules:
  :root / html / body / *   -> .ucc-mo (the mount point IS the document root here)
  .foo, .foo .bar           -> .ucc-mo .foo, .ucc-mo .foo .bar
  @media / @keyframes       -> prelude kept, body recursed (keyframes NOT scoped)
  font-weight: 650          -> font-weight: 600 (snap to standard steps)
"""
import re, sys

ROOTISH = {":root", "html", "body"}

# The prototype uses off-step font weights (650 on .btn/.tab/.workspace-btn/
# .add-page, 760 on .big-score) - flagged in the 2026-08-01 round-3 design
# audit as non-standard. Normalising here rather than by hand-editing the
# generated CSS is the point: this is the boundary the values enter through,
# so a re-run against a new prototype produces standard steps too instead of
# silently reintroducing them. Nearest standard step, except 650, which is an
# exact tie (600 vs 700) and resolves DOWN so button/tab labels stay lighter
# than the 700 used for chips, field labels and section headers - snapping up
# would flatten that hierarchy.
WEIGHT_SNAP = {"420": "400", "650": "600", "760": "800"}


def normalise_weights(decls):
    return re.sub(
        r"(font-weight:\s*)(\d+)",
        lambda m: m.group(1) + WEIGHT_SNAP.get(m.group(2), m.group(2)),
        decls,
    )


def split_top(block):
    """(selector_or_atrule, body, is_at) chunks at one nesting level."""
    out, i, depth, start = [], 0, 0, 0
    while i < len(block):
        c = block[i]
        if c == "{":
            if depth == 0:
                head = block[start:i]
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                out.append((head.strip(), block[block.index("{", start) + 1:i]))
                start = i + 1
        i += 1
    return out


def scope_selector(sel):
    parts = []
    for one in sel.split(","):
        one = one.strip()
        if not one:
            continue
        if one in ROOTISH:
            parts.append(".ucc-mo")
        elif one.startswith("*"):
            parts.append(".ucc-mo " + one)
        elif one.startswith("@"):
            parts.append(one)
        else:
            parts.append(".ucc-mo " + one)
    # html, body -> two identical ".ucc-mo" selectors; keep one.
    seen, uniq = set(), []
    for p in parts:
        if p not in seen:
            seen.add(p); uniq.append(p)
    return ", ".join(uniq)


def emit(chunks, indent=""):
    out = []
    for head, body in chunks:
        if head.startswith("@keyframes") or head.startswith("@-"):
            out.append("%s%s {%s}" % (indent, head, body))          # never scope
        elif head.startswith("@"):
            inner = emit(split_top(body), indent + "\t")
            out.append("%s%s {\n%s\n%s}" % (indent, head, inner, indent))
        else:
            decls = normalise_weights(" ".join(body.split()))
            out.append("%s%s { %s }" % (indent, scope_selector(head), decls))
    return "\n".join(out)


src = open(sys.argv[1]).read()
css = src[src.index("<style>") + 7:src.index("</style>")]
css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
print(emit(split_top(css)))
