"""FRA20 only: the activities behind the Energisation and Trade performance pages
(overrides/script.js draws them).

An activity is an energisation activity when a custom field whose name contains FIELD (the
"Discipline" field) has a value that mentions VALUE ("Energisation", "Energization"...). Both
matches ignore case. In FRA20 these are End Milestones, one per machine (taskName "2HVM2",
location "P2_FO_L0.008 - HV Room"). That type is outside data.taskTypes, so they are not in
facts.tasks: they come from model["otherTasks"] (and model["tasks"], should one be Construction)
and the page gets their own short rows in metrics.energisation.items.

Each item also carries its prerequisites as pq: [[name, ready], ...] (ready = marked made ready in
VisiLean), and metrics.energisation.prereqs lists every prerequisite name, in VisiLean's order, so
the drill-through can show one column per prerequisite: marked, selected but not marked, or not
on the activity.

Trade performance needs one more thing facts.tasks does not carry: which activities have a
planned workforce (totalPlannedWorkers above 0). Their guids go in metrics.workforce.guids,
and metrics.workforce.n maps each to its planned workers for the Meeting readiness page.

Meeting readiness also checks whether the "High Risk Activity" custom field is filled in (Yes or
No); facts.tasks only flags the Yes ones, so metrics.highRiskField maps each unfinished activity's
guid to the field's value when it has one.
"""

FIELD = "discipline"
VALUE = "energi"


def _is_energisation(custom) -> bool:
    for name, value in (custom or {}).items():
        if FIELD in str(name).lower():
            values = value if isinstance(value, list) else [value]
            if any(VALUE in str(v).lower() for v in values if v is not None):
                return True
    return False


def extend(metrics, model, project, today):
    picked = [t for t in list(model["tasks"]) + list(model.get("otherTasks") or []) if _is_energisation(t.get("custom"))]
    items = [{"g": t["guid"], "id": t["id"], "n": t["name"], "tr": t["trade"], "l": t["location"], "ps": t.get("plannedStart"),
              "pe": t["plannedEnd"], "ae": t["actualEnd"], "st": t["status"],
              "pq": [[m[0], m[2]] for m in (t.get("prereqMarks") or [])]} for t in picked]
    # every prerequisite name: the feed's catalogue, then any only seen on these activities
    order = {n: (0, i) for i, n in enumerate((model.get("feed") or {}).get("prerequisites") or [])}
    for t in picked:
        for m in t.get("prereqMarks") or []:
            order.setdefault(m[0], (1, m[1]))
    metrics["energisation"] = {"items": items, "prereqs": sorted(order, key=lambda n: (order[n], n))}
    print("FRA20 energisation: %d activities" % len(items))
    staffed = [t for t in model["tasks"] if (t.get("plannedWorkers") or 0) > 0]
    # guids: Trade performance; n (guid -> planned workers): the Meeting readiness drill-through
    metrics["workforce"] = {"guids": [t["guid"] for t in staffed], "n": {t["guid"]: t["plannedWorkers"] for t in staffed}}
    # Meeting readiness: the "High Risk Activity" custom field's value (Yes / No) on each unfinished
    # activity that has one filled in; finished ones are never in the look-ahead, so they are left out
    hrf = {}
    for t in model["tasks"]:
        if t.get("actualEnd"):
            continue
        v = _field(t.get("custom"), HR_FIELD)
        if v:
            hrf[t["guid"]] = v
    metrics["highRiskField"] = hrf
    print("FRA20 high-risk field filled in on %d unfinished activities" % len(hrf))
    return metrics


HR_FIELD = "high risk activity"


def _field(custom, name):
    """The value of the custom field called name (ignoring case and spaces), as text; "" when empty.
    Matches the whole name, so "High Risk Activity Type" is not "High Risk Activity"."""
    for k, v in (custom or {}).items():
        if " ".join(str(k).split()).lower() == name:
            vals = v if isinstance(v, list) else [v]
            return ", ".join(" ".join(str(x).split()) for x in vals if x is not None and str(x).strip())
    return ""
