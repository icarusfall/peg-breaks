import { h, pageHead, tile, card, table, baseFilters, baseState, loadJSON, pct, num, fmtYM, field, numberInput, segmented, store, save, spct } from "../ui.js";
import { buildLives, kaplanMeier, conditionalBreak, hazardByAge, hazardOlderThan, AGE_BUCKETS } from "../stats.js";
import { lineChart, columnChart } from "../charts.js";

const calc = store("pbx.calc", { age: 40, horizon: 5 });
const PRESETS = [[40, "SAR at 3.75 (1986)"], [46, "AED/QAR de facto (1980)"], [53, "GCC spells in IRR data (1973)"]];

export function findEpisode(eps, iso3, ym) {
  const y = +ym.slice(0, 4);
  return eps.episodes.find((e) => e.iso3 === iso3 && Math.abs(+e.date.slice(0, 4) - y) <= 1 && e.kind === "break");
}

export default async function likelihood() {
  const [data, eps] = await Promise.all([loadJSON("data/processed/regimes.json"), loadJSON("data/processed/episodes.json")]);
  const body = h("div");
  const root = h("div", {},
    pageHead("How likely is a peg break?",
      "Base rates from the de facto regime of every country, monthly from 1940 (Ilzetzki–Reinhart–Rogoff), extended to 2026 with BIS exchange rates. Change what counts as a break, and which pegs count as comparable, to see how sensitive the answer is."),
    baseFilters(draw), body);

  function draw() {
    const lives = buildLives(data, baseState);
    const events = lives.filter((l) => l.event);
    const py = lives.reduce((a, l) => a + (l.exit - l.entry), 0) / 12;
    const km = kaplanMeier(lives);
    const old = hazardOlderThan(lives, 30);

    const tiles = h("div", { class: "grid grid-4" },
      tile("Peg spells in sample", num(lives.length), `${num(py)} peg-years observed`),
      tile("Breaks counted", num(events.length), baseState.realign ? `exits + step realignments ≥ ${baseState.realign}%` : "regime exits only"),
      tile("Annual break rate, all ages", pct(events.length / py, 1), "breaks ÷ peg-years"),
      tile("Annual break rate, pegs aged 30y+", pct(old.rate, 1), `${old.events} breaks in ${num(old.py)} peg-years`),
    );

    // ---- calculator ----
    const result = h("div");
    const renderResult = () => {
      save("pbx.calc", calc);
      const A = calc.age * 12, H = calc.horizon * 12;
      const c = conditionalBreak(km, lives, A, H);
      const hz = hazardOlderThan(lives, Math.min(calc.age, 45));
      const constP = 1 - Math.exp(-hz.rate * calc.horizon);
      const thin = c.atRisk < 15;
      result.replaceChildren(
        h("div", { class: "grid grid-2", style: { marginTop: "14px" } },
          h("div", {},
            h("div", { class: "muted small", text: `P(break within ${calc.horizon}y | peg has lasted ${calc.age}y) — Kaplan–Meier` }),
            h("div", { class: "hero-figure", text: isFinite(c.p) ? pct(c.p, 1) : "–" }),
            h("div", { class: "ink-2 small", text: isFinite(c.lo) ? `95% interval ${pct(Math.max(0, c.lo), 1)} to ${pct(Math.min(1, c.hi), 1)} · ${c.events} breaks among ${c.atRisk} pegs that reached ${calc.age} years` : `${c.atRisk} pegs reached ${calc.age} years; too few to estimate` }),
          ),
          h("div", {},
            h("div", { class: "muted small", text: `Constant-hazard cross-check (pegs aged ${Math.min(calc.age, 45)}y+)` }),
            h("div", { class: "hero-figure", style: { fontSize: "2.2rem" }, text: isFinite(constP) ? pct(constP, 1) : "–" }),
            h("div", { class: "ink-2 small", text: `${pct(hz.rate, 2)} a year · ${hz.events} break${hz.events === 1 ? "" : "s"} in ${num(hz.py)} peg-years` }),
            h("div", { class: "ink-2 small", text: isFinite(hz.ciHi) ? `The data are consistent with up to ${pct(hz.ciHi, 2)} a year (95% upper bound), or ${pct(1 - Math.exp(-hz.ciHi * calc.horizon), 1)} over ${calc.horizon}y.` : "" }),
          ),
        ),
        ...(thin ? [h("p", { class: "callout warn small", text: "Thin data: few pegs in this cohort have survived this long. Treat the number as indicative, widen the cohort, or lower the age." })] : []),
      );
    };
    const ageInput = numberInput(calc.age, (v) => { calc.age = Math.max(0, v); renderResult(); }, { step: 1, min: 0, max: 80 });
    const calcCard = h("section", { class: "card" },
      h("h3", { text: "Your peg" }),
      h("p", { class: "sub", text: "Probability conditional on having already survived, which matters a lot because young pegs break far more often than old ones." }),
      h("div", { class: "filters", style: { position: "static", margin: "0", border: "0", padding: "0", background: "none" } },
        field("Peg age (years)", ageInput),
        field("Presets", h("div", { class: "tags" }, PRESETS.map(([a, l]) => h("button", { type: "button", class: "tag", text: `${l}: ${a}y`, onclick: () => { calc.age = a; ageInput.value = a; renderResult(); } })))),
        field("Horizon", segmented([[1, "1y"], [3, "3y"], [5, "5y"], [10, "10y"]], calc.horizon, (v) => { calc.horizon = +v; renderResult(); }, "Horizon")),
      ),
      result);
    renderResult();

    // ---- conditional grid ----
    const ages = [0, 5, 10, 20, 30, 40], hors = [1, 3, 5, 10];
    const gridRows = ages.map((a) => {
      const r = { age: a };
      for (const hz of hors) r[hz] = conditionalBreak(km, lives, a * 12, hz * 12);
      return r;
    });
    const gridCard = card({
      title: "Break probability by age and horizon",
      sub: "Each cell: chance a peg that has lasted A years breaks within the next H years. n = pegs that reached age A.",
      body: table([
        { label: "Peg age", get: (r) => `${r.age}y (n=${r[1].atRisk})` },
        ...hors.map((hz) => ({ label: `within ${hz}y`, r: true, get: (r) => r[hz].p, fmt: (v) => (isFinite(v) ? pct(v, 1) : "–") })),
      ], gridRows),
    });

    // ---- survival curve ----
    const surv = [], band = [];
    for (let i = 0; i < km.t.length; i++) {
      const x = km.t[i] / 12, S = km.S[i], se = Math.sqrt(km.green[i]);
      const lo = Math.max(0, S * Math.exp(-1.96 * se)), hi = Math.min(1, S * Math.exp(1.96 * se));
      surv.push([x, S]);
      const nx = i + 1 < km.t.length ? km.t[i + 1] / 12 : Math.max(x, ...lives.map((l) => l.exit / 12));
      band.push([x, lo, hi], [nx - 1e-6, lo, hi]);
    }
    const maxAge = Math.min(75, Math.max(...lives.map((l) => l.exit / 12)));
    const survChart = h("div");
    const survCard = card({
      title: "Share of pegs still intact, by age",
      sub: "Kaplan–Meier survival with 95% band. Pegs still in place at the end of the data count as survivors, not breaks.",
      body: survChart,
      tableFn: () => table([{ label: "Age", key: "a", fmt: (v) => `${v}y` }, { label: "Still intact", key: "S", r: true, fmt: (v) => pct(v, 1) }, { label: "Pegs at risk", key: "n", r: true }],
        [1, 2, 5, 10, 20, 30, 40, 50, 60].map((a) => { let i = 0; while (i + 1 < km.t.length && km.t[i + 1] <= a * 12) i++; return { a, S: km.S[i], n: lives.filter((l) => l.entry <= a * 12 && l.exit > a * 12).length }; })),
    });

    // ---- hazard by age ----
    const hz = hazardByAge(lives);
    const hzChart = h("div");
    const labels = AGE_BUCKETS.map(([a, b]) => (b === Infinity ? `${a}+` : `${a}–${b}`));
    const hzCard = card({
      title: "Annual break rate by peg age",
      sub: "Breaks per peg-year within each age band (years), with 95% intervals. Bands with little exposure have wide intervals.",
      body: hzChart,
      tableFn: () => table([{ label: "Age band", key: "label" }, { label: "Breaks", key: "events", r: true }, { label: "Peg-years", key: "py", r: true, fmt: (v) => num(v) }, { label: "Annual rate", key: "rate", r: true, fmt: (v) => pct(v, 2) }, { label: "95% interval", r: true, get: (r) => `${pct(r.ciLo, 2)}–${pct(r.ciHi, 2)}` }],
        hz.map((r, i) => ({ ...r, label: labels[i] }))),
    });

    // ---- old pegs that broke ----
    const oldBreaks = events.filter((l) => l.exit >= 240).sort((a, b) => b.exit - a.exit);
    const typeLabel = (l) => (l.reason === "realign" ? `Step realignment ${spct(l.eventSpell.realign_pct, 0)}` : (data.codes[l.eventSpell.next_code] || (l.endSource === "curated" ? "Float (curated)" : "Regime exit (BIS)")));
    const chg12 = (l) => { const s = l.eventSpell; return (s.chg_anchor && s.chg_anchor["12"]) ?? (s.chg_usd && s.chg_usd["12"]) ?? null; };
    const oldCard = card({
      title: "Pegs that broke after lasting 20+ years",
      sub: "The relevant reference class for 40-year-old Gulf pegs. Click a row with a curated episode for detail.",
      body: oldBreaks.length ? table([
        { label: "Country", key: "name" },
        { label: "Peg since", key: "start", fmt: fmtYM },
        { label: "Broke", get: (l) => l.eventSpell.event, fmt: (v) => (v ? fmtYM(v) : "–") },
        { label: "Age", r: true, get: (l) => l.exit / 12, fmt: (v) => `${v.toFixed(0)}y` },
        { label: "What happened", get: typeLabel },
        { label: "12m value change", r: true, get: chg12, fmt: (v) => spct(v, 0), cls: (v) => (v < 0 ? "neg" : v > 0 ? "pos" : "") },
        { label: "", get: (l) => (findEpisode(eps, l.iso3, l.eventSpell.event || l.end) ? "Episode →" : "") },
      ], oldBreaks, { onRowClick: (l) => { const e = findEpisode(eps, l.iso3, l.eventSpell.event || l.end); if (e) location.hash = `#/episode/${e.id}`; }, maxHeight: "420px" }) : h("p", { class: "muted", text: "No breaks after 20+ years in this selection." }),
    });

    const ongoing = lives.filter((l) => !l.event && l.reason === "ongoing").sort((a, b) => b.months - a.months).slice(0, 15);
    const ongoingCard = card({
      title: "Longest-lived pegs still in place",
      body: table([
        { label: "Country", key: "name" }, { label: "Since", key: "start", fmt: fmtYM }, { label: "Age", r: true, get: (l) => l.months / 12, fmt: (v) => `${v.toFixed(0)}y` },
        { label: "Anchor", key: "anchor" }, { label: "Data to", key: "end", fmt: fmtYM },
      ], ongoing),
    });

    body.replaceChildren(
      tiles,
      h("div", { class: "section" }, calcCard),
      h("div", { class: "grid grid-2 section" }, survCard, hzCard),
      h("div", { class: "section" }, gridCard),
      h("div", { class: "grid grid-2 section" }, oldCard, ongoingCard),
      h("div", { class: "callout section prose", html: `
        <strong>Reading these numbers</strong>
        <ul>
          <li><b>Survivorship cuts both ways.</b> Pegs that last decades usually have strong institutions and buffers, so old-age hazards are low partly by selection. That is informative, but it is not a guarantee.</li>
          <li><b>Breaks cluster.</b> Most breaks fall in 1971–73, 1992–93, 1997–98 and 2014–16. The six GCC pegs share a shock and would likely come under pressure together, so treat them as one bet, not six.</li>
          <li><b>Monthly averages hide jumps.</b> Realignment sizes are measured on monthly averages and understate the day-one gap. See <a href="#/episodes">Episodes</a> for daily data.</li>
          <li><b>“Break” is a choice.</b> A narrow definition (regime exit only) and a broad one (any ≥5% step) can differ by a factor of two. Use the filters to bound the answer rather than picking one number.</li>
        </ul>` }),
    );

    lineChart(survChart, {
      series: [{ name: "Share intact", color: "var(--s1)", points: surv, step: true }],
      bands: [{ name: "95% band", color: "var(--band)", points: band }],
      xType: "number", xDomain: [0, maxAge], yDomain: [0, 1], xTitle: "Peg age (years)",
      xFormat: (v) => `Age ${v.toFixed(1)}y`, xTickFormat: (v) => `${v}`, yFormat: (v) => pct(v, 0),
      refX: [{ x: calc.age, label: `${calc.age}y` }], height: 300,
    });
    const cap = Math.max(...hz.map((r) => (isFinite(r.rate) ? r.rate : 0))) * 1.8 || 0.1;
    columnChart(hzChart, {
      items: hz.map((r, i) => ({ label: labels[i], value: isFinite(r.rate) ? r.rate : 0, lo: r.ciLo, hi: r.ciHi, valueLabel: isFinite(r.rate) ? pct(r.rate, 1) : "–",
        tooltip: [{ value: pct(r.rate, 2), label: "annual break rate" }, { value: `${pct(r.ciLo, 1)}–${pct(r.ciHi, 1)}`, label: "95% interval" }, { value: `${r.events} / ${num(r.py)}`, label: "breaks / peg-years" }] })),
      yFormat: (v) => pct(v, 0), yDomain: [0, cap], height: 300, xTitle: "Peg age band (years)",
    });
  }
  draw();
  return root;
}
