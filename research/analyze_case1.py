"""Read-only source-data audit for Case 1. Uses the Python standard library.

Run from the repository root: python research/analyze_case1.py
Outputs research/dataset_findings.json. Source datasets are never modified.
Historical replay uses row.date as the only supplied temporal proxy. For
self-paced activities it is enrollment date, not a known completion timestamp.
"""
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_json(name):
    return json.loads((ROOT / name).read_text(encoding="utf-8-sig"))


employees_doc = read_json("employees.json")
employees = employees_doc["employees"]
events = read_json("events.json")["events"]
skills_doc = read_json("skills.json")
skills = skills_doc["skills"]
profiles = {(p["role"], p["grade"]): p for p in skills_doc["role_profiles"]}
with (ROOT / "activity_history.csv").open(encoding="utf-8-sig", newline="") as f:
    history = list(csv.DictReader(f))
as_of = employees_doc["meta"]["as_of_date"]
event_by_id = {e["event_id"]: e for e in events}
skill_by_id = {s["skill_id"]: s for s in skills}
hist_by_emp = defaultdict(list)
for row in history:
    hist_by_emp[row["employee_id"]].append(row)
grade_order = ["Junior", "Middle", "Senior", "Lead"]


def effective_skills(emp):
    levels = emp["skills"].copy()
    changed = []
    for row in sorted(hist_by_emp[emp["employee_id"]], key=lambda r: (r["date"], r["record_id"])):
        if row["status"] != "completed" or not emp["last_review_date"] < row["date"] <= as_of:
            continue
        event = event_by_id[row["event_id"]]
        for effect in event["develops_skills"]:
            sid = effect["skill_id"]
            old = levels.get(sid, 0)
            new = min(5, old + max(0, min(effect["gain"], effect["max_level"] - old)))
            levels[sid] = new
            if new > old:
                changed.append({"record_id": row["record_id"], "event_id": row["event_id"],
                                "skill": sid, "before": old, "after": new})
    return levels, changed


def target_for(emp):
    if emp["career_goal"]:
        goal = emp["career_goal"]
        return (goal["target_role"], goal["target_grade"]), "explicit"
    i = grade_order.index(emp["grade"])
    if i < len(grade_order) - 1:
        return (emp["role"], grade_order[i + 1]), "suggested_next_grade"
    return (emp["role"], emp["grade"]), "current_grade_for_lead_without_goal"


def eligibility(emp, event, levels):
    reasons = []
    rows = hist_by_emp[emp["employee_id"]]
    same = [r for r in rows if r["event_id"] == event["event_id"]]
    if event["mandatory"]:
        reasons.append("mandatory")
    if emp["role"] not in event["target_roles"]:
        reasons.append("role")
    if emp["grade"] not in event["target_grades"]:
        reasons.append("grade")
    if event["event_id"] != "EV_036" and any(r["status"] == "completed" for r in same):
        reasons.append("completed_nonrepeatable")
    if any(r["status"] == "in_progress" for r in same):
        reasons.append("already_in_progress_resume_separately")
    if any(levels.get(sid, 0) < level for sid, level in event["prerequisites"].items()):
        reasons.append("prerequisites")
    if event["format"] != "self_paced" and not any(d >= as_of for d in event["upcoming_sessions"]):
        reasons.append("no_future_session")
    return reasons


def closure(event, levels, target):
    gains = {}
    for effect in event["develops_skills"]:
        sid = effect["skill_id"]
        old = levels.get(sid, 0)
        delta = max(0, min(effect["gain"], effect["max_level"] - old, 5 - old))
        gain = min(delta, max(0, target["required_skills"].get(sid, 0) - old))
        if gain:
            gains[sid] = gain
    return gains


people = []
gap_counts = Counter()
critical_gap_counts = Counter()
uncovered_critical = Counter()
changed_people = []
for emp in employees:
    levels, changes = effective_skills(emp)
    target_key, target_policy = target_for(emp)
    target = profiles[target_key]
    gaps = {sid: req - levels.get(sid, 0) for sid, req in target["required_skills"].items()
            if req > levels.get(sid, 0)}
    gap_counts.update(gaps.keys())
    critical_gaps = {sid: gaps[sid] for sid in target["critical_skills"] if sid in gaps}
    critical_gap_counts.update(critical_gaps.keys())
    candidates = []
    for event in events:
        if eligibility(emp, event, levels):
            continue
        gains = closure(event, levels, target)
        if gains:
            candidates.append({"event_id": event["event_id"], "title": event["title"],
                               "hours": event["duration_hours"], "gains": gains,
                               "critical_gain": sum(v for sid, v in gains.items()
                                                    if sid in target["critical_skills"])})
    for sid in critical_gaps:
        if not any(sid in c["gains"] for c in candidates):
            uncovered_critical[sid] += 1
    candidates.sort(key=lambda c: (-c["critical_gain"], -sum(c["gains"].values()), c["hours"], c["event_id"]))
    if changes:
        changed_people.append({"employee_id": emp["employee_id"], "changes": changes})
    people.append({"employee_id": emp["employee_id"], "role": emp["role"], "grade": emp["grade"],
                   "target": list(target_key), "target_policy": target_policy,
                   "critical_gaps": critical_gaps, "all_gaps": gaps,
                   "new_direct_candidate_count": len(candidates), "candidates": candidates})

voluntary = [r for r in history if not event_by_id[r["event_id"]]["mandatory"]]
terminal = [r for r in voluntary if r["status"] != "in_progress"]
voluntary_statuses = Counter(r["status"] for r in voluntary)
completed_after_review = [r for emp in employees for r in hist_by_emp[emp["employee_id"]]
                          if r["status"] == "completed" and emp["last_review_date"] < r["date"] <= as_of]
all_developed = {x["skill_id"] for e in events if not e["mandatory"] for x in e["develops_skills"]}
max_catalog_levels = {sid: max((x["max_level"] for e in events if not e["mandatory"]
                              for x in e["develops_skills"] if x["skill_id"] == sid), default=0)
                      for sid in skill_by_id}
catalog_critical_limits = []
for (role, grade), profile in profiles.items():
    for sid in profile["critical_skills"]:
        req = profile["required_skills"][sid]
        if max_catalog_levels[sid] < req:
            catalog_critical_limits.append({"role": role, "grade": grade, "skill": sid,
                                            "required": req, "global_catalog_max": max_catalog_levels[sid]})

report = {
    "method": {
        "as_of": as_of,
        "synthetic_only": True,
        "history_date_caveat": "self_paced date is enrollment date; no actual completed_at exists. Replay uses date as documented proxy.",
        "target_policy": "Explicit career_goal; otherwise proposed next grade; Lead without goal assessed against current grade. Defaults are analysis assumptions, not inferred user consent.",
        "candidate_policy": "New enrollment, current role/grade, unmet target gains, prerequisites met, future session/self-paced, voluntary, not previously completed except EV_036. In-progress events excluded from new enrollment but should be offered as resume actions.",
        "ranking": "Candidates sorted for illustration by critical gain, total gap reduction, hours. This is NOT an AI recommender or quality evaluation.",
    },
    "input_sha256": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                     for name in ["employees.json", "events.json", "skills.json", "activity_history.csv"]},
    "counts": {"employees": len(employees), "events": len(events), "skills": len(skills),
               "role_grade_profiles": len(profiles), "history": len(history),
               "mandatory_events": sum(e["mandatory"] for e in events),
               "voluntary_events": sum(not e["mandatory"] for e in events),
               "null_career_goal": sum(e["career_goal"] is None for e in employees),
               "cross_role_goals": sum(bool(e["career_goal"] and e["career_goal"]["target_role"] != e["role"]) for e in employees),
               "core_tenure_12_60_months": sum(12 <= e["tenure_months"] <= 60 for e in employees),
               "completed_rows_after_review_proxy": len(completed_after_review),
               "self_paced_completed_rows_after_review_proxy": sum(event_by_id[r["event_id"]]["format"] == "self_paced" for r in completed_after_review),
               "employees_with_actual_replay_gain": len(changed_people),
               "employees_with_no_new_direct_candidate": sum(p["new_direct_candidate_count"] == 0 for p in people),
               "employees_with_no_new_direct_candidate_and_gaps": sum(p["new_direct_candidate_count"] == 0 and bool(p["all_gaps"]) for p in people),
               "skills_developed_by_voluntary_catalog": len(all_developed)},
    "distributions": {"roles": dict(Counter(e["role"] for e in employees)),
                      "grades": dict(Counter(e["grade"] for e in employees)),
                      "languages": dict(Counter(e["preferred_language"] for e in employees)),
                      "work_formats": dict(Counter(e["work_format"] for e in employees)),
                      "all_history_statuses": dict(Counter(r["status"] for r in history)),
                      "voluntary_history_statuses": dict(voluntary_statuses),
                      "event_types": dict(Counter(e["type"] for e in events))},
    "voluntary_completed_share_of_all_rows_pct": round(100 * voluntary_statuses["completed"] / len(voluntary), 2),
    "voluntary_completed_share_of_terminal_rows_pct": round(100 * voluntary_statuses["completed"] / len(terminal), 2),
    "gap_prevalence": gap_counts.most_common(),
    "critical_gap_prevalence": critical_gap_counts.most_common(),
    "critical_gaps_without_current_direct_new_event": uncovered_critical.most_common(),
    "critical_requirements_above_global_catalog_max": catalog_critical_limits,
    "skills_not_developed_in_voluntary_catalog": sorted(set(skill_by_id) - all_developed),
    "replay_changes": changed_people,
    "employees": people,
    "events_compact": [{k: e[k] for k in ["event_id", "title", "mandatory", "type", "format",
                                         "duration_hours", "develops_skills", "prerequisites",
                                         "target_roles", "target_grades", "upcoming_sessions"]} for e in events],
}
output = ROOT / "research" / "dataset_findings.json"
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({k: v for k, v in report.items() if k not in ["employees", "events_compact", "replay_changes"]},
                 ensure_ascii=False, indent=2))
