import { h, pageHead, tile, card, table, baseFilters, baseState, loadJSON, pct, spct, num, fmtYM, fmtISO, field, segmented, store, save } from "../ui.js";
import { buildLives, summarize, fan } from "../stats.js";
import { lineChart, rangeChart } from "../charts.js";
import { findEpisode } from "./likelihood.js";

const opt = store("pbx.impact", { basis: "anchor" });
const HORIZONS = [1, 3, 6, 12, 24];

export function primaryStats(ep) {
  const s = ep.series.find((x) => !x.missing && x.stats);
  return s ? s.stats : null;
}

export default async function impact() {
  const [data, eps] = await Promise.all([loadJSON("data/processed/regimes.json"), loadJSON("data/processed/episodes.json")]);
  const body = h("div");
  const basisSeg = field("Measure against", segmented([["anchor", "Anchor currency"], ["usd", "US dollar"]], opt.basis, (v) => { opt.basis = v; save("pbx.impact", opt); draw(); }, "Basis"));
  const root = h("div", {},
    pageHead("If a peg breaks, how bad does it get?",
      "The change in the currency's value after every break in the sample (negative = weaker), measured from the last month on the peg. Curated daily episodes below show the first-day gap that monthly averages smooth over."),
    baseFilters(draw, [basisSeg]), body);

  function draw() {
    const lives = buildLives(data, baseState);
    const key = opt.basis === "usd" ? "chg_usd" : "chg_anchor";
    const events = lives.filter((l) => l.event).map((l) => ({ ...l.eventSpell, name: l.name, age: l.exit / 12, iso3: l.iso3 }));
    const get = (e, hz) => (e[key] && e[key][hz] !== undefined ? e[key][hz] : (opt.basis === "anchor" && e.chg_usd ? e.chg_usd[hz] : null));
    const rows = HORIZONS.map((hz) => ({ label: `${hz} month${hz > 1 ? "s" : ""}`, ...summarize(events.map((e) => get(e, hz))) }));
    rows.push({ label: "Worst in 24m", ...summarize(events.map((e) => e.max_dep_24)) });
    const s12 = rows[3];
    const vals12 = events.map((e) => get(e, 12)).filter((v) => v !== null && v !== undefined);
    const big = vals12.filter((v) => v <= -0.2).length;

    const rangeEl = h("div"), fanEl = h("div");
    const tiles = h("div", { class: "grid grid-4" },
      tile("Breaks with price data", num(s12.n), `of ${events.length} counted`),
      tile("Median change after 12 months", spct(s12.p50, 0), "half of breaks were worse"),
      tile("1-in-4 worst case (12m)", spct(s12.p25, 0), "25th percentile"),
      tile("Lost 20%+ within a year", pct(vals12.length ? big / vals12.length : NaN, 0), `${big} of ${vals12.length} breaks`),
    );

    const f = fan(events, opt.basis).filter((r) => r.ok);
    const fanCard = card({
      title: "Path around the break",
      sub: "Value of the currency, 100 = last month on the peg. Median line, middle-half band and 10th–90th percentile band across breaks. Pre-break drift is part of the signal story.",
      body: fanEl,
      tableFn: () => table([{ label: "Months from break", key: "k", r: true }, { label: "10th", key: "p10", r: true, fmt: (v) => v.toFixed(1) }, { label: "25th", key: "p25", r: true, fmt: (v) => v.toFixed(1) }, { label: "Median", key: "p50", r: true, fmt: (v) => v.toFixed(1) }, { label: "75th", key: "p75", r: true, fmt: (v) => v.toFixed(1) }, { label: "90th", key: "p90", r: true, fmt: (v) => v.toFixed(1) }, { label: "n", key: "n", r: true }], f, { maxHeight: "360px" }),
    });
    const rangeCard = card({
      title: "Distribution of value change after a break",
      sub: "Dot = median; bar = middle half of breaks; line = 10th to 90th percentile.",
      body: rangeEl,
      tableFn: () => table([{ label: "Horizon", key: "label" }, { label: "n", key: "n", r: true }, { label: "10th", key: "p10", r: true, fmt: (v) => spct(v, 1) }, { label: "25th", key: "p25", r: true, fmt: (v) => spct(v, 1) }, { label: "Median", key: "p50", r: true, fmt: (v) => spct(v, 1) }, { label: "75th", key: "p75", r: true, fmt: (v) => spct(v, 1) }, { label: "90th", key: "p90", r: true, fmt: (v) => spct(v, 1) }], rows),
    });

    // curated daily episodes
    const breaks = eps.episodes.filter((e) => e.kind === "break").map((e) => ({ e, st: primaryStats(e) })).filter((x) => x.st)
      .sort((a, b) => (a.st.chg["12m"] ?? a.st.max_dep_24m ?? 0) - (b.st.chg["12m"] ?? b.st.max_dep_24m ?? 0));
    const cls = (v) => (v < -0.0005 ? "neg" : v > 0.0005 ? "pos" : "");
    const epCard = card({
      title: "Curated episodes (daily or monthly data)",
      sub: "Changes from the last observation before the break date. Click for the full episode.",
      body: table([
        { label: "Episode", get: (x) => x.e.title },
        { label: "Date", get: (x) => fmtISO(x.e.date) },
        { label: "1 week", r: true, get: (x) => x.st.chg["1w"], fmt: (v) => spct(v, 1), cls },
        { label: "1 month", r: true, get: (x) => x.st.chg["1m"], fmt: (v) => spct(v, 1), cls },
        { label: "12 months", r: true, get: (x) => x.st.chg["12m"], fmt: (v) => spct(v, 0), cls },
        { label: "Worst in 24m", r: true, get: (x) => x.st.max_dep_24m, fmt: (v) => spct(v, 0), cls },
      ], breaks, { onRowClick: (x) => { location.hash = `#/episode/${x.e.id}`; }, maxHeight: "480px" }),
    });

    const byId = Object.fromEntries(eps.episodes.map((e) => [e.id, e]));
    const s = (id, k = "12m") => { const st = primaryStats(byId[id]); return st ? (k === "max" ? st.max_dep_24m : st.chg[k]) : null; };
    const qarOff = byId["qar-2017"]?.series.find((x) => x.key === "offshore")?.stats?.max_dev_from_peg;
    const scen = [
      { name: "Offshore-only dislocation, onshore holds", ex: "Qatar 2017", loss: qarOff ? -qarOff : null, note: "Mark-to-market/execution loss for anyone dealing offshore; reversed within ~6 months." },
      { name: "One-off step to a new peg", ex: "Oman 1986, UK 1967, Iraq 2020, Turkmenistan 2015", loss: [s("omr-1986"), s("gbp-1967"), s("iqd-2020"), s("tmt-2015")], note: "The historical GCC template. Oman's step was ~10% (the monthly average shows less)." },
      { name: "Two-step break (re-peg fails)", ex: "Azerbaijan 2015, Italy 1992", loss: [s("azn-2015"), s("itl-1992")], note: "The first devaluation doesn't restore credibility." },
      { name: "Oil-exporter float", ex: "Kazakhstan 2015, Russia 2014, Nigeria 2016, Russia 1998", loss: [s("kzt-2015"), s("rub-2014"), s("ngn-2016"), s("rub-1998")], note: "Terms-of-trade shock judged permanent; buffers much thinner than the Gulf's." },
      { name: "Hard-peg collapse with controls", ex: "Argentina 2002, Lebanon 2019–23", loss: [s("ars-2002")], note: "Convertibility risk arrives first; contracts can be rewritten." },
    ];
    const fmtLoss = (l) => (Array.isArray(l) ? l.filter((v) => v !== null).map((v) => spct(v, 0)).join(", ") : spct(l, 1));
    const scenCard = card({
      title: "Loss-given-break templates for a Gulf peg",
      sub: "12-month value change in each precedent (the Qatar row shows the maximum offshore gap). Use these as stress scenarios rather than the pooled distribution, which is dominated by emerging-market floats.",
      body: table([{ label: "Scenario", key: "name" }, { label: "Precedents", key: "ex" }, { label: "Observed", get: (r) => fmtLoss(r.loss) }, { label: "Note", key: "note" }], scen),
    });

    const evCard = card({
      title: "Every break in the current selection",
      body: table([
        { label: "Country", key: "name" },
        { label: "Break", key: "event", fmt: (v) => (v ? fmtYM(v) : "–") },
        { label: "Peg age", r: true, key: "age", fmt: (v) => `${v.toFixed(1)}y` },
        { label: "Type", get: (e) => (e.reason === "realign" ? `Step ${spct(e.realign_pct, 0)}` : data.codes[e.next_code] || "Exit (BIS/curated)") },
        { label: "1m", r: true, get: (e) => get(e, 1), fmt: (v) => spct(v, 0), cls },
        { label: "12m", r: true, get: (e) => get(e, 12), fmt: (v) => spct(v, 0), cls },
        { label: "Worst 24m", r: true, key: "max_dep_24", fmt: (v) => spct(v, 0), cls },
      ], events.slice().sort((a, b) => (get(a, 12) ?? 0) - (get(b, 12) ?? 0)), { onRowClick: (e) => { const ep = findEpisode(eps, e.iso3, e.event); if (ep) location.hash = `#/episode/${ep.id}`; }, maxHeight: "480px" }),
    });

    body.replaceChildren(tiles, h("div", { class: "grid grid-2 section" }, rangeCard, fanCard), h("div", { class: "section" }, scenCard), h("div", { class: "grid grid-2 section" }, epCard, evCard));

    rangeChart(rangeEl, { rows, xFormat: (v) => spct(v, 0), labelWidth: 96 });
    lineChart(fanEl, {
      bands: [{ name: "10th–90th pct", color: "var(--band)", points: f.map((r) => [r.k, r.p10, r.p90]) }, { name: "Middle half", color: "var(--band-2)", points: f.map((r) => [r.k, r.p25, r.p75]) }],
      series: [{ name: "Median", color: "var(--s1)", points: f.map((r) => [r.k, r.p50]) }],
      xType: "number", xTitle: "Months from the last pegged month", xFormat: (v) => `Month ${v > 0 ? "+" : ""}${v}`, xTickFormat: (v) => `${v}`,
      yFormat: (v) => v.toFixed(0), refX: [{ x: 0, label: "break" }], refY: [{ y: 100 }], height: 300,
    });
  }
  draw();
  return root;
}
