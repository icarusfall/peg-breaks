"""Bundle the processed data into downloadable files.

Output (data/processed/downloads/):
  peg_breaks_dataset.xlsx       one workbook, one sheet per table
  peg_breaks_dataset_csv.zip    the same tables as CSVs
  manifest.json                 table list for the web app's Data page

Raw Yahoo Finance prices are deliberately left out: Yahoo's terms restrict
redistribution. Statistics derived from them are included.
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import date

import pandas as pd

from common import CURATED, PROCESSED, write_json

OUT = PROCESSED / "downloads"
BASES = ["anchor", "usd", "gbp", "proxy"]
HZ = ["1", "3", "6", "12", "24"]
EP_LABELS = ["1d", "1w", "1m", "3m", "6m", "12m", "24m"]


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


def main():
    reg = load(PROCESSED / "regimes.json")
    eps = load(PROCESSED / "episodes.json")
    gcc = load(PROCESSED / "gcc.json")
    cur = load(CURATED / "current.json")
    countries, codes = reg["countries"], reg["codes"]
    tables: dict[str, tuple[pd.DataFrame, str]] = {}

    # ---- peg spells & break events ----
    rows, paths = [], []
    for s in reg["spells"]:
        c = countries.get(s["iso3"], {})
        sid = f'{s["iso3"]}-{s["def"]}-{s["start"]}'
        r = {
            "spell_id": sid, "iso3": s["iso3"], "country": c.get("name"), "definition": s["def"],
            "start": s["start"], "end": s["end"], "months": s["months"], "end_reason": s["reason"],
            "event_month": s.get("event"), "direction": s.get("direction"),
            "next_regime_code": s.get("next_code"), "next_regime": codes.get(str(s.get("next_code"))) if s.get("next_code") else None,
            "realign_pct": s.get("realign_pct"), "anchor": s.get("anchor"), "anchor_basis": s.get("basis"),
            "left_censored": s.get("left_censored"), "end_source": s.get("end_source"), "bretton_woods": s.get("bretton_woods"),
            "hydrocarbon_exporter": c.get("hydrocarbon"), "gcc": c.get("gcc"),
        }
        for b in BASES:
            ch = s.get(f"chg_{b}") or {}
            for h in HZ:
                r[f"chg_{b}_{h}m"] = ch.get(h)
            r[f"worst24m_{b}"] = (s.get("max_dep") or {}).get(b)
        pre = s.get("pre_anchor") or {}
        r["pre_12m_anchor"], r["pre_24m_anchor"] = pre.get("12"), pre.get("24")
        rows.append(r)
        for b in BASES:
            p = s.get(f"path_{b}")
            if p:
                paths.append({"spell_id": sid, "iso3": s["iso3"], "event_month": s.get("event"), "basis": b,
                              **{f"m{k:+d}": p[k + 24] for k in range(-24, 37)}})
    tables["peg_spells"] = (pd.DataFrame(rows),
        "One row per peg spell (both definitions). Spells ending in exit/realign are breaks; chg_* = value change of the local "
        "currency 1-24 months after, vs anchor / USD / GBP (unhedged) / proxy (USD-hedged GBP investor shortfall). Negative = weaker.")
    tables["break_paths"] = (pd.DataFrame(paths),
        "Monthly value index around each break, 100 = last pegged month, months -24..+36, one row per break and basis.")

    tl = [{"iso3": iso, "country": countries.get(iso, {}).get("name"), "start": a, "end": b, "irr_fine_code": code,
           "arrangement": codes.get(str(code)) if code is not None else None}
          for iso, runs in reg["timelines"].items() for a, b, code in runs]
    tables["regime_history"] = (pd.DataFrame(tl), "IRR de facto fine classification as runs of months per country (1940-2019).")
    tables["regime_codes"] = (pd.DataFrame([{"code": int(k), "arrangement": v} for k, v in codes.items()]), "IRR fine classification codes.")

    # ---- curated episodes ----
    ep_rows, ep_text, ep_dp, ep_px = [], [], [], []
    for e in eps["episodes"]:
        ep_text.append({"episode_id": e["id"], "title": e["title"], "kind": e["kind"], "country": e["country"], "date": e["date"],
                        "summary": e.get("summary"), "precursors": "; ".join(e.get("precursors") or []), "aftermath": e.get("aftermath"),
                        "hedger_lesson": e.get("hedger_lesson"), "tags": ", ".join(e.get("tags") or []),
                        "sources": " | ".join(s["url"] for s in e.get("sources") or [])})
        for d in e.get("datapoints") or []:
            ep_dp.append({"episode_id": e["id"], "date": d["date"], "label": d["label"], "value": d.get("value"), "unit": d.get("unit"), "source": d["source"]})
        for s in e["series"]:
            if s.get("missing"):
                continue
            st = s.get("stats") or {}
            r = {"episode_id": e["id"], "title": e["title"], "kind": e["kind"], "ccy": e["ccy"], "anchor": e["anchor"], "event_date": e["date"],
                 "break_type": e.get("break_type"), "series": s["key"], "series_label": s["label"], "source": s["source"], "frequency": s["freq"],
                 "base_date": st.get("base_date"), "base_rate": st.get("base"), "max_dev_from_peg": st.get("max_dev_from_peg"),
                 "largest_move_date": (st.get("largest_move_near_date") or {}).get("date"),
                 "largest_move": (st.get("largest_move_near_date") or {}).get("value_change")}
            for lab in EP_LABELS:
                r[f"chg_charted_{lab}"] = (st.get("chg") or {}).get(lab)
            r["worst24m_charted"] = st.get("max_dep_24m")
            for b in ("usd", "gbp", "proxy"):
                a = (s.get("alt") or {}).get(b) or {}
                for lab in EP_LABELS:
                    r[f"chg_{b}_{lab}"] = (a.get("chg") or {}).get(lab)
                r[f"worst24m_{b}"] = a.get("max_dep_24m")
            ep_rows.append(r)
            if s["source"] != "yahoo":  # Yahoo prices are not redistributed
                d0 = pd.Timestamp(e["date"])
                for t, v in zip(s["t"], s["v"]):
                    ep_px.append({"episode_id": e["id"], "series": s["key"], "source": s["source"],
                                  "date": (d0 + pd.Timedelta(days=t)).strftime("%Y-%m-%d"), "rate": v})
    tables["episodes"] = (pd.DataFrame(ep_text), "Curated breaks, near misses and edge cases: narrative, lessons and sources.")
    tables["episode_stats"] = (pd.DataFrame(ep_rows),
        "Measured moves per episode series: 'charted' is local per anchor as shown in the app; usd / gbp (unhedged) / proxy "
        "(USD-hedged GBP investor shortfall). Trading-day offsets for daily data, months for monthly.")
    tables["episode_evidence"] = (pd.DataFrame(ep_dp), "Dated evidence points (forward points, CDS, policy actions) with sources.")
    tables["episode_prices"] = (pd.DataFrame(ep_px),
        "BIS rates around each episode (local per anchor). Yahoo-sourced series are excluded under Yahoo's terms.")

    # ---- Gulf monitor & briefing ----
    on = [{"ccy": c, "date": d, "rate_onshore_bis": v} for c, p in gcc["pegs"].items() for d, v in p.get("onshore") or []]
    tables["gcc_onshore"] = (pd.DataFrame(on), "BIS daily reference rates for GCC currencies since 2005, change points only (rate holds until the next date).")
    q = [{"ccy": c, "parity": p.get("parity"), **{f"offshore_{k}": v for k, v in (p.get("offshore_dev_bp") or {}).items()},
          **{f"quality_{k}": v for k, v in (p.get("offshore_quality") or {}).items() if k != "note"}} for c, p in gcc["pegs"].items()]
    tables["gcc_offshore_summary"] = (pd.DataFrame(q), "Offshore-proxy deviation statistics (bp vs parity) and data-quality flags. Raw Yahoo prices not included.")
    tables["brent"] = (pd.DataFrame(gcc["brent"], columns=["date", "usd_per_bbl"]), f"Brent crude, {gcc.get('brent_source')}.")
    tables["gulf_scorecard"] = (pd.DataFrame(cur["scorecard"]), f"GCC scorecard as of {cur['as_of']} (qualitative stress = this tool's synthesis).")
    tables["gulf_timeline"] = (pd.DataFrame(cur["timeline"]), f"2026 timeline as of {cur['as_of']}, with sources.")
    tables["gulf_key_points"] = (pd.DataFrame(cur["key_points"]), f"Briefing key points as of {cur['as_of']}.")

    scr_path = PROCESSED / "screen.json"
    if scr_path.exists():
        scr = load(scr_path)
        tables["peg_screen"] = (pd.DataFrame(scr["current"]),
            "Every peg still standing at the latest data, with drift inside its band, move since the 2019 reference level, "
            "peg age, and curated Gulf buffers.")
        tables["drift_signal_test"] = (pd.json_normalize(scr["signal_test"]),
            "Measured performance of the drift indicator: hit rate, false-alarm rate, noise-to-signal ratio and lead time.")

    readme = pd.DataFrame(
        [{"table": "README", "rows": None, "description": f"Peg Break Explorer dataset, generated {date.today().isoformat()}. Research use only; not investment advice."},
         {"table": "sources", "rows": None, "description": "Ilzetzki, Reinhart & Rogoff (2019, 2021) de facto regime classification (cite); BIS US dollar exchange rates "
          "(source: BIS); EIA Brent via the FRED API (this product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis); "
          "news and official sources as linked. Yahoo Finance prices are excluded; statistics derived from them are included."}]
        + [{"table": k, "rows": len(df), "description": desc} for k, (df, desc) in tables.items()])

    OUT.mkdir(parents=True, exist_ok=True)
    xlsx = OUT / "peg_breaks_dataset.xlsx"
    with pd.ExcelWriter(xlsx, engine="openpyxl") as w:
        readme.to_excel(w, sheet_name="README", index=False)
        for k, (df, _) in tables.items():
            df.to_excel(w, sheet_name=k[:31], index=False)
    zpath = OUT / "peg_breaks_dataset_csv.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README.csv", readme.to_csv(index=False))
        for k, (df, _) in tables.items():
            z.writestr(f"{k}.csv", df.to_csv(index=False))
    manifest = {
        "generated": date.today().isoformat(),
        "files": [{"name": p.name, "bytes": p.stat().st_size} for p in (xlsx, zpath)],
        "tables": [{"name": k, "rows": len(df), "columns": len(df.columns), "description": desc} for k, (df, desc) in tables.items()],
    }
    write_json(manifest, OUT / "manifest.json")
    for f in manifest["files"]:
        print(f"{f['name']}: {f['bytes'] / 1e6:.1f} MB")
    for t in manifest["tables"]:
        print(f"  {t['name']:22s} {t['rows']:>7,} rows x {t['columns']} cols")


if __name__ == "__main__":
    main()
