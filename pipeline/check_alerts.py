"""Post-refresh checks: flag anything that deserves a human look.

Writes data/processed/alerts.json (the app shows these) and prints a summary. Sets
has_alerts=true in $GITHUB_OUTPUT so the refresh workflow can open an issue.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime

import pandas as pd

from common import PROCESSED, write_json

ONSHORE_BP = 25      # BIS onshore rate this far from parity
OFFSHORE_BP = 50     # persistent offshore-proxy gap (quality-flagged series ignored)
STALE_DAYS = 75      # BIS monthly data older than this


def main():
    gcc = json.loads((PROCESSED / "gcc.json").read_text(encoding="utf-8"))
    reg = json.loads((PROCESSED / "regimes.json").read_text(encoding="utf-8"))
    alerts = []

    for ccy, p in gcc["pegs"].items():
        parity = p.get("parity")
        if parity and p.get("onshore_last"):
            d, v = p["onshore_last"]
            bp = (v / parity - 1) * 1e4
            if abs(bp) > ONSHORE_BP:
                alerts.append({"level": "high", "ccy": ccy,
                               "message": f"{ccy} onshore (BIS) at {v} on {d}, {bp:+.0f}bp from parity {parity}"})
        q = p.get("offshore_quality") or {}
        dev = p.get("offshore_dev_bp") or {}
        if parity and not q.get("suspect") and dev.get("median_abs_365d", 0) > OFFSHORE_BP:
            alerts.append({"level": "medium", "ccy": ccy,
                           "message": f"{ccy} offshore proxy median gap {dev['median_abs_365d']:.0f}bp over the last year"})

    latest = reg["meta"]["bis_latest"]
    age = (pd.Timestamp.today().to_period("M") - pd.Period(latest, "M")).n
    if age * 30 > STALE_DAYS:
        alerts.append({"level": "medium", "ccy": None, "message": f"BIS data ends {latest}, {age} months ago"})

    cur_path = PROCESSED.parent / "curated" / "current.json"
    as_of = json.loads(cur_path.read_text(encoding="utf-8"))["as_of"]
    days = (date.today() - datetime.fromisoformat(as_of).date()).days
    if days > 45:
        alerts.append({"level": "low", "ccy": None,
                       "message": f"Curated briefing (current.json) is {days} days old - review the Gulf page narrative"})

    out = {"generated": date.today().isoformat(), "alerts": alerts}
    write_json(out, PROCESSED / "alerts.json")
    for a in alerts:
        print(f"[{a['level']}] {a['message']}")
    if not alerts:
        print("no alerts")
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a", encoding="utf-8") as f:
            f.write(f"has_alerts={'true' if alerts else 'false'}\n")
            f.write("summary<<EOF\n" + ("\n".join(f"- [{a['level']}] {a['message']}" for a in alerts) or "none") + "\nEOF\n")


if __name__ == "__main__":
    main()
