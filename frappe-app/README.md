# Frappe App Placeholder

The actual installable Frappe application should be generated here only after environment discovery confirms:

- Frappe and ERPNext versions
- Bench location
- Development site
- App naming
- Existing UCC DocTypes to reuse

Do not paste a guessed app scaffold into production.

Expected future structure may resemble:

```text
ucc_measurement_outcomes/
  hooks.py
  modules.txt
  patches.txt
  public/
  templates/
  www/
  ucc_measurement_outcomes/
    survey_studio/
    mapping_studio/
    index_studio/
    dashboard_studio/
    data_explorer/
    api/
    tests/
```
