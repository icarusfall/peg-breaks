"""Download raw inputs into data/raw/ (not committed).

    python fetch_raw.py            # everything missing
    python fetch_raw.py --force    # re-download everything
    python fetch_raw.py --only market

Sources
  irr     Ilzetzki-Reinhart-Rogoff de facto regime classification + anchor currencies (xlsx)
  bis     BIS US dollar exchange rates bulk file, filtered to daily & monthly averages
  market  Yahoo Finance closes for offshore / episode currencies (+ Brent futures), and
          optionally FRED Brent via the official API (set FRED_API_KEY; scraping is not permitted)

Be a polite client: this is a monthly batch job, requests are sequential with pauses,
and each source is downloaded once (use --force only when you actually need a refresh).
"""
from __future__ import annotations

import argparse
import io
import os
import time
import zipfile

import pandas as pd
import requests

from common import RAW

IRR_FILES = {
    "irr_monthly.xlsx": "https://www.ilzetzki.com/_files/ugd/b3763a_242513d0fba24aa1a64be41c8f73d887.xlsx?dn=ERA_Classification_Monthly_1940-2019.xlsx",
    "irr_anchor.xlsx": "https://www.ilzetzki.com/_files/ugd/b3763a_7b72377cfe184f72ba0ad77dabbabae0.xlsx?dn=Anchor_monthly_1946-2019.xlsx",
}
BIS_BULK = "https://data.bis.org/static/bulk/WS_XRU_csv_flat.zip"
FRED_API = "https://api.stlouisfed.org/fred/series/observations"
POLITE_PAUSE = 2.0  # seconds between requests to the same host

# Yahoo tickers are quoted as units of the second currency per first (USD base unless EURxxx).
# Yahoo FX closes are composite dealer quotes, so for pegged currencies they tend to capture
# OFFSHORE pricing - useful as a proxy for dislocations like QAR in 2017, but noisy: bad ticks
# are filtered downstream.
YAHOO_TICKERS = [
    "SAR=X", "AED=X", "QAR=X", "BHD=X", "OMR=X", "KWD=X", "JOD=X",
    "EGP=X", "NGN=X", "KZT=X", "IQD=X", "LBP=X", "BOB=X", "RUB=X", "CNY=X", "LYD=X", "UAH=X",
    "LKR=X", "ARS=X", "TRY=X", "HKD=X", "TMT=X", "BYN=X", "VND=X", "ETB=X", "GHS=X", "PKR=X",
    "EURCHF=X", "EURDKK=X", "EURCZK=X",
    "BZ=F",  # Brent futures, fallback when FRED is unreachable
]


def get(url: str, **kw) -> requests.Response:
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=300, headers={"User-Agent": "peg-breaks-research/1.0"}, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            print(f"  retry {attempt + 1}: {e}")
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def fetch_irr(force: bool):
    for name, url in IRR_FILES.items():
        p = RAW / name
        if p.exists() and not force:
            continue
        print("irr:", name)
        p.write_bytes(get(url).content)
        time.sleep(POLITE_PAUSE)


def fetch_bis(force: bool):
    p = RAW / "bis_xru_DM.csv.gz"
    if p.exists() and not force:
        return
    print("bis: downloading bulk file (~10 MB zipped, ~450 MB unzipped)")
    z = zipfile.ZipFile(io.BytesIO(get(BIS_BULK).content))
    name = [n for n in z.namelist() if n.endswith(".csv")][0]
    out = []
    with z.open(name) as f:
        for ch in pd.read_csv(f, usecols=[3, 4, 5, 6, 7, 8], chunksize=2_000_000, dtype=str):
            ch.columns = ["freq", "area", "ccy", "coll", "date", "value"]
            ch = ch[ch["coll"].str.startswith("A") & ch["freq"].str[0].isin(["D", "M"])]
            out.append(ch)
    df = pd.concat(out)
    for c in ["freq", "area", "ccy", "coll"]:
        df[c] = df[c].str.split(":").str[0]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["value"])
    df.to_csv(p, index=False, compression="gzip")
    print(f"bis: {len(df):,} rows")


def fetch_market(force: bool):
    p = RAW / "brent.csv"
    key = os.environ.get("FRED_API_KEY")
    if (force or not p.exists()) and key:
        # FRED terms prohibit scraping fredgraph.csv; the API with a registered key is the permitted route.
        # One series, one request. Brent (DCOILBRENTEU) is EIA data redistributed by FRED.
        print("fred api: DCOILBRENTEU")
        r = requests.get(FRED_API, params={"series_id": "DCOILBRENTEU", "api_key": key, "file_type": "json"}, timeout=60)
        r.raise_for_status()
        obs = pd.DataFrame(r.json()["observations"])[["date", "value"]]
        obs.to_csv(p, index=False)
        time.sleep(POLITE_PAUSE)
    elif not key:
        print("fred: FRED_API_KEY not set; skipping (build_gcc uses Yahoo BZ=F instead)")
    p = RAW / "yahoo_close.csv"
    if force or not p.exists():
        import yfinance as yf

        # Yahoo's terms restrict automated collection/redistribution: personal research use only.
        # Sequential (threads=False) to keep request volume modest.
        print(f"yahoo: {len(YAHOO_TICKERS)} tickers, sequential")
        d = yf.download(YAHOO_TICKERS, start="2000-01-01", progress=False, auto_adjust=False, threads=False)["Close"]
        d.index.name = "date"
        d.to_csv(p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", choices=["irr", "bis", "market"])
    a = ap.parse_args()
    steps = {"irr": fetch_irr, "bis": fetch_bis, "market": fetch_market}
    for k, fn in steps.items():
        if a.only in (None, k):
            fn(a.force)


if __name__ == "__main__":
    main()
