"""Shared paths and helpers for the data pipeline."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CURATED = ROOT / "data" / "curated"
PROCESSED = ROOT / "data" / "processed"

for _p in (RAW, PROCESSED):
    _p.mkdir(parents=True, exist_ok=True)

GCC = ["SAU", "ARE", "QAT", "BHR", "OMN", "KWT"]

# Hydrocarbon exporters where oil/gas is a dominant share of exports or fiscal revenue
# for most of the sample. Deliberately coarse: used only as a cohort filter.
HYDROCARBON_EXPORTERS = [
    "SAU", "ARE", "QAT", "BHR", "OMN", "KWT", "IRQ", "IRN", "LBY", "DZA", "NGA", "AGO",
    "GAB", "COG", "GNQ", "TCD", "VEN", "ECU", "TTO", "BRN", "KAZ", "AZE", "TKM", "RUS",
    "YEM", "SYR", "SDN", "SSD", "BOL", "TLS",
]


def clean(obj):
    """Recursively make an object JSON-safe: NaN/inf -> None, numpy -> python, round floats."""
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        f = float(obj)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 6)
    if isinstance(obj, (pd.Timestamp,)):
        return obj.strftime("%Y-%m-%d")
    if obj is pd.NaT:
        return None
    return obj


def write_json(obj, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(clean(obj), f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size/1024:.0f} KB)")


def load_bis(freq: str) -> pd.DataFrame:
    """BIS USD exchange rates (local currency per USD, period average), long format."""
    df = pd.read_csv(RAW / "bis_xru_DM.csv.gz", dtype={"area": str, "ccy": str, "date": str})
    return df[df["freq"] == freq]


def bis_series(freq: str) -> dict[str, pd.Series]:
    """area -> local currency per USD with a DatetimeIndex (monthly obs dated to month start)."""
    df = load_bis(freq)
    out = {}
    for area, g in df.groupby("area"):
        ccy = g.groupby("ccy").size().idxmax()
        g = g[g["ccy"] == ccy]
        s = pd.Series(g["value"].astype(float).values, index=pd.to_datetime(g["date"])).sort_index()
        out[area] = s[~s.index.duplicated()]
    return out


def despike(s: pd.Series, min_thresh: float = 0.02, win: int = 11) -> pd.Series:
    """Drop isolated bad ticks: points far from a centred rolling median.

    A centred median follows genuine level shifts (a devaluation persists for more than
    win/2 observations) but rejects 1-4 day spikes, which are common in Yahoo FX closes
    for thinly traded pegged currencies.
    """
    s = s.dropna()
    s = s[s > 0]
    if len(s) < win:
        return s
    lg = np.log(s)
    med = lg.rolling(win, center=True, min_periods=3).median()
    dev = (lg - med).abs()
    mad = dev.rolling(63, center=True, min_periods=10).median().fillna(0)
    bad = dev > np.maximum(min_thresh, 8 * mad)
    return s[~bad]


def load_yahoo() -> pd.DataFrame:
    return pd.read_csv(RAW / "yahoo_close.csv", index_col=0, parse_dates=True).sort_index()
