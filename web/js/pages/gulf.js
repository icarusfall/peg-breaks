import { h, pageHead, card, table, loadJSON, bp, tile, segmented, field, sourcesList, fmtISO, store, save } from "../ui.js";
import { lineChart } from "../charts.js";

const view = store("pbx.gulf", { ccy: "QAR", range: "since2014" });
const RANGES = [["1y", "1y"], ["3y", "3y"], ["since2014", "Since 2014"], ["since2005", "Since 2005"]];
const toMs = (d) => Date.parse(`${d}T00:00:00Z`);

function rangeStart(range, last) {
  const d = new Date(last);
  if (range === "1y") return Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate());
  if (range === "3y") return Date.UTC(d.getUTCFullYear() - 3, d.getUTCMonth(), d.getUTCDate());
  if (range === "since2014") return Date.UTC(2014, 0, 1);
  return Date.UTC(2005, 0, 1);
}

export default async function gulf() {
  const [gcc, cur] = await Promise.all([loadJSON("data/processed/gcc.json"), loadJSON("data/curated/current.json")]);

  const points = cur.key_points.map((k) => h("section", { class: "card" }, h("h3", { text: k.title }), h("p", { class: "ink-2", style: { margin: 0 }, text: k.body })));

  const score = card({
    title: "Scorecard",
    sub: "Stress levels are this tool's qualitative synthesis of the cited facts, not a model output.",
    body: table([
      { label: "Currency", get: (r) => h("div", {}, h("b", { text: r.ccy }), h("div", { class: "muted small", text: r.country })) },
      { label: "Peg", key: "peg" },
      { label: "Hormuz bypass", key: "hormuz_bypass" },
      { label: "IMF 2026 growth", key: "imf_growth_2026" },
      { label: "Reserves / buffers", key: "fx_reserves" },
      { label: "Fiscal breakeven", key: "fiscal_breakeven" },
      { label: "CDS YTD", key: "cds_ytd" },
      { label: "Stress", get: (r) => h("span", { class: `status ${r.stress}`, text: r.stress }) },
      { label: "Watch", key: "watch" },
    ], cur.scorecard),
  });

  // ---- monitor ----
  const monitor = h("div");
  const drawMonitor = () => {
    save("pbx.gulf", view);
    const p = gcc.pegs[view.ccy];
    const lastDate = Math.max(...[p.onshore, p.offshore].filter(Boolean).map((s) => toMs(s[s.length - 1][0])));
    const x0 = rangeStart(view.range, lastDate);
    const cut = (arr) => {
      if (!arr) return [];
      const pts = arr.map(([d, v]) => [toMs(d), v]);
      const before = pts.filter((q) => q[0] < x0).pop();
      const inside = pts.filter((q) => q[0] >= x0);
      return before ? [[x0, before[1]], ...inside] : inside;
    };
    const on = cut(p.onshore), off = cut(p.offshore);
    const brent = gcc.brent.map(([d, v]) => [toMs(d), v]).filter((q) => q[0] >= x0);
    const dec = p.parity && p.parity < 1 ? 5 : 4;
    const dev = p.offshore_dev_bp;
    const chartEl = h("div"), brentEl = h("div");
    monitor.replaceChildren(
      h("div", { class: "filters", style: { position: "static" } },
        field("Currency", segmented(Object.keys(gcc.pegs).map((c) => [c, c]), view.ccy, (v) => { view.ccy = v; drawMonitor(); }, "Currency")),
        field("Range", segmented(RANGES, view.range, (v) => { view.range = v; drawMonitor(); }, "Range"))),
      h("div", { class: "grid grid-4" },
        tile("Onshore (BIS)", p.onshore_last ? p.onshore_last[1].toFixed(dec) : "–", p.onshore_last ? `as of ${fmtISO(p.onshore_last[0])}` : "no BIS daily series"),
        tile("Offshore proxy (Yahoo)", p.offshore_last ? p.offshore_last[1].toFixed(dec) : "–", p.offshore_last ? `as of ${fmtISO(p.offshore_last[0])}` : ""),
        tile("Offshore vs parity, now", dev ? bp(dev.last) : "–", p.offshore_quality?.suspect ? "suspect data, see note below" : p.parity ? `parity ${p.parity}` : p.since),
        tile("Largest offshore gap, 12m", dev ? `${Math.round(dev.max_abs_365d)}bp` : "–", dev ? `90d: ${Math.round(dev.max_abs_90d)}bp` : ""),
      ),
      p.offshore_quality?.suspect ? h("p", { class: "callout warn small", text: `Data quality: ${p.offshore_quality.note}` }) : null,
      card({
        title: `${view.ccy} per USD: onshore vs offshore proxy`,
        sub: `${p.country} · ${p.since}. Off-parity Yahoo prints are shown only if they persist for 5+ days, which filters bad ticks but keeps real dislocations such as QAR in 2017.`,
        body: chartEl,
        tableFn: () => {
          const monthly = new Map();
          for (const [t, v] of off) monthly.set(new Date(t).toISOString().slice(0, 7), { off: v });
          for (const [t, v] of on) { const k = new Date(t).toISOString().slice(0, 7); monthly.set(k, { ...(monthly.get(k) || {}), on: v }); }
          const rows = [...monthly.entries()].sort().reverse().map(([m, r]) => ({ m, ...r }));
          return table([{ label: "Month (last obs)", key: "m" }, { label: "Onshore", key: "on", r: true, fmt: (v) => v?.toFixed(dec) ?? "–" }, { label: "Offshore proxy", key: "off", r: true, fmt: (v) => v?.toFixed(dec) ?? "–" }], rows, { maxHeight: "360px" });
        },
      }),
      h("div", { class: "section" }, card({ title: "Brent crude, USD per barrel", sub: gcc.brent_source, body: brentEl })),
    );
    lineChart(chartEl, {
      series: [
        ...(on.length ? [{ name: "Onshore (BIS)", color: "var(--s1)", points: on, step: true }] : []),
        ...(off.length ? [{ name: "Offshore proxy (Yahoo)", color: "var(--s2)", points: off, step: true }] : []),
      ],
      xType: "time", yFormat: (v) => v.toFixed(dec > 4 ? 4 : 3), tooltipValue: (v) => v.toFixed(dec),
      refY: p.parity ? [{ y: p.parity, label: `parity ${p.parity}` }] : [],
      refX: view.range === "since2014" || view.range === "since2005" ? [{ x: toMs("2017-06-05"), label: "Qatar blockade" }, { x: toMs("2026-02-28"), label: "Iran war" }] : [{ x: toMs("2026-02-28"), label: "Iran war" }],
      height: 320,
    });
    lineChart(brentEl, {
      series: [{ name: "Brent", color: "var(--s1)", points: brent }], xType: "time", yFormat: (v) => `$${v.toFixed(0)}`, height: 220,
      refX: [{ x: toMs("2026-02-28"), label: "Iran war" }],
    });
  };
  drawMonitor();

  return h("div", {},
    pageHead("Gulf pegs in September 2026", cur.headline),
    h("p", { class: "muted small", text: `Briefing as of ${fmtISO(cur.as_of)}.` }),
    h("div", { class: "grid grid-2" }, points),
    h("div", { class: "section" }, score),
    h("h2", { text: "Peg monitor" }),
    monitor,
    h("div", { class: "grid grid-2 section" },
      card({ title: "Timeline", body: h("ul", { class: "timeline" }, cur.timeline.map((t) => h("li", {}, h("time", { datetime: t.date, text: fmtISO(t.date) }), h("span", {}, h("span", { text: t.event + " " }), h("a", { href: t.src, target: "_blank", rel: "noopener", text: "source" }))))) }),
      card({ title: "Sources", body: sourcesList(cur.sources) })),
    h("p", { class: "callout warn small", text: cur.caveat }),
  );
}
