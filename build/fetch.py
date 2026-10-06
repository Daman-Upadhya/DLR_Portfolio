# -*- coding: utf-8 -*-
"""Getting a project's raw task rows: live from VisiLean, from the last good copy, or from
the sample fixture. This is the only module that ever sees a token or a URL.

Token resolution, in order (every candidate found is kept, so a rejected one falls through):
  1. environment variable  VL_TOKEN_<KEY>        (repository secret, one per project)
  2. VL_TOKENS_JSON        {"PAR14": "<token>", ...} (one repository secret for all projects)
  3. tokens.json           same map, repo root, gitignored, for local runs

Feeds: every project has the task feed (source.type, default "task"). The commitment and
constraint feeds are optional: source.feeds.committed / source.feeds.constraints, each
{"type": "<api type>", "extraQuery": "..."}. A feed without a type is not fetched and comes
through as None, so its KPIs show as "no data" instead of a guessed number.

Outcomes of fetch_raw():
  ("live",   feeds)  fetched now; also written to .cache/<key>.json
  ("cache",  feeds)  VisiLean unreachable, last good copy used
  ("sample", feeds)  --source sample, or --source auto with no token
  feeds = {"tasks": [...], "committed": [...] | None, "constraints": [...] | None}
  raises TokenRejected   every candidate was refused -> the run must go red
  raises Unreachable     no live data and no cache -> page is built as "unavailable"

Nothing in this module prints a token or a URL.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from . import CACHE_DIR, ROOT, TOKENS_FILE

USER_AGENT = "DLR-Portfolio-build"


class TokenRejected(Exception):
    """VisiLean refused every token this project has. A configuration problem, not an outage."""


class Unreachable(Exception):
    """VisiLean could not be reached and there is no cached copy."""


class TokenMissing(Exception):
    """No token was configured anywhere for this project."""


# ----------------------------------------------------------------------------- tokens

def _clean(raw: str | None) -> str:
    """The token alone, even if the whole URL was pasted into the secret."""
    s = (raw or "").strip().strip('"').strip("'")
    if not s:
        return ""
    if "accessToken=" in s:
        s = s.split("accessToken=", 1)[1]
    for sep in ("&", "?", "#", " "):
        s = s.split(sep, 1)[0]
    return s.strip()


def _map_from(text: str, source: str) -> dict:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise TokenMissing("%s is not valid JSON: %s" % (source, e))
    if not isinstance(parsed, dict):
        raise TokenMissing('%s must be an object like {"PAR14": "<token>"}' % source)
    return {str(k).strip().lower(): v for k, v in parsed.items() if isinstance(v, str) and v.strip()}


def secret_name(key: str) -> str:
    """VL_TOKEN_<CODE>: the project code upper-cased, anything a secret name cannot hold
    (secrets allow A-Z, 0-9 and _) turned into _. MAD4.3 -> VL_TOKEN_MAD4_3."""
    return "VL_TOKEN_" + re.sub(r"[^A-Z0-9_]", "_", key.upper())


def token_candidates(key: str) -> list[tuple[str, str]]:
    """[(token, where it came from)], de-duplicated, in priority order."""
    out, seen = [], set()

    def add(tok, src):
        tok = _clean(tok)
        if tok and tok not in seen:
            seen.add(tok)
            out.append((tok, src))

    env_name = secret_name(key)
    add(os.environ.get(env_name), env_name)
    blob = os.environ.get("VL_TOKENS_JSON", "").strip()
    if blob:
        add(_map_from(blob, "VL_TOKENS_JSON").get(key.lower()), "VL_TOKENS_JSON")
    if os.path.exists(TOKENS_FILE):
        with open(TOKENS_FILE, encoding="utf-8") as f:
            text = f.read().strip()
        if text:
            add(_map_from(text, "tokens.json").get(key.lower()), "tokens.json")
    return out


def token_sources(key: str) -> list[str]:
    """Where tokens were found, for `list` output. Never the tokens themselves."""
    try:
        return [src for _, src in token_candidates(key)]
    except TokenMissing as e:
        return ["error: %s" % e]


# ----------------------------------------------------------------------------- http

OPTIONAL_FEEDS = ("committed", "constraints")


def feed_specs(project: dict) -> dict:
    """{feed name: {"type", "extraQuery"}} for every feed this project fetches."""
    src = project.get("source") or {}
    specs = {"tasks": {"type": src.get("type") or "task", "extraQuery": src.get("extraQuery") or ""}}
    for name in OPTIONAL_FEEDS:
        f = (src.get("feeds") or {}).get(name) or {}
        if f.get("type"):
            specs[name] = {"type": f["type"], "extraQuery": f.get("extraQuery") or ""}
    return specs


def _url(project: dict, token: str, spec: dict) -> str:
    src = project.get("source") or {}
    base = (src.get("baseUrl") or "").rstrip("?&")
    q = {"accessToken": token, "projectId": project.get("projectId") or "", "type": spec["type"]}
    extra = (spec.get("extraQuery") or "").lstrip("&?")
    return base + ("&" if "?" in base else "?") + urllib.parse.urlencode(q) + (("&" + extra) if extra else "")


def _is_rejection(err: Exception) -> bool:
    """A 400, or a 403/500 whose body says the API does not exist, means 'wrong token'."""
    if not isinstance(err, urllib.error.HTTPError):
        return False
    if err.code == 400:
        return True
    if err.code in (401, 403, 500):
        try:
            body = err.read().decode("utf-8", "replace").lower()
        except Exception:
            body = ""
        return "api does not exist" in body or "invalid token" in body or "unauthorized" in body
    return False


def _describe(err: Exception) -> str:
    if isinstance(err, urllib.error.HTTPError):
        return "HTTP %d" % err.code
    if isinstance(err, urllib.error.URLError):
        return "network: %s" % getattr(err, "reason", err)
    return type(err).__name__ + (": " + str(err)[:100] if str(err) else "")


def _get_json(url: str, timeout: int):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8", errors="replace"))


def _rows_of(payload) -> list:
    """The feed is normally a JSON array; tolerate {result: [...]}, {data: [...]}, {tasks: [...]}."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("result", "data", "tasks", "items", "value"):
            v = payload.get(k)
            if isinstance(v, list):
                return v
            if isinstance(v, dict):
                inner = _rows_of(v)
                if inner:
                    return inner
    raise ValueError("unexpected response shape: %s" % type(payload).__name__)


def fetch_live(project: dict, log, attempts: int = 3, timeout: int = 180) -> dict:
    """Every configured feed with the first token that works for the task feed."""
    specs = feed_specs(project)
    feeds = {name: None for name in OPTIONAL_FEEDS}
    feeds["tasks"], tok = _fetch_feed(project, log, specs["tasks"], "tasks", attempts, timeout)
    for name in OPTIONAL_FEEDS:
        if name in specs:
            feeds[name], _ = _fetch_feed(project, log, specs[name], name, attempts, timeout, only=tok)
    return feeds


def _fetch_feed(project: dict, log, spec: dict, feed: str, attempts: int, timeout: int, only=None):
    key = project["key"]
    candidates = token_candidates(key)
    if not candidates:
        raise TokenMissing('no token for %s: set secret %s, or add "%s" to VL_TOKENS_JSON, '
                           'or to tokens.json locally' % (key, secret_name(key), key))
    if only:
        candidates = [c for c in candidates if c[0] == only] or candidates
    rejected = []
    last = None
    for tok, src in candidates:
        for i in range(attempts):
            try:
                rows = _rows_of(_get_json(_url(project, tok, spec), timeout))
                log("%s: fetched %d %s rows using %s" % (key, len(rows), feed, src))
                return rows, tok
            except Exception as e:  # noqa: BLE001
                last = e
                if _is_rejection(e):
                    log("::warning title=%s token rejected::%s was rejected by VisiLean (%s)" % (key, src, _describe(e)))
                    rejected.append(src)
                    break
                log("%s: attempt %d/%d failed (%s)" % (key, i + 1, attempts, _describe(e)))
                if i + 1 < attempts:
                    time.sleep(15 * (i + 1))
        else:
            # outage on this candidate; trying another token will not help with an outage
            raise Unreachable("%s: VisiLean unreachable after %d attempts (%s)" % (key, attempts, _describe(last)))
    raise TokenRejected("%s: every token was rejected (%s)" % (key, ", ".join(rejected)))


# ----------------------------------------------------------------------------- cache & sample

def _cache_path(key: str) -> str:
    return os.path.join(CACHE_DIR, key + ".json")


def _as_feeds(obj) -> dict:
    """A bare list is the task feed (and the old cache format)."""
    if isinstance(obj, dict) and "tasks" in obj:
        return {"tasks": obj.get("tasks") or [], **{n: obj.get(n) for n in OPTIONAL_FEEDS}}
    return {"tasks": _rows_of(obj), **{n: None for n in OPTIONAL_FEEDS}}


def write_cache(key: str, feeds: dict, fetched_at: str) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(_cache_path(key), "w", encoding="utf-8") as f:
        json.dump({"fetchedAt": fetched_at, "feeds": feeds}, f, ensure_ascii=False)


def read_cache(key: str):
    p = _cache_path(key)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        c = json.load(f)
    return c.get("fetchedAt"), _as_feeds(c.get("feeds") or c.get("rows") or [])


def _load_json(path: str):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def _sample_path(rel: str) -> str:
    return rel if os.path.isabs(rel) else os.path.join(ROOT, rel)


def read_sample(project: dict) -> dict:
    """source.sampleFile is the task feed; source.sampleFeeds.committed / .constraints are optional."""
    src = project.get("source") or {}
    p = _sample_path(src.get("sampleFile") or ("sample/%s.tasks.json.gz" % project["key"]))
    if not os.path.exists(p):
        # never borrow another project's export: a project without one is "unavailable"
        raise Unreachable("%s: no sample task file at %s" % (project["key"], os.path.relpath(p, ROOT)))
    feeds = _as_feeds(_load_json(p))
    for name in OPTIONAL_FEEDS:
        rel = (src.get("sampleFeeds") or {}).get(name)
        if rel and os.path.exists(_sample_path(rel)):
            feeds[name] = _rows_of(_load_json(_sample_path(rel)))
    return feeds


def fetch_raw(project: dict, mode: str, now_iso: str, log) -> tuple[str, dict, str]:
    """-> (origin, feeds, data_as_of). See module docstring for the outcomes."""
    key = project["key"]
    if mode == "sample":
        return "sample", read_sample(project), now_iso
    if mode == "auto" and not token_candidates(key):
        log("%s: no token configured, using the sample data" % key)
        return "sample", read_sample(project), now_iso
    try:
        feeds = fetch_live(project, log)
        write_cache(key, feeds, now_iso)
        return "live", feeds, now_iso
    except TokenRejected:
        raise
    except (Unreachable, TokenMissing, ValueError) as e:
        cached = read_cache(key)
        if cached:
            log("%s: %s; using cached data from %s" % (key, e, cached[0]))
            return "cache", cached[1], cached[0]
        raise Unreachable(str(e))
