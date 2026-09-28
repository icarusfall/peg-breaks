"""Vulnerability screen: how today's surviving pegs look on the indicators free data can see,
and how those indicators performed before past breaks.

Output: data/processed/screen.json

Indicators (monthly BIS rates vs the peg's anchor):
  drift_since_ref  value change from the spell's reference level (H2 2019, or its first 6 months) to the latest month
  band_12m         largest deviation from the median of the last 12 months: how much the rate moves inside its band
Both are what a peg looks like when a central bank starts letting the rate slip. Reserves, forward
points and parallel-market rates - the indicators that matter most - are not in the free data.

The signal test compares 12-month windows that preceded a break with all other pegged windows, and
reports a Kaminsky-Lizondo-Reinhart style noise-to-signal ratio (below 1 = informative).
"""
from __future__ import annotations

import json
from datetime import date

import numpy as np
import pandas as pd

from common import CURATED, GCC, PROCESSED, bis_series, write_json

ANCHOR_BIS = {"USD": "US", "EUR": "XM", "GBP": "GB", "DEM": "DE", "FRF": "FR", "INR": "IN", "ZAR": "ZA",
              "AUD": "AU", "SDR": "XW", "XDR": "XW", "CHF": "CH", "SGD": "SG", "NZD": "NZ", "HKD": "HK", "NLG": "NL"}
YAHOO_FOR = {"SAU": "SAR=X", "ARE": "AED=X", "QAT": "QAR=X", "BHR": "BHD=X", "OMN": "OMR=X", "KWT": "KWD=X", "HKG": "HKD=X", "JOR": "JOD=X"}


def rel_series(bis: dict, iso2: str | None, anchor: str | None) -> pd.Series | None:
    """log(local per anchor), monthly."""
    if not iso2 or iso2 not in bis:
        return None
    s = np.log(bis[iso2].astype(float))
    area = ANCHOR_BIS.get(anchor or "USD")
    if area == "US":
        return s
    if area and area in bis:
        return (s - np.log(bis[area].astype(float)).reindex(s.index)).dropna()
    return None


def band_and_drift(x: pd.Series, end, ref_level=None):
    """band_12m and (optionally) drift from a reference level, as value changes of the local currency."""
    w = x.loc[:end].tail(12).dropna()
    if len(w) < 6:
        return None, None
    med = w.median()
    band = float(np.exp(-(w - med)).sub(1).abs().max())
    drift = None if ref_level is None else float(np.exp(-(w.iloc[-1] - ref_level)) - 1)
    return band, drift


def main():
    reg = json.loads((PROCESSED / "regimes.json").read_text(encoding="utf-8"))
    cur = json.loads((CURATED / "current.json").read_text(encoding="utf-8"))
    bis = bis_series("M")
    countries = reg["countries"]
    spells = [s for s in reg["spells"] if s["def"] == "narrow"]
    scorecard = {r["ccy"]: r for r in cur["scorecard"]}

    # ---------- current pegs ----------
    rows = []
    for s in spells:
        if s["reason"] != "ongoing":
            continue
        iso3 = s["iso3"]
        c = countries.get(iso3, {})
        x = rel_series(bis, c.get("iso2"), s.get("anchor"))
        end = pd.Period(s["end"], "M").to_timestamp()
        band, drift = (None, None)
        if x is not None and len(x):
            ref_w = x.loc["2019-07":"2019-12"]
            if len(ref_w) < 3:
                ref_w = x.head(6)
            ref = ref_w.mean() if len(ref_w) else None
            band, drift = band_and_drift(x, end, ref)
        start = pd.Period(s["start"], "M")
        age = (pd.Period(s["end"], "M") - start).n / 12
        rows.append({
            "iso3": iso3, "country": c.get("name"), "ccy": YAHOO_FOR.get(iso3, "").replace("=X", "") or None,
            "anchor": s.get("anchor"), "since": s["start"], "age_years": round(age, 1), "data_to": s["end"],
            "hydrocarbon": c.get("hydrocarbon", False), "gcc": c.get("gcc", False),
            "band_12m": band, "drift_since_ref": drift,
        })
    for r in rows:
        sc = scorecard.get(r["ccy"] or "")
        if sc:
            r.update({"peg": sc["peg"], "buffers": sc["fx_reserves"], "breakeven": sc["fiscal_breakeven"],
                      "growth_2026": sc["imf_growth_2026"], "stress": sc["stress"], "watch": sc["watch"]})
    rows.sort(key=lambda r: (-(r["band_12m"] or 0)))

    # ---------- how these indicators behaved before past breaks ----------
    windows = []
    for s in spells:
        iso3 = s["iso3"]
        c = countries.get(iso3, {})
        x = rel_series(bis, c.get("iso2"), s.get("anchor"))
        if x is None or len(x) < 18:
            continue
        start, end = pd.Period(s["start"], "M"), pd.Period(s["end"], "M")
        broke = s["reason"] in ("exit", "realign")
        for p in pd.period_range(max(start + 11, pd.Period("1960-01", "M")), end, freq="M"):
            band, _ = band_and_drift(x, p.to_timestamp())
            if band is None:
                continue
            months_to_break = (end - p).n + 1 if broke else None
            windows.append({"iso3": iso3, "month": str(p), "band": band, "months_to_break": months_to_break,
                            "pre_break": bool(broke and months_to_break is not None and months_to_break <= 12)})
    wdf = pd.DataFrame(windows)
    signal = {}
    if len(wdf):
        thr = float(wdf["band"].quantile(0.90))
        a = int(((wdf.band > thr) & wdf.pre_break).sum())
        b = int(((wdf.band > thr) & ~wdf.pre_break).sum())
        cc = int(((wdf.band <= thr) & wdf.pre_break).sum())
        d = int(((wdf.band <= thr) & ~wdf.pre_break).sum())
        tpr = a / (a + cc) if a + cc else np.nan
        fpr = b / (b + d) if b + d else np.nan
        signal = {
            "threshold": thr, "windows": len(wdf), "pre_break_windows": int(wdf.pre_break.sum()),
            "signals_called": a + b, "true_positive_rate": tpr, "false_positive_rate": fpr,
            "noise_to_signal": (fpr / tpr) if tpr else None,
            "p_break_given_signal": a / (a + b) if a + b else None,
            "p_break_unconditional": float(wdf.pre_break.mean()),
            "median_band_pre_break": float(wdf[wdf.pre_break].band.median()) if wdf.pre_break.any() else None,
            "median_band_other": float(wdf[~wdf.pre_break].band.median()),
        }
        flagged = wdf[(wdf.band > thr) & wdf.pre_break]["months_to_break"].dropna()
        if len(flagged):
            signal["lead_months"] = {"median": float(flagged.median()), "p25": float(flagged.quantile(0.25)),
                                     "p75": float(flagged.quantile(0.75)), "share_le_3m": float((flagged <= 3).mean())}

    out = {
        "generated": date.today().isoformat(),
        "bis_latest": reg["meta"]["bis_latest"],
        "current": rows,
        "signal_test": signal,
        "notes": [
            "Indicators are limited to what free data shows: drift of the official rate inside its band. Reserves, forward points, "
            "interbank spreads and parallel-market rates - the indicators with the best track record - need a licensed feed.",
            "Curated Gulf columns (buffers, breakeven, growth, stress) come from data/curated/current.json and are dated.",
            "A high band reading on a hard peg usually means the rate is quoted with a wider spread or the anchor is a basket, not that a break is near.",
        ],
    }
    write_json(out, PROCESSED / "screen.json")
    print(f"{len(rows)} ongoing pegs; signal test: {signal}")
    for r in rows[:12]:
        print(f"  {r['country'][:22]:24s} age {r['age_years']:5.1f}y  band {(r['band_12m'] or 0) * 100:6.2f}%  drift {(r['drift_since_ref'] or 0) * 100:+7.2f}%")


if __name__ == "__main__":
    main()
