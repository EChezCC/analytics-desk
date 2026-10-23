"""Daily YPP push update + MANDATORY pace recompute (Eric standing Oct 23 2026).

Run from analytics-desk repo root after Studio Earn pull:
  python3 tools/ypp_update.py --hours 1347 --as-of 2026-10-18 --mixes 1 --shorts 0 --live --subs 3893

Always recomputes pace_h_per_day, pace_7d, checkpoints, overall_status from the
latest Studio Earn as-of. Never leave Behind/On-track on a stale window.
Hours = Studio Earn qualified public watch hours (365d) only — never API.
"""
from __future__ import annotations
import argparse, datetime as dt, json, re, sys

F = "data/chezerecta/ypp.json"
ASOF_RE = re.compile(r"as of\s+(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2})", re.I)
MON = {m: i for i, m in enumerate(
    "january february march april may june july august september october november december".split(), 1)}
MON.update({m[:3]: i for m, i in list(MON.items())})


def parse_as_of(text: str, year_hint: int | None = None) -> dt.date | None:
    if not text:
        return None
    m = ASOF_RE.search(text)
    if not m:
        return None
    raw = m.group(1)
    try:
        return dt.date.fromisoformat(raw)
    except ValueError:
        pass
    parts = raw.replace(",", "").split()
    if len(parts) != 2:
        return None
    mon = MON.get(parts[0].lower())
    if not mon:
        return None
    day = int(parts[1])
    y = year_hint or dt.date.today().year
    return dt.date(y, mon, day)


def readings_from(d: dict) -> list[tuple[dt.date, float, str | None]]:
    """Collect (as_of, hours, read_day) from window_readings + daily rows."""
    out: dict[dt.date, tuple[float, str | None]] = {}
    wr = d.get("window_readings") or {}
    for key in ("start", "end", "7d_start"):
        r = wr.get(key) or {}
        if r.get("as_of") is not None and r.get("hours") is not None:
            a = dt.date.fromisoformat(str(r["as_of"])[:10])
            out[a] = (float(r["hours"]), r.get("read"))
    for row in d.get("daily") or []:
        hours = row.get("hours")
        if hours is None:
            continue
        a = None
        if row.get("as_of"):
            a = dt.date.fromisoformat(str(row["as_of"])[:10])
        else:
            a = parse_as_of(row.get("note") or "", year_hint=int(str(row.get("day", "2026"))[:4]))
        if a:
            out[a] = (float(hours), row.get("day"))
    return sorted((a, h, rd) for a, (h, rd) in out.items())


def nearest_on_or_before(readings, target: dt.date):
    cands = [r for r in readings if r[0] <= target]
    return cands[-1] if cands else (None if not readings else readings[0])


def recompute_pace(d: dict, end_as_of: dt.date, end_hours: float, read_day: str) -> None:
    readings = readings_from(d)
    # ensure end is present
    readings = [r for r in readings if r[0] != end_as_of]
    readings.append((end_as_of, float(end_hours), read_day))
    readings.sort(key=lambda r: r[0])

    start = nearest_on_or_before(readings, end_as_of - dt.timedelta(days=28))
    seven = nearest_on_or_before(readings, end_as_of - dt.timedelta(days=7))
    if not start or start[0] >= end_as_of:
        raise SystemExit(f"cannot build 28d window: start={start} end={end_as_of}")
    days_28 = (end_as_of - start[0]).days
    if days_28 <= 0:
        raise SystemExit("28d window length must be > 0")
    pace_28 = round((end_hours - start[1]) / days_28, 2)
    if seven and seven[0] < end_as_of:
        days_7 = (end_as_of - seven[0]).days
        pace_7 = round((end_hours - seven[1]) / days_7, 2) if days_7 > 0 else pace_28
    else:
        pace_7 = pace_28

    deadline = dt.date.fromisoformat(d["deadline"])
    goal = float(d["goal_hours"])

    def project(milestone: float) -> tuple[dt.date | None, float | None]:
        if end_hours >= milestone:
            return end_as_of, 0.0
        if pace_28 <= 0:
            return None, None
        days_needed = (milestone - end_hours) / pace_28
        return end_as_of + dt.timedelta(days=days_needed), days_needed

    new_cps = []
    for cp in d.get("checkpoints") or []:
        mh = float(cp["hours"])
        target = dt.date.fromisoformat(cp["target"])
        proj, days_from = project(mh)
        old_by = cp.get("by") or cp.get("projected")
        if proj is None:
            status, dvs, by = "behind", None, None
        else:
            dvs = (proj - target).days
            status = "on track" if proj <= target else "behind"
            by = proj.isoformat()
        new_cps.append({
            **{k: v for k, v in cp.items() if k not in ("by", "old_by", "days_from_as_of", "projected", "status", "days_vs_target")},
            "hours": mh,
            "by": by,
            "old_by": old_by,
            "days_from_as_of": None if days_from is None else round(days_from, 1),
            "target": target.isoformat(),
            "projected": by,
            "status": status,
            "days_vs_target": dvs,
        })

    goal_proj, _ = project(goal)
    if goal_proj is None:
        overall, note = "behind", f"{goal:g} h: cannot project (non-positive pace)"
    else:
        dvs = (goal_proj - deadline).days
        overall = "on track" if goal_proj <= deadline else "behind"
        rel = f"on track by {-dvs} days" if dvs <= 0 else f"behind by {dvs} days"
        note = f"{goal:g} h projected {goal_proj.isoformat()} at {pace_28} h/day (28d) vs target {deadline.isoformat()}: {rel}"

    d["pace_h_per_day"] = pace_28
    d["pace_7d_h_per_day"] = pace_7
    d["window_start"] = start[0].isoformat()
    d["window_end"] = end_as_of.isoformat()
    d["window_readings"] = {
        "start": {"as_of": start[0].isoformat(), "hours": start[1], "read": start[2]},
        "end": {"as_of": end_as_of.isoformat(), "hours": float(end_hours), "read": read_day},
        "7d_start": {
            "as_of": (seven[0].isoformat() if seven else start[0].isoformat()),
            "hours": (seven[1] if seven else start[1]),
            "read": (seven[2] if seven else start[2]),
        },
    }
    d["method"] = (
        f"Dates = as-of {end_as_of.isoformat()} + (milestone - {end_hours:g}) / {pace_28} h/day, "
        f"the 28-day trailing pace ({start[1]:g} h as of {start[0].isoformat()} to {end_hours:g} h as of {end_as_of.isoformat()}, "
        f"Studio Earn as-of dates). 7-day pace {pace_7} h/day"
        + (f" ({seven[1]:g} h as of {seven[0].isoformat()})" if seven else "")
        + ". Approximate: qualified hours are a rolling 365-day window, so old hours expire."
    )
    d["checkpoints"] = new_cps
    d["overall_status"] = overall
    d["overall_note"] = note


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--day", default=dt.date.today().isoformat())
    p.add_argument("--hours", type=float, required=True)
    p.add_argument("--as-of", required=True, help="Studio Earn 'as of' date YYYY-MM-DD (not the read day)")
    p.add_argument("--mixes", type=int, default=0)
    p.add_argument("--shorts", type=int, default=0)
    p.add_argument("--live", action="store_true")
    p.add_argument("--subs", type=int)
    p.add_argument("--note", default="")
    p.add_argument("--mix")
    p.add_argument("--h7", type=float)
    p.add_argument("--h14", type=float)
    p.add_argument("--status", nargs=2, metavar=("ID", "STATUS"))
    a = p.parse_args()
    as_of = dt.date.fromisoformat(a.as_of)

    d = json.load(open(F))
    rows = [r for r in d["daily"] if r["day"] != a.day]
    prev = max((r for r in rows if r["day"] < a.day), key=lambda r: r["day"], default=None)
    note = a.note
    if f"as of" not in note.lower():
        note = (note + " " if note else "") + f"Studio Earn {a.hours:g} (as of {as_of.isoformat()})."
    row = {
        "day": a.day,
        "hours": a.hours,
        "as_of": as_of.isoformat(),
        "added24": round(a.hours - prev["hours"], 1) if prev else None,
        "mixes": a.mixes,
        "shorts": a.shorts,
        "live": a.live,
        "subs": a.subs,
        "note": note.strip(),
    }
    rows.append(row)
    d["daily"] = sorted(rows, key=lambda r: r["day"])
    for m in d.get("mixes") or []:
        if a.mix == m["id"]:
            if a.h7 is not None:
                m["h7"] = a.h7
            if a.h14 is not None:
                m["h14"] = a.h14
        if a.status and a.status[0] == m["id"]:
            m["status"] = a.status[1]

    recompute_pace(d, as_of, a.hours, a.day)
    json.dump(d, open(F, "w"), ensure_ascii=False, indent=1)
    print("ok daily", d["daily"][-1])
    print("ok pace", d["pace_h_per_day"], "7d", d["pace_7d_h_per_day"], d["overall_status"], d["overall_note"])


if __name__ == "__main__":
    main()
