import { h, pageHead, card, table, loadJSON, pct, num, spct, field, numberInput, selectEl, segmented, store, save, baseState } from "../ui.js";
import { buildLives, kaplanMeier, conditionalBreak, hazardOlderThan, summarize } from "../stats.js";
import { columnChart } from "../charts.js";
import { statsFor } from "./impact.js";

const pf = store("pbx.portfolio", {
  positions: [{ ccy: "SAR", amount: 50, hedge: 0 }, { ccy: "AED", amount: 30, hedge: 0 }, { ccy: "QAR", amount: 20, hedge: 0 }],
  sterling: 0, scenario: "gcc_step", one: "QAR", cost: 40, horizon: 1, custom: {},
});
const CCYS = ["SAR", "AED", "QAR", "KWD", "BHD", "OMR", "HKD", "Other"];
const STERLING = [["Unchanged", 0], ["Brexit-scale: 15% weaker", +((1 / 0.85 - 1) * 100).toFixed(1)], ["10% stronger", +((1 / 1.1 - 1) * 100).toFixed(1)]];

export default async function portfolio() {
  const [data, eps] = await Promise.all([loadJSON("data/processed/regimes.json"), loadJSON("data/processed/episodes.json")]);
  const lives = buildLives(data, baseState);
  const km = kaplanMeier(lives);
  const hz30 = hazardOlderThan(lives, 30);
  const byId = Object.fromEntries(eps.episodes.map((e) => [e.id, e]));
  const usdOf = (id, k = "12m") => { const s = statsFor(byId[id], "usd"); return s && s.chg ? s.chg[k] : null; };
  const qarOffshore = byId["qar-2017"]?.series.find((x) => x.key === "offshore")?.stats?.max_dev_from_peg ?? 0.07;
  const kztFloat = usdOf("kzt-2015") ?? -0.44;
  const aznTwoStep = usdOf("azn-2015") ?? -0.47;
  const omanStepData = usdOf("omr-1986"); // monthly averages smooth the step, so the headline size is used below
  const omanStep = -0.10;

  const SCEN = [
    { id: "qar_offshore", name: "Offshore dislocation, onshore peg holds", precedent: "Qatar 2017", one: true,
      note: "Offshore quotes gap away while the central bank keeps supplying dollars onshore at parity. A mark-to-market and execution loss that reversed within about six months.",
      shock: (c) => (c === pf.one ? -qarOffshore : 0) },
    { id: "one_step", name: "One country steps to a new peg (−10%)", precedent: "Oman 1986, Saudi 1986", one: true,
      note: "The historical Gulf template: a single devaluation to a new fixed rate, which then holds.", shock: (c) => (c === pf.one ? omanStep : 0) },
    { id: "gcc_step", name: "GCC-wide step devaluation (−10%)", precedent: "Oman 1986 applied across the bloc",
      note: "Treats the pegs as one position: a shared shock (oil, war, a peer devaluing) hits them together.", shock: () => omanStep },
    { id: "gcc_two_step", name: "Two-step break across the GCC", precedent: "Azerbaijan 2015",
      note: "A first devaluation fails to restore credibility and a second leg follows within a year.", shock: () => aznTwoStep },
    { id: "float", name: "Oil-exporter float", precedent: "Kazakhstan 2015",
      note: "The shock is judged permanent and the peg is abandoned. Gulf buffers are far larger than Kazakhstan's, so treat this as a severe tail.", shock: () => kztFloat },
    { id: "reval", name: "Revaluation (+10%)", precedent: "Kuwait 2007, GCC 2007–08",
      note: "Gulf peg pressure has run upward too. For a proxy-hedged investor this is a gain.", shock: () => 0.10 },
    { id: "custom", name: "Custom per-currency shocks", precedent: "your own assumptions", custom: true,
      note: "Set the move against USD for each currency.", shock: (c) => (pf.custom[c] ?? 0) / 100 },
  ];

  const body = h("div");
  const draw = () => {
    save("pbx.portfolio", pf);
    const scen = SCEN.find((s) => s.id === pf.scenario) || SCEN[2];
    const factor = 1 + pf.sterling / 100;
    const total = pf.positions.reduce((a, p) => a + (+p.amount || 0), 0);
    const rows = pf.positions.map((p) => {
      const shock = scen.shock(p.ccy);
      const unhedged = (+p.amount || 0) * (1 - (+p.hedge || 0) / 100);
      const loss = unhedged * shock * factor;
      const carry = (+p.amount || 0) * ((+p.hedge || 0) / 100) * (pf.cost / 1e4) * pf.horizon;
      return { ...p, shock, unhedged, loss, carry };
    });
    const loss = rows.reduce((a, r) => a + r.loss, 0);
    const carry = rows.reduce((a, r) => a + r.carry, 0);
    const p5 = conditionalBreak(km, lives, 40 * 12, Math.round(pf.horizon * 12)).p;
    const pPooled = 1 - Math.exp(-hz30.rate * pf.horizon);
    const pUpper = 1 - Math.exp(-hz30.ciHi * pf.horizon);

    const editor = table([
      { label: "Currency", get: (r) => selectEl(CCYS.map((c) => [c, c]), r.ccy, (v) => { pf.positions[r.i].ccy = v; draw(); }) },
      { label: "Exposure (£m)", r: true, get: (r) => numberInput(r.amount, (v) => { pf.positions[r.i].amount = v; draw(); }, { step: 1, width: "90px" }) },
      { label: "Hedged directly %", r: true, get: (r) => numberInput(r.hedge, (v) => { pf.positions[r.i].hedge = v; draw(); }, { step: 5, min: 0, max: 100, width: "80px" }) },
      ...(scen.custom ? [{ label: "Shock vs USD %", r: true, get: (r) => numberInput(pf.custom[r.ccy] ?? 0, (v) => { pf.custom[r.ccy] = v; draw(); }, { step: 1, width: "80px" }) }] : []),
      { label: "Shock applied", r: true, get: (r) => spct(r.shock, 1) },
      { label: "P&L (£m)", r: true, get: (r) => r.loss, fmt: (v) => num(v, 2), cls: (v) => (v < -0.005 ? "neg" : v > 0.005 ? "pos" : "") },
      { label: "", get: (r) => h("button", { class: "linkbtn", type: "button", text: "remove", onclick: () => { pf.positions.splice(r.i, 1); draw(); } }) },
    ], rows.map((r, i) => ({ ...r, i })));

    const chartEl = h("div");
    body.replaceChildren(
      h("div", { class: "filters" },
        field("Scenario", selectEl(SCEN.map((s) => [s.id, s.name]), pf.scenario, (v) => { pf.scenario = v; draw(); })),
        ...(scen.one ? [field("Applies to", selectEl(pf.positions.map((p) => [p.ccy, p.ccy]), pf.one, (v) => { pf.one = v; draw(); }))] : []),
        field("Sterling at the break: % rise in GBP per USD", numberInput(pf.sterling, (v) => { pf.sterling = v; draw(); }, { step: 1 })),
        field("Direct hedge cost (bp p.a.)", numberInput(pf.cost, (v) => { pf.cost = v; draw(); }, { step: 5 })),
        field("Horizon (years)", numberInput(pf.horizon, (v) => { pf.horizon = v; draw(); }, { step: 0.5 }))),
      h("div", { class: "tags", style: { marginBottom: "14px" } }, STERLING.map(([label, v]) => h("button", { type: "button", class: "tag", text: `Sterling: ${label}`, onclick: () => { pf.sterling = +v; draw(); } }))),
      h("div", { class: "grid grid-4" },
        h("div", { class: "tile" }, h("div", { class: "label", text: "Portfolio P&L in this scenario" }), h("div", { class: "value", text: `£${num(loss, 1)}m` }), h("div", { class: "note", text: `${pct(total ? loss / total : NaN, 1)} of £${num(total, 0)}m exposure` })),
        h("div", { class: "tile" }, h("div", { class: "label", text: "Carry cost of the direct hedges you set" }), h("div", { class: "value", text: `£${num(carry, 2)}m` }), h("div", { class: "note", text: `over ${pf.horizon}y at ${pf.cost}bp` })),
        h("div", { class: "tile" }, h("div", { class: "label", text: `Expected loss at pooled 30y+ rate (${pct(pPooled, 1)})` }), h("div", { class: "value", text: `£${num(pPooled * loss, 2)}m` }), h("div", { class: "note", text: `upper bound ${pct(pUpper, 1)} → £${num(pUpper * loss, 2)}m` })),
        h("div", { class: "tile" }, h("div", { class: "label", text: "Kaplan–Meier, 40y-old peg" }), h("div", { class: "value", text: pct(p5, 1) }), h("div", { class: "note", text: `probability over ${pf.horizon}y on current filters` }))),
      h("p", { class: "callout small", text: `${scen.name} — precedent: ${scen.precedent}. ${scen.note}` }),
      h("div", { class: "section" }, card({
        title: "Positions", sub: "Exposure in £m. 'Hedged directly' is the share hedged in the local currency (SAR/AED/QAR forwards or NDFs); the rest is proxy-hedged with USD and carries the peg risk.",
        body: h("div", {}, editor, h("p", { style: { marginTop: "10px" } }, h("button", { class: "btn", type: "button", text: "Add position", onclick: () => { pf.positions.push({ ccy: "Other", amount: 10, hedge: 0 }); draw(); } }))),
      })),
      h("div", { class: "section" }, card({ title: "P&L by currency", sub: "Negative = loss in sterling terms.", body: chartEl })),
      h("div", { class: "callout section prose", html: `
        <strong>How this is calculated.</strong> For each position, P&amp;L = exposure × (1 − direct hedge %) × shock vs USD × (1 + sterling move).
        The proxy hedge (USD/GBP) neutralises sterling–dollar moves but leaves the local currency's move against the dollar, converted at the
        GBP/USD rate prevailing at the break. Shock sizes come from the episode data: Qatar 2017 offshore gap ${pct(qarOffshore, 1)},
        Oman's 1986 step was about ${spct(omanStep, 0)} (monthly averages show ${spct(omanStepData, 1)} because they smooth the jump),
        Azerbaijan 2015 two-step ${spct(aznTwoStep, 0)}, Kazakhstan 2015 float ${spct(kztFloat, 0)} (12 months after).
        Probabilities are unconditional historical base rates for a single peg; the GCC pegs share shocks, so treat a bloc-wide scenario as one bet
        rather than multiplying independent probabilities.` }),
    );
    columnChart(chartEl, {
      items: rows.map((r) => ({ label: r.ccy, value: r.loss, color: r.loss < 0 ? "var(--s2)" : "var(--s3)", valueLabel: `£${num(r.loss, 1)}m`,
        tooltip: [{ value: `£${num(r.loss, 2)}m`, label: "P&L" }, { value: spct(r.shock, 1), label: "shock vs USD" }, { value: `£${num(r.unhedged, 1)}m`, label: "unhedged exposure" }] })),
      yFormat: (v) => `£${num(v, 0)}m`, height: 260, yDomain: [Math.min(0, ...rows.map((r) => r.loss)) * 1.25, Math.max(0.0001, ...rows.map((r) => r.loss)) * 1.25],
    });
  };

  draw();
  return h("div", {},
    pageHead("Portfolio stress panel", "Your actual exposure under each break scenario, in sterling. Set the positions and how much of each is hedged directly rather than by USD proxy."),
    body);
}
