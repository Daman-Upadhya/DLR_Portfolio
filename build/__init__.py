"""The Build Process: turns Template/ + P<key>/ + VisiLean data into dist/<key>/index.html."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(ROOT, "Template")
DIST_DIR = os.path.join(ROOT, "dist")
CACHE_DIR = os.path.join(ROOT, ".cache")
SAMPLE_DIR = os.path.join(ROOT, "sample")
TOKENS_FILE = os.path.join(ROOT, "tokens.json")
DEFAULTS_FILE = os.path.join(ROOT, "build", "project_defaults.json")
