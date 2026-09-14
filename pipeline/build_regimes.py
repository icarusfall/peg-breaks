"""Build peg spells from the Ilzetzki-Reinhart-Rogoff (IRR) de facto regime classification.

Output: data/processed/regimes.json

A *spell* is a run of consecutive months in which a country is classified as pegged.
Spells end in one of:
  exit     - regime moves to a non-peg code (crawl, band, float, freely falling, dual market)
  realign  - still classed as a peg, but the rate vs the anchor jumped >=5% (e.g. a step
             devaluation and re-peg). Stored at >=5%; the UI chooses the threshold that counts.
  union    - country joined a currency union / dollarised (IRR code 1) -> censored, not a break
  gap      - classification missing -> censored
  ongoing  - still pegged at the end of the data -> censored

IRR ends in 2019-12. Spells still pegged then are extended to the latest BIS month: an exit
is recorded the first month the rate vs the anchor moves more than 5% from its H2-2019 level.
"""
from __future__ import annotations

import difflib
import re
from datetime import date

import numpy as np
import pandas as pd
import pycountry

from common import GCC, HYDROCARBON_EXPORTERS, PROCESSED, RAW, load_bis, write_json

PEG_DEFS = {"narrow": {2, 3, 4}, "broad": {2, 3, 4, 5, 6, 7, 8}}
REALIGN_MIN = 0.05
EXT_BAND = 0.05
MERGE_GAP = 2
MERGE_TOL = 0.02
IRR_END = pd.Period("2019-12", "M")

# Known currency-union entries after the IRR sample ends (censor, don't count as breaks).
UNION_AFTER_2019 = {"HRV": "2023-01", "BGR": "2026-01"}

# Breaks after the latest BIS month, from curated sources (see data/curated/episodes.json).
# iso3 -> last pegged month
POST_SAMPLE_EXITS = {"BOL": "2026-06"}

MANUAL_ISO = {
    "UAE": "ARE", "United States": "USA", "Korea": "KOR", "Kyrgyz Rep.": "KGZ", "Lao Dem. Rep.": "LAO",
    "Syrian Arab Rep.": "SYR", "PNG": "PNG", "Montenegro": "MNE", "Micronesia": "FSM", "Curacao": "CUW",
    "Netherlands Antilles": "ANT", "West Bank and Gaza": "PSE",
}
NOT_AN_ANCHOR = {"n.a.", "nan", "", "None", "Freely_falling"}

ANCHOR_BIS = {
    "USD": "US", "GBP": "GB", "FRF": "FR", "DEM": "DE", "EUR": "XM", "YEN": "JP", "JPY": "JP",
    "INR": "IN", "ZAR": "ZA", "AUD": "AU", "RUB": "RU", "PTE": "PT", "ESP": "ES", "BEF": "BE",
    "ITL": "IT", "SDR": "XW", "XDR": "XW", "CHF": "CH", "SGD": "SG", "NZD": "NZ", "HKD": "HK",
    "NLG": "NL",
}

FINE_CODES = {
    1: "No separate legal tender or currency union",
    2: "Pre-announced peg or currency board",
    3: "Pre-announced horizontal band <= +/-2%",
    4: "De facto peg",
    5: "Pre-announced crawling peg; de facto moving band <= +/-1%",
    6: "Pre-announced crawling band <= +/-2%; de facto horizontal band <= +/-2%",
    7: "De facto crawling peg",
    8: "De facto crawling band <= +/-2%",
    9: "Pre-announced crawling band >= +/-2%",
    10: "De facto crawling band <= +/-5%; moving band <= +/-2%",
    11: "Moving band <= +/-2%",
    12: "De facto moving band +/-5%; managed floating",
    13: "Freely floating",
    14: "Freely falling",
    15: "Dual market in which parallel market data is missing",
}


def norm(s: str) -> str:
    s = s.lower()
    s = re.sub(r"\b(rep\.? of|republic of|kingdom of|the|pr|sar|islamic|arab|state of|fed\.?|democratic|dem\.?)\b", " ", s)
    return re.sub(r"[^a-z]", "", s)


def load_fine() -> pd.DataFrame:
    raw = pd.read_excel(RAW / "irr_monthly.xlsx", sheet_name="Fine", header=None)
    names = (raw.iloc[4, 2:].fillna("").astype(str) + " " + raw.iloc[5, 2:].fillna("").astype(str))
    names = names.str.replace(r"\s+", " ", regex=True).str.strip().tolist()
    body = raw.iloc[7:, 1:].copy()
    body.columns = ["month"] + names
    body = body[body["month"].astype(str).str.match(r"^\d{4}M\d+$")]
    body = body.loc[:, [c for c in body.columns if c]]
    body.index = pd.PeriodIndex([pd.Period(m.replace("M", "-"), "M") for m in body.pop("month")], freq="M")
    return body.apply(pd.to_numeric, errors="coerce")


def load_anchor() -> tuple[pd.DataFrame, dict]:
    a = pd.read_excel(RAW / "irr_anchor.xlsx", sheet_name="Master", header=None)
    iso = a.iloc[5, 1:].astype(str).str.strip().tolist()
    cname = a.iloc[6, 1:].astype(str).str.strip().tolist()
    body = a.iloc[10:, :].copy()
    body = body[body.iloc[:, 0].astype(str).str.match(r"^\d{4}M\d+$")]
    idx = pd.PeriodIndex([pd.Period(str(m).replace("M", "-"), "M") for m in body.iloc[:, 0]], freq="M")
    body = body.iloc[:, 1:]
    body.columns = iso
    body.index = idx
    return body, dict(zip(iso, cname))


def iso2_for(iso3: str) -> str | None:
    c = pycountry.countries.get(alpha_3=iso3)
    return c.alpha_2 if c else None


def bis_monthly_logs() -> dict[str, pd.Series]:
    """area -> log(local currency per USD), monthly PeriodIndex."""
    m = load_bis("M")
    out = {}
    for area, g in m.groupby("area"):
        # pick the currency series with most observations (areas occasionally have >1)
        ccy = g.groupby("ccy").size().idxmax()
        g = g[g["ccy"] == ccy]
        s = pd.Series(np.log(g["value"].astype(float).values),
                      index=pd.PeriodIndex(g["date"], freq="M")).sort_index()
        s = s[~s.index.duplicated()]
        out[area] = s
    out["US"] = pd.Series(0.0, index=pd.period_range("1940-01", "2030-12", freq="M"))
    return out


def runs(mask: pd.Series):
    """Yield (start, end) Periods for contiguous True runs."""
    start = None
    prev = None
    for p, v in mask.items():
        if v and start is None:
            start = p
        if not v and start is not None:
            yield start, prev
            start = None
        prev = p
    if start is not None:
        yield start, prev


def value_change(x: pd.Series, base: pd.Period, k: int):
    """Change in the local currency's value between base month and base+k (negative = depreciation)."""
    a, b = x.get(base), x.get(base + k)
    if a is None or b is None or pd.isna(a) or pd.isna(b):
        return None
    return float(np.exp(-(b - a)) - 1)


def path(x: pd.Series | None, base: pd.Period, lo=-24, hi=36):
    if x is None or pd.isna(x.get(base, np.nan)):
        return None
    b = x[base]
    out = []
    for k in range(lo, hi + 1):
        v = x.get(base + k)
        out.append(None if v is None or pd.isna(v) else round(float(100 * np.exp(-(v - b))), 2))
    return out


def main():
    fine = load_fine()
    anchors, anchor_names = load_anchor()
    bis = bis_monthly_logs()

    # map IRR fine-sheet country names -> ISO3 via the anchor sheet
    anorm = {norm(n): iso for iso, n in anchor_names.items()}
    name_to_iso = {}
    for n in fine.columns:
        if n in MANUAL_ISO:
            name_to_iso[n] = MANUAL_ISO[n]
            continue
        k = norm(n)
        if k in anorm:
            name_to_iso[n] = anorm[k]
        else:
            hit = difflib.get_close_matches(k, list(anorm), n=1, cutoff=0.75)
            if hit:
                name_to_iso[n] = anorm[hit[0]]
                print(f"  fuzzy: {n!r} -> {anchor_names[anorm[hit[0]]]!r}")
            else:
                print(f"  UNMATCHED IRR country: {n!r}")

    unknown_anchor = set()
    countries = {}
    all_spells = []
    timelines = {}

    for name, iso3 in name_to_iso.items():
        if iso3 == "USA":
            continue  # the principal anchor itself
        codes = fine[name]
        first_valid = codes.first_valid_index()
        if first_valid is None:
            continue
        codes = codes.loc[first_valid:]
        iso2 = iso2_for(iso3)
        local = bis.get(iso2) if iso2 else None
        anc = anchors[iso3] if iso3 in anchors.columns else pd.Series(dtype=object)
        anc = anc.astype(str).str.strip()
        countries[iso3] = {
            "name": anchor_names.get(iso3, name), "irr_name": name, "iso2": iso2,
            "gcc": iso3 in GCC, "hydrocarbon": iso3 in HYDROCARBON_EXPORTERS,
            "bis_monthly": local is not None,
        }

        # compact regime timeline (code runs)
        tl = []
        cur, cs = None, None
        for p, v in codes.items():
            v = None if pd.isna(v) else int(v)
            if v != cur:
                if cs is not None:
                    tl.append([str(cs), str(p - 1), cur])
                cur, cs = v, p
        tl.append([str(cs), str(codes.index[-1]), cur])
        timelines[iso3] = tl

        for defn, peg_codes in PEG_DEFS.items():
            raw_runs = []
            for s, e in runs(codes.isin(peg_codes)):
                nxt = codes.get(e + 1) if e < codes.index[-1] else None
                if e >= IRR_END:
                    reason = "ongoing"
                elif nxt is None or pd.isna(nxt):
                    reason = "gap"
                elif int(nxt) == 1:
                    reason = "union"
                else:
                    reason = "exit"
                raw_runs.append({"start": s, "end": e, "reason": reason,
                                 "next_code": None if nxt is None or pd.isna(nxt) else int(nxt)})

            def anchor_for(s, e):
                w = anc.reindex(pd.period_range(max(s, e - 23), min(e, IRR_END), freq="M")).dropna()
                w = w[~w.isin(NOT_AN_ANCHOR)]
                return w.mode().iloc[0] if len(w) else None

            def rel_series(anchor):
                if local is None:
                    return None, None
                if anchor in ANCHOR_BIS and ANCHOR_BIS[anchor] in bis:
                    return local - bis[ANCHOR_BIS[anchor]].reindex(local.index), "anchor"
                if anchor is not None:
                    unknown_anchor.add(anchor)
                return None, "usd_proxy"

            # merge short classification blips where the rate barely moved
            merged = []
            for r in raw_runs:
                if merged:
                    pr = merged[-1]
                    gap = (r["start"] - pr["end"]).n - 1
                    if pr["reason"] == "exit" and gap <= MERGE_GAP:
                        x, _ = rel_series(anchor_for(pr["start"], pr["end"]))
                        ok = False
                        if x is not None and not pd.isna(x.get(pr["end"], np.nan)) and not pd.isna(x.get(r["start"], np.nan)):
                            ok = abs(np.exp(x[r["start"]] - x[pr["end"]]) - 1) < MERGE_TOL
                        elif x is None and gap <= 1:
                            ok = True
                        if ok:
                            pr["end"], pr["reason"], pr["next_code"] = r["end"], r["reason"], r["next_code"]
                            continue
                merged.append(dict(r))

            for r in merged:
                s, e = r["start"], r["end"]
                anchor = anchor_for(s, e)
                x, basis = rel_series(anchor)
                source_end = "irr"

                # extend spells still pegged at 2019-12 using BIS data
                if r["reason"] == "ongoing" and x is not None:
                    ref_w = x.reindex(pd.period_range("2019-07", "2019-12", freq="M")).dropna()
                    last = x.dropna().index.max()
                    if len(ref_w) and last > IRR_END:
                        ref = ref_w.mean()
                        union_at = UNION_AFTER_2019.get(iso3)
                        end, reason = last, "ongoing"
                        for p in pd.period_range("2020-01", last, freq="M"):
                            if union_at and p >= pd.Period(union_at, "M"):
                                end, reason = p - 1, "union"
                                break
                            v = x.get(p)
                            if v is not None and not pd.isna(v) and abs(np.exp(v - ref) - 1) > EXT_BAND:
                                end, reason = p - 1, "exit"
                                break
                        e = end
                        r["reason"] = reason
                        source_end = "bis_extension"
                if r["reason"] == "ongoing" and iso3 in POST_SAMPLE_EXITS:
                    e = pd.Period(POST_SAMPLE_EXITS[iso3], "M")
                    r["reason"] = "exit"
                    source_end = "curated"

                # split at realignments (only where we can measure vs the true anchor)
                pieces = []
                cur_s = s
                if basis == "anchor" and x is not None:
                    xs = x.reindex(pd.period_range(s, e + 1, freq="M"))
                    cands = []
                    for p in pd.period_range(s + 1, e, freq="M"):
                        a, b = xs.get(p - 1), xs.get(p + 1)
                        if a is None or b is None or pd.isna(a) or pd.isna(b):
                            continue
                        if abs(np.exp(-(b - a)) - 1) >= REALIGN_MIN:
                            cands.append(p)
                    groups, g = [], []
                    for p in cands:
                        if g and (p - g[-1]).n > 1:
                            groups.append(g)
                            g = []
                        g.append(p)
                    if g:
                        groups.append(g)
                    for g in groups:
                        opts = [p for p in set(g) | {g[-1] + 1} if s < p <= e]
                        if not opts:
                            continue
                        ev = max(opts, key=lambda p: abs((xs.get(p, np.nan) - xs.get(p - 1, np.nan)) if not pd.isna(xs.get(p, np.nan)) and not pd.isna(xs.get(p - 1, np.nan)) else 0))
                        if r["reason"] == "exit" and (e - ev).n < 2:
                            continue  # the move belongs to the exit itself
                        if ev <= cur_s:
                            continue
                        a, b = xs.get(ev - 2 if ev - 2 >= s else ev - 1), xs.get(ev + 1)
                        size = float(np.exp(-(b - a)) - 1) if not (a is None or b is None or pd.isna(a) or pd.isna(b)) else None
                        if size is None or size < -0.9 or size > 9:
                            continue  # redenomination / data break rather than a realignment
                        pieces.append((cur_s, ev - 1, "realign", size, None))
                        cur_s = ev
                pieces.append((cur_s, e, r["reason"], None, r["next_code"]))

                for ps, pe, reason, size, nxt in pieces:
                    spell = {
                        "iso3": iso3, "def": defn, "start": str(ps), "end": str(pe),
                        "months": (pe - ps).n + 1, "reason": reason, "next_code": nxt,
                        "realign_pct": size, "anchor": anchor, "basis": basis,
                        "left_censored": ps == first_valid, "end_source": source_end if pe > IRR_END or reason == "ongoing" else "irr",
                    }
                    if reason in ("exit", "realign"):
                        usd = local
                        base = pe
                        spell["chg_anchor"] = {h: value_change(x, base, h) for h in (1, 3, 6, 12, 24)} if x is not None else None
                        spell["chg_usd"] = {h: value_change(usd, base, h) for h in (1, 3, 6, 12, 24)} if usd is not None else None
                        spell["pre_anchor"] = {h: value_change(x, base - h, h) for h in (12, 24)} if x is not None else None
                        ser = x if x is not None else usd
                        if ser is not None:
                            vals = [value_change(ser, base, k) for k in range(1, 25)]
                            vals = [v for v in vals if v is not None]
                            spell["max_dep_24"] = min(vals) if vals else None
                            spell["max_app_24"] = max(vals) if vals else None
                        spell["path_anchor"] = path(x, base)
                        spell["path_usd"] = path(usd, base)
                        ev_month = pe + 1
                        spell["event"] = str(ev_month)
                        spell["bretton_woods"] = pd.Period("1971-08", "M") <= ev_month <= pd.Period("1973-12", "M")
                        if reason == "realign":
                            ref = size
                        else:
                            ch = spell["chg_anchor"] or spell["chg_usd"] or {}
                            ref = next((ch[h] for h in (12, 6, 3, 1) if ch.get(h) is not None), None)
                        spell["direction"] = None if ref is None else ("down" if ref < -0.02 else "up" if ref > 0.02 else "flat")
                    all_spells.append(spell)

    if unknown_anchor:
        print("  anchors without BIS mapping (treated as usd_proxy):", sorted(unknown_anchor))

    latest = max(str(s.dropna().index.max()) for k, s in bis.items() if k != "US")
    out = {
        "meta": {
            "generated": date.today().isoformat(),
            "irr_end": str(IRR_END), "bis_latest": latest,
            "definitions": {k: sorted(v) for k, v in PEG_DEFS.items()},
            "realign_min": REALIGN_MIN, "extension_band": EXT_BAND,
            "sources": [
                "Ilzetzki, Reinhart & Rogoff (2019, 2021) de facto classification, monthly 1940-2019, ilzetzki.com/irr-data",
                "BIS US dollar exchange rates (WS_XRU), monthly averages, data.bis.org",
            ],
        },
        "codes": FINE_CODES,
        "countries": countries,
        "timelines": timelines,
        "spells": all_spells,
    }
    write_json(out, PROCESSED / "regimes.json")

    sp = pd.DataFrame(all_spells)
    for d in PEG_DEFS:
        t = sp[sp["def"] == d]
        print(d, "spells", len(t), t["reason"].value_counts().to_dict())
    g = sp[(sp["def"] == "narrow") & (sp["iso3"].isin(GCC + ["HKG", "DNK", "BGR", "LBN", "BOL", "IRQ"]))]
    print(g[["iso3", "start", "end", "months", "reason", "realign_pct", "anchor", "basis", "end_source"]].tail(60).to_string())


if __name__ == "__main__":
    main()
