"""Pure bulk-paste parser (ported from the prototype's parseBulk).

Parses lines of `question | type | options` into question dicts. Frappe-free and
unit-tested (test_bulk_parse.py); the builder API turns the result into records.
"""

CANONICAL_TYPES = [
	"Short Text", "Paragraph", "Email", "Number", "Date", "Rating",
	"Single Choice", "Multiple Choice", "Dropdown", "Yes / No", "Likert Matrix",
	"NPS", "Ranking", "Slider", "File Upload", "Section Heading",
]

_ALIASES = {
	"text": "Short Text", "short text": "Short Text",
	"para": "Paragraph", "long text": "Paragraph",
	"yesno": "Yes / No", "yes/no": "Yes / No", "yes / no": "Yes / No", "boolean": "Yes / No",
	"single": "Single Choice", "single choice": "Single Choice", "radio": "Single Choice",
	"multiple": "Multiple Choice", "multi": "Multiple Choice", "checkbox": "Multiple Choice",
	"select": "Dropdown", "likert": "Likert Matrix", "section": "Section Heading",
}


def resolve_type(text):
	key = " ".join((text or "").lower().split())
	exact = {t.lower(): t for t in CANONICAL_TYPES}
	return exact.get(key) or _ALIASES.get(key) or "Short Text"


def parse_bulk_questions(text):
	"""[{question_text, question_type, options}] from `q | type | options` lines."""
	out = []
	for line in (text or "").splitlines():
		line = line.strip()
		if not line:
			continue
		parts = [p.strip() for p in line.split("|")]
		title = parts[0]
		if not title:
			continue
		type_text = parts[1] if len(parts) > 1 else ""
		options = parts[2] if len(parts) > 2 else ""
		out.append({
			"question_text": title,
			"question_type": resolve_type(type_text),
			"options": options,
		})
	return out
