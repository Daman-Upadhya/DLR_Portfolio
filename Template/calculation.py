# -*- coding: utf-8 -*-
"""Universal calculational logic for every DLR project page.

This is the file the ER diagram calls "Calculational Logic". It is pure: no network, no
file I/O, no printing. Every number a page shows is computed here; the HTML only renders.
The build records this file's SHA-256 on every page and in every project's manifest.json.

The logic is a port of the "Digital Reality - KPIs (Committed)" Power BI semantic model:

    Power Query (transformations)          here
    -------------------------------------  ---------------------------------------------
    RowData  taskType filter               normalise() -> data.taskTypes
    MasterTable  Reasons for Variance      _reason()   -> data.reasons.order / .categories
    MasterTable  Reasons Category          _event()    -> data.reasons.events
    MasterTable  Planned_/Actual_Week-Year week_key()  (ISO week of the end date)
    MasterTable  Planned_PPC               task["plannedPPC"]
    All_Committed_Task  nested feed expanded (data.isAutoCommit, one row per activity),
                        Custom_CommittedPPC    _commit_rows(), commitment["ppc"]
    AllConstraintsLog  status, guid split, category clean-up, UniqueID   _constraints()
    MasterTable  Standard Reason                reasons()["standard"] (data.reasons.standard)

    DAX (calculated columns and measures)  here
    -------------------------------------  ---------------------------------------------
    Delay, DelayDays, IsLastSixWeeks       _derive(), six_week_window()
    !!PPC, !!PPC(Committed)                ppc()
    !!PPC Avg (6wk Running)                ppc()["running"]
    !!%Activity_Delayed                    activity_kpis()["delayedPct"]
    !!Avg_Delay_Durations                  activity_kpis()["avgDelayDays"]
    !!Avg_Planned_Duration                 activity_kpis()["avgPlannedDuration"]
    !!Avg_Activity_Week                    activity_kpis()["avgPerWeek"]
    Successful Task(C), UnSuccessful Task(C), TotalTask   ppc()["committedAllTime"]
    Total Task, Successful Task, Delay Task   totals()
    !!%Constraints_Overdue, !!ConstraintsResolvedonTIme, Unlinked(%), Avg._Lagtime,
    Successful_Constraints, %ConstraintsResolved Before PL Start, UnSuccessful Constraints,
    Successful(BeforeTarget), Unsuccessful(Target), Total_Constraints, Open Constraints,
    Constraints (categorised)              constraint_kpis()
    Delayed Constraint, Delayed by days Constraint   constraint_kpis()["overdue"]
    #TargetYrWeek, #CreationYrWeek, #completeYrWeek  constraint_kpis()["weeks"] (ISO weeks)
    Measure 3 (rescheduled)                reasons()["events"]
    !!@Total Score, !!@TotalScore_Status, !!@Remaining Score   total_score()
    Tolerance_Limits                       rag() with data.tolerance
    Remaining (1 - PPC)                    100 - pct, drawn by the page, not stored
    !!TotalProjects, !!StartedProjects, !!CompletedProjects   landing page (build/build.py)

    Slicers (Calendar date range, organisation, trade, location) are applied in the page:
    facts() emits one row per task, commitment and constraint with every derived flag, and
    Template/scripts/aggregate.js re-aggregates them under the chosen filter context the way
    the DAX measures do (date range on plannedEndDate / committedEndDate / targetDate; the
    "!!" measures intersect it with IsLastSixWeeks). compute() still produces the unfiltered
    numbers for build.json, the landing page and the selftest.
    group_performance()   Committed PPC per trade / organisation for the last complete committed week
    reasons_by_trade()    Reasons for variance of activities that missed a commitment, per trade

Entry points:

    model   = normalise(feeds, data)               # raw VisiLean feeds -> tasks, commitments, constraints
    metrics = compute(model, project, data, today) # everything the page needs

`feeds` is {"tasks": [...], "committed": [...] | None, "constraints": [...] | None}. The task
feed carries one row per history event, so tasks are de-duplicated by guid (the model's
DISTINCTCOUNT(guid)). A feed that is None was not configured and its KPIs come out None.

Conventions
- Unknown stays None and the page renders an em dash. 0 is a measurement.
- Percentages are 0..100. Dates are ISO strings in the output; `today` is a datetime.date.
- "Last six weeks" (L6W) is the six complete Monday-Sunday weeks before the current week.
"""
from __future__ import annotations

import math
import re
from collections import OrderedDict
from datetime import date, datetime, timedelta

# --------------------------------------------------------------------------- parsing

_DATE_FORMATS = ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y",
                 "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d")


def parse_date(value) -> str | None:
    """VisiLean sends dd/mm/yyyy hh:mm:ss, and " " for a date that is not set. Returns ISO or None."""
    if value in (None, "", 0):
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip()
    if not s:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def _num(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", "").replace("%", "").strip())
    except ValueError:
        return None


def _text(value) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _d(iso: str | None) -> date | None:
    return date.fromisoformat(iso) if iso else None


def _get(data: dict, path: str, default=None):
    cur = data
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def _pct(num, den, nd=1):
    return None if not den else round(100.0 * num / den, nd)


def _round(x, nd=1):
    return None if x is None else round(x, nd)


def _roundup(x):
    """DAX ROUNDUP(x, 0): away from zero."""
    if x is None:
        return None
    return float(math.copysign(math.ceil(abs(x) - 1e-9), x))


def week_key(d: date | None) -> str | None:
    """ISO week of a date as 'YYYY-WW' (the model's Week & Year / Planned_Week-Year)."""
    if d is None:
        return None
    y, w, _ = d.isocalendar()
    return "%d-%02d" % (y, w)


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def six_week_window(today: date, weeks: int = 6) -> tuple[date, date]:
    """IsLastSixWeeks: from the Monday six weeks before this week's Monday to last Sunday."""
    this_monday = week_start(today)
    return this_monday - timedelta(days=7 * weeks), this_monday - timedelta(days=1)


def _in(d: date | None, window: tuple[date, date]) -> bool:
    return d is not None and window[0] <= d <= window[1]


def _week_spans(today: date, n: int) -> list[tuple[date, date]]:
    """The n complete Monday-Sunday weeks before this week, oldest first (the trend axis)."""
    last_monday = week_start(today) - timedelta(days=7)
    out = []
    for k in range(n - 1, -1, -1):
        mon = last_monday - timedelta(days=7 * k)
        out.append((mon, mon + timedelta(days=6)))
    return out


# --------------------------------------------------------------------------- normalise

def _reason(history: str, data: dict) -> tuple[str | None, str | None]:
    """Reasons for Variance: the first listed reason the history text contains (case-sensitive,
    like Text.Contains), then its category. No reason -> (None, 'Uncategorised')."""
    if history:
        for r in _get(data, "reasons.order", []) or []:
            if r in history:
                for cat, members in (_get(data, "reasons.categories", {}) or {}).items():
                    if r in members:
                        return r, cat
                return r, None
    return None, _get(data, "reasons.uncategorised", "Uncategorised")


def _event(history: str, data: dict) -> str | None:
    """Reasons Category: late start / late complete / stopped / warning / rescheduled."""
    if history:
        for needle, label in _get(data, "reasons.events", []) or []:
            if needle in history:
                return label
    return None


def _tasks(raw: list, data: dict) -> tuple[list[dict], dict]:
    types = set(_get(data, "taskTypes", ["Construction", "Design"]) or [])
    by_guid: "OrderedDict[str, dict]" = OrderedDict()
    excluded: dict[str, int] = {}
    history_rows = 0
    for r in raw or []:
        if not isinstance(r, dict):
            continue
        ttype = _text(r.get("taskType"))
        if types and ttype not in types:
            excluded[ttype or "(none)"] = excluded.get(ttype or "(none)", 0) + 1
            continue
        guid = _text(r.get("guid")) or _text(r.get("taskId"))
        if not guid:
            continue
        history_rows += 1
        history = r.get("activityHistory") or ""
        reason, category = _reason(history, data)
        event = _event(history, data)
        t = by_guid.get(guid)
        if t is None:
            pe = parse_date(r.get("plannedEndDate"))
            ae = parse_date(r.get("actualEndDate"))
            dur = _num(r.get("plannedDuration"))
            t = by_guid[guid] = {
                "guid": guid,
                "id": _text(r.get("taskId")),
                "name": _text(r.get("taskName")) or "(unnamed)",
                "type": ttype,
                "status": _text(r.get("status")),
                "owner": _text(r.get("owner")),
                "organisation": _text(r.get("organisation")),
                "trade": _text(r.get("trade")),
                "location": _text(r.get("location")),
                "priority": _text(r.get("taskPriority")),
                "pct": _num(r.get("percentComplete")),
                "plannedStart": parse_date(r.get("plannedStartDate")),
                "plannedEnd": pe,
                "actualStart": parse_date(r.get("actualStartDate")),
                "actualEnd": ae,
                "plannedDuration": dur,
                "plannedWeek": week_key(_d(pe)),
                "actualWeek": week_key(_d(ae)),
                "reasons": set(),
                "categories": set(),
                "events": set(),
            }
            # Planned_PPC: finished in the same ISO week it was planned to finish
            t["plannedPPC"] = bool(t["actualWeek"] and t["actualWeek"] == t["plannedWeek"])
        if reason:
            t["reasons"].add(reason)
        if category:
            t["categories"].add(category)
        if event:
            t["events"].add(event)
    tasks = list(by_guid.values())
    for t in tasks:
        t["reasons"], t["categories"], t["events"] = sorted(t["reasons"]), sorted(t["categories"]), sorted(t["events"])
    return tasks, {"rows": len(raw or []), "historyRows": history_rows, "excludedByType": excluded}


def _commit_rows(raw) -> list[dict]:
    """All_Committed_Task source rows, one per (commit, activity). VisiLean sends the commitment
    feed nested: [{"isAutoCommit": bool, "commitDetails": [{"committedTimestamp",
    "committedStartDate", "committedEndDate", "activitiesGuid": [guid, ...]}, ...]}, ...], which
    Power Query expands with data.isAutoCommit carried down to every row. A flat row (one guid
    per row, or a list of guids) is accepted as-is."""
    out = []
    for r in raw or []:
        if not isinstance(r, dict):
            continue
        details = r.get("commitDetails")
        if isinstance(details, list):
            auto = r.get("isAutoCommit", r.get("data.isAutoCommit"))
            for d in details:
                if not isinstance(d, dict):
                    continue
                guids = d.get("activitiesGuid")
                for g in (guids if isinstance(guids, list) else [guids]):
                    out.append({**d, "activitiesGuid": g, "data.isAutoCommit": auto})
            continue
        guids = r.get("activitiesGuid")
        if isinstance(guids, list):
            out.extend({**r, "activitiesGuid": g} for g in guids)
        else:
            out.append(r)
    return out


def _commitments(raw, tasks_by_guid: dict) -> list[dict] | None:
    if raw is None:
        return None
    out = []
    for r in _commit_rows(raw):
        ts = r.get("committedTimestamp")
        if ts in (None, ""):
            continue  # Filtered Rows4: committedTimestamp <> null
        guid = _text(r.get("activitiesGuid")) or _text(r.get("activityGuid")) or _text(r.get("guid"))
        ce = parse_date(r.get("committedEndDate"))
        if not guid or not ce:
            continue
        auto = r.get("data.isAutoCommit", r.get("isAutoCommit"))
        if auto is None and isinstance(r.get("data"), dict):
            auto = r["data"].get("isAutoCommit")
        t = tasks_by_guid.get(guid)
        cweek = week_key(_d(ce))
        out.append({
            "guid": guid,
            "committedStart": parse_date(r.get("committedStartDate")),
            "committedEnd": ce,
            "committedWeek": cweek,
            "auto": bool(auto),
            "linked": t is not None,
            # Custom_CommittedPPC: the task finished in the ISO week it was committed for
            "ppc": bool(t and t["actualWeek"] and t["actualWeek"] == cweek),
        })
    return out


def _constraints(raw, tasks_by_guid: dict, data: dict) -> list[dict] | None:
    if raw is None:
        return None
    replacements = _get(data, "constraints.categoryReplacements", []) or []
    out = []
    for r in raw:
        if not isinstance(r, dict):
            continue
        cid = _text(r.get("constrainId")) or _text(r.get("constraintId")) or _text(r.get("id"))
        if not cid:
            continue
        commitment = parse_date(r.get("commitmentDate"))
        completion = parse_date(r.get("completionDate"))
        status = "Open" if commitment is None else ("Committed" if completion is None else "Closed")
        category = _text(r.get("category"))
        if category:
            for old, new in replacements:  # List.Accumulate of Text.Replace, in order
                category = category.replace(old, new)
        guids = [g.strip().strip('"') for g in str(r.get("activityGuid") or "").split(",")]
        guids = [g for g in guids if g] or [None]
        base = {
            "uid": cid,
            "title": _text(r.get("title")) or "(untitled)",
            "category": category,
            "priority": _text(r.get("priority")),
            "owner": " ".join((_text(r.get("owner")) or "").split()) or None,  # source names carry doubled spaces
            "ownerOrganisation": _text(r.get("ownerOrganisation")),
            "location": _text(r.get("location")),
            "trade": _text(r.get("trade")),
            "creation": parse_date(r.get("creationDate")),
            "target": parse_date(r.get("targetDate")),
            "commitment": commitment,
            "completion": completion,
            "status": status,
        }
        for g in guids:  # Split Column by Delimiter: one row per linked activity
            t = tasks_by_guid.get(g) if g else None
            row = dict(base)
            row["activityGuid"] = g
            row["taskPlannedStart"] = t["plannedStart"] if t else None
            row["taskName"] = t["name"] if t else None
            out.append(row)
    return out


def normalise(feeds, data: dict | None = None) -> dict:
    """Raw feeds -> {"tasks", "commitments", "constraints", "feed"}. Accepts a bare task list too."""
    data = data or {}
    if isinstance(feeds, list) or feeds is None:
        feeds = {"tasks": feeds or []}
    tasks, feed = _tasks(feeds.get("tasks") or [], data)
    by_guid = {t["guid"]: t for t in tasks}
    return {
        "tasks": tasks,
        "commitments": _commitments(feeds.get("committed"), by_guid),
        "constraints": _constraints(feeds.get("constraints"), by_guid, data),
        "feed": feed,
    }


def reporting_date(model: dict) -> date | None:
    """The "today" for a data snapshot (a sample export or a cached copy), read from the
    commitment feed: the Monday after the latest week anything was committed for, so that week
    is the snapshot's last complete week. None without a commitment feed or commitments."""
    ends = [_d(c["committedEnd"]) for c in model.get("commitments") or [] if c.get("committedEnd")]
    return week_start(max(ends)) + timedelta(days=7) if ends else None


def project_status(model: dict) -> str | None:
    """Started / Completed / Not started from the task feed (the !!StartedProjects and
    !!CompletedProjects logic): completed when every activity has an actual finish, started
    when any has an actual start. None without tasks."""
    tasks = model.get("tasks") or []
    if not tasks:
        return None
    if all(t["actualEnd"] for t in tasks):
        return "Completed"
    return "Started" if any(t["actualStart"] or t["actualEnd"] for t in tasks) else "Not started"


# --------------------------------------------------------------------------- derived columns

def _derive(t: dict, today: date) -> dict:
    """The DAX calculated columns that depend on TODAY()."""
    ps, pe, as_, ae = _d(t["plannedStart"]), _d(t["plannedEnd"]), _d(t["actualStart"]), _d(t["actualEnd"])
    late_start = bool(ps and ps < today and not as_)
    late_finish = bool(pe and pe < today and not ae)
    if late_start:
        days, kind = (today - ps).days, "Not started"
    elif late_finish:
        days, kind = (today - pe).days, "Not finished"
    else:
        days, kind = None, None
    return {
        # MasterTable[Delay]: construction only, strictly before today
        "delay": (late_start or late_finish) and t["type"] == "Construction",
        "delayDays": days,
        "delayKind": kind,
        # !!%Activity_Delayed uses <= TODAY()
        "delayedForPct": bool((ps and ps <= today and not as_) or (pe and pe <= today and not ae)),
        "dueForPct": bool((ps and ps <= today) or (pe and pe <= today)),
    }


# --------------------------------------------------------------------------- KPIs

def rag(value, rule) -> str:
    """Tolerance_Limits: rule = {"good": [op, v], "watch": [op, v]}; anything else is bad."""
    if value is None or not rule:
        return "inert"
    ops = {">=": lambda a, b: a >= b, ">": lambda a, b: a > b, "<=": lambda a, b: a <= b, "<": lambda a, b: a < b}
    for tone, key in (("good", "good"), ("warn", "watch")):
        op, v = rule.get(key) or (None, None)
        if op in ops and ops[op](value, v):
            return tone
    return "bad"


def _ppc_block(items: list, key_guid: str = "guid", key_ok: str = "ok") -> dict:
    """TotalTask / Successful Task(C) / UnSuccessful Task(C): distinct activities. An activity
    committed twice, kept once and missed once, counts on both sides, as DISTINCTCOUNT does."""
    total = {i[key_guid] for i in items}
    ok = {i[key_guid] for i in items if i[key_ok]}
    no = {i[key_guid] for i in items if not i[key_ok]}
    return {"total": len(total), "successful": len(ok), "unsuccessful": len(no), "pct": _pct(len(ok), len(total))}


def ppc(model: dict, data: dict, today: date) -> dict:
    """!!PPC (planned), !!PPC(Committed), weekly trend and !!PPC Avg (6wk Running)."""
    window = six_week_window(today)
    trend_weeks = int(_get(data, "ppc.trendWeeks", 12))
    tasks, comms = model["tasks"], model["commitments"]
    planned_items = [{"guid": t["guid"], "ok": t["plannedPPC"], "end": _d(t["plannedEnd"])} for t in tasks]
    committed_items = None if comms is None else [{"guid": c["guid"], "ok": c["ppc"], "end": _d(c["committedEnd"])} for c in comms]

    def block(items, lo, hi):
        return _ppc_block([i for i in items if i["end"] and lo <= i["end"] <= hi])

    weeks = []
    for mon, sun in _week_spans(today, trend_weeks):
        weeks.append({
            "week": week_key(mon), "start": mon.isoformat(), "end": sun.isoformat(),
            "inWindow": _in(mon, window),
            "planned": block(planned_items, mon, sun),
            "committed": None if committed_items is None else block(committed_items, mon, sun),
        })

    def running(kind):
        """AVERAGEX over the six weeks; a week with nothing planned counts as 0, as in the model."""
        six = [w for w in weeks if w["inWindow"]]
        if not six or all(w[kind] is None or w[kind]["total"] == 0 for w in six):
            return None
        return round(sum((w[kind]["pct"] or 0.0) for w in six) / len(six), 1)

    committed_l6w = None if committed_items is None else block(committed_items, *window)
    basis = "committed" if committed_items else "planned"
    return {
        "window": {"from": window[0].isoformat(), "to": window[1].isoformat()},
        "target": _get(data, "ppc.targetPct", 85),
        "planned": block(planned_items, *window),
        "committed": committed_l6w,
        "plannedAllTime": _ppc_block(planned_items),
        "committedAllTime": None if committed_items is None else _ppc_block(committed_items),
        # the commitment feed itself: rows after Filtered Rows4, data.isAutoCommit, and rows whose
        # activity is not in the task feed (not Construction/Design, or gone): those are "No" in the model
        "commitments": None if comms is None else {
            "rows": len(comms), "auto": sum(1 for c in comms if c["auto"]),
            "unlinked": sum(1 for c in comms if not c["linked"]),
            "activities": len({c["guid"] for c in comms}),
            "weeks": len({c["committedWeek"] for c in comms}),
        },
        "weeks": weeks,
        "running": running(basis) if basis == "committed" else running("planned"),
        "runningBasis": basis,
    }


def activity_kpis(tasks: list, derived: dict, today: date) -> dict:
    window = six_week_window(today)
    l6w = [t for t in tasks if _in(_d(t["plannedEnd"]), window)]
    due = [t for t in l6w if derived[t["guid"]]["dueForPct"]]
    late = [t for t in due if derived[t["guid"]]["delayedForPct"]]
    delays = [derived[t["guid"]]["delayDays"] for t in l6w if derived[t["guid"]]["delayDays"] is not None]
    durations = [t["plannedDuration"] for t in l6w if t["plannedDuration"] is not None]
    per_week: dict[str, int] = {}
    for t in l6w:
        per_week[t["plannedWeek"]] = per_week.get(t["plannedWeek"], 0) + 1
    return {
        "window": {"from": window[0].isoformat(), "to": window[1].isoformat()},
        "tasksInWindow": len(l6w),
        # !!%Activity_Delayed
        "delayedPct": _pct(len(late), len(due)) if l6w else None,
        "delayedCount": len(late),
        "dueCount": len(due),
        # !!Avg_Delay_Durations: ROUNDUP of the mean over delayed tasks; 0 when none are late
        "avgDelayDays": (_roundup(sum(delays) / len(delays)) if delays else 0.0) if l6w else None,
        # !!Avg_Planned_Duration
        "avgPlannedDuration": _round(sum(durations) / len(durations)) if durations else None,
        # !!Avg_Activity_Week: mean tasks per planned week, over weeks that have tasks
        "avgPerWeek": _round(sum(per_week.values()) / len(per_week)) if per_week else None,
        "perWeek": [{"week": k, "count": v} for k, v in sorted(per_week.items())],
    }


def constraint_kpis(rows: list | None, data: dict, today: date) -> dict | None:
    if rows is None:
        return None
    window = six_week_window(today)
    uids = {r["uid"] for r in rows}
    by_uid: "OrderedDict[str, list]" = OrderedDict()
    for r in rows:
        by_uid.setdefault(r["uid"], []).append(r)
    first = {u: rs[0] for u, rs in by_uid.items()}
    l6w_rows = [r for r in rows if _in(_d(r["target"]), window)]
    l6w_uids = {r["uid"] for r in l6w_rows}
    linked = {r["uid"] for r in rows if r["activityGuid"]}

    def done_by(r, limit):
        return r["completion"] is not None and limit is not None and _d(r["completion"]) <= _d(limit)

    on_time_l6w = {r["uid"] for r in l6w_rows if done_by(r, r["target"])}
    before_target = {r["uid"] for r in rows if done_by(r, r["target"])}
    before_start = {r["uid"] for r in rows if r["activityGuid"] and done_by(r, r["taskPlannedStart"])}
    unsuccessful = {r["uid"] for r in rows if r["activityGuid"] and r["target"] and _d(r["target"]) < today
                    and (r["completion"] is None or r["taskPlannedStart"] is None
                         or _d(r["completion"]) > _d(r["taskPlannedStart"]))}
    lags = []
    for u, rs in by_uid.items():
        vals = [(_d(r["completion"]) - _d(r["target"])).days for r in rs if r["completion"] and r["target"]]
        if vals:
            lags.append(max(vals))
    status = OrderedDict((s, 0) for s in ("Open", "Committed", "Closed"))
    for r in first.values():
        status[r["status"]] += 1
    cats: dict[str, int] = {}
    for r in first.values():
        if r["category"]:
            cats[r["category"]] = cats.get(r["category"], 0) + 1
    # Constraints = DISTINCTCOUNT(UniqueID) where category <> BLANK()
    categorised = {r["uid"] for r in rows if r["category"]}
    # #TargetYrWeek / #CreationYrWeek / #completeYrWeek over the trend axis (ISO weeks, like the
    # rest of the port; the model uses WEEKNUM(..., 2) with a 2024-53 patch). One row per constraint.
    weeks = []
    for mon, sun in _week_spans(today, int(_get(data, "ppc.trendWeeks", 12))):
        due = [r for r in first.values() if _in(_d(r["target"]), (mon, sun))]
        on_time = sum(1 for r in due if done_by(r, r["target"]))
        still_open = sum(1 for r in due if r["completion"] is None)
        weeks.append({"week": week_key(mon), "start": mon.isoformat(), "end": sun.isoformat(), "inWindow": _in(mon, window),
                      "due": len(due), "onTime": on_time, "late": len(due) - on_time - still_open, "open": still_open,
                      "created": sum(1 for r in first.values() if _in(_d(r["creation"]), (mon, sun))),
                      "completed": sum(1 for r in first.values() if _in(_d(r["completion"]), (mon, sun)))})
    limit = int(_get(data, "constraints.tableLimit", 15))
    overdue_list = []
    for r in first.values():
        tg = _d(r["target"])
        # overdue: still open (no completion date) and the target date is before today
        if tg and tg < today and r["completion"] is None:
            overdue_list.append({"title": r["title"], "category": r["category"], "status": r["status"],
                                 "owner": r["owner"], "target": r["target"],
                                 "taskName": r["taskName"], "overdueDays": (today - tg).days})
    overdue_list.sort(key=lambda x: (-x["overdueDays"], x["title"]))

    # outcome of each constraint: closed on time / closed late / open, not yet due / open, overdue
    def state(r):
        cp, tg = _d(r["completion"]), _d(r["target"])
        if cp:
            return "closedLate" if tg and cp > tg else "closedOnTime"
        return "openOverdue" if tg and tg < today else "openNotDue"
    states = ("closedOnTime", "closedLate", "openNotDue", "openOverdue")
    split = OrderedDict((k, 0) for k in states)
    for r in first.values():
        split[state(r)] += 1
    unassigned = _get(data, "unassignedLabel", "Unassigned")

    def grouped(key):
        groups: dict[str, dict] = {}
        for r in first.values():
            g = groups.setdefault(key(r) or unassigned, OrderedDict([("label", key(r) or unassigned), ("total", 0)] + [(k, 0) for k in states]))
            g["total"] += 1
            g[state(r)] += 1
        # most open constraints first, then the most raised
        return sorted(groups.values(), key=lambda g: (-(g["openNotDue"] + g["openOverdue"]), -g["total"], g["label"]))
    open_rows = [r for r in first.values() if r["completion"] is None]
    resolve = [(_d(r["completion"]) - _d(r["creation"])).days for r in first.values() if r["completion"] and r["creation"]]
    ages = [(today - _d(r["creation"])).days for r in open_rows if r["creation"]]
    ageing = []
    for lo, hi in _get(data, "constraints.ageBuckets", [[0, 7], [8, 14], [15, 30], [31, 60], [61, None]]):
        ageing.append({"from": lo, "to": hi, "label": "%d+ days" % lo if hi is None else "%d–%d days" % (lo, hi),
                       "count": sum(1 for a in ages if a >= lo and (hi is None or a <= hi))})
    prio_order = _get(data, "constraints.priorityOrder", ["High", "Medium", "Low"])
    prios: dict[str, int] = {}
    for r in first.values():
        k = r["priority"] or "No priority"
        prios[k] = prios.get(k, 0) + 1
    by_priority = sorted(({"label": k, "count": v} for k, v in prios.items()),
                         key=lambda x: (prio_order.index(x["label"]) if x["label"] in prio_order else len(prio_order) + (x["label"] == "No priority"), x["label"]))
    return {
        "window": {"from": window[0].isoformat(), "to": window[1].isoformat()},
        "total": len(uids),
        # open: no completion date
        "open": sum(1 for r in first.values() if r["completion"] is None),
        "status": [{"status": k, "count": v} for k, v in status.items()],
        # !!%Constraints_Overdue: rows, not distinct ids, as COUNT() in the model
        "overduePct": _pct(sum(1 for r in l6w_rows if _d(r["target"]) < today and r["completion"] is None),
                           len(l6w_rows)) if l6w_rows else None,
        # !!ConstraintsResolvedonTIme
        "resolvedOnTimePct": _pct(len(on_time_l6w), len(l6w_uids)) if l6w_uids else None,
        # Unlinked(%)
        "unlinkedPct": _pct(sum(1 for r in rows if not r["activityGuid"]), len(rows)),
        # Avg._Lagtime
        "avgLagDays": _roundup(sum(lags) / len(lags)) if lags else None,
        # Successful_Constraints / %ConstraintsResolved Before PL Start / UnSuccessful Constraints
        "linked": len(linked),
        "beforeStart": len(before_start),
        "beforeStartPct": _pct(len(before_start), len(linked)),
        "unsuccessful": len(unsuccessful),
        # Successful(BeforeTarget) / Unsuccessful(Target)
        "beforeTarget": len(before_target),
        "notBeforeTarget": len(uids) - len(before_target),
        "categorised": len(categorised),
        "byCategory": sorted(({"label": k, "count": v} for k, v in cats.items()), key=lambda x: (-x["count"], x["label"])),
        "weeks": weeks,
        # Delayed Constraint / Delayed by days Constraint
        "overdue": overdue_list[:limit],
        "overdueCount": len(overdue_list),
        "overdueDays": sum(x["overdueDays"] for x in overdue_list),
        "split": dict(split),
        # mean days from creation to completion (closed), and from creation to today (open)
        "avgResolveDays": _round(sum(resolve) / len(resolve)) if resolve else None,
        "avgOpenAgeDays": _round(sum(ages) / len(ages)) if ages else None,
        "ageing": ageing,
        "byPriority": by_priority,
        # the responsible owner and the trade as recorded on the constraint itself
        "byOwner": grouped(lambda r: r["owner"]),
        "byTrade": grouped(lambda r: r["trade"]),
    }


def total_score(inputs: dict, data: dict) -> dict:
    """!!@Total Score: each input is banded to a 20..100 score, then weighted. Inputs that are
    None (feed not configured, nothing in the window) are left out and the remaining weights
    are re-scaled, so a missing feed never scores as perfect."""
    ops = {">=": lambda a, b: a >= b, ">": lambda a, b: a > b, "<=": lambda a, b: a <= b, "<": lambda a, b: a < b}
    comps, used_w = [], 0.0
    for c in _get(data, "score.components", []) or []:
        v = inputs.get(c["key"])
        s = None
        if v is not None:
            s = c.get("else", 20)
            for op, threshold, points in c["bands"]:
                if ops[op](v, threshold):
                    s = points
                    break
            used_w += c["weight"]
        comps.append({"key": c["key"], "label": c["label"], "unit": c.get("unit"), "value": v,
                      "weight": c["weight"], "score": s})
    if used_w <= 0:
        return {"value": None, "remaining": None, "status": None, "tone": "inert", "components": comps,
                "missing": [c["label"] for c in comps], "weightUsed": 0}
    value = sum(c["score"] * c["weight"] for c in comps if c["score"] is not None) / used_w
    value = round(value, 1)
    status, tone = "Red", "bad"
    for threshold, label, t in _get(data, "score.status", [[75, "Green", "good"], [50, "Amber", "warn"]]):
        if value >= threshold:
            status, tone = label, t
            break
    return {"value": value, "remaining": round(100 - value, 1), "status": status, "tone": tone, "components": comps,
            "missing": [c["label"] for c in comps if c["score"] is None], "weightUsed": round(used_w, 2)}


# --------------------------------------------------------------------------- breakdowns

def status_counts(tasks: list, data: dict) -> list[dict]:
    order = _get(data, "status.order", []) or []
    labels = _get(data, "status.labels", {}) or {}
    counts = OrderedDict((s, 0) for s in order)
    for t in tasks:
        s = t["status"] or "Unknown"
        counts[s] = counts.get(s, 0) + 1
    return [{"status": s, "label": labels.get(s, s), "count": c, "share": _pct(c, len(tasks))}
            for s, c in counts.items() if c]


def by_group(tasks: list, derived: dict, model: dict, data: dict, today: date) -> dict:
    """Committed PPC per organisation / trade / location over the L6W: TotalTask, Successful
    Task(C) and UnSuccessful Task(C) grouped by the committed activity's attribute. A commitment
    whose activity is not in the task feed is "Unassigned"."""
    by = _get(data, "groupBy", "organisation")
    top_n = int(_get(data, "breakdown.topN", 10))
    unassigned = _get(data, "unassignedLabel", "Unassigned")
    window = six_week_window(today)
    group_of = {t["guid"]: (t.get(by) or unassigned) for t in tasks}
    groups: "OrderedDict[str, list]" = OrderedDict()
    for c in model["commitments"] or []:
        if _in(_d(c["committedEnd"]), window):
            groups.setdefault(group_of.get(c["guid"], unassigned), []).append({"guid": c["guid"], "ok": c["ppc"]})
    delayed_by: dict[str, int] = {}
    for t in tasks:
        if _in(_d(t["plannedEnd"]), window) and derived[t["guid"]]["delay"]:
            delayed_by[group_of[t["guid"]]] = delayed_by.get(group_of[t["guid"]], 0) + 1
    rows = []
    for g, items in groups.items():
        b = _ppc_block(items)
        b["label"] = g
        b["delayed"] = delayed_by.get(g, 0)
        rows.append(b)
    rows.sort(key=lambda x: (-x["total"], x["label"]))
    label = (_get(data, "groupByLabel", {}) or {}).get(by, by)
    return {"by": by, "byLabel": label, "rows": rows[:top_n], "others": rows[top_n:]}


def _standard_groups(reasons_of_task: list, data: dict) -> list[str]:
    standard_map = _get(data, "reasons.standard", {}) or {}
    uncategorised = _get(data, "reasons.uncategorised", "Uncategorised")
    return sorted({next((g for g, m in standard_map.items() if r in m), uncategorised) for r in reasons_of_task})


def reasons(tasks: list, data: dict) -> dict:
    """Reasons for variance (distinct tasks per category and per raw reason) and variance events."""
    mapping = _get(data, "reasons.categories", {}) or {}
    cats: dict[str, dict] = {}
    with_reason = 0
    for t in tasks:
        if t["reasons"]:
            with_reason += 1
        seen = set()
        for r in t["reasons"]:
            # a reason the model lists but maps to no category comes out null there; "Unmapped" here
            cat = next((c for c, m in mapping.items() if r in m), "Unmapped")
            entry = cats.setdefault(cat, {"label": cat, "tasks": 0, "reasons": {}})
            entry["reasons"][r] = entry["reasons"].get(r, 0) + 1
            if cat not in seen:
                entry["tasks"] += 1
                seen.add(cat)
    out = []
    for c in cats.values():
        out.append({"label": c["label"], "tasks": c["tasks"],
                    "reasons": sorted(({"label": k, "tasks": v} for k, v in c["reasons"].items()), key=lambda x: -x["tasks"])})
    out.sort(key=lambda x: (-x["tasks"], x["label"]))
    events = OrderedDict((label, 0) for _, label in (_get(data, "reasons.events", []) or []))
    for t in tasks:
        for e in t["events"]:
            events[e] = events.get(e, 0) + 1
    # Standard Reason: the coarser SWITCH grouping; a reason in no group is "Uncategorised"
    standard: dict[str, int] = {}
    for t in tasks:
        for g in _standard_groups(t["reasons"], data):
            standard[g] = standard.get(g, 0) + 1
    return {"categories": out, "tasksWithReason": with_reason, "tasks": len(tasks),
            "events": [{"label": k, "tasks": v} for k, v in events.items()],
            "standard": sorted(({"label": k, "tasks": v} for k, v in standard.items()), key=lambda x: (-x["tasks"], x["label"]))}


def delayed_list(tasks: list, derived: dict, data: dict) -> dict:
    limit = int(_get(data, "delayed.tableLimit", 25))
    buckets_cfg = _get(data, "delayed.buckets", [[1, 7], [8, 14], [15, 30], [31, 60], [61, None]])
    late = []
    for t in tasks:
        d = derived[t["guid"]]
        if not d["delay"]:
            continue
        late.append({"id": t["id"], "name": t["name"], "trade": t["trade"], "organisation": t["organisation"],
                     "location": t["location"], "status": t["status"], "plannedStart": t["plannedStart"],
                     "plannedEnd": t["plannedEnd"], "delayDays": d["delayDays"], "kind": d["delayKind"]})
    late.sort(key=lambda x: (-(x["delayDays"] or 0), x["name"]))
    buckets = []
    for lo, hi in buckets_cfg:
        label = ("%d-%d days" % (lo, hi)) if hi is not None else ("%d+ days" % lo)
        n = sum(1 for x in late if x["delayDays"] is not None and x["delayDays"] >= lo and (hi is None or x["delayDays"] <= hi))
        buckets.append({"label": label, "min": lo, "max": hi, "count": n})
    return {"count": len(late), "rows": late[:limit], "more": max(0, len(late) - limit), "buckets": buckets,
            "notStarted": sum(1 for x in late if x["kind"] == "Not started"),
            "notFinished": sum(1 for x in late if x["kind"] == "Not finished")}


def totals(model: dict, derived: dict) -> dict:
    tasks = model["tasks"]
    types: dict[str, int] = {}
    for t in tasks:
        types[t["type"] or "(none)"] = types.get(t["type"] or "(none)", 0) + 1
    return {
        "tasks": len(tasks),                                              # Total Task
        "successful": sum(1 for t in tasks if t["plannedPPC"]),           # Successful Task
        "delayed": sum(1 for t in tasks if derived[t["guid"]]["delay"]),  # Delay Task
        "complete": sum(1 for t in tasks if t["actualEnd"]),
        "byType": [{"type": k, "count": v} for k, v in sorted(types.items(), key=lambda x: -x[1])],
        "noPlannedEnd": sum(1 for t in tasks if not t["plannedEnd"]),
        "noPlannedStart": sum(1 for t in tasks if not t["plannedStart"]),
        "plannedStart": min((t["plannedStart"] for t in tasks if t["plannedStart"]), default=None),
        "plannedEnd": max((t["plannedEnd"] for t in tasks if t["plannedEnd"]), default=None),
        "feedRows": model["feed"]["rows"],
        "historyRows": model["feed"]["historyRows"],
        "excludedByType": model["feed"]["excludedByType"],
        "commitments": None if model["commitments"] is None else len(model["commitments"]),
        "constraints": None if model["constraints"] is None else len({c["uid"] for c in model["constraints"]}),
    }


# --------------------------------------------------------------------------- trade views

def _trade_of(t: dict | None, data: dict) -> str:
    return (t or {}).get("trade") or _get(data, "unassignedLabel", "Unassigned")


def group_performance(model: dict, data: dict, today: date, by: str = "trade") -> dict | None:
    """Committed PPC per group (trade or organisation, the committed activity's attribute) for the
    last complete committed week (the latest committed week ending on or before last Sunday), with
    the week before for comparison. Rows are sorted worst first; tone follows the PPC tolerance
    so the page can single out the groups below it. A commitment whose activity is not in the
    task feed is "Unassigned"."""
    unassigned = _get(data, "unassignedLabel", "Unassigned")
    comms = model["commitments"]
    if comms is None:
        return None
    window = six_week_window(today)
    by_guid = {t["guid"]: t for t in model["tasks"]}
    tol = (_get(data, "tolerance", {}) or {}).get("ppc")
    done = [c for c in comms if _d(c["committedEnd"]) <= window[1]]
    if not done:
        return {"by": by, "week": None, "start": None, "end": None, "previousWeek": None, "overall": None, "previousOverall": None,
                "rows": [], "belowTarget": 0, "critical": 0, "groups": 0}
    last = max(done, key=lambda c: c["committedEnd"])
    mon = week_start(_d(last["committedEnd"]))
    week, prev_week = week_key(mon), week_key(mon - timedelta(days=7))

    def items(wk):
        return [{"guid": c["guid"], "ok": c["ppc"], "group": (by_guid.get(c["guid"]) or {}).get(by) or unassigned}
                for c in comms if c["committedWeek"] == wk]

    cur, prev = items(week), items(prev_week)
    rows = []
    for g in sorted({i["group"] for i in cur}):
        b = _ppc_block([i for i in cur if i["group"] == g])
        pb = _ppc_block([i for i in prev if i["group"] == g])
        delta = None if b["pct"] is None or pb["pct"] is None else round(b["pct"] - pb["pct"], 1)
        rows.append({"label": g, "total": b["total"], "successful": b["successful"], "unsuccessful": b["unsuccessful"],
                     "pct": b["pct"], "previousPct": pb["pct"], "previousTotal": pb["total"], "delta": delta, "tone": rag(b["pct"], tol)})
    rows.sort(key=lambda r: (r["pct"] if r["pct"] is not None else 101, -r["unsuccessful"], r["label"].lower()))
    overall, prev_overall = _ppc_block(cur), _ppc_block(prev)
    return {"by": by, "week": week, "start": mon.isoformat(), "end": (mon + timedelta(days=6)).isoformat(), "previousWeek": prev_week,
            "overall": overall, "previousOverall": prev_overall, "rows": rows, "groups": len(rows),
            "belowTarget": sum(1 for r in rows if r["tone"] in ("warn", "bad")), "critical": sum(1 for r in rows if r["tone"] == "bad")}


def trade_performance(model: dict, data: dict, today: date) -> dict | None:
    return group_performance(model, data, today, "trade")


def reasons_by_trade(model: dict, data: dict, today: date) -> dict | None:
    """Reasons for variance (category) of the activities that missed a commitment in the trend
    window, stacked per trade. The categories are those of the activity's recorded reasons (the
    Reasons for Variance1 mapping); an activity with several counts under each. Activities with
    no recorded reason are left out and only counted ("withoutReason"). Categories beyond the
    top N fold into "Other"."""
    comms = model["commitments"]
    if comms is None:
        return None
    spans = _week_spans(today, int(_get(data, "ppc.trendWeeks", 12)))
    lo, hi = spans[0][0], spans[-1][1]
    by_guid = {t["guid"]: t for t in model["tasks"]}
    top_n = int(_get(data, "reasons.topCategories", 8))
    missed = {c["guid"] for c in comms if not c["ppc"] and _in(_d(c["committedEnd"]), (lo, hi))}
    mapping = _get(data, "reasons.categories", {}) or {}
    cat_count: dict[str, int] = {}
    per_trade: dict[str, dict] = {}
    without = 0
    for g in missed:
        t = by_guid.get(g)
        if not (t and t["reasons"]):
            without += 1
            continue
        cats = sorted({next((c for c, m in mapping.items() if r in m), "Unmapped") for r in t["reasons"]})
        row = per_trade.setdefault(_trade_of(t, data), {"activities": 0, "parts": {}})
        row["activities"] += 1
        for c in cats:
            cat_count[c] = cat_count.get(c, 0) + 1
            row["parts"][c] = row["parts"].get(c, 0) + 1
    ordered = sorted(cat_count.items(), key=lambda x: (-x[1], x[0]))
    keep = [c for c, _ in ordered[:top_n]]
    labels = keep + (["Other"] if len(ordered) > top_n else [])
    rows = []
    for trade, r in per_trade.items():
        parts = {}
        for c, v in r["parts"].items():
            k = c if c in keep else "Other"
            parts[k] = parts.get(k, 0) + v
        rows.append({"trade": trade, "activities": r["activities"],
                     "parts": [{"label": k, "count": parts[k]} for k in labels if parts.get(k)]})
    rows.sort(key=lambda x: (-x["activities"], x["trade"]))
    return {"window": {"from": lo.isoformat(), "to": hi.isoformat()}, "missed": len(missed),
            "activities": len(missed) - without, "withoutReason": without,
            "categories": [{"label": c, "count": v} for c, v in ordered], "labels": labels, "rows": rows}


# --------------------------------------------------------------------------- facts for the page

def facts(model: dict, derived: dict, data: dict, today: date) -> dict:
    """One row per task, commitment and constraint with every derived flag, for the page's
    slicers (Template/scripts/aggregate.js re-aggregates them). Keys are short to keep the page
    small:
      tasks        g guid, id, n name, ty type, st status, o organisation, tr trade, l location,
                   ps/pe planned start/end, as/ae actual start/end, pw planned week, d planned
                   duration, rs reasons, cs reason categories, ss standard groups, ev events,
                   dl Delay, dd DelayDays, dk delay kind, due/late the %Activity_Delayed flags
      commitments  g guid, cw committed week, ce committed end, ok Custom_CommittedPPC, a auto, ln linked
      constraints  u UniqueID, t title, c category, p priority, ow owner, oo owner organisation, l location,
                   tr trade, cr creation, tg target, cm commitment, cp completion, s status,
                   g activity guid, tps linked activity planned start, tn linked activity name"""
    tasks = []
    for t in model["tasks"]:
        d = derived[t["guid"]]
        tasks.append({"g": t["guid"], "id": t["id"], "n": t["name"], "ty": t["type"], "st": t["status"],
                      "o": t["organisation"], "tr": t["trade"], "l": t["location"],
                      "ps": t["plannedStart"], "pe": t["plannedEnd"], "as": t["actualStart"], "ae": t["actualEnd"],
                      "pw": t["plannedWeek"], "d": t["plannedDuration"],
                      "rs": t["reasons"], "cs": t["categories"], "ss": _standard_groups(t["reasons"], data), "ev": t["events"],
                      "dl": d["delay"], "dd": d["delayDays"], "dk": d["delayKind"], "due": d["dueForPct"], "late": d["delayedForPct"]})
    comms = None if model["commitments"] is None else [
        {"g": c["guid"], "cw": c["committedWeek"], "ce": c["committedEnd"], "ok": c["ppc"], "a": c["auto"], "ln": c["linked"]}
        for c in model["commitments"]]
    cons = None if model["constraints"] is None else [
        {"u": r["uid"], "t": r["title"], "c": r["category"], "p": r["priority"], "ow": r["owner"], "oo": r["ownerOrganisation"], "l": r["location"],
         "tr": r["trade"], "cr": r["creation"], "tg": r["target"], "cm": r["commitment"], "cp": r["completion"], "s": r["status"],
         "g": r["activityGuid"], "tps": r["taskPlannedStart"], "tn": r["taskName"]}
        for r in model["constraints"]]
    window = six_week_window(today)
    spans = _week_spans(today, int(_get(data, "ppc.trendWeeks", 12)))
    return {"today": today.isoformat(),
            "window": {"from": window[0].isoformat(), "to": window[1].isoformat()},
            "trend": {"from": spans[0][0].isoformat(), "to": spans[-1][1].isoformat()},
            "tasks": tasks, "commitments": comms, "constraints": cons}


# --------------------------------------------------------------------------- compute

def compute(model: dict, project: dict, data: dict, today: date) -> dict:
    """Everything the page needs, as one JSON-serialisable dict. Pure."""
    if isinstance(model, list):
        model = normalise(model, data)
    tasks = model["tasks"]
    derived = {t["guid"]: _derive(t, today) for t in tasks}
    p = ppc(model, data, today)
    a = activity_kpis(tasks, derived, today)
    c = constraint_kpis(model["constraints"], data, today)
    score = total_score({
        "ppc": p["running"],
        "activityDelayed": a["delayedPct"],
        "constraintsOverdue": c["overduePct"] if c else None,
        "avgDelay": a["avgDelayDays"],
        "plannedDuration": a["avgPlannedDuration"],
        "weeklyPlanned": a["avgPerWeek"],
    }, data)
    tol = _get(data, "tolerance", {}) or {}
    tones = {
        "ppc": rag(p["planned"]["pct"], tol.get("ppc")),
        "ppcCommitted": rag(p["committed"]["pct"] if p["committed"] else None, tol.get("ppc")),
        "ppcRunning": rag(p["running"], tol.get("ppc")),
        "activityDelayed": rag(a["delayedPct"], tol.get("activityDelayed")),
        "avgDelay": rag(a["avgDelayDays"], tol.get("avgDelay")),
        "plannedDuration": rag(a["avgPlannedDuration"], tol.get("plannedDuration")),
        "weeklyPlanned": rag(a["avgPerWeek"], tol.get("weeklyPlanned")),
        "constraintsOverdue": rag(c["overduePct"] if c else None, tol.get("constraintsOverdue")),
        "constraintsOnTime": rag(c["resolvedOnTimePct"] if c else None, tol.get("constraintsOnTime")),
        "constraintLag": rag(c["avgLagDays"] if c else None, tol.get("constraintLag")),
        "unlinked": rag(c["unlinkedPct"] if c else None, tol.get("unlinked")),
    }
    return {
        "today": today.isoformat(),
        "feeds": {"tasks": True, "committed": model["commitments"] is not None, "constraints": model["constraints"] is not None},
        "totals": totals(model, derived),
        "score": score,
        "health": {"label": score["status"] or "Unknown", "tone": score["tone"],
                   "reason": "Total score %s of 100" % score["value"] if score["value"] is not None else "No score: nothing to measure yet"},
        "ppc": p,
        "activity": a,
        "constraints": c,
        "tones": tones,
        "statusCounts": status_counts(tasks, data),
        "breakdown": by_group(tasks, derived, model, data, today),
        "reasons": reasons(tasks, data),
        "delayed": delayed_list(tasks, derived, data),
        "tradePerformance": trade_performance(model, data, today),
        "orgPerformance": group_performance(model, data, today, "organisation"),
        "reasonsByTrade": reasons_by_trade(model, data, today),
        "facts": facts(model, derived, data, today),
    }


def invariants(metrics: dict) -> list[str]:
    """Sanity checks the build runs on every result. Returns a list of problems; empty = fine."""
    problems = []
    t = metrics.get("totals", {})

    def pct_ok(label, v):
        if v is not None and not (0.0 <= v <= 100.0):
            problems.append("%s %.2f outside 0..100" % (label, v))

    p, a, c = metrics.get("ppc", {}), metrics.get("activity", {}), metrics.get("constraints")
    pct_ok("planned PPC", (p.get("planned") or {}).get("pct"))
    pct_ok("committed PPC", (p.get("committed") or {}).get("pct"))
    pct_ok("running PPC", p.get("running"))
    pct_ok("activities delayed", a.get("delayedPct"))
    for w in p.get("weeks", []):
        pct_ok("week %s PPC" % w["week"], w["planned"]["pct"])
        if w["planned"]["successful"] > w["planned"]["total"]:
            problems.append("week %s: successful exceeds total" % w["week"])
    if t.get("successful", 0) > t.get("tasks", 0):
        problems.append("successful tasks exceed tasks")
    if t.get("delayed", 0) > t.get("tasks", 0):
        problems.append("delayed tasks exceed tasks")
    if sum(x["count"] for x in metrics.get("statusCounts", [])) != t.get("tasks", 0):
        problems.append("status counts do not add up to tasks")
    if metrics.get("delayed", {}).get("count") != t.get("delayed"):
        problems.append("delayed list and Delay Task disagree")
    s = (metrics.get("score") or {}).get("value")
    if s is not None and not (20.0 <= s <= 100.0):
        problems.append("total score %.1f outside 20..100" % s)
    if c:
        for k in ("overduePct", "resolvedOnTimePct", "unlinkedPct", "beforeStartPct"):
            pct_ok("constraints " + k, c.get(k))
        if sum(x["count"] for x in c["status"]) != c["total"]:
            problems.append("constraint statuses do not add up to total")
        if c.get("categorised", 0) > c["total"] or c.get("beforeTarget", 0) > c["total"] or c.get("open", 0) > c["total"]:
            problems.append("a constraint count exceeds the total")
        if "split" in c and sum(c["split"].values()) != c["total"]:
            problems.append("constraint outcomes (closed on time / late, open not due / overdue) do not add up to total")
        if "split" in c and c["split"]["openNotDue"] + c["split"]["openOverdue"] != c["open"]:
            problems.append("open constraint outcomes do not add up to the open count")
        if "ageing" in c and sum(b["count"] for b in c["ageing"]) > c["open"]:
            problems.append("constraint ageing counts more than the open constraints")
        for g in c.get("byOwner", []) + c.get("byTrade", []):
            if sum(g[k] for k in ("closedOnTime", "closedLate", "openNotDue", "openOverdue")) != g["total"]:
                problems.append("constraint group %s: outcomes do not add up to its total" % g["label"])
        for w in c.get("weeks", []):
            if w["onTime"] + w["late"] + w["open"] != w["due"] or min(w["onTime"], w["late"], w["open"]) < 0:
                problems.append("constraint week %s: on time + late + open != due" % w["week"])
    ca = p.get("committedAllTime")
    if ca and (ca["successful"] > ca["total"] or ca["unsuccessful"] > ca["total"]):
        problems.append("committed successful/unsuccessful exceed total")
    cm = p.get("commitments")
    if cm and (cm["unlinked"] > cm["rows"] or cm["auto"] > cm["rows"]):
        problems.append("commitment feed counts exceed rows")
    for key in ("tradePerformance", "orgPerformance"):
        tp = metrics.get(key)
        if not tp:
            continue
        for r in tp["rows"]:
            pct_ok("%s %s committed PPC" % (tp["by"], r["label"]), r["pct"])
            if r["successful"] > r["total"] or r["unsuccessful"] > r["total"]:
                problems.append("%s %s: kept/missed exceed total" % (tp["by"], r["label"]))
        if tp["overall"] and sum(r["total"] for r in tp["rows"]) < tp["overall"]["total"]:
            problems.append("%s rows cover fewer activities than the week total" % tp["by"])
    rb = metrics.get("reasonsByTrade")
    if rb and sum(r["activities"] for r in rb["rows"]) != rb["activities"]:
        problems.append("reasons by trade: trade rows do not add up to missed activities")
    f = metrics.get("facts")
    if f and len(f["tasks"]) != t.get("tasks"):
        problems.append("facts tasks and Total Task disagree")
    return problems
