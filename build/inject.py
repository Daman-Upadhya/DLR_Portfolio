# -*- coding: utf-8 -*-
"""Template content injection: the "Logic Injection" half of the Build Process.

A template is plain HTML with {{PLACEHOLDER}} slots. Injection happens in a fixed order so
nothing coming from the API can ever be mistaken for a template slot:

  1. inline_assets  -> {{TOKENS_CSS}} {{CHARTS_JS}} {{AGGREGATE_JS}} {{APP_JS}}  (Template/ files)
  2. fill           -> {{TITLE}} {{EYEBROW}} ... {{PROJECT_SECTIONS}} (strings from config)
  3. assert_filled  -> no {{...}} slot may remain except {{DATA}}
  4. embed          -> {{DATA}} becomes the JSON payload, last of all
  5. assert_clean   -> nothing secret reached the page

The payload goes into <script type="application/json" id="data">, with "</" escaped so a
value containing "</script>" cannot break out of the element.
"""
from __future__ import annotations

import html
import json
import re

SLOT_RE = re.compile(r"\{\{([A-Z][A-Z0-9_]*)\}\}")


class InjectError(Exception):
    """A template or payload problem that must stop the build."""


def inline_assets(page: str, tokens_css: str, charts_js: str, app_js: str, aggregate_js: str = "") -> str:
    for name, body in (("TOKENS_CSS", tokens_css), ("CHARTS_JS", charts_js), ("AGGREGATE_JS", aggregate_js), ("APP_JS", app_js)):
        if "</script" in body.lower() or "</style" in body.lower():
            raise InjectError("%s contains a closing tag that would end its inline element" % name)
        page = page.replace("{{%s}}" % name, body)
    return page


def fill(page: str, values: dict) -> str:
    """Fill string slots. Values are HTML-escaped unless the key ends in _HTML."""
    for key, val in values.items():
        safe = val if key.endswith("_HTML") else html.escape(str(val if val is not None else ""), quote=True)
        page = page.replace("{{%s}}" % key.replace("_HTML", ""), safe)
    return page


def unfilled(page: str) -> list[str]:
    return sorted(set(SLOT_RE.findall(page)) - {"DATA"})


def assert_filled(page: str) -> None:
    left = unfilled(page)
    if left:
        raise InjectError("unfilled template slots: %s" % ", ".join(left))


def to_json(payload) -> str:
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return text.replace("</", "<\\/")


def embed(page: str, payload) -> str:
    if "{{DATA}}" not in page:
        raise InjectError("template has no {{DATA}} slot")
    return page.replace("{{DATA}}", to_json(payload))


def assert_clean(page: str, forbidden: list[str]) -> None:
    """Fail if any forbidden string (token, host, GUID, ...) appears in the finished page."""
    low = page.lower()
    for s in forbidden:
        if s and s.lower() in low:
            raise InjectError("forbidden content reached the page: %s..." % s[:12])
    if "accesstoken" in low:
        raise InjectError("the word accessToken reached the page")
