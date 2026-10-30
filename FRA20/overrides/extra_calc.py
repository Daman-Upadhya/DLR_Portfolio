"""FRA20 only: the activities behind the Energisation and Trade performance pages
(overrides/script.js draws them).

An activity is an energisation activity when a custom field whose name contains FIELD (the
"Discipline" field) has a value that mentions VALUE ("Energisation", "Energization"...). Both
matches ignore case. In FRA20 these are End Milestones, one per machine (taskName "2HVM2",
location "P2_FO_L0.008 - HV Room"). That type is outside data.taskTypes, so they are not in
facts.tasks: they come from model["otherTasks"] (and model["tasks"], should one be Construction)
and the page gets their own short rows in metrics.energisation.items.

Trade performance needs one more thing facts.tasks does not carry: which activities have a
planned workforce (totalPlannedWorkers above 0). Their guids go in metrics.workforce.
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
    items = [{"g": t["guid"], "n": t["name"], "l": t["location"], "pe": t["plannedEnd"], "ae": t["actualEnd"], "st": t["status"]}
             for t in list(model["tasks"]) + list(model.get("otherTasks") or []) if _is_energisation(t.get("custom"))]
    metrics["energisation"] = {"items": items}
    print("FRA20 energisation: %d activities" % len(items))
    metrics["workforce"] = {"guids": [t["guid"] for t in model["tasks"] if (t.get("plannedWorkers") or 0) > 0]}
    return metrics
