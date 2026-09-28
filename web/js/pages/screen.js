import { h, pageHead, card, table, loadJSON, pct, num, spct, tile, fmtYM } from "../ui.js";
import { columnChart } from "../charts.js";

export default async function screen() {
  const s = await loadJSON("data/processed/screen.json");
  const st = s.signal_test || {};
  const rows = s.current;
  const gcc = rows.filter((r) => r.gcc);
  const withBand = rows.filter((r) => r.band_12m !== null && r.band_12m !== undefined).sort((a, b) => b.band_12m - a.band_12m);
  const chartEl = h("div");

  const lift = st.p_break_given_signal && st.p_break_unconditional ? st.p_break_given_signal / st.p_break_unconditional : null;

  const node = h("div", {},
    pageHead("Vulnerability screen", `Every peg still standing in the data (to ${s.bis_latest}), ranked on the one early-warning indicator free data can actually measure: how much the official rate is already drifting inside its band.`),
    h("div", { class: "grid grid-4" },
      tile("Pegs still standing", num(rows.length), `${gcc.length} of them GCC`),
      tile("Median age", `${num(rows.reduce((a, r) => a + r.age_years, 0) / rows.length, 0)}y`, "across surviving pegs"),
      tile("Drift signal: chance of a break within 12m", pct(st.p_break_given_signal, 1), `vs ${pct(st.p_break_unconditional, 1)} unconditionally${lift ? ` (${lift.toFixed(1)}× lift)` : ""}`),
      tile("Noise-to-signal ratio", st.noise_to_signal ? st.noise_to_signal.toFixed(2) : "–", st.lead_months ? `informative, but the median warning is only ${num(st.lead_months.median, 0)} months` : "below 1 = informative (KLR convention)")),
    h("div", { class: "section" }, card({
      title: "Does drift inside the band actually warn?",
      sub: `Every 12-month window of every peg in the sample (${num(st.windows)} windows, ${num(st.pre_break_windows)} of them in the year before a break). A window 'signals' when the rate's largest deviation from its own 12-month median exceeds ${pct(st.threshold, 2)}, the 90th percentile of all windows.`,
      body: table([{ label: "Measure", key: "k" }, { label: "Value", key: "v", r: true }], [
        { k: "Pre-break windows correctly flagged (hit rate)", v: pct(st.true_positive_rate, 0) },
        { k: "Quiet windows wrongly flagged (false alarm rate)", v: pct(st.false_positive_rate, 0) },
        { k: "Chance of a break within 12m once flagged", v: pct(st.p_break_given_signal, 1) },
        { k: "Chance in any window (base rate)", v: pct(st.p_break_unconditional, 1) },
        { k: "Noise-to-signal ratio", v: st.noise_to_signal ? st.noise_to_signal.toFixed(2) : "–" },
        { k: "Median drift, pre-break windows", v: pct(st.median_band_pre_break, 2) },
        { k: "Median drift, all other windows", v: pct(st.median_band_other, 2) },
        ...(st.lead_months ? [
          { k: "Median warning, once flagged", v: `${num(st.lead_months.median, 0)} months before the break` },
          { k: "Middle half of warnings", v: `${num(st.lead_months.p25, 0)}–${num(st.lead_months.p75, 0)} months` },
          { k: "Flags arriving inside 3 months", v: pct(st.lead_months.share_le_3m, 0) },
        ] : []),
      ]),
    })),
    h("div", { class: "section" }, card({
      title: "Pegs ranked by drift inside the band",
      sub: `Largest deviation from the rate's own 12-month median. Pre-break windows ran at a median of ${pct(st.median_band_pre_break, 2)} against ${pct(st.median_band_other, 2)} for everything else, so this separates weakly: use it to ask questions, not to conclude.`,
      body: chartEl,
      tableFn: () => table([
        { label: "Country", key: "country" }, { label: "Anchor", key: "anchor" }, { label: "Pegged since", key: "since", fmt: fmtYM },
        { label: "Age", key: "age_years", r: true, fmt: (v) => `${v}y` },
        { label: "Drift in band", key: "band_12m", r: true, fmt: (v) => pct(v, 2) },
        { label: "Move since 2019 reference", key: "drift_since_ref", r: true, fmt: (v) => spct(v, 2) },
        { label: "Oil/gas exporter", key: "hydrocarbon", fmt: (v) => (v ? "yes" : "") },
      ], withBand, { maxHeight: "460px" }),
    })),
    h("div", { class: "section" }, card({
      title: "Gulf pegs: what the free data can't see",
      sub: "Buffers, fiscal breakevens and growth from the dated briefing; drift measured from BIS rates.",
      body: table([
        { label: "Currency", get: (r) => h("div", {}, h("b", { text: r.ccy || r.iso3 }), h("div", { class: "muted small", text: r.country })) },
        { label: "Peg", get: (r) => r.peg || "–" },
        { label: "Age", key: "age_years", r: true, fmt: (v) => `${v}y` },
        { label: "Drift in band", key: "band_12m", r: true, fmt: (v) => pct(v, 2) },
        { label: "Buffers", get: (r) => r.buffers || "–" },
        { label: "Fiscal breakeven", get: (r) => r.breakeven || "–" },
        { label: "2026 growth", get: (r) => r.growth_2026 || "–" },
        { label: "Stress", get: (r) => (r.stress ? h("span", { class: `status ${r.stress}`, text: r.stress }) : "–") },
        { label: "Watch", get: (r) => r.watch || "–" },
      ], gcc),
    })),
    h("div", { class: "callout warn prose section", html: `<strong>What this screen is not.</strong>
      <ul>
        <li>The indicators with the best track record — reserves against short-term liabilities, forward points beyond carry, interbank spreads, and the parallel-market premium — need a licensed feed. They are absent here.</li>
        <li>A hard peg that never moves scores zero drift, which is exactly what Saudi Arabia, the UAE and Qatar look like today. That is reassuring about the mechanics, not about the politics or the fiscal position.</li>
        <li>Basket pegs (Kuwait) and currencies quoted with wide spreads score higher without being under stress.</li>
        <li>Rankings are a prompt to look, not a forecast. ${s.notes[0]}</li>
      </ul>` }),
  );
  columnChart(chartEl, {
    items: withBand.slice(0, 16).map((r) => ({
      label: r.ccy || r.iso3, value: r.band_12m,
      color: r.gcc ? "var(--s1)" : "var(--s3)",
      valueLabel: pct(r.band_12m, 1),
      tooltip: [{ value: pct(r.band_12m, 2), label: "drift inside band" }, { value: r.country }, { value: `${r.age_years}y`, label: "peg age" }, { value: spct(r.drift_since_ref, 2), label: "vs 2019 reference" }],
    })),
    yFormat: (v) => pct(v, 0), height: 280, xTitle: "GCC pegs in blue",
  });
  return node;
}
