"""GCC peg monitor: onshore (BIS) vs offshore-proxy (Yahoo) spot, deviation from parity, Brent.

Output: data/processed/gcc.json
"""
from __future__ import annotations

import pandas as pd

from common import PROCESSED, RAW, bis_series, despike, load_yahoo, write_json

PEGS = {
    "SAR": {"area": "SA", "ticker": "SAR=X", "parity": 3.75, "country": "Saudi Arabia", "since": "1986"},
    "AED": {"area": "AE", "ticker": "AED=X", "parity": 3.6725, "country": "UAE", "since": "1997 (de facto 1980)"},
    "QAR": {"area": "QA", "ticker": "QAR=X", "parity": 3.64, "country": "Qatar", "since": "2001 (de facto 1980)"},
    "BHD": {"area": "BH", "ticker": "BHD=X", "parity": 0.376, "country": "Bahrain", "since": "2001 (de facto 1980)"},
    "OMR": {"area": "OM", "ticker": "OMR=X", "parity": 0.3845, "country": "Oman", "since": "1986"},
    "KWD": {"area": "KW", "ticker": "KWD=X", "parity": None, "country": "Kuwait", "since": "Basket since 2007"},
}
START = "2005-01-01"


def persistent_only(s: pd.Series, parity: float, thresh: float = 0.003, min_run: int = 5) -> pd.Series:
    """For a pegged pair, keep an off-parity print only if it belongs to a run of at least
    `min_run` consecutive observations deviating the same way. Genuine offshore dislocations
    (QAR 2017: months) survive; one- to four-day bad ticks (common in Yahoo) are dropped."""
    dev = s / parity - 1
    sign = dev.where(dev.abs() > thresh, 0).apply(lambda x: 1 if x > 0 else -1 if x < 0 else 0)
    run_id = (sign != sign.shift()).cumsum()
    run_len = sign.groupby(run_id).transform("size")
    return s[(sign == 0) | (run_len >= min_run)]


def compress(s: pd.Series, decimals: int):
    """[[date, value], ...] keeping only points where the rounded value changes (plus the last)."""
    s = s.round(decimals)
    keep = s.ne(s.shift())
    keep.iloc[-1] = True
    s = s[keep]
    return [[d.strftime("%Y-%m-%d"), float(v)] for d, v in s.items()]


def main():
    bis_d = bis_series("D")
    yahoo = load_yahoo()
    out = {"pegs": {}, "notes": [
        "Onshore = BIS daily reference rates (central-bank/official fixing sources).",
        "Offshore proxy = Yahoo Finance composite dealer closes, despiked. Yahoo is not an authoritative "
        "offshore fixing; use it to spot dislocations (e.g. QAR 2017), then confirm with a Bloomberg/Refinitiv source.",
    ]}
    for ccy, p in PEGS.items():
        rec = {k: v for k, v in p.items()}
        dec = 5 if p["parity"] and p["parity"] < 1 else 4
        on = bis_d.get(p["area"])
        if on is not None:
            on = on.loc[START:]
            rec["onshore"] = compress(on, dec)
            rec["onshore_last"] = [on.index[-1].strftime("%Y-%m-%d"), float(on.iloc[-1])]
        if p["ticker"] in yahoo:
            off = despike(yahoo[p["ticker"]].loc[START:], min_thresh=0.006 if p["parity"] else 0.02)
            if p["parity"]:
                off = persistent_only(off, p["parity"])
            rec["offshore"] = compress(off, dec)
            rec["offshore_last"] = [off.index[-1].strftime("%Y-%m-%d"), float(off.iloc[-1])]
            if p["parity"]:
                # data-quality check on the raw (unfiltered) proxy over the last 180 days
                raw = yahoo[p["ticker"]].dropna()
                raw = raw.loc[raw.index[-1] - pd.Timedelta(days=180):]
                rdev = (raw / p["parity"] - 1) * 1e4
                offp = rdev[rdev.abs() > 30]
                share = len(offp) / max(1, len(rdev))
                med = float(offp.median()) if len(offp) else 0.0
                side = "strong" if len(offp) and (offp < 0).mean() > 0.8 else "weak" if len(offp) and (offp > 0).mean() > 0.8 else "mixed"
                onshore_at_par = on is not None and abs(float(on.iloc[-1]) / p["parity"] - 1) < 0.002
                suspect = share >= 0.2 and abs(med) >= 100 and side == "strong" and onshore_at_par
                rec["offshore_quality"] = {
                    "window_days": 180, "share_off_parity": share, "median_dev_off_bp": med, "side": side, "suspect": suspect,
                    "note": ("Over the last 180 days {:.0%} of Yahoo prints sit more than 30bp from parity (median {:+.0f}bp), on the STRONG side, "
                             "while onshore is at parity. Genuine stress shows up on the weak side, and no news or CDS move corroborates this, "
                             "so treat these prints as a data artefact.").format(share, med) if suspect else None,
                }
                dev = (off / p["parity"] - 1) * 1e4
                recent = dev.loc[off.index[-1] - pd.Timedelta(days=365):]
                rec["offshore_dev_bp"] = {
                    "last": float(dev.iloc[-1]),
                    "max_abs_90d": float(dev.loc[off.index[-1] - pd.Timedelta(days=90):].abs().max()),
                    "max_abs_365d": float(recent.abs().max()),
                    "median_abs_365d": float(recent.abs().median()),
                }
        out["pegs"][ccy] = rec

    fred = RAW / "brent.csv"
    if fred.exists() and fred.stat().st_size > 1000:
        brent = pd.read_csv(fred)
        brent.columns = ["date", "value"]
        brent["value"] = pd.to_numeric(brent["value"], errors="coerce")
        brent = brent.dropna()
        b = pd.Series(brent["value"].values, index=pd.to_datetime(brent["date"]))
        out["brent_source"] = "EIA Brent spot (DCOILBRENTEU) via the FRED® API"
        out["fred_api"] = True  # FRED API terms: app must display their notice (web/js/app.js does)
    else:
        b = yahoo["BZ=F"].dropna()
        out["brent_source"] = "Yahoo BZ=F (ICE Brent front-month futures)"
    b = b.loc[START:]
    out["brent"] = [[d.strftime("%Y-%m-%d"), round(float(v), 2)] for d, v in b.items()]
    out["brent_last"] = out["brent"][-1]
    write_json(out, PROCESSED / "gcc.json")
    for c, r in out["pegs"].items():
        print(c, r.get("onshore_last"), r.get("offshore_last"), r.get("offshore_dev_bp"))


if __name__ == "__main__":
    main()
