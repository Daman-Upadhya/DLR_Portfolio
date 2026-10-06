# -*- coding: utf-8 -*-
"""Validation gate: configs, manifests, and the built site. Exit 1 on any failure.

    python -m build validate      after a build; CI runs this before uploading dist/
    python -m build selftest      calculation.py against the sample export and a hand-checked case

Failures stop a deploy. Warnings are printed and do not.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import date

from . import DEFAULTS_FILE, DIST_DIR, ROOT, SAMPLE_DIR, TEMPLATE_DIR
from . import manifest as M
from .fetch import secret_name

GUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,30}$")
PAGE_FORBIDDEN = (
    ("accessToken", re.compile(r"accesstoken", re.I)),
    ("Bearer token", re.compile(r"Bearer\s+[A-Za-z0-9._-]{8,}")),
    ("long hex string (token-like)", re.compile(r"(?<![0-9a-zA-Z])[0-9a-fA-F]{32,}(?![0-9a-zA-Z])")),
    ("e-mail address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("unfilled template slot", re.compile(r"\{\{[A-Z][A-Z0-9_]*\}\}")),
)
PAGE_WARN = (
    ("GUID", re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")),
)


class Report:
    def __init__(self):
        self.fails, self.warns = [], []

    def fail(self, msg):
        self.fails.append(msg)
        print("FAIL  " + msg)

    def warn(self, msg):
        self.warns.append(msg)
        print("WARN  " + msg)

    def ok(self, msg):
        print("ok    " + msg)


def _read_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _projects():
    out = []
    for name in sorted(os.listdir(ROOT)):
        pdir = os.path.join(ROOT, name)
        if os.path.isdir(pdir) and not name.startswith((".", "_")) and os.path.exists(os.path.join(pdir, "project.json")):
            out.append((name, pdir))
    return out


# ----------------------------------------------------------------------------- configs

def check_project(name, pdir, r: Report):
    try:
        cfg = _read_json(os.path.join(pdir, "project.json"))
    except Exception as e:  # noqa: BLE001
        r.fail("%s/project.json is not valid JSON: %s" % (name, e))
        return None
    if not KEY_RE.match(name):
        r.fail("%s: folder name must match %s" % (name, KEY_RE.pattern))
    if cfg.get("key", name) != name:
        r.fail("%s/project.json: key %r must equal the folder name" % (name, cfg.get("key")))
    if not cfg.get("title"):
        r.warn("%s/project.json: no title; the pages will show %r" % (name, name))
    pid = cfg.get("projectId")
    if not pid:
        r.fail("%s/project.json: missing projectId (the VisiLean project GUID)" % name)
    elif not GUID_RE.match(str(pid)):
        r.fail("%s/project.json: projectId is not a GUID" % name)
    if pid == "00000000-0000-0000-0000-000000000000":
        r.warn("%s/project.json: projectId is the placeholder; set it before a live build" % name)
    from .build import with_defaults
    cfg = with_defaults({**cfg, "key": name}, _read_json(DEFAULTS_FILE))
    src = cfg.get("source") or {}
    base = src.get("baseUrl") or ""
    if base and not base.startswith("https://"):
        r.fail("%s/project.json: source.baseUrl must be https" % name)
    for f in cfg.get("facts") or []:
        if not isinstance(f, dict) or "label" not in f or "value" not in f:
            r.fail("%s/project.json: every fact needs label and value (value may be null)" % name)
            break
    text = json.dumps(_read_json(os.path.join(pdir, "project.json")))
    if "accessToken" in text or re.search(r"(?<![0-9a-zA-Z])[0-9a-fA-F]{32,}(?![0-9a-zA-Z])", text):
        r.fail("%s/project.json: looks like it contains a token. Tokens live in secrets, never in config" % name)
    return cfg


def check_manifest(name, pdir, r: Report):
    p = os.path.join(pdir, "manifest.json")
    if not os.path.exists(p):
        return  # optional: the build uses the default dependencies
    try:
        m = _read_json(p)
    except Exception as e:  # noqa: BLE001
        r.fail("%s/manifest.json is not valid JSON: %s" % (name, e))
        return
    if m.get("page") != name:
        r.fail("%s/manifest.json: page must be %r" % (name, name))
    for dep, default_ref in M.DEPENDENCIES:
        ref = (m.get(dep) or {}).get("ref") or default_ref
        if not os.path.exists(os.path.join(ROOT, ref)):
            r.fail("%s/manifest.json: %s ref %s does not exist" % (name, dep, ref))
    for k, rel in (m.get("overrides") or {}).items():
        if rel and not os.path.exists(os.path.join(pdir, rel)):
            r.fail("%s/manifest.json: override %s -> %s does not exist" % (name, k, rel))
    drift = M.drift(m, M.current_hashes(m, M.resolve_overrides(pdir, m)))
    for d in drift:
        r.warn("%s: manifest drift - %s" % (name, d))


# ----------------------------------------------------------------------------- site

def scan_page(path, r: Report, extra_forbidden):
    with open(path, encoding="utf-8") as f:
        page = f.read()
    rel = os.path.relpath(path, ROOT)
    for label, rx in PAGE_FORBIDDEN:
        m = rx.search(page)
        if m:
            r.fail("%s contains %s (%r...)" % (rel, label, m.group(0)[:16]))
    for label, rx in PAGE_WARN:
        if rx.search(page):
            r.warn("%s contains a %s; make sure it is not a project id" % (rel, label))
    low = page.lower()
    for s in extra_forbidden:
        if s and s.lower() in low:
            r.fail("%s contains forbidden string %r" % (rel, s[:16]))
    for needle in ("src=\"http", "href=\"http", "@import", "fetch(", "XMLHttpRequest"):
        if needle in page:
            r.fail("%s has an external reference or network call (%s); pages must be self-contained" % (rel, needle))
    if 'id="data"' not in page:
        r.fail("%s has no embedded data element" % rel)
    return page


def check_site(configs, r: Report, scope: str = "all", only: list[str] | None = None):
    """scope "all": the landing page and every project page (a local build --all).
    scope "project": only the pages in `only` (a project refresh; the landing page comes later).
    scope "landing": the landing page, and that it links every project already published."""
    if not os.path.isdir(DIST_DIR):
        r.fail("dist/ does not exist; run `python -m build build` first")
        return
    if scope != "project":
        for f in ("index.html", ".nojekyll"):
            if not os.path.exists(os.path.join(DIST_DIR, f)):
                r.fail("dist/%s missing" % f)
    hosts, ids = [], []
    for cfg in configs:
        base = ((cfg.get("source") or {}).get("baseUrl")) or ""
        if base:
            hosts.append(re.sub(r"^https?://", "", base).split("/")[0])
        if cfg.get("projectId"):
            ids.append(str(cfg["projectId"]))
    extra = hosts + ids
    landing = None
    if scope != "project" and os.path.exists(os.path.join(DIST_DIR, "index.html")):
        landing = scan_page(os.path.join(DIST_DIR, "index.html"), r, extra)
    if scope == "landing":
        built = [c for c in configs if os.path.exists(os.path.join(DIST_DIR, c["key"], "build.json"))]
        for cfg in built:
            if landing is not None and ('"href":"./%s/"' % cfg["key"]) not in landing:
                r.fail("landing page does not link to %s" % cfg["key"])
        r.ok("landing: links %d published project(s)" % len(built))
        return
    if scope == "project":
        wanted = {k.lower() for k in only or []}
        configs = [c for c in configs if c["key"].lower() in wanted]
    for cfg in configs:
        key = cfg["key"]
        page = os.path.join(DIST_DIR, key, "index.html")
        bj = os.path.join(DIST_DIR, key, "build.json")
        if not os.path.exists(page):
            r.fail("dist/%s/index.html missing - a project must never be dropped from the site" % key)
            continue
        scan_page(page, r, extra)
        if not os.path.exists(bj):
            r.fail("dist/%s/build.json missing" % key)
        else:
            s = _read_json(bj)
            if s.get("state") == "unavailable":
                r.warn("%s: built without data (%s)" % (key, (s.get("error") or "no data")[:120]))
            if s.get("tokenRejected"):
                r.warn("%s: token rejected - fix secret %s or its VL_TOKENS_JSON entry" % (key, secret_name(key)))
        if landing is not None and ('"href":"./%s/"' % key) not in landing:
            r.fail("landing page does not link to %s" % key)
    r.ok("site: %d project page(s) checked" % len(configs))


# ----------------------------------------------------------------------------- entry points

def main(scope: str = "all", only: list[str] | None = None) -> int:
    r = Report()
    configs = []
    for name, pdir in _projects():
        cfg = check_project(name, pdir, r)
        if cfg:
            cfg["key"] = name
            configs.append(cfg)
        check_manifest(name, pdir, r)
    if not configs:
        r.warn("no project folders found")
    for f in ("calculation.py", "Dashboard.html", "Landing.html", "dashboard_data.json", "tokens.css",
              "scripts/charts.js", "scripts/aggregate.js", "scripts/app.js",
              "assets/logo-visilean.png", "assets/logo-digital-realty.png"):
        if not os.path.exists(os.path.join(TEMPLATE_DIR, f)):
            r.fail("Template/%s missing" % f)
    check_site(configs, r, scope, only)
    print("\n%d failure(s), %d warning(s)" % (len(r.fails), len(r.warns)))
    return 1 if r.fails else 0


def _synthetic():
    """A hand-checked case for the parts the sample cannot exercise (commitments, constraints).
    today = Thu 1 Oct 2026 -> last six weeks = Mon 17 Aug .. Sun 27 Sep 2026."""
    def t(guid, ttype, ps, pe, as_=" ", ae=" ", hist="", dur="5", status="Complete"):
        return {"guid": guid, "taskId": guid, "taskName": "Task " + guid, "taskType": ttype, "status": status,
                "organisation": "Org", "trade": "Trade", "plannedStartDate": ps, "plannedEndDate": pe,
                "actualStartDate": as_, "actualEndDate": ae, "plannedDuration": dur, "activityHistory": hist}
    tasks = [
        t("A", "Construction", "14/09/2026 00:00:00", "18/09/2026 00:00:00", "14/09/2026 00:00:00", "18/09/2026 00:00:00"),
        t("A", "Construction", "14/09/2026 00:00:00", "18/09/2026 00:00:00", "14/09/2026 00:00:00", "18/09/2026 00:00:00",
          hist="Task 'A' started on time by X."),
        t("B", "Construction", "14/09/2026 00:00:00", "18/09/2026 00:00:00", "15/09/2026 00:00:00", "23/09/2026 00:00:00",
          hist="Task 'B' completed late by X. Note added:  Labour shortfall"),
        t("C", "Construction", "21/09/2026 00:00:00", "25/09/2026 00:00:00", status="Ready"),
        t("D", "Design", "05/10/2026 00:00:00", "09/10/2026 00:00:00", status="Not Ready"),
        t("M", "Start Milestone", "01/09/2026 00:00:00", None),
    ]
    committed = [  # the nested feed shape: one record per commit batch, guids as a list
        {"isAutoCommit": True, "commitDetails": [
            {"committedTimestamp": "2026-09-11T08:00:00Z", "committedStartDate": "2026-09-14", "committedEndDate": "2026-09-18", "activitiesGuid": ["A", "B"]},
            {"committedTimestamp": None, "committedStartDate": "2026-09-21", "committedEndDate": "2026-09-25", "activitiesGuid": ["D"]},
        ]},
        # a flat row (one activity per row) is accepted too
        {"activitiesGuid": "C", "isAutoCommit": False, "committedTimestamp": "2026-09-18T08:00:00Z", "committedEndDate": "2026-09-25"},
    ]
    constraints = [
        {"constrainId": 1, "title": "K1", "category": "Design", "activityGuid": "A,B", "targetDate": "10/09/2026 00:00:00",
         "commitmentDate": "01/09/2026 00:00:00", "completionDate": "09/09/2026 00:00:00",
         "creationDate": "01/09/2026 00:00:00", "owner": "Person A", "ownerOrganisation": "Org A", "priority": "Medium", "trade": "T1"},
        {"constrainId": 2, "title": "K2", "category": "Approvals", "activityGuid": "C", "targetDate": "20/09/2026 00:00:00",
         "commitmentDate": "15/09/2026 00:00:00", "completionDate": None,
         "creationDate": "14/09/2026 00:00:00", "owner": "Person A", "ownerOrganisation": "Org A", "priority": "High", "trade": "T1"},
        {"constrainId": 3, "title": "K3", "category": "Materials", "activityGuid": "", "targetDate": "20/10/2026 00:00:00",
         "commitmentDate": None, "completionDate": None, "creationDate": "21/09/2026 00:00:00"},
    ]
    expected = {
        "tasks": ("totals.tasks", 4), "delay task": ("totals.delayed", 1),
        "planned PPC": ("ppc.planned.pct", 33.3), "committed PPC": ("ppc.committed.pct", 33.3),
        "6-week running PPC": ("ppc.running", 8.3), "activities delayed": ("activity.delayedPct", 33.3),
        "avg delay days": ("activity.avgDelayDays", 10.0), "avg planned duration": ("activity.avgPlannedDuration", 5.0),
        "avg activities per week": ("activity.avgPerWeek", 1.5),
        "constraints total": ("constraints.total", 3), "constraints open": ("constraints.open", 2),
        "constraints overdue": ("constraints.overduePct", 33.3), "resolved on time": ("constraints.resolvedOnTimePct", 50.0),
        "unlinked": ("constraints.unlinkedPct", 25.0), "avg lag": ("constraints.avgLagDays", -1.0),
        "before planned start": ("constraints.beforeStartPct", 50.0), "unsuccessful": ("constraints.unsuccessful", 1),
        "category clean-up": ("constraints.byCategory.-1.label", "Material"),
        "total score": ("score.value", 34.0), "score status": ("score.status", "Red"), "remaining score": ("score.remaining", 66.0),
        "reason category": ("reasons.categories.0.label", "Labour shortfall"),
        "standard reason": ("reasons.standard.0.label", "Labour / Resources"),
        # Successful Task(C) / UnSuccessful Task(C) / TotalTask: D has no timestamp and is filtered out
        "committed total": ("ppc.committedAllTime.total", 3), "committed kept": ("ppc.committedAllTime.successful", 1),
        "committed missed": ("ppc.committedAllTime.unsuccessful", 2),
        "commitment rows": ("ppc.commitments.rows", 3), "auto commitments": ("ppc.commitments.auto", 2),
        "unlinked commitments": ("ppc.commitments.unlinked", 0),
        "constraints categorised": ("constraints.categorised", 3),
        # weeks: 12 complete weeks ending Sun 27 Sep; index 9 = Mon 7 Sep (K1 due 10/09, closed 09/09),
        # index 10 = Mon 14 Sep (K2 due 20/09, still open); K3 is due in October, off the axis
        "constraints due W37": ("constraints.weeks.9.due", 1), "on time W37": ("constraints.weeks.9.onTime", 1),
        "constraints open W38": ("constraints.weeks.10.open", 1), "created W37": ("constraints.weeks.9.created", 0),
        "overdue days": ("constraints.overdueDays", 11),
        # K1 closed on time (created 1 Sep, done 9 Sep: 8 days); K2 open past its 20 Sep target (17 days old);
        # K3 open, due in October (10 days old)
        "closed on time": ("constraints.split.closedOnTime", 1), "closed late": ("constraints.split.closedLate", 0),
        "open not due": ("constraints.split.openNotDue", 1), "open overdue": ("constraints.split.openOverdue", 1),
        "avg resolve days": ("constraints.avgResolveDays", 8.0), "avg open age": ("constraints.avgOpenAgeDays", 13.5),
        "ageing 8-14": ("constraints.ageing.1.count", 1), "ageing 15-30": ("constraints.ageing.2.count", 1),
        "ageing 0-7": ("constraints.ageing.0.count", 0),
        "priority first": ("constraints.byPriority.0.label", "High"),
        "owner top": ("constraints.byOwner.0.label", "Person A"), "owner open": ("constraints.byOwner.0.openOverdue", 1),
        "trade top": ("constraints.byTrade.0.label", "T1"), "trade total": ("constraints.byTrade.0.total", 2),
        "overdue owner": ("constraints.overdue.0.owner", "Person A"),
        "unassigned owner": ("constraints.byOwner.1.label", "Unassigned"),
        "completed W37": ("constraints.weeks.9.completed", 1),
    }
    return {"tasks": tasks, "committed": committed, "constraints": constraints}, expected


def _pick(obj, path):
    for part in path.split("."):
        obj = obj[int(part)] if isinstance(obj, list) else obj[part]
    return obj


def selftest() -> int:
    """calculation.py against the sample export and against a hand-checked synthetic case."""
    import gzip
    import importlib.util
    spec = importlib.util.spec_from_file_location("dlr_calculation", os.path.join(TEMPLATE_DIR, "calculation.py"))
    calc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(calc)
    data = _read_json(os.path.join(TEMPLATE_DIR, "dashboard_data.json"))
    today = date(2026, 10, 1)  # the day the sample was exported
    ok = True

    def check(label, passed, detail=""):
        nonlocal ok
        print(("ok    " if passed else "FAIL  ") + label + (("  " + detail) if detail and not passed else ""))
        ok &= bool(passed)

    fixture = os.path.join(SAMPLE_DIR, "P1.tasks.json.gz")
    with gzip.open(fixture, "rt", encoding="utf-8") as f:
        raw = json.load(f)
    feeds = {"tasks": raw}
    for name in ("committed", "constraints"):
        fp = os.path.join(SAMPLE_DIR, "P1.%s.json" % name)
        if os.path.exists(fp):
            with open(fp, encoding="utf-8") as f:
                payload = json.load(f)
            feeds[name] = payload["data"] if isinstance(payload, dict) and isinstance(payload.get("data"), list) else payload
    model = calc.normalise(feeds, data)
    m = calc.compute(model, {"key": "P1"}, data, today)
    problems = calc.invariants(m)
    tasks_only = calc.compute(calc.normalise({"tasks": raw}, data), {"key": "P1"}, data, today)
    check("sample: tasks de-duplicated by guid", m["totals"]["tasks"] == len({r["guid"] for r in raw if r.get("taskType") in data["taskTypes"]}))
    check("sample: only Construction and Design", {t["type"] for t in model["tasks"]} <= set(data["taskTypes"]))
    check("sample: weekly PPC has %d weeks" % data["ppc"]["trendWeeks"], len(m["ppc"]["weeks"]) == data["ppc"]["trendWeeks"])
    check("sample: six weeks in the window", sum(w["inWindow"] for w in m["ppc"]["weeks"]) == 6)
    check("sample: score computed", m["score"]["value"] is not None)
    check("sample: reporting date is the Monday after the last committed week (W40 -> 5 Oct)",
          "committed" not in feeds or calc.reporting_date(model) == date(2026, 10, 5), str(calc.reporting_date(model)))
    check("sample: no commitment feed -> no reporting date", calc.reporting_date(calc.normalise({"tasks": raw}, data)) is None)
    check("sample: project status from the task feed", calc.project_status(model) == "Started", str(calc.project_status(model)))
    check("sample: missing feeds come out None", tasks_only["constraints"] is None and tasks_only["ppc"]["committed"] is None)
    if "committed" in feeds:
        rows = sum(len(d.get("activitiesGuid") or []) for r in feeds["committed"] for d in r.get("commitDetails", []) if d.get("committedTimestamp"))
        check("sample: commitment feed expanded to one row per activity", m["ppc"]["commitments"]["rows"] == rows, "got %r want %r" % (m["ppc"]["commitments"]["rows"], rows))
        check("sample: committed PPC computed on the committed basis", m["ppc"]["runningBasis"] == "committed" and m["ppc"]["committed"]["pct"] is not None)
        check("sample: committed weeks within the window", all(w["committed"] is not None for w in m["ppc"]["weeks"]))
    if "constraints" in feeds:
        check("sample: constraints de-duplicated by id", m["constraints"]["total"] == len({r["constrainId"] for r in feeds["constraints"]}))
        check("sample: constraints-overdue score component present", "Constraints overdue" not in m["score"]["missing"])
        check("sample: constraint weeks has %d weeks" % data["ppc"]["trendWeeks"], len(m["constraints"]["weeks"]) == data["ppc"]["trendWeeks"])
    check("sample: delayed rows sorted", all((a["delayDays"] or 0) >= (b["delayDays"] or 0) for a, b in zip(m["delayed"]["rows"], m["delayed"]["rows"][1:])))
    check("sample: json serialisable", json.dumps(m) is not None)
    check("sample: invariants", not problems, "; ".join(problems))

    feeds, expected = _synthetic()
    s = calc.compute(calc.normalise(feeds, data), {"key": "x"}, data, today)
    for label, (path, want) in expected.items():
        got = _pick(s, path)
        check("synthetic: %s = %r" % (label, want), got == want, "got %r" % (got,))
    check("synthetic: invariants", not calc.invariants(s), "; ".join(calc.invariants(s)))

    e = calc.compute(calc.normalise({"tasks": []}, data), {"key": "x"}, data, today)
    check("empty feed handled", e["totals"]["tasks"] == 0 and e["score"]["value"] is None and not calc.invariants(e))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
