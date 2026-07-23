# Acceptance Criteria

## Survey Studio

- Staff can create, edit, preview, save and publish a survey.
- Dragging and reordering questions changes the saved order.
- Required questions are enforced publicly.
- Published versions are not silently modified.
- A public response creates one submission and one answer row per answered question.
- Campaign response counts match the stored submissions.

## Mapping Studio

- A question can be mapped to an objective and one or more clauses.
- A question can be mapped to a stable metric code.
- Mapping coverage identifies unmapped questions and unsupported objectives.
- Five-point and Yes/No answers can be normalised consistently.

## Index Studio

- Metrics can be dragged into a node canvas.
- Connections and weights are editable.
- Invalid weight totals are blocked from publication.
- The official score is calculated on the server.
- Users can explain a score down to its source data.

## Dashboard Studio

- Current score, target, variance, response count and coverage are visible.
- Programme and period filters update every relevant widget.
- Trend and contribution charts agree with the saved index results.
- A weak result can link to a Quality Action.

## Data Explorer

- Users can select approved datasets, measures and dimensions.
- Users cannot submit arbitrary database queries.
- Displayed totals agree with exported records.
- CSV and JSON exports respect permissions and filters.
