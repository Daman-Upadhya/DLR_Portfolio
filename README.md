# DLR Portfolio

Static project dashboards built from VisiLean data. Each project has its own GitHub Actions
workflow that refreshes it twice a day and publishes it to the `gh-pages` branch, which GitHub
Pages serves:

```
https://<owner>.github.io/DLR_Portfolio/        landing page, one card per project
https://<owner>.github.io/DLR_Portfolio/<CODE>/ one page per project code
```

The repo follows the structure in [lead-repo-er-diagram.md](lead-repo-er-diagram.md).

For what the report does now, the decisions behind its numbers and the open issues, see
[CHANGES.md](CHANGES.md).

| Diagram entity | Here |
|---|---|
| Template Folder | `Template/` — `calculation.py`, `Dashboard.html`, `Landing.html`, `dashboard_data.json`, `tokens.css`, `scripts/` (`charts.js`, `aggregate.js`, `app.js`), `assets/` (the VisiLean and Digital Realty header logos, PNG, embedded into each page as data URIs) |
| Calculational Logic | `Template/calculation.py`, hashed into every page footer and every manifest |
| P1 Folder, P2 Folder | One folder per project code (`PAR14/`, `MRS05/`) — `project.json`, optional `manifest.json` and `overrides/` |
| Dependency Manifest | `P<key>/manifest.json` — which logic, template and data the page was built against, with hashes |
| Build Process | `build/` — `python -m build` |
| Generated Page Artifact | `dist/<key>/index.html` (+ `build.json`), `dist/index.html` — gitignored on `main`, published to the `gh-pages` branch |

Pure Python 3.12+ standard library. No pip install, no CDN, no chart library. Every page is
one self-contained HTML file with the data embedded, so it works offline and from `file://`.

## Local build

Copy `tokens.json.example` to `tokens.json` (gitignored) and put each project's token in,
keyed by project code. The token is the `accessToken` value only; no URL, no `&projectId`.

```
python -m build selftest                                   # calculation.py against a hand-checked synthetic case
python -m build build --all --source live
python -m build validate
python -m build serve                                      # http://localhost:8000/ and /<CODE>/
```

`--source`:
- `live` — calls VisiLean with the project's token
- `sample` — reads exports saved as `sample/<CODE>.tasks.json.gz`, `<CODE>.committed.json` and
  `<CODE>.constraints.json`, for working offline. The repository ships none; a project without
  them is built as "unavailable".
- `auto` (default) — live when a token is configured, otherwise sample
- `--today YYYY-MM-DD` pins the run date. It applies to live builds only; see "Reporting date".

`--write-manifest` records the current dependency hashes into `P<key>/manifest.json`. Do this
when a project's report is approved; later builds then report "drift" whenever the universal
logic, template or data changed since that approval.

## How a build works

```
P<key>/project.json + manifest.json
   + build/project_defaults.json (everything the project does not set)
   -> build/fetch.py        token: VL_TOKEN_<CODE> -> VL_TOKENS_JSON[code] -> tokens.json
                            3 calls: <baseUrl>?accessToken=...&projectId=...&type=task&Include...=true
                                                                    ...&type=committedTask
                                                                    ...&type=constraintLog
                            live fetch (3 attempts) -> .cache/<key>.json ; outage -> cache ; no cache -> "unavailable"
   -> Template/calculation.py   normalise(feeds, data) -> compute(model, project, data, today)
   -> P<key>/overrides/extra_calc.py  (optional) extend(metrics, ...)
   -> build/inject.py       Template/Dashboard.html + tokens.css + scripts -> {{slots}} -> JSON data last
   -> dist/<key>/index.html + dist/<key>/build.json
all build.json -> Template/Landing.html -> dist/index.html
```

Page states: `fresh` (live data), `stale` (VisiLean unreachable, last good copy with a banner),
`unavailable` (no data yet, empty-state page). A refresh publishes only its own folder on
`gh-pages`, so one project's failure never removes another's page.

Exit codes of `build`: 0 ok, 2 a token was rejected (pages still written, run goes red in
the `report` job), 1 build error.

## What the page shows

The logic is a port of the **Digital Reality - KPIs (Committed)** Power BI model (the
`*.SemanticModel` folder). `Template/calculation.py` maps each Power Query step and DAX measure
to a function; its docstring has the table.

- **Two pages**, as tabs under the filter bar: **Performance** (everything below except
  constraints) and **Constraints** (all constraint KPIs, status, category, target-week trend and
  the overdue list). The Constraints tab shows how many constraints are overdue in the current
  filter context. The slicers apply to both pages, and the open page is kept in the URL hash
  (`#page=constraints`) with the filters.
- **Export PPC review**: a button in the control bar opens a standalone report for the
  selected range and filters, ready to send: committed / kept / missed totals, PPC for the
  range, the 6-week rolling PPC and last week's PPC; an overall chart of kept and missed per
  week with the rolling and weekly PPC; a heat table of the rolling PPC per trade and week; and
  every commitment grouped by trade and week. The report prints or saves as PDF (A4
  landscape) and downloads as HTML or as a CSV activity list. The rolling PPC (`Agg.review`)
  looks back before the range start; overall it counts a week with no commitments as 0, as
  "PPC Avg (6wk Running)" does, per trade only the trade's weeks with commitments count.
  `ppc.rollingWeeks` in `dashboard_data.json` sets the window.
- **Detail lists**: every mark opens the activities or constraints behind it in a side
  panel: columns, points, bar segments, bar labels, donut slices and legend rows, tiles and
  chips. Each card also has a "View list" button for everything it shows. The panel lists the
  key fields (activity, trade, organisation, committed week and result, planned and actual
  dates, status, reasons; for constraints the category, owner, status, target, completion,
  overdue or lag days and the linked activities), searches them, and downloads them as CSV.
  The rows come from `Agg.records`, which uses the same filtered sets as the measure that was
  clicked, so a list always matches its number.
- **Slicers**: a date range picker (presets on the left: this week, last week, last 4 / 6 /
  12 weeks, this month, last month, all data; two months side by side; selections snap to
  whole ISO weeks; days outside the data are struck through) and
  organisation / trade / location pickers, as in the Power BI report. The range applies to
  tasks by planned end, to commitments by committed end and to constraints by target date
  (the Calendar relationships); the attribute pickers apply to tasks, to commitments through
  their activity, and to constraints through their linked activity (or their own fields when
  unlinked). The "!!" measures (the tiles, the running PPC, the organisation breakdown)
  intersect the range with the last six weeks, exactly as their `CALCULATE(...,
  IsLastSixWeeks)` does; everything else follows the range. The filter state is kept in the
  URL hash, so a filtered view can be shared. `calculation.py` derives every per-row flag and
  embeds the rows (`metrics.facts`); `Template/scripts/aggregate.js` re-aggregates them under
  the chosen filter context and never re-derives a flag.
- **Weekly committed PPC**: activities kept and missed per committed week (`Successful
  Task(C)` / `UnSuccessful Task(C)`) as clustered columns on the left count axis, with the
  committed PPC as a line on the right 0-100% axis (the Power BI line-and-clustered-column
  visual); the 85% target and the six-week window are marked. Planned PPC is no longer shown anywhere on the page.
- **Last-six-week tiles**, coloured by the `Tolerance_Limits` table: PPC committed, 6-week
  running, % activities delayed, avg. delay duration, avg. planned duration, weekly planned
  activities.
- **Trade performance, last committed week**: committed PPC per trade, or per organisation with
  the toggle (trade is the default), for the latest complete committed week. Three headline numbers (the week's PPC and its change, how many trades sit
  below the good band, and the share of the week's missed commitments they account for), a bar
  splitting the trades into good / watch / critical, and the eight below-target trades with the
  most missed commitments as kept/missed bars. The other trades follow as chips.
- **Reasons for variance by trade**: the activities that missed a commitment in the range,
  stacked per trade by the reason category from their activity history. Activities with no
  recorded reason are left out; the card says how many. Horizontal stacked bars rather than stacked columns, so long trade names
  stay readable; the top eight trades are bars, the rest chips.
- Reasons for variance (a donut with a toggle between the reason
  categories and the variance events: late start, late complete, stopped, warning, rescheduled),
  and on the Constraints page the constraint KPIs (open, overdue, on time, lag, unlinked,
  resolved before planned start, by category, by target week, overdue list). The tolerance
  thresholds in `dashboard_data.json` still colour the tiles; the page no longer lists them.
- The **total score** (`!!@Total Score`) is still computed by `calculation.py` for the landing
  page cards and `build.json`, but the project page no longer shows the score card.

The task feed has one row per history event; tasks are de-duplicated by guid (the model's
`DISTINCTCOUNT(guid)`). Only `Construction` and `Design` tasks count.

**Feeds.** Committed PPC needs the commitment feed (`type=committedTask`, the model's
`All_Committed_Task`) and the constraint KPIs need the constraint feed (`type=constraintLog`,
`AllConstraintsLog`). Both are on for every project in `build/project_defaults.json`. A
project that sets a feed's type to null shows "no data" for those tiles, the 6-week running
PPC falls back to planned PPC, and the score leaves out constraints overdue.

The commitment feed is nested (`{"data": [{"isAutoCommit", "commitDetails": [{"committedTimestamp",
"committedStartDate", "committedEndDate", "activitiesGuid": [...]}]}]}`); `calculation.py` expands
it to one row per (commit, activity) like the Power Query does, and drops commits without a
timestamp. The constraint feed is a flat list (`constrainId`, `targetDate`, `commitmentDate`,
`completionDate`, `activityGuid` as a comma-separated list, ...).

Everything configurable (task types, reason lists and categories, constraint category
clean-up, score bands and weights, tolerance limits, PPC target, trend length, status order,
grouping, delay buckets) lives in `Template/dashboard_data.json`. A project overrides any of
it in `project.json` → `display`, or in `overrides/data.json`.

## Reporting date

The date every measure is computed for ("today": last complete week, L6W window, overdue) is
worked out on every refresh, never typed in:

| Data | Today is |
|---|---|
| Live | the run date (IST) |
| Cached copy (VisiLean unreachable) | the day the copy was fetched |
| Sample export | the Monday after the latest week in its commitment feed (`committedEndDate`), so that week is the export's last complete week. Without commitments, the run date |

## Adding a project

You need three things: the project code, the project name and the VisiLean project GUID.

1. Generate the project folder and its workflow:

   ```
   python -m build new-project --code AMS11 --name "Amsterdam 11" --id <project GUID>
   ```

   This writes `AMS11/project.json` and `.github/workflows/refresh-AMS11.yml`. The code is
   the folder, the page URL (`/AMS11/`) and the secret suffix. Add `--client "…"` if the
   client is not Digital Reality. Each new workflow runs 4 minutes after the previous
   project's (09:51 / 15:51 IST for the first, 09:55 / 15:55 for the second, and so on).
2. Create the repository secret `VL_TOKEN_<CODE>` (Settings → Secrets and variables →
   Actions) holding the project's VisiLean access token. Secret names allow only letters,
   digits and `_`, so other characters in the code become `_` (`MAD4.3` → `VL_TOKEN_MAD4_3`);
   the generator prints the exact name.
3. Commit and push both files, then run "Refresh AMS11 - Amsterdam 11" once by hand (or wait
   for the schedule). The page appears at `/AMS11/` and the landing page gains a card.

Everything else comes from `build/project_defaults.json` (API base URL, query parameters,
feed types, client, sample paths, fact labels, display); a key set in `project.json`
overrides it. The Project fact is the name and Status is read from the task feed (Started /
Completed / Not started). Contractor, Region, Country and City are in no feed: add them to
`facts` as `{"label": "City", "value": "…"}` or they show "—". Projects are listed in
natural code order (P2 before P10) unless `order` is set. `manifest.json` is optional.

To retire a project, delete its folder and its `refresh-<CODE>.yml`. Its card leaves the
landing page on the next portfolio refresh.

## Refresh workflows

| Workflow | Runs | Does |
|---|---|---|
| `refresh-<CODE>.yml`, one per project | 2× a day, staggered; or "Run workflow" | 3 API calls → `<CODE>/index.html` + `build.json` → validate, credential scan → publish that folder to `gh-pages` → start `portfolio.yml`. Goes red if the token is rejected or the page has no data, after publishing |
| `portfolio.yml` | after every project refresh; "Run workflow"; a push to `main` that changes `Template/`, `build/`, a `project.json` or `.github/scripts/` | Rebuilds `index.html` and `portfolio.json` from the published `build.json` files and publishes them. On a push, or with "Refresh every project first" ticked, it also starts every project refresh |

`.github/scripts/pages.sh` does the `gh-pages` work for both. The branch always holds a
single commit: each publish swaps only its own paths into the current tree and pushes with
`--force-with-lease`, retrying if another refresh got there first. So projects never overwrite
each other and the branch does not grow with every refresh. The source history stays on
`main`.

## GitHub setup (once)

1. Create the repository and push `main`. GitHub Pages from a branch needs a public
   repository, or a paid plan for a private one. The published pages are public either way.
2. Generate the projects (see "Adding a project") and create each `VL_TOKEN_<CODE>` secret.
3. Run one project's workflow by hand. Its first publish creates the `gh-pages` branch.
4. Settings → Pages → Build and deployment → Source: **Deploy from a branch**, branch
   `gh-pages`, folder `/ (root)`.
5. Actions → "Refresh portfolio" → Run workflow, with "Refresh every project first" ticked.

GitHub pauses scheduled workflows after 60 days without a commit to `main`; a push or a
manual run turns them back on.

## Safety

- VisiLean refuses browser-origin requests, so fetching only happens in the build. The page
  carries no endpoint, no project id and no token; `build/validate.py` and a grep in the
  workflow both fail the run if any of those reach `dist/`.
- `projectId` and `source.*` from `project.json` and `build/project_defaults.json` never reach
  the page, and every publish runs the same credential scan on what it is about to push.
- Pages are `noindex`.

## Layout

```
Template/               universal logic, templates, defaults
<CODE>/                 one folder per project (PAR14, MRS05)
build/                  the build process (fetch, inject, manifest, validate, CLI)
dist/                   output (gitignored)
.cache/                 last good feed per project (gitignored; cached in CI)
.github/workflows/      refresh-<CODE>.yml per project, portfolio.yml
.github/scripts/        pages.sh (fetch, scan and publish the gh-pages site)
```
