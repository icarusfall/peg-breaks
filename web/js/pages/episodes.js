import { h, pageHead, card, table, loadJSON, spct, fmtISO, segmented, field, sourcesList, store, save, pct } from "../ui.js";
import { lineChart, SERIES_COLORS } from "../charts.js";
import { primaryStats } from "./impact.js";

const listState = store("pbx.eplist", { kind: "all", tag: "" });
const detailState = store("pbx.epdetail", { mode: "rate" });
const KIND_LABEL = { break: "Break", stress: "Stress, peg held", edge: "Edge case" };
const TAG_LABEL = {
  gcc: "GCC", hydrocarbon: "Hydrocarbon exporter", parallel_market: "Parallel market", offshore_dislocation: "Offshore dislocation",
  upward: "Upward pressure", currency_board: "Currency board", step_devaluation: "Step devaluation", two_step: "Two-step",
  capital_controls: "Capital controls", oil_collapse: "Oil collapse", near_miss: "Near miss", erm: "ERM", asia97: "Asia 1997",
  external_support: "External support", reserves_exhausted: "Reserves exhausted", float: "Float", gap_risk: "Gap risk",
  deposit_freeze: "Deposit freeze", default: "Default", geopolitical: "Geopolitical", war: "War", anchor_tightening: "Anchor tightening",
  interest_rate_defence: "Interest-rate defence", banking_crisis: "Banking crisis", forward_stress: "Forward stress", recent: "Recent",
};
const tagName = (t) => TAG_LABEL[t] || t.replace(/_/g, " ");
const DAY = 864e5;

function headlineStat(ep) {
  if (ep.kind === "break") {
    const st = primaryStats(ep);
    if (!st) return "";
    const v = st.chg["12m"] ?? st.max_dep_24m;
    return `${st.chg["12m"] !== undefined ? "12 months later" : "Worst within 24m"}: ${spct(v, 0)}`;
  }
  const devs = ep.series.map((s) => s.stats?.max_dev_from_peg).filter((v) => v !== undefined && v !== null);
  return devs.length ? `Largest gap vs peg in window: ${pct(Math.max(...devs), 1)}` : "";
}

function list() {
  const eps = this;
  const tags = [...new Set(eps.episodes.flatMap((e) => e.tags))].sort((a, b) => tagName(a).localeCompare(tagName(b)));
  const grid = h("div", { class: "grid grid-3" });
  const draw = () => {
    save("pbx.eplist", listState);
    const items = eps.episodes
      .filter((e) => listState.kind === "all" || e.kind === listState.kind)
      .filter((e) => !listState.tag || e.tags.includes(listState.tag))
      .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.date.localeCompare(a.date));
    grid.replaceChildren(...(items.length ? items.map((e) => h("a", { class: "card ep-card", href: `#/episode/${e.id}` },
      h("div", { class: "ep-meta", text: `${fmtISO(e.date)} · ${KIND_LABEL[e.kind]}` }),
      h("div", { class: "ep-title", text: e.title }),
      h("div", { class: "ep-stat", text: headlineStat(e) }),
      h("div", { class: "tags" }, e.tags.slice(0, 4).map((t) => h("span", { class: "tag", text: tagName(t) }))))) : [h("p", { class: "muted", text: "No episodes match." })]));
  };
  const tagSel = h("select", { onchange: (e) => { listState.tag = e.target.value; draw(); } },
    h("option", { value: "", text: "All themes" }), tags.map((t) => h("option", { value: t, text: tagName(t), selected: t === listState.tag })));
  draw();
  return h("div", {},
    pageHead("Episodes", `${eps.episodes.length} curated breaks, near misses and edge cases, each with price data around the event, what preceded it, what followed, and the lesson for a proxy-hedged investor.`),
    h("div", { class: "filters" },
      field("Kind", segmented([["all", "All"], ["break", "Breaks"], ["stress", "Stress, peg held"], ["edge", "Edge cases"]], listState.kind, (v) => { listState.kind = v; draw(); }, "Kind")),
      field("Theme", tagSel)),
    grid);
}

function detail(id) {
  const eps = this;
  const i = eps.episodes.findIndex((e) => e.id === id);
  const ep = eps.episodes[i];
  if (!ep) return h("div", {}, h("p", { text: "Episode not found. " }), h("a", { href: "#/episodes", text: "Back to episodes" }));
  const d0 = Date.parse(`${ep.date}T00:00:00Z`);
  const series = ep.series.filter((s) => !s.missing);
  const chartEl = h("div");

  const drawChart = () => {
    save("pbx.epdetail", detailState);
    const idx = detailState.mode === "index";
    lineChart(chartEl, {
      series: series.map((s, k) => {
        const base = s.stats?.base;
        return {
          name: s.label, color: SERIES_COLORS[k], step: s.freq === "M",
          points: s.t.map((t, j) => [d0 + t * DAY, idx ? (base ? (100 * base) / s.v[j] : null) : s.v[j]]),
        };
      }),
      xType: "time",
      yFormat: idx ? (v) => v.toFixed(0) : (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3)),
      tooltipValue: idx ? (v) => v.toFixed(1) : (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4)),
      refX: [{ x: d0, label: ep.kind === "break" ? "break" : "event" }],
      refY: idx ? [{ y: 100 }] : ep.peg ? [{ y: ep.peg, label: `peg ${ep.peg}` }] : [],
      markers: (ep.datapoints || []).map((p) => ({ x: Date.parse(`${p.date}T00:00:00Z`), label: p.label })),
      height: 340,
    });
  };

  const unitNote = ep.anchor && ep.anchor !== "USD" ? `local currency per ${ep.anchor}` : `${ep.ccy} per USD`;
  const statRows = series.filter((s) => s.stats).map((s) => ({ s, st: s.stats }));
  const cls = (v) => (v < -0.0005 ? "neg" : v > 0.0005 ? "pos" : "");
  const statsTable = table([
    { label: "Series", get: (r) => r.s.label },
    { label: "Base", get: (r) => `${r.st.base.toPrecision(5)} (${fmtISO(r.st.base_date)})` },
    ...["1d", "1w", "1m", "3m", "12m"].map((k) => ({ label: k, r: true, get: (r) => r.st.chg[k], fmt: (v) => spct(v, 1), cls })),
    { label: "Worst 24m", r: true, get: (r) => r.st.max_dep_24m, fmt: (v) => spct(v, 1), cls },
    { label: "Max gap vs peg", r: true, get: (r) => r.st.max_dev_from_peg, fmt: (v) => (v === undefined ? "–" : pct(v, 1)) },
    { label: "Largest daily move ±14d", get: (r) => (r.st.largest_move_near_date ? `${spct(r.st.largest_move_near_date.value_change, 1)} on ${fmtISO(r.st.largest_move_near_date.date)}` : "–") },
  ], statRows);

  const prev = eps.episodes[(i - 1 + eps.episodes.length) % eps.episodes.length];
  const next = eps.episodes[(i + 1) % eps.episodes.length];
  const node = h("div", {},
    h("p", { class: "small" }, h("a", { href: "#/episodes", text: "← All episodes" })),
    h("div", { class: "page-head" },
      h("div", { class: "muted small", text: `${ep.country} · ${fmtISO(ep.date)} · ${KIND_LABEL[ep.kind]}` }),
      h("h1", { text: ep.title }),
      h("div", { class: "tags" }, ep.tags.map((t) => h("span", { class: "tag", text: tagName(t) })))),
    h("div", { class: "grid grid-2" },
      h("section", { class: "card" }, h("h3", { text: "What happened" }), h("p", { text: ep.summary }),
        h("dl", { class: "kv" }, h("dt", { text: "Before" }), h("dd", { text: ep.regime_before }), h("dt", { text: "After" }), h("dd", { text: ep.regime_after }), h("dt", { text: "Anchor" }), h("dd", { text: ep.anchor }))),
      h("section", { class: "card" }, h("h3", { text: "Lesson for a proxy-hedged investor" }), h("p", { text: ep.hedger_lesson }),
        ep.precursors?.length ? [h("h3", { text: "What came first" }), h("ul", {}, ep.precursors.map((p) => h("li", { text: p })))] : null,
        ep.aftermath ? [h("h3", { text: "Aftermath" }), h("p", { text: ep.aftermath })] : null)),
    h("div", { class: "section" }, card({
      title: "Price around the event",
      sub: `${detailState.mode === "index" ? "Currency value, 100 = last observation before the event (lower = weaker)" : unitNote}. Dots along the top mark dated events; hover for detail.${series.some((s) => s.source === "yahoo") ? " Yahoo series are composite dealer quotes and can be noisy." : ""}`,
      actions: segmented([["rate", "Rate"], ["index", "Value index"]], detailState.mode, (v) => { detailState.mode = v; drawChart(); }, "Chart mode"),
      body: chartEl,
      tableFn: () => table([{ label: "Date", key: "d" }, ...series.map((s, k) => ({ label: s.label, key: `s${k}`, r: true, fmt: (v) => (v === undefined ? "–" : v.toPrecision(6)) }))],
        (() => { const m = new Map(); series.forEach((s, k) => s.t.forEach((t, j) => { const d = new Date(d0 + t * DAY).toISOString().slice(0, 10); m.set(d, { ...(m.get(d) || { d }), [`s${k}`]: s.v[j] }); })); return [...m.values()].sort((a, b) => a.d.localeCompare(b.d)); })(), { maxHeight: "360px" }),
    })),
    h("div", { class: "section" }, card({ title: "Measured moves", sub: "Value change of the local currency from the base observation (negative = weaker). Trading-day offsets for daily data, months for monthly.", body: statsTable })),
    ep.datapoints?.length ? h("div", { class: "section" }, card({ title: "Dated evidence", body: table([{ label: "Date", key: "date", fmt: fmtISO }, { label: "What", key: "label" }, { label: "Source", get: (p) => h("a", { href: p.source, target: "_blank", rel: "noopener", text: new URL(p.source).hostname.replace("www.", "") }) }], ep.datapoints) })) : null,
    h("div", { class: "section" }, card({ title: "Sources", body: sourcesList(ep.sources) })),
    h("p", { class: "small section" }, h("a", { href: `#/episode/${prev.id}`, text: `← ${prev.title}` }), "  ·  ", h("a", { href: `#/episode/${next.id}`, text: `${next.title} →` })),
  );
  drawChart();
  return node;
}

export default async function episodes({ name, params }) {
  const eps = await loadJSON("data/processed/episodes.json");
  return name === "episode" && params[0] ? detail.call(eps, params[0]) : list.call(eps);
}
