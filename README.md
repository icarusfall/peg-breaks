# Peg Break Explorer

A research tool for portfolio managers who **proxy-hedge pegged currencies** (SAR, AED, QAR) with USD. It answers four questions:

| Page | Question | What's there |
|---|---|---|
| **How likely?** | How often do pegs break, given how long they've lasted? | Kaplan–Meier survival and hazard-by-age over every de facto peg since 1946 (IRR classification, extended to 2026 with BIS data), with live filters for what counts as a break and which pegs are comparable |
| **How bad?** | If it breaks, how much does the currency lose? | Distribution of 1–24 month moves after every break, event-study fan, Gulf-specific loss scenarios, curated daily episodes |
| **Early signals** | Any clues it's imminent? | Forward-points implied-probability calculator, signal checklist with false-alarm history and a Sept 2026 Gulf reading, literature |
| **Mitigation** | What else can I do? | Direct-vs-proxy hedge cost/tail calculator, and a playbook covering triggers, tail options, settlement/fixing risk, correlated hedges and scenarios |
| **Gulf 2026** | What's going on now? | Hormuz-closure briefing, GCC scorecard, onshore vs offshore-proxy peg monitor, Brent, timeline, sources |
| **Episodes** | What actually happened? | 42 curated breaks, near misses and edge cases (Qatar 2017 offshore dislocation, Lebanon's "held" peg, Bolivia 2026, Oman 1986, Kazakhstan 2015, CHF 2015 …) |

Not investment advice. See the in-app **Method** page for definitions and limitations.

## Layout

```
app/main.py              FastAPI: serves web/ and the JSON in data/
web/                     Vanilla JS single-page app (no build step), SVG charts
data/curated/            Hand-written episode notes and the 2026 briefing (with sources)
data/processed/          Pipeline outputs served to the browser (committed)
data/raw/                Downloads (git-ignored)
pipeline/                fetch_raw.py → build_regimes.py → build_episodes.py → build_gcc.py
```

## Run locally

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8765
```

Open http://localhost:8765.

## Refresh the data

A monthly batch job. It is sequential and polite, and each source is downloaded once:

```bash
pip install -r requirements-pipeline.txt
cd pipeline
python fetch_raw.py          # add --force to re-download
python build_regimes.py
python build_episodes.py
python build_gcc.py
```

Then update `data/curated/*.json` by hand as events develop and commit `data/processed/`.

## Deploy (Railway)

The repo has a `Dockerfile` and `railway.json` (health check at `/healthz`). In Railway, create a service from this GitHub repo; it builds the Dockerfile and binds to `$PORT`. Pushes to `main` redeploy.

## Data sources and terms

- **Ilzetzki, Reinhart & Rogoff** de facto regime classification and anchor currencies, monthly 1940–2019 ([ilzetzki.com/irr-data](https://www.ilzetzki.com/irr-data)). Cite the papers.
- **BIS** US dollar exchange rates (WS_XRU), daily and monthly bulk file ([data.bis.org](https://data.bis.org)). Attribute the BIS.
- **Yahoo Finance** via `yfinance`, used for offshore-proxy quotes and Brent futures. Yahoo's terms restrict automated collection and redistribution, so this is for internal research only. Use a licensed feed (Bloomberg, LSEG) for production or wider distribution, and for the forward points, NDFs and interbank rates this tool can't source for free. Yahoo's 2026 GCC quotes are flagged in-app as a likely data artefact.
- **FRED**: its terms prohibit scraping, so the pipeline never scrapes it. If `FRED_API_KEY` is set, it makes a single API call for Brent. The app must then carry FRED's API notice, and third-party series (EIA Brent) are subject to their owners' terms.
- **News and official sources** are linked per claim in `data/curated/`.
