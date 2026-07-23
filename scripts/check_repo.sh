#!/usr/bin/env bash
set -euo pipefail

required=(
  "README.md"
  "CLAUDE.md"
  "prototype/ucc_measurement_outcomes_studio.html"
  "docs/01-product-scope.md"
  "docs/03-data-model.md"
  "docs/05-implementation-plan.md"
  "reference-documents/01-criterion-7-1-1-measurement-outcomes-workflow.pdf"
  "reference-documents/02-survey-objective-question-mapping-v02.pdf"
)

for file in "${required[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

echo "Repository starter files are present."
