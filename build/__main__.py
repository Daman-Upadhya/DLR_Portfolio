# -*- coding: utf-8 -*-
"""Command line for the Build Process.

    python -m build build [--all | --project PAR14 ...] [--source live|sample|auto] [--today YYYY-MM-DD]
                          [--write-manifest] [--title "DLR Portfolio"] [--no-landing]
    python -m build landing [--title "DLR Portfolio"]
    python -m build new-project --code CODE --name "Project name" --id GUID [--client "..."]
    python -m build validate [--project CODE ... | --landing]
    python -m build selftest
    python -m build list
    python -m build serve [--port 8000]

Exit codes for build: 0 built (fresh or stale), 2 at least one project's token was rejected
(pages still written), 1 a build error.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from . import DIST_DIR


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m build", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")

    b = sub.add_parser("build", help="build project pages and the landing page into dist/")
    b.add_argument("--all", action="store_true", help="every project folder (default)")
    b.add_argument("--project", action="append", help="only this project key; repeatable")
    b.add_argument("--source", choices=("live", "sample", "auto"), default="auto",
                   help="live = VisiLean API; sample = sample/<CODE>.* exports, if any; auto = live when a token exists, else sample")
    b.add_argument("--today", help="YYYY-MM-DD, pins the run date for live builds (default: today in IST); sample and cached data work out their own date")
    b.add_argument("--write-manifest", action="store_true", help="record current dependency hashes in P<key>/manifest.json")
    b.add_argument("--title", default="DLR Portfolio", help="landing page title")
    b.add_argument("--no-landing", action="store_true", help="build only the project pages (a project refresh)")

    lp = sub.add_parser("landing", help="rebuild only the landing page from the build.json files in dist/")
    lp.add_argument("--title", default="DLR Portfolio", help="landing page title")

    n = sub.add_parser("new-project", help="create <code>/project.json and its refresh workflow")
    n.add_argument("--code", required=True, help="project code: the folder, the page URL and the secret suffix")
    n.add_argument("--name", required=True, help="project name shown on the pages")
    n.add_argument("--id", required=True, help="VisiLean project GUID")
    n.add_argument("--client", help="client name (default: the one in build/project_defaults.json)")
    n.add_argument("--force", action="store_true", help="overwrite an existing project.json and workflow")

    v = sub.add_parser("validate", help="check configs, manifests and the built site in dist/")
    v.add_argument("--project", action="append", help="check only this project's page (a project refresh)")
    v.add_argument("--landing", action="store_true", help="check only the landing page (the portfolio refresh)")
    sub.add_parser("selftest", help="run calculation.py on the sample fixture and check invariants")
    sub.add_parser("list", help="list project folders and where their tokens were found")
    s = sub.add_parser("serve", help="serve dist/ locally")
    s.add_argument("--port", type=int, default=8000)

    args = ap.parse_args(argv)
    if not args.cmd:
        ap.print_help()
        return 1

    if args.cmd == "build":
        from .build import run
        today = date.fromisoformat(args.today) if args.today else None
        return run(args.project, args.source, today, args.write_manifest, args.title, not args.no_landing)

    if args.cmd == "landing":
        from .build import run_landing
        return run_landing(args.title)

    if args.cmd == "new-project":
        from .scaffold import new_project
        return new_project(args.code, args.name, args.id, args.client, args.force)

    if args.cmd == "validate":
        from .validate import main as vmain
        if args.project:
            return vmain("project", args.project)
        return vmain("landing" if args.landing else "all")

    if args.cmd == "selftest":
        from .validate import selftest
        return selftest()

    if args.cmd == "list":
        from .build import discover_projects
        from .fetch import token_sources
        for p in discover_projects(None):
            print("%-10s %-40s tokens: %s" % (p["key"], (p.get("title") or "")[:40], ", ".join(token_sources(p["key"])) or "none"))
        return 0

    if args.cmd == "serve":
        import functools
        import http.server
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIST_DIR)
        print("serving dist/ at http://localhost:%d/  (Ctrl+C to stop)" % args.port)
        http.server.ThreadingHTTPServer(("", args.port), handler).serve_forever()
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
