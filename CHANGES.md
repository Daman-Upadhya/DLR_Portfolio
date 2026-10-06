# DLR Portfolio: change log and working notes

This file records every change made to the DLR Portfolio dashboards in the working session of
5 October 2026, why each was made, and what is still open. Read it before changing the
calculation logic, the dashboard template or the PPC review export.

The [README](README.md) explains how the repository is built and deployed. This file explains
what the report now does and the decisions behind its numbers.

---

## 1. At a glance

| Area | Before | Now |
|---|---|---|
| Data feeds | Tasks only; committed and constraint KPIs showed "no data" | Tasks, commitments and constraints, from sample files |
| Page | One static page computed at build time | Two pages (Performance, Constraints) with slicers, recomputed in the browser |
| Headline | Total score card | "Last week PPC" and the 6-week rolling PPC; the score card was removed |
| PPC basis | Planned PPC | Committed PPC everywhere; planned PPC removed from all visuals |
| Reasons for variance | English model reasons only, about 40 activities matched | Plus the project's 11 French reasons, 695 activities matched |
| Detail review | None | Every mark opens the activities or constraints behind it, with CSV download |
| Export | None | "Export PPC review": a printable, sendable report (PDF via print, HTML, CSV) |
| Branding | "VL" square | VisiLean and Digital Realty logos (PNG) |

---

## 2. Data and calculation

### 2.1 Feeds

- The commitment and constraint samples are in `sample/P1.committed.json` and
  `sample/P1.constraints.json`. `P1/project.json` points `source.sampleFeeds` at them.
- **Live feeds are still off.** `source.feeds.committed.type` and `source.feeds.constraints.type`
  are `null`, because the VisiLean API type names are not known. Set them to switch live
  builds on.
- The commitment feed is nested: one record per commit batch, with `isAutoCommit` and
  `commitDetails[].activitiesGuid` as a list. `_commit_rows()` in
  [calculation.py](Template/calculation.py) expands it to one row per commit and activity, as
  the Power Query does, and drops rows without a `committedTimestamp`.

### 2.2 Measures added to the Power BI port

All of these live in [calculation.py](Template/calculation.py) and are covered by the selftest.

| Power BI measure or column | Where |
|---|---|
| Successful Task(C), UnSuccessful Task(C), TotalTask | `ppc()["committedAllTime"]` |
| Constraints (categorised count) | `constraint_kpis()["categorised"]` |
| #TargetYrWeek, #CreationYrWeek, #completeYrWeek | `constraint_kpis()["weeks"]` (ISO weeks) |
| Delayed by days Constraint | `constraint_kpis()["overdueDays"]` |
| Standard Reason | `reasons()["standard"]`, mapping in `reasons.standard` |
| !!@Remaining Score | `total_score()["remaining"]` |
| Trade / organisation performance, last committed week | `group_performance()`, `trade_performance()` |
| Reasons for variance by trade (missed commitments) | `reasons_by_trade()` |
| Row-level facts for the page slicers | `facts()` |
| Constraint outcome split, average time to resolve, average open age, ageing, by priority / owner / trade | `constraint_kpis()["split"]`, `["avgResolveDays"]`, `["avgOpenAgeDays"]`, `["ageing"]`, `["byPriority"]`, `["byOwner"]`, `["byTrade"]` (6 Oct; owner is the person in the feed's `owner` field, with doubled spaces collapsed, and trade is the constraint's own; the page computes the same in `aggregate.js`, and an all-dates run matches Python on every one) |

### 2.3 How the page recomputes under filters

The page is no longer only a renderer. The split is:

1. `calculation.py` derives every per-row flag (delay, PPC result, reason categories,
   constraint status) and embeds the rows as `metrics.facts`.
2. [aggregate.js](Template/scripts/aggregate.js) re-aggregates those rows under the chosen
   filters, following the DAX filter context. It exports `Agg.run`, `Agg.records` (the rows
   behind a mark), `Agg.review` (the export), `Agg.options` and `Agg.extent`.
3. [app.js](Template/scripts/app.js) and [charts.js](Template/scripts/charts.js) draw the
   result.

**Rule for future changes:** a new measure goes into `calculation.py`, and the same
logic goes into `aggregate.js`. The two must agree. Section 6 explains how to check this.

Filter rules, as in the model's relationships:

- The date range applies to tasks by planned end, to commitments by committed end, and to
  constraints by target date.
- Organisation, trade and location come from the task. A commitment inherits them from its
  activity. A constraint inherits them from its linked activity, or uses its own fields when
  unlinked.
- The "last six weeks" tiles intersect the selected range with the six-week window, as
  `CALCULATE(..., IsLastSixWeeks)` does.

### 2.4 Reasons for variance

The project writes its reasons in French in the activity history, as `Note: <reason>` or
`Note added: <reason>`. They were added to `reasons.order`, `reasons.categories` and
`reasons.standard` in [dashboard_data.json](Template/dashboard_data.json), ahead of the
English reasons, so the team's own note wins over an English keyword in a task name.

| Reason (as written in VisiLean) | Category | Standard group |
|---|---|---|
| Erreur de plan | Design | Outstanding Design |
| Refus HSE | Health and safety | Health & Safety |
| Manque d'appro | Materials | Materials |
| Pas assez de ressource | Labour shortfall | Labour / Resources |
| Predecesseur non accompli | Predecessor incomplete | Predecessor Work |
| Problème qualité | Quality and rework | Quality & Rework |
| Trop de coactivité | Space | Access / Space |
| Intempérie météo | Adverse weather | External / Weather |
| Durée sous estimé | Labour shortfall | Labour / Resources |
| BUG system | Others | Other |
| PLUS RAPIDE | Others | Other |

These mappings are judgement calls. Change any of them in `dashboard_data.json`; no code change
is needed.

The "Reasons for variance by trade" visual leaves out missed activities with no recorded
reason. The card states how many were left out. In the sample, 122 of 293 missed commitments
have a reason.

### 2.5 Counting rules

| Number | Rule |
|---|---|
| PPC (weekly, last week, tiles) | Share of committed activities finished in the ISO week they were committed for; one count per activity per week (DISTINCTCOUNT), as in the model |
| 6-week rolling PPC | Mean of the weekly PPC over the 6 weeks ending that week. Overall, a week with no commitments counts as 0, as "PPC Avg (6wk Running)" does. Per trade, only weeks the trade had commitments count. The look-back may reach before the selected range but never before the first week of the commitment feed |
| Export totals (total / successful / unsuccessful tasks) | One count per activity per committed week, repeats included, so successful + unsuccessful = total |
| Bands | From `tolerance.ppc`: good 80%+, watch 65–80%, critical below 65% |
| Open constraint | Completion date is blank, whatever the status says |
| Overdue constraint | Open (completion date blank) and the target date is before today; a target of today is not yet overdue. This applies to the overdue list, the tab badge, the "Constraints overdue" rate and the detail lists. Until 6 Oct the list and badge used status ≠ Closed and the rate counted a target of today as overdue |

The rolling window length is `ppc.rollingWeeks` in `dashboard_data.json` (default 6). The last
week's rolling value equals the "PPC 6-week running" tile.

---

## 3. The dashboard page

### 3.1 Layout, top to bottom

1. **Header:** VisiLean and Digital Realty logos, project name with a status pill, and
   "Data as of".
2. **Top panel**, a blue-to-navy gradient band styled like the VisiLean report library:
   - an eyebrow line, the project name and a one-line description;
   - **Export PPC review** in the top-right corner, with three project totals beneath it:
     - unique activities in the task history;
     - trades with at least one activity, not counting Unassigned;
     - open constraints.

     Unique activities and trades cover the whole feed. They follow the organisation, trade
     and location filters but not the date range, and `totals.project` in
     [aggregate.js](Template/scripts/aggregate.js) computes them. Open constraints is the
     Constraints page's own count: no completion date, target date in the selected range,
     so the two always agree. For example, the sample has 10 for the last 12 weeks; 3 more
     are open with October targets;
   - below a hairline, the Performance / Constraints capsule toggle, then the filters in this
     order: date range, trade, location, organisation, and Reset (with a count of active
     filters). A summary line sits underneath.

   The controls are glass buttons, and turn white when they hold a selection. The panel's
   colours are the `--panel-*` tokens in [tokens.css](Template/tokens.css). It replaced the
   sticky control bar (6 Oct), so it scrolls with the page. It was later made compact, about
   195px tall on a wide screen:
   - a one-line description and a 27px title;
   - Export on the same row as the counts;
   - on screens 1500px and wider, the summary sits in the filter row between the tabs and
     the filters. It is cut off with an ellipsis when long, and the full text is in its
     tooltip.
3. **Performance page:**
   - "Last six weeks" tiles: Last week PPC, 6-week rolling PPC, average planned duration,
     and weekly planned activities. The activities-delayed and average-delay-duration tiles
     were removed at the user's request (6 Oct); their measures are still calculated.
     The two PPC tiles count committed activities. The other two count activities from the
     task history with a planned finish in the window, as the Power BI measures do.
   - Weekly committed PPC: clustered columns for kept and missed counts, a committed PPC line
     with labels, the 85% target, and "View as table".
   - Trade performance for the last committed week, with a Trade / Organisation toggle: four
     headline stats, a good / watch / critical tier bar, the eight worst groups as bars, and
     the rest as chips.
   - Reasons for variance: a donut with a "Reasons for variance" / "Reason category" toggle,
     and a legend with share bars.
   - Reasons for variance by trade.
4. **Constraints page** (redesigned 6 Oct). The tab shows an overdue badge.
   - **Tiles:** ten in two rows of five. The new ones are constraints raised, overdue now
     (a count), average time to resolve (raised to completed) and average age of open
     constraints (days since raised). They sit beside the open, overdue %, resolved on
     time, lag, unlinked and resolved-before-start tiles.
   - **Three donuts:**
     - Outcome: closed on time, closed late, open and not yet due, open and overdue. These
       use the validated series colours in their own meanings.
     - Category: the seven largest, with the rest folded and the uncategorised shown.
     - Priority.
   - **Breakdowns:**
     - Open constraint ageing in 0–7 / 8–14 / 15–30 / 31–60 / 60+ day buckets, on the
       ordinal ramp.
     - By responsible owner (the constraint's `owner`, a person) and by trade (the trade
       recorded on the constraint). Each bar is stacked by outcome, labelled "open / raised",
       and sorted with the most open first. The top eight are bars; the rest
       are chips.
   - **By target week:** a stacked column chart (completed by target, completed after
     target, still open), with the total above each column and the last six weeks shaded.
     It sits beside the overdue list. A "Raised and resolved by week" trend was tried and
     removed at the user's request (6 Oct).
   - **Detail lists:** every slice, bar, column and tile opens the constraints behind it.

Removed at the user's request: the "Data notes" line under the cards and the grey "Sample
data" banner (6 Oct). The banner still appears when VisiLean was unreachable, when no data
has been fetched yet, or when a live build is older than `staleAfterHours`. Also removed
earlier: total score card, planned PPC, task status card, delayed
activities card, tolerance limits table, project facts strip, separate organisation PPC card,
and the filter summary in the tab bar.

### 3.1a Portfolio page (`dist/index.html`, redesigned 6 Oct)

- **Header and panel:** the same app bar and blue-to-navy panel as the project pages. The
  panel shows the number of projects and how many fall in each 6-week rolling PPC band:
  Critical, Watch and Good. Clicking a band count filters the cards to that band, and
  clicking it again shows all.
- **Project cards, PPC first.** The 0–100 total score and the Green / Amber / Red counts are
  gone, closing the open issue. Each card shows:
  - client, name and project status;
  - last week PPC and 6-week rolling PPC, each with its Good / Watch / Critical band;
  - activities, trades and open constraints (the trend line and the overdue count were tried
    and removed at the user's request);
  - data freshness and "Open dashboard".

  A coloured edge marks each card's rolling-PPC band. A project with no data yet shows a
  pending card.
- **Finding a project:**
  - a search box over project and client names;
  - band filter chips with counts (All / Critical / Watch / Good);
  - a sort: lowest PPC first (the default), most open constraints, or A–Z. The band and sort are
    remembered in the browser.
  - When nothing matches, a message says why and offers "Clear search and filter".
- **Data:** `landing_card()` in [build.py](build/build.py) adds these numbers to each
  project's `build.json` summary from the computed metrics: `lastWeekPpc`, `trades`,
  `openConstraints` and the bands. They match the project
  page's default view.

### 3.2 Interaction

- **Date range picker:** presets (this week, last week, last 4 / 6 / 12 weeks, this month,
  last month, all data), two months side by side, and selections that snap to whole ISO weeks.
  Days outside the data are struck through.
- **Detail lists:** every mark opens a side panel with the records behind it. Marks include
  columns, points, bar segments, bar labels, donut slices and legend rows, tiles, chips, and
  the "View list" button on each card. The panel searches, downloads CSV, closes on Escape,
  and keeps focus inside while open.
- **Shareable state:** the open page and its filters are kept in the URL hash, for example
  `#page=constraints&trade=GSE`.
- **Separate filters per page (6 Oct):** Performance and Constraints each keep their own
  filters. They are not synced.
  - Performance has the date range, trade, location and organisation, all from the
    activity.
  - Constraints has the date range, category, trade and owner, all as recorded on the
    constraint. The URL keys are `cat`, `ctrade` and `cown`.
  - The panel's controls show the active page's filters. Switching tabs swaps them in, and
    each page keeps its selections when you come back to it.
  - Reset clears only the active page.
  - **Export PPC review** always uses the Performance filters.
  - The Constraints badge and the panel's open-constraint count always follow the
    Constraints filters.
  - The summary line names the page whose filters it describes.
  - The URL hash carries the filters of the page it opens on.
  - This replaced the earlier rule that reset the filters on switching to Constraints.
  - `FS` and `switchPage()` in [app.js](Template/scripts/app.js) handle it.

- **Copy:** all on-screen text is in sentence case. That includes the tile notes, the
  descriptions and the reason category names in `dashboard_data.json`: "Labour shortfall",
  "Quality and rework", "Adverse weather", "Health and safety", "Scope variation" and
  "Equipment". "6-week rolling PPC" is the one name used for the rolling rate. Source data,
  such as trade, owner and reason text from VisiLean, is shown as recorded.

### 3.3 Design

- **Design system:** the VisiLean design system applies throughout. Colours are tokens with
  light and dark values in [tokens.css](Template/tokens.css). Nulls show "—", and status is
  shown with both an icon and a word.
- **Design-system pass (6 Oct):** the dashboard and the PPC review now use more of the
  VisiLean components:
  - **KPI tiles:** they keep their earlier layout and colours, at the user's request. Hero
    cards and tile icon chips were tried and removed. Only the tile border changed, to
    `--line-soft`.
  - **Tokens:** `--line-soft`, `--brand-soft`, `--grid`, `--axis` and the elevation ladder
    were added to `tokens.css`.
  - **Controls:** filter pickers are pill buttons that fill with brand blue when they hold a
    value. Labelled buttons are 36px high. The segmented controls are pill-shaped.
  - **Tables:** headers sit on `--inset`, with roomier cells and a hover tint on rows.
  - **Tooltip:** the tooltip is light, with the "transient" shadow.
  - No measure changed.
- **Full width:** the page uses the whole screen width, with a shared gutter variable.
- **Charts:** charts redraw at their real pixel width, so text keeps its size. The weekly
  chart grows taller with its width.
- **Logos:** trimmed PNG copies are in `Template/assets/` and are embedded into each page as
  data URIs by [build.py](build/build.py). In dark mode they sit on a white plate. The
  original logo files in the project root were not changed.

---

### 3.4 A second project (P2), 6 Oct

`P2/` was added from the user's sample exports, to show how the build scales to more
projects:

| Piece | Where |
|---|---|
| Project settings | `P2/project.json`: key `P2`, title "Project 2" (a placeholder, as the export carries no project name), project GUID |
| Dependency manifest | `P2/manifest.json`, with page `P2` |
| Sample feeds | `sample/P2.tasks.json.gz` (gzipped from `Sample Task _P2.json`, 16.7 MB to 0.5 MB), `sample/P2.committed.json`, `sample/P2.constraints.json` |
| Live token | Secret `VL_TOKEN_P2` (see 3.6 for how workflows are set up now) |
| Raw export | `Sample Task _P2.json` added to `.gitignore`, like P1's raw export |

Nothing in the template, calculation or build code is project-specific. `--all` finds every
top-level folder that holds a `project.json`, builds `dist/<key>/index.html` and its
`build.json`, and the portfolio page gains a card.

### 3.5 Only the project GUID is entered, 6 Oct

A project folder now needs only `project.json` with `projectId`, `title` and `client`.

- **Shared defaults.** `build/project_defaults.json` holds what every project shares: the API
  base URL, the task, commitment and constraint feed types, the sample file paths
  (`sample/{key}.…`), the fact labels and `display.groupBy`. It is read at build time only and
  never reaches a page. A key in `project.json` still overrides it.
- **Reporting date, worked out per refresh.** Live builds use the run date; a cached copy uses
  the day it was fetched; a sample export uses the Monday after the latest week in its
  commitment feed (`Template/calculation.py` → `reporting_date`). `source.sampleToday` is
  gone, and `--today` now pins live builds only.
- **Derived facts.** The Project fact defaults to the title, and Status comes from the task
  feed (`project_status`: Completed when every activity has an actual finish, Started when any
  has an actual start, otherwise Not started).
- **Order.** Without `order`, projects sort by key in natural order (P2 before P10).
- **No borrowed sample.** A project with no sample task file used to fall back to P1's export;
  it is now built as "unavailable".

Both sample exports hold commitments up to W40 (28 Sep – 4 Oct), so both are now reported as
of Monday 5 Oct with W40 as the last complete week:

| | Last week PPC | 6-week rolling PPC | Open constraints |
|---|---|---|---|
| P1 | 25.5% (W40, was 64.3% for W39) | 51.5% (was 57.8%) | 11 (was 10) |
| P2 | 66.7% (W40, unchanged) | 81.1% (unchanged) | 28 (unchanged) |

P1's W40 is low because its task export ends on Thu 1 Oct: activities finished on 2–4 Oct are
not in it, so they count as missed. A fresh export, or the live feed, corrects it.

### 3.6 Per-project refresh on GitHub, 6 Oct

- **Live API.** `build/project_defaults.json` now holds the real endpoint for every project,
  `https://go.visilean.com/pb/PowerBiAPI/resource/powerBi/getData/visilean?accessToken=…&projectId=…`,
  and three calls per refresh: `type=task&IncludeStatusChange=true&IncludeReschedule=true&IncludeConstraintNotes=true&IncludeOther=true`,
  `type=committedTask` and `type=constraintLog`. Client defaults to Digital Reality.
- **Token.** Repository secret `VL_TOKEN_<CODE>`. A secret name cannot hold `.` or `-`, so
  those become `_`.
- **One workflow per project.** `python -m build new-project --code --name --id` writes the
  project folder and `.github/workflows/refresh-<CODE>.yml`, staggered 4 minutes after the
  last project's twice-a-day slot.
- **Published to `gh-pages`.** Each refresh publishes only its own folder (`<CODE>/index.html`,
  `build.json`) with `.github/scripts/pages.sh`. The branch holds a single commit, and racing
  refreshes retry rather than overwrite each other. Tested with two refreshes pushing to a
  local remote at the same moment.
- **Portfolio workflow.** `portfolio.yml` rebuilds the landing page after each project
  refresh, and on a push to `main` it starts every project refresh. It replaces
  `build-deploy.yml` and the Pages artifact deploy.
- **CLI.** `build --no-landing`, `landing`, `new-project`, `validate --project CODE` /
  `--landing`. Project codes may contain `.` (e.g. `MAD4.3`).
- **Fixes found on the way.** `build.json` stored full 64-character hashes, which the
  credential scan rejects; it now stores the short ones. A project with no sample file used
  to borrow P1's; it is now "unavailable".

### 3.7 Live on GitHub; sample data removed, 6 Oct

PAR14 and MRS05 were generated with `new-project`. Their first refreshes, the portfolio
refresh and the Pages deploy all ran green, and the published site was checked:

| Project | State | Last week PPC (W40) | 6-week rolling PPC | Open constraints | Activities | Trades |
|---|---|---|---|---|---|---|
| MRS05 Production Control | fresh, live | 48.9% | 55.5% | 11 | 2,986 | 59 |
| PAR14 Production Control | fresh, live | 66.7% | 81.1% | 28 | 1,538 | 7 |

No published page contains a token, the API host or a project GUID. The landing page links
both projects, and both dashboards render.

The sample projects and their data were then removed: `P1/`, `P2/`, `sample/`, the four
`Sample …json` exports at the root and the two large raw exports that were never committed.
With them gone:

- `selftest` runs on the hand-checked synthetic case only (64 checks), including the
  reporting date and project status.
- The refresh workflows always use the live API. The "sample" choice on "Run workflow" is
  gone, as it would have published an empty page over the live one.
- `--source sample` still works locally for exports saved under `sample/<CODE>.…`.

## 4. Export PPC review

The button builds a standalone report for the current range and filters, and opens it in a
new tab. The tab offers "Print / Save as PDF", "Download HTML" and "Download activity list
(CSV)".

Sections:

1. **Cover:** project, period, weeks, filters, data date and generation time.
2. **Summary:** Last week PPC, 6-week rolling PPC, total tasks, successful tasks and
   unsuccessful tasks, followed by a highlights box.
3. **Overall PPC trend:** successful and unsuccessful columns with the rolling PPC line only.
4. **Rolling PPC by trade:** a table with one row per trade and one cell per week, worst trade
   first.
5. **Activities by trade and week:** activities grouped by trade, then by week.
6. **How the numbers are counted.**

Print layout (A4 landscape):

- Page 1 holds the cover, the summary cards and the highlights.
- The trade name and column headers repeat on every continued page, and a week label never
  sits alone at the bottom of a page.
- Every page has a footer: the title on the left, and "Page x of y" on the right.

The builder is `buildReview()` in [app.js](Template/scripts/app.js), and its numbers come from
`Agg.review()`.

---

## 5. Files changed

| File | Change |
|---|---|
| `Template/calculation.py` | Nested commitment feed, new measures, trade / organisation performance, reasons by trade, row-level facts, invariants |
| `Template/scripts/aggregate.js` | **New.** Filter context, `records`, `review` |
| `Template/scripts/app.js` | Slicers, date picker, pages, detail panel, export builder, all card renderers |
| `Template/scripts/charts.js` | Line-and-clustered-column chart, donut, clickable marks, `barRows` options |
| `Template/Dashboard.html` | New layout, styles, control bar, detail panel markup |
| `Template/Landing.html` | Full width, logos |
| `Template/tokens.css` | Categorical slots, `--on-fill`, `--shadow-xs`, `--logo-plate` |
| `Template/dashboard_data.json` | `reasons.standard`, French reasons, `noneLabel`, `topCategories`, `unassignedLabel`, `ppc.rollingWeeks` |
| `Template/assets/*.png` | **New.** Header logos |
| `build/build.py` | Inlines `aggregate.js`, embeds the logos, adds `lastCommittedWeek` and `tradesBelowTarget` to `build.json` |
| `build/inject.py` | New `{{AGGREGATE_JS}}` slot |
| `build/manifest.py` | `aggregate` added to the tracked dependencies |
| `build/validate.py` | Selftest covers the sample feeds and new measures; checks the new files exist |
| `P1/project.json`, `P1/manifest.json` | Sample feed paths; `aggregate` dependency |
| `sample/P1.committed.json`, `sample/P1.constraints.json` | **New.** Copies of the supplied samples |
| `README.md` | Feeds, slicers, detail lists, export, page description |

---

## 6. How to verify a change

```
python -m build selftest
python -m build build --all --source sample
python -m build validate
```

These checks are necessary but **not sufficient**. Nothing in the build checks the page's
JavaScript, so a syntax error passes all three and leaves a blank dashboard. This happened once
in the session and was caught in the browser. After any change to `Template/scripts/` or the
templates, also:

1. Open `dist/P1/index.html` in a browser and check the developer console for errors.
2. Click **Export PPC review**, print to PDF, and look at the pages.
3. If a measure changed, compare a few numbers between the dashboard, a detail list and the
   export for the same filters. During the session these were compared automatically: 61
   Python-versus-page checks, 284 list-versus-measure checks, and 24 export checks. Those test
   pages were scratch files and are not in the repository.

To check in headless Chrome, give each run its own `--user-data-dir`. Headless Edge was
unreliable on this machine while an Edge update was pending.

---

## 7. Open issues and follow-ups

| Issue | Impact | Suggested fix |
|---|---|---|
| No JavaScript check in the build | A script error can ship with a green build | Add a headless-browser load check to `validate` or the workflow |
| Manifest hashes never recorded | Every build logs "drift" | Run `python -m build build --write-manifest` once the report is approved |
| 171 of 293 missed commitments have no reason recorded | The reasons-by-trade visual covers only part of the misses | A process question for the site teams, not a code issue |
| Inter font not embedded | Pages use the system font stack | Add the font file and embed it, as the design system expects |
