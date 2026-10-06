# -*- coding: utf-8 -*-
"""The Build Process. For each P<key>/ folder:

    project.json + manifest.json
        -> fetch_raw (live | cache | sample)
        -> calculation.normalise(feeds, data) -> calculation.compute
        -> optional overrides/extra_calc.extend
        -> inject into Template/Dashboard.html
        -> dist/<key>/index.html + dist/<key>/build.json

then the landing page from every build.json -> dist/index.html, plus dist/.nojekyll.

A project is never dropped from dist: GitHub Pages replaces the whole site on deploy, so a
missing folder would turn a client's URL into a 404. A project without data gets an
"unavailable" page instead.
"""
from __future__ import annotations

import base64
import copy
import importlib.util
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

from . import DEFAULTS_FILE, DIST_DIR, ROOT, TEMPLATE_DIR
from . import fetch as F
from . import inject as I
from . import manifest as M

IST = timezone(timedelta(hours=5, minutes=30))
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,30}$")
PRIVATE_KEYS = ("_comment",)


def log(msg: str) -> None:
    print(msg, flush=True)


# ----------------------------------------------------------------------------- loading

def load_calculation():
    """Import Template/calculation.py by path so the Template folder stays a plain folder."""
    path = os.path.join(TEMPLATE_DIR, "calculation.py")
    spec = importlib.util.spec_from_file_location("dlr_calculation", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_override_logic(path: str):
    spec = importlib.util.spec_from_file_location("dlr_extra_calc_" + re.sub(r"\W", "_", path), path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if not hasattr(mod, "extend"):
        raise RuntimeError("%s has no extend(metrics, model, project, today) function" % path)
    return mod


def read_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def read_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def strip_private(obj):
    """Drop _comment keys (and anything starting with _) before embedding."""
    if isinstance(obj, dict):
        return {k: strip_private(v) for k, v in obj.items() if not str(k).startswith("_")}
    if isinstance(obj, list):
        return [strip_private(v) for v in obj]
    return obj


def deep_merge(base, over):
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            out[k] = deep_merge(base.get(k), v) if k in base else v
        return out
    return copy.deepcopy(over) if over is not None else base


def discover_projects(only: list[str] | None = None) -> list[dict]:
    """Every top-level folder that holds a project.json is a project. Sorted by order, then key."""
    found = []
    defaults = read_json(DEFAULTS_FILE)
    for name in sorted(os.listdir(ROOT)):
        pdir = os.path.join(ROOT, name)
        pj = os.path.join(pdir, "project.json")
        if not os.path.isdir(pdir) or name.startswith((".", "_")) or not os.path.exists(pj):
            continue
        own = read_json(pj)
        own.setdefault("key", name)
        if own["key"] != name:
            raise SystemExit("%s/project.json: key %r must equal the folder name" % (name, own["key"]))
        if not KEY_RE.match(name):
            raise SystemExit("%s: folder name must match %s" % (name, KEY_RE.pattern))
        cfg = with_defaults(own, defaults)
        cfg["_dir"] = pdir
        found.append(cfg)
    if only:
        wanted = {k.lower() for k in only}
        found = [p for p in found if p["key"].lower() in wanted]
        missing = wanted - {p["key"].lower() for p in found}
        if missing:
            raise SystemExit("no such project folder: %s" % ", ".join(sorted(missing)))
    found.sort(key=project_sort_key)
    return found


def natural(key: str) -> list:
    """P2 before P10: digit runs compare as numbers."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", key)]


def project_sort_key(p: dict):
    """order when set, otherwise the folder name in natural order."""
    return (p.get("order", 1000), natural(p["key"]))


def with_defaults(own: dict, defaults: dict) -> dict:
    """project.json over build/project_defaults.json. Objects merge key by key; facts merge by
    label, keeping the default order and appending labels only the project has; {key} in a
    default string becomes the folder name. title defaults to the key, the Project fact to the
    title."""
    key = own["key"]

    def fill(v):
        if isinstance(v, str):
            return v.replace("{key}", key)
        if isinstance(v, dict):
            return {k: fill(x) for k, x in v.items()}
        if isinstance(v, list):
            return [fill(x) for x in v]
        return v
    base = fill(copy.deepcopy(defaults))
    cfg = deep_merge(base, {k: v for k, v in own.items() if k != "facts"})
    cfg["title"] = own.get("title") or key
    facts = [dict(f) for f in base.get("facts") or []]
    labels = {f["label"]: f for f in facts}
    for f in own.get("facts") or []:
        if f.get("label") in labels:
            labels[f["label"]]["value"] = f.get("value")
        else:
            facts.append(dict(f))
    for f in facts:
        if f["label"] == "Project" and not f.get("value"):
            f["value"] = cfg["title"]
    cfg["facts"] = facts
    return cfg


def resolve_today(origin: str, model: dict, run_date: date, data_as_of: str | None, calc) -> tuple[date, str]:
    """The date the measures are computed for, worked out on every refresh:
    live    the run date: the feed was read just now
    cache   the day the cached copy was fetched
    sample  the Monday after the latest committed week in the export's commitment feed
    A snapshot without commitments falls back to the run date."""
    if origin == "live":
        return run_date, "run date"
    if origin == "cache" and data_as_of:
        return datetime.fromisoformat(data_as_of).astimezone(IST).date(), "cache fetch date"
    d = calc.reporting_date(model)
    if d:
        return d, "week after the last committed week"
    return run_date, "run date (no commitments in the snapshot)"


def fill_derived_facts(cfg: dict, model: dict, calc) -> None:
    """Facts the data can answer, when project.json leaves them empty: Status."""
    for f in cfg.get("facts") or []:
        if f["label"] == "Status" and not f.get("value"):
            f["value"] = calc.project_status(model)


def public_project(cfg: dict) -> dict:
    """What the page may know about the project: never projectId, never source."""
    return {"key": cfg["key"], "title": cfg.get("title") or cfg["key"], "client": cfg.get("client"),
            "order": cfg.get("order"), "facts": strip_private(cfg.get("facts") or [])}


def forbidden_strings(cfg: dict) -> list[str]:
    out = []
    if cfg.get("projectId"):
        out.append(str(cfg["projectId"]))
    base = ((cfg.get("source") or {}).get("baseUrl")) or ""
    if base:
        host = re.sub(r"^https?://", "", base).split("/")[0]
        if host:
            out.append(host)
    for tok, _ in F.token_candidates(cfg["key"]) if _safe_tokens(cfg["key"]) else []:
        out.append(tok)
    return out


def _safe_tokens(key: str) -> bool:
    try:
        F.token_candidates(key)
        return True
    except F.TokenMissing:
        return False


# ----------------------------------------------------------------------------- assets

class Assets:
    def __init__(self):
        self.tokens_css = read_text(os.path.join(TEMPLATE_DIR, "tokens.css"))
        self.charts_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "charts.js"))
        self.aggregate_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "aggregate.js"))
        self.app_js = read_text(os.path.join(TEMPLATE_DIR, "scripts", "app.js"))
        self.dashboard = read_text(os.path.join(TEMPLATE_DIR, "Dashboard.html"))
        self.landing = read_text(os.path.join(TEMPLATE_DIR, "Landing.html"))
        # header logos: PNG files embedded as data URIs, so every page stays one self-contained file
        self.logos = {key: png_data_uri(os.path.join(TEMPLATE_DIR, "assets", name))
                      for key, name in (("LOGO_VISILEAN", "logo-visilean.png"), ("LOGO_DLR", "logo-digital-realty.png"))}
        self.data = read_json(os.path.join(TEMPLATE_DIR, "dashboard_data.json"))
        self.logic_hash = M.sha256_file(os.path.join(TEMPLATE_DIR, "calculation.py"))
        self.calc = load_calculation()


def png_data_uri(path: str) -> str:
    with open(path, "rb") as f:
        raw = f.read()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("%s is not a PNG file" % path)
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


def fmt_when(dt: datetime) -> str:
    return "%d %s %d, %02d:%02d IST" % (dt.day, dt.strftime("%b"), dt.year, dt.hour, dt.minute)


def write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


# ----------------------------------------------------------------------------- one project

def build_project(cfg: dict, assets: Assets, mode: str, today: date, now: datetime,
                  write_manifest: bool = False) -> dict:
    key = cfg["key"]
    pdir = cfg["_dir"]
    man = M.load(pdir, key)
    overrides = M.resolve_overrides(pdir, man)
    hashes = M.current_hashes(man, overrides)
    for d in M.drift(man, hashes):
        log("%s: manifest drift - %s" % (key, d))

    # merged template data: Template defaults <- project.display <- overrides/data.json
    data = deep_merge(assets.data, cfg.get("display") or {})
    if overrides["data"]:
        data = deep_merge(data, read_json(overrides["data"]))

    now_iso = now.isoformat(timespec="seconds")
    state, origin, data_as_of, rows, metrics, error, token_rejected = "fresh", None, None, [], None, None, False
    try:
        origin, feeds, data_as_of = F.fetch_raw(cfg, mode, now_iso, log)
        rows = assets.calc.normalise(feeds, data)
        today, basis = resolve_today(origin, rows, today, data_as_of, assets.calc)
        log("%s: today = %s (%s)" % (key, today.isoformat(), basis))
        fill_derived_facts(cfg, rows, assets.calc)
        metrics = assets.calc.compute(rows, cfg, data, today)
        if overrides["logic"]:
            metrics = load_override_logic(overrides["logic"]).extend(metrics, rows, cfg, today)
        problems = assets.calc.invariants(metrics)
        if problems:
            raise RuntimeError("metric invariants failed: " + "; ".join(problems))
        if origin == "cache":
            state = "stale"
    except F.TokenRejected as e:
        token_rejected, state, error = True, "unavailable", str(e)
        log("::error title=%s token rejected::%s" % (key, e))
        cached = F.read_cache(key)
        if cached:
            data_as_of, rows = cached[0], assets.calc.normalise(cached[1], data)
            today, _ = resolve_today("cache", rows, today, data_as_of, assets.calc)
            fill_derived_facts(cfg, rows, assets.calc)
            metrics, state, origin = assets.calc.compute(rows, cfg, data, today), "stale", "cache"
    except F.Unreachable as e:
        state, error = "unavailable", str(e)
        log("::warning title=%s no data::%s" % (key, e))

    build_id = M.short(M.sha256_text(assets.dashboard + (I.to_json(metrics) if metrics else "") + now_iso))
    meta = {
        "key": key, "state": state, "origin": origin, "generatedAt": now_iso, "dataAsOf": data_as_of,
        "today": today.isoformat(), "buildId": build_id,
        # short hashes only: the page must not carry long hex strings (the token scan would flag them)
        "logicHash": M.short(assets.logic_hash), "templateHash": M.short(hashes.get("template")),
        "dataHash": M.short(hashes.get("data")),
        "staleAfterHours": data.get("staleAfterHours", 20), "locale": data.get("locale", "en-IN"),
        "tokenRejected": token_rejected,
    }
    payload = {"meta": meta, "project": public_project(cfg), "data": strip_private(data), "metrics": metrics}

    sections_html = read_text(overrides["sections"]) if overrides["sections"] else ""
    page = I.inline_assets(assets.dashboard, assets.tokens_css, assets.charts_js, assets.app_js, assets.aggregate_js)
    page = I.fill(page, {
        "TITLE": cfg.get("title") or key,
        "EYEBROW": data.get("eyebrow", "DLR"),
        "CLIENT": cfg.get("client") or "",
        "GENERATED_AT": fmt_when(now),
        "BUILD_ID": build_id,
        "LOGIC_HASH": M.short(assets.logic_hash),
        "HOME_HREF": "../",
        **assets.logos,
        "PROJECT_SECTIONS_HTML": sections_html,
    })
    I.assert_filled(page)
    page = I.embed(page, payload)
    I.assert_clean(page, forbidden_strings(cfg))

    out_dir = os.path.join(DIST_DIR, key)
    write(os.path.join(out_dir, "index.html"), page)
    artifact_hash = M.sha256_text(page)
    summary = {
        "key": key, "title": payload["project"]["title"], "client": cfg.get("client"), "order": cfg.get("order", 1000),
        "state": state, "origin": origin, "generatedAt": now_iso, "dataAsOf": data_as_of, "tokenRejected": token_rejected,
        "error": error, "buildId": build_id, "logicHash": M.short(assets.logic_hash), "artifactHash": M.short(artifact_hash),
        "href": "./%s/" % key,
        "health": metrics["health"] if metrics else None,
        "score": metrics["score"]["value"] if metrics else None,
        "scoreStatus": metrics["score"]["status"] if metrics else None,
        "ppcRunning": metrics["ppc"]["running"] if metrics else None,
        "ppcBasis": metrics["ppc"]["runningBasis"] if metrics else None,
        "ppcPlanned": metrics["ppc"]["planned"]["pct"] if metrics else None,
        "activityDelayedPct": metrics["activity"]["delayedPct"] if metrics else None,
        "tasks": metrics["totals"]["tasks"] if metrics else None,
        "delayed": metrics["totals"]["delayed"] if metrics else None,
        "lastCommittedWeek": (metrics.get("tradePerformance") or {}).get("week") if metrics else None,
        "tradesBelowTarget": (metrics.get("tradePerformance") or {}).get("belowTarget") if metrics else None,
        **(landing_card(metrics, assets.data, payload["project"]) if metrics else {}),
    }
    write(os.path.join(out_dir, "build.json"), json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    if write_manifest and state != "unavailable":
        M.save(pdir, M.update(man, hashes, "dist/%s/index.html" % key, artifact_hash, now))
        log("%s: manifest.json updated" % key)
    log("%s: %s (%s) -> dist/%s/index.html %d KB" % (key, state, origin or "no data", key, len(page.encode("utf-8")) // 1024))
    return summary


# ----------------------------------------------------------------------------- landing

def landing_card(metrics: dict, data: dict, project: dict) -> dict:
    """The numbers a portfolio card shows, read from the computed metrics, in the project page's
    default view (the trend range): last week and 6-week rolling PPC with their bands, unique
    activities and trades, and open constraints with a target in the range (the Constraints
    page's own count)."""
    tol = (data.get("tolerance") or {}).get("ppc") or {}
    good, watch = (tol.get("good") or [0, 80])[1], (tol.get("watch") or [0, 65])[1]

    def band(v):
        return None if v is None else ("good" if v >= good else ("warn" if v >= watch else "bad"))
    tp = metrics.get("tradePerformance") or {}
    last = (tp.get("overall") or {}).get("pct") if tp.get("week") else None
    facts = metrics.get("facts") or {}
    trend = facts.get("trend") or {}
    lo, hi = trend.get("from"), trend.get("to")
    cons_open = None
    if facts.get("constraints") is not None:
        first = {}
        for r in facts["constraints"]:
            first.setdefault(r["u"], r)
        in_range = [r for r in first.values() if r.get("tg") and lo <= r["tg"] <= hi]
        cons_open = sum(1 for r in in_range if not r.get("cp"))
    status = next((f["value"] for f in project.get("facts") or [] if f.get("label") == "Status" and f.get("value")), None)
    return {
        "projectStatus": status,
        "lastWeekPpc": last, "lastWeekTone": band(last), "lastWeek": tp.get("week"),
        "ppcRunningTone": band(metrics["ppc"]["running"]),
        "trades": len({t["tr"] for t in facts.get("tasks") or [] if t.get("tr")}),
        "openConstraints": cons_open,
    }


def build_landing(summaries: list[dict], assets: Assets, now: datetime, today: date, title: str) -> None:
    now_iso = now.isoformat(timespec="seconds")
    build_id = M.short(M.sha256_text(assets.landing + json.dumps(summaries, sort_keys=True) + now_iso))
    projects = [{k: v for k, v in s.items() if k not in ("error", "artifactHash", "logicHash", "buildId")} for s in summaries]
    payload = {
        "meta": {"state": "fresh", "generatedAt": now_iso, "today": today.isoformat(), "buildId": build_id,
                 "logicHash": M.short(assets.logic_hash), "staleAfterHours": assets.data.get("staleAfterHours", 20),
                 "locale": assets.data.get("locale", "en-IN"),
                 "origin": "sample" if projects and all(p.get("origin") == "sample" for p in projects) else "live"},
        "projects": projects,
    }
    page = I.inline_assets(assets.landing, assets.tokens_css, assets.charts_js, assets.app_js)
    page = I.fill(page, {"TITLE": title, "EYEBROW": assets.data.get("eyebrow", "DLR"),
                         "GENERATED_AT": fmt_when(now), "BUILD_ID": build_id, "LOGIC_HASH": M.short(assets.logic_hash),
                         **assets.logos})
    I.assert_filled(page)
    page = I.embed(page, payload)
    I.assert_clean(page, [])
    write(os.path.join(DIST_DIR, "index.html"), page)
    write(os.path.join(DIST_DIR, ".nojekyll"), "")
    write(os.path.join(DIST_DIR, "portfolio.json"), json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    log("landing: %d projects -> dist/index.html" % len(projects))


# ----------------------------------------------------------------------------- entry

def published_summaries(fresh: list[dict]) -> list[dict]:
    """The landing page's cards: the summaries just built, plus every other project folder's
    build.json already in dist/ (in CI, dist/ starts as a copy of the published gh-pages
    site). A folder never built yet has no card; a page whose folder was deleted loses its card."""
    keys = {s["key"].lower() for s in fresh}
    out = list(fresh)
    for cfg in discover_projects(None):
        bj = os.path.join(DIST_DIR, cfg["key"], "build.json")
        if cfg["key"].lower() not in keys and os.path.exists(bj):
            out.append({**read_json(bj), "order": cfg.get("order", 1000)})
    out.sort(key=project_sort_key)
    return out


def run_landing(title: str) -> int:
    """Only the landing page, from the build.json files in dist/ (the portfolio workflow)."""
    now = datetime.now(IST).replace(microsecond=0)
    summaries = published_summaries([])
    if not summaries:
        log("::warning::no project has been built yet; the landing page lists none")
    build_landing(summaries, Assets(), now, now.date(), title)
    return 0


def run(only: list[str] | None, mode: str, today: date | None, write_manifest: bool, title: str,
        landing: bool = True) -> int:
    now = datetime.now(IST).replace(microsecond=0)
    today = today or now.date()
    assets = Assets()
    projects = discover_projects(only)
    if not projects:
        log("no project folders found (a project is a top-level folder holding project.json)")
    summaries = []
    for cfg in projects:
        summaries.append(build_project(cfg, assets, mode, today, now, write_manifest))
    if landing:
        build_landing(published_summaries(summaries), assets, now, today, title)
    rejected = [s["key"] for s in summaries if s.get("tokenRejected")]
    if rejected:
        log("::error::token rejected for: %s" % ", ".join(rejected))
        return 2
    return 0
