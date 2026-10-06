# Project overrides (optional)

Files placed here extend the universal template for this project only. All three are optional.

| File | Effect |
|---|---|
| `extra_calc.py` | Must define `extend(metrics, model, project, today) -> metrics`, where `model` is the output of `calculation.normalise` (`tasks`, `commitments`, `constraints`). Runs after `Template/calculation.py`. Add project-only metrics; do not recompute universal ones. |
| `data.json` | Deep-merged over `Template/dashboard_data.json` after `project.json` `display`. |
| `sections.html` | HTML injected at `{{PROJECT_SECTIONS}}` near the bottom of the page. Use `D.metrics` from an inline script if it needs data. |

Paths can be changed in `manifest.json` under `overrides`.
