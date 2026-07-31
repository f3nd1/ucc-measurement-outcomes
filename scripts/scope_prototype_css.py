"""Scope the prototype's CSS under .ucc-mo, mechanically.

Transcribing 28KB of CSS by hand is how a design system drifts from its own
reference on day one, so this reads the artifact and rewrites selectors. It also
means re-running it against a new prototype is one command, not a day.

Rules:
  :root / html / body / *   -> .ucc-mo (the mount point IS the document root here)
  .foo, .foo .bar           -> .ucc-mo .foo, .ucc-mo .foo .bar
  @media / @keyframes       -> prelude kept, body recursed (keyframes NOT scoped)
"""
import re, sys

ROOTISH = {":root", "html", "body"}


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
            decls = " ".join(body.split())
            out.append("%s%s { %s }" % (indent, scope_selector(head), decls))
    return "\n".join(out)


src = open(sys.argv[1]).read()
css = src[src.index("<style>") + 7:src.index("</style>")]
css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
print(emit(split_top(css)))
