"""FRA20 only: the activities behind the Energisation and Trade performance pages
(overrides/script.js draws them).

An activity is an energisation activity when a custom field whose name contains FIELD (the
"Deliverables" / "Deliveries" field) has a value that mentions VALUE ("Energisation",
"Energization", "Energise"...). Both matches ignore case. The page reads the activities'
name, location, planned and actual end and status from facts.tasks; this adds only their guids.

Trade performance needs one more thing facts.tasks does not carry: which activities have a
planned workforce (totalPlannedWorkers above 0). Their guids go in metrics.workforce.
"""

FIELD = "deliver"
VALUE = "energi"


def _is_energisation(custom) -> bool:
    for name, value in (custom or {}).items():
        if FIELD in str(name).lower():
            values = value if isinstance(value, list) else [value]
            if any(VALUE in str(v).lower() for v in values if v is not None):
                return True
    return False


def extend(metrics, model, project, today):
    metrics["energisation"] = {"guids": [t["guid"] for t in model["tasks"] if _is_energisation(t.get("custom"))]}
    metrics["workforce"] = {"guids": [t["guid"] for t in model["tasks"] if (t.get("plannedWorkers") or 0) > 0]}
    return metrics
