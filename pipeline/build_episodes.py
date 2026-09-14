"""Build price windows and break statistics for curated episodes.

Input : data/curated/episodes.json, BIS daily/monthly, Yahoo closes
Output: data/processed/episodes.json

Convention: rates are local currency per unit of anchor. 'Value change' of the local currency
is base/x - 1, so a depreciation is negative (-0.25 = the currency lost 25% of its value).
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from common import CURATED, PROCESSED, bis_series, despike, load_yahoo, write_json

DAILY_OFFSETS = {"1d": 1, "1w": 5, "1m": 21, "3m": 63, "6m": 126, "12m": 252, "24m": 504}
MONTHLY_OFFSETS = {"1m": 1, "3m": 3, "6m": 6, "12m": 12, "24m": 24}


def main():
    cur = json.loads((CURATED / "episodes.json").read_text(encoding="utf-8"))
    bis_d, bis_m = bis_series("D"), bis_series("M")
    yahoo = load_yahoo()

    def series_for(spec):
        src = spec["source"]
        if src == "bis_d":
            s, freq = bis_d.get(spec["area"]), "D"
            anchor = bis_d.get(spec.get("anchor_area")) if spec.get("anchor_area") else None
        elif src == "bis_m":
            s, freq = bis_m.get(spec["area"]), "M"
            anchor = bis_m.get(spec.get("anchor_area")) if spec.get("anchor_area") else None
        elif src == "yahoo":
            t = spec["ticker"]
            s = despike(yahoo[t]) if t in yahoo else None
            freq, anchor = "D", None
        else:
            raise ValueError(src)
        if s is None or s.empty:
            return None, freq
        if anchor is not None:
            s = (s / anchor.reindex(s.index)).dropna()
        return s, freq

    out = []
    for ep in cur["episodes"]:
        d0 = pd.Timestamp(ep["date"])
        lo, hi = ep.get("window", [-365, 730])
        rec = {k: v for k, v in ep.items() if k != "series"}
        rec["series"] = []
        for i, spec in enumerate(ep["series"]):
            s, freq = series_for(spec)
            entry = {k: v for k, v in spec.items()}
            entry["freq"] = freq
            if s is None:
                entry["missing"] = True
                rec["series"].append(entry)
                print(f"  {ep['id']}: no data for {spec}")
                continue
            w = s.loc[d0 + pd.Timedelta(days=lo): d0 + pd.Timedelta(days=hi)]
            before = s.loc[: d0 - pd.Timedelta(days=1)]
            if w.empty or before.empty:
                entry["missing"] = True
                rec["series"].append(entry)
                print(f"  {ep['id']}: no data in window for {spec}")
                continue
            entry["t"] = [int((ix - d0).days) for ix in w.index]
            entry["v"] = [float(f"{x:.6g}") for x in w.values]

            base_date, base = before.index[-1], float(before.iloc[-1])
            after = s.loc[d0:]
            offsets = DAILY_OFFSETS if freq == "D" else MONTHLY_OFFSETS
            stats = {"base_date": base_date.strftime("%Y-%m-%d"), "base": base, "chg": {}}
            for lab, k in offsets.items():
                if len(after) >= k:
                    stats["chg"][lab] = base / float(after.iloc[k - 1]) - 1
            for lab, k in (("12m", 252 if freq == "D" else 12), ("24m", 504 if freq == "D" else 24)):
                seg = after.iloc[:k]
                if len(seg):
                    vals = base / seg - 1
                    stats[f"max_dep_{lab}"] = float(vals.min())
                    stats[f"max_app_{lab}"] = float(vals.max())
                    stats[f"trough_date_{lab}"] = vals.idxmin().strftime("%Y-%m-%d")
            k_pre = 252 if freq == "D" else 12
            if len(before) > k_pre:
                stats["pre_12m"] = float(before.iloc[-k_pre - 1]) / base - 1
            if freq == "D":
                near = s.loc[d0 - pd.Timedelta(days=14): d0 + pd.Timedelta(days=14)]
                r = np.log(near).diff().dropna()
                if len(r):
                    j = r.abs().idxmax()
                    stats["largest_move_near_date"] = {"date": j.strftime("%Y-%m-%d"), "value_change": float(np.exp(-r[j]) - 1)}
                pre = np.log(before.iloc[-64:]).diff().dropna()
                if len(pre) > 20:
                    stats["pre_vol_3m_ann"] = float(pre.std() * np.sqrt(252))
            if ep.get("peg"):
                stats["max_dev_from_peg"] = float((w / ep["peg"] - 1).abs().max())
            entry["stats"] = stats
            rec["series"].append(entry)
        out.append(rec)

    write_json({"episodes": out}, PROCESSED / "episodes.json")
    for r in out:
        s0 = next((s for s in r["series"] if not s.get("missing")), None)
        if s0 is None:
            print(f"{r['id']:10s} NO DATA")
            continue
        st = s0["stats"]
        lm = st.get("largest_move_near_date", {})
        print(f"{r['id']:10s} {s0['key']:8s} 1m={st['chg'].get('1m', float('nan')):+.3f} 12m={st['chg'].get('12m', float('nan')):+.3f} "
              f"maxdep24={st.get('max_dep_24m', float('nan')):+.3f} jump={lm.get('date')} {lm.get('value_change', float('nan')):+.3f}")


if __name__ == "__main__":
    main()
