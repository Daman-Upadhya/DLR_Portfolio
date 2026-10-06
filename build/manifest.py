# -*- coding: utf-8 -*-
"""Dependency manifests: which logic, template and data each project page is built from.

P<key>/manifest.json records, for the page, a reference to each dependency and the SHA-256
of that file at the last build. On every build the hashes are recomputed; a mismatch is
"drift" and is reported (the page is rebuilt anyway). With --write-manifest the manifest is
updated in place, which is how a project gets pinned to the logic it was approved with.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime

from . import ROOT

DEPENDENCIES = (
    ("logic", "Template/calculation.py"),
    ("template", "Template/Dashboard.html"),
    ("data", "Template/dashboard_data.json"),
    ("tokens", "Template/tokens.css"),
    ("charts", "Template/scripts/charts.js"),
    ("aggregate", "Template/scripts/aggregate.js"),
    ("app", "Template/scripts/app.js"),
)

OVERRIDE_FILES = {
    "logic": "overrides/extra_calc.py",
    "data": "overrides/data.json",
    "sections": "overrides/sections.html",
}


def sha256_file(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return "sha256:" + h.hexdigest()


def sha256_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def short(h: str | None) -> str:
    return (h or "sha256:").split(":", 1)[1][:12] or "-"


def default_manifest(key: str) -> dict:
    m = {"page": key}
    for name, ref in DEPENDENCIES:
        m[name] = {"ref": ref, "hash": None}
    m["overrides"] = {k: None for k in OVERRIDE_FILES}
    m["lastBuild"] = None
    return m


def load(project_dir: str, key: str) -> dict:
    path = os.path.join(project_dir, "manifest.json")
    if not os.path.exists(path):
        return default_manifest(key)
    with open(path, encoding="utf-8") as f:
        m = json.load(f)
    base = default_manifest(key)
    for name, _ in DEPENDENCIES:
        if name not in m:
            m[name] = base[name]
    m.setdefault("overrides", base["overrides"])
    m.setdefault("page", key)
    return m


def resolve_overrides(project_dir: str, m: dict) -> dict:
    """Which override files exist for this project: {name: absolute path or None}."""
    out = {}
    declared = m.get("overrides") or {}
    for name, default_rel in OVERRIDE_FILES.items():
        rel = declared.get(name) or default_rel
        p = os.path.join(project_dir, rel)
        out[name] = p if os.path.exists(p) else None
    return out


def current_hashes(m: dict, override_paths: dict) -> dict:
    hashes = {}
    for name, _ in DEPENDENCIES:
        ref = (m.get(name) or {}).get("ref") or dict(DEPENDENCIES)[name]
        hashes[name] = sha256_file(os.path.join(ROOT, ref))
    for name, p in override_paths.items():
        hashes["override:" + name] = sha256_file(p) if p else None
    return hashes


def drift(m: dict, hashes: dict) -> list[str]:
    """Human-readable list of dependencies that changed since the manifest was last written."""
    out = []
    for name, _ in DEPENDENCIES:
        recorded = (m.get(name) or {}).get("hash")
        now = hashes.get(name)
        if recorded is None:
            out.append("%s: not yet recorded" % name)
        elif recorded != now:
            out.append("%s: changed since last build (%s -> %s)" % (name, short(recorded), short(now)))
    return out


def update(m: dict, hashes: dict, artifact_rel: str, artifact_hash: str, when: datetime) -> dict:
    for name, _ in DEPENDENCIES:
        m.setdefault(name, {"ref": dict(DEPENDENCIES)[name]})
        m[name]["hash"] = hashes.get(name)
    m["lastBuild"] = {"at": when.isoformat(timespec="seconds"), "artifact": artifact_rel, "artifactHash": artifact_hash}
    return m


def save(project_dir: str, m: dict) -> None:
    with open(os.path.join(project_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
        f.write("\n")
