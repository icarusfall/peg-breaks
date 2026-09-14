"""Peg Break Explorer — static data + single-page app.

All analysis data is precomputed by the pipeline into data/processed (and hand-curated
notes live in data/curated); the browser does the interactive statistics.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

ROOT = Path(__file__).resolve().parents[1]

app = FastAPI(title="Peg Break Explorer", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.get("/healthz")
def healthz():
    return {"ok": True}


app.mount("/data/processed", StaticFiles(directory=ROOT / "data" / "processed"), name="processed")
app.mount("/data/curated", StaticFiles(directory=ROOT / "data" / "curated"), name="curated")
app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
