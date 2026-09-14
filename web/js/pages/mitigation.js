import { h, pageHead, card, table, loadJSON, pct, num, field, numberInput, store, save, baseState, spct } from "../ui.js";
import { buildLives, kaplanMeier, conditionalBreak, summarize, hazardOlderThan } from "../stats.js";

const m = store("pbx.mitigation", { notional: 100, horizon: 1, prob: 3, lgd: 15, cost: 40, ratio: 0, premium: 30, strike: 5, age: 40 });

export default async function mitigation() {
  const [data, eps] = await Promise.all([loadJSON("data/processed/regimes.json"), loadJSON("data/processed/episodes.json")]);
  const lives = buildLives(data, baseState);
  const km = kaplanMeier(lives);
  const events = lives.filter((l) => l.event).map((l) => l.eventSpell);
  const s12 = summarize(events.map((e) => (e.chg_anchor && e.chg_anchor["12"]) ?? (e.chg_usd && e.chg_usd["12"])));
  const omr = eps.episodes.find((e) => e.id === "omr-1986");
  const kzt = eps.episodes.find((e) => e.id === "kzt-2015");
  const kztS = kzt?.series.find((s) => s.stats)?.stats;

  const out = h("div");
  const inputs = {};
  const baseRateP = () => conditionalBreak(km, lives, m.age * 12, Math.round(m.horizon * 12)).p;

  const render = () => {
    save("pbx.mitigation", m);
    const N = m.notional, T = m.horizon, p = m.prob / 100, L = m.lgd / 100, c = m.cost / 1e4, hr = m.ratio / 100;
    const prem = m.premium / 1e4, K = m.strike / 100;
    const row = (hr2, withOption) => {
      const unhedged = 1 - hr2;
      const carry = hr2 * c * N * T;
      const optCost = withOption ? unhedged * prem * N * T : 0;
      const lossIfBreak = unhedged * L * N - (withOption ? unhedged * Math.max(0, L - K) * N : 0);
      const expected = carry + optCost + p * lossIfBreak;
      return { hr2, carry, optCost, lossIfBreak, expected };
    };
    const now = row(hr, false), nowOpt = row(hr, true);
    const breakeven = (c * T) / L;
    out.replaceChildren(
      h("div", { class: "result-row" },
        h("div", { class: "tile" }, h("div", { class: "label", text: "Expected cost over horizon (hedge carry + probability × loss)" }), h("div", { class: "value", text: `$${num(now.expected, 2)}m` }), h("div", { class: "note", text: `${num((now.expected / N / T) * 1e4, 0)}bp of notional a year` })),
        h("div", { class: "tile" }, h("div", { class: "label", text: "Loss if the peg breaks" }), h("div", { class: "value", text: `$${num(now.lossIfBreak, 1)}m` }), h("div", { class: "note", text: `at ${m.ratio}% direct hedge, no options` })),
        h("div", { class: "tile" }, h("div", { class: "label", text: "Break-even break probability" }), h("div", { class: "value", text: pct(breakeven, 1) }), h("div", { class: "note", text: `a direct hedge is cheaper in expectation if P(break over ${T}y) exceeds this` })),
        h("div", { class: "tile" }, h("div", { class: "label", text: "With tail option on the unhedged part" }), h("div", { class: "value", text: `$${num(nowOpt.lossIfBreak, 1)}m` }), h("div", { class: "note", text: `loss if break; expected cost $${num(nowOpt.expected, 2)}m` }))),
      h("div", { class: "section" }, table([
        { label: "Direct hedge ratio", key: "hr2", fmt: (v) => pct(v, 0) },
        { label: "Hedge carry ($m)", key: "carry", r: true, fmt: (v) => num(v, 2) },
        { label: "Loss if break ($m)", key: "lossIfBreak", r: true, fmt: (v) => num(v, 1) },
        { label: "Expected cost ($m)", key: "expected", r: true, fmt: (v) => num(v, 2) },
        { label: "+ tail option: loss if break", get: (r) => row(r.hr2, true).lossIfBreak, r: true, fmt: (v) => num(v, 1) },
        { label: "+ tail option: expected cost", get: (r) => row(r.hr2, true).expected, r: true, fmt: (v) => num(v, 2) },
      ], [0, 0.25, 0.5, 0.75, 1].map((x) => row(x, false)))),
    );
  };
  const inp = (key, label, step, note) => field(label, inputs[key] = numberInput(m[key], (v) => { m[key] = v; render(); }, { step }));
  const setv = (patch) => { Object.assign(m, patch); for (const k of Object.keys(patch)) if (inputs[k]) inputs[k].value = +(+m[k]).toFixed(2); render(); };

  const bp0 = baseRateP();
  const hz30 = hazardOlderThan(lives, 30);
  const calcCard = h("section", { class: "card" },
    h("h3", { text: "Proxy hedge vs direct hedge: expected cost and tail" }),
    h("p", { class: "sub", text: "A USD proxy hedge leaves you exposed to the peg breaking. Hedging the local currency directly removes that but costs the local–USD carry plus wider spreads. Defaults are illustrative placeholders: replace cost and option premium with dealer quotes." }),
    h("div", { class: "calc" },
      inp("notional", "Exposure ($m)", "1"), inp("horizon", "Horizon (years)", "0.5"),
      inp("prob", "P(break over horizon) %", "0.1"), inp("lgd", "Loss if it breaks %", "1"),
      inp("cost", "Extra cost of direct hedge (bp p.a.)", "5"), inp("ratio", "Direct hedge ratio %", "5"),
      inp("premium", "Tail option premium (bp p.a.)", "5"), inp("strike", "Option strike, % out of the money", "1")),
    h("div", { class: "tags", style: { marginTop: "10px" } },
      h("button", { type: "button", class: "tag", text: `P: Kaplan–Meier for a ${m.age}y peg (${pct(bp0, 1)})`, onclick: () => setv({ prob: +(baseRateP() * 100).toFixed(2) }) }),
      h("button", { type: "button", class: "tag", text: `P: pooled rate, pegs aged 30y+ (${pct(1 - Math.exp(-hz30.rate * m.horizon), 1)})`, onclick: () => setv({ prob: +((1 - Math.exp(-hz30.rate * m.horizon)) * 100).toFixed(2) }) }),
      h("button", { type: "button", class: "tag", text: `P: 95% upper bound, 30y+ (${pct(1 - Math.exp(-hz30.ciHi * m.horizon), 1)})`, onclick: () => setv({ prob: +((1 - Math.exp(-hz30.ciHi * m.horizon)) * 100).toFixed(2) }) }),
      h("button", { type: "button", class: "tag", text: "Loss: Gulf step, ~10% (Oman 1986)", onclick: () => setv({ lgd: 10 }) }),
      h("button", { type: "button", class: "tag", text: `Loss: median break (${spct(s12.p50, 0)} at 12m)`, onclick: () => setv({ lgd: +(-s12.p50 * 100).toFixed(1) }) }),
      h("button", { type: "button", class: "tag", text: `Loss: 1-in-4 worst (${spct(s12.p25, 0)})`, onclick: () => setv({ lgd: +(-s12.p25 * 100).toFixed(1) }) }),
      kztS ? h("button", { type: "button", class: "tag", text: `Loss: oil-exporter float, Kazakhstan (${spct(kztS.chg["12m"], 0)})`, onclick: () => setv({ lgd: +(-kztS.chg["12m"] * 100).toFixed(1) }) }) : null),
    h("p", { class: "small muted", style: { marginTop: "8px" }, text: `Base-rate probability uses the sample chosen on the "How likely?" page (currently ${baseState.def === "narrow" ? "hard pegs" : "incl. crawling"}, cohort ${baseState.cohort}). It is the unconditional historical rate, not a forecast for any specific currency.` }),
    out);
  render();

  const play = (title, items) => h("section", { class: "card" }, h("h3", { text: title }), h("ul", { class: "prose", style: { paddingLeft: "18px", margin: 0 } }, items.map((t) => h("li", { html: t }))));

  return h("div", {},
    pageHead("What else can I do?", "The hedging choice is a trade-off between a known carry cost and a small-probability jump loss. The rest of the toolkit is about keeping options open before stress arrives, because liquidity and even the rules can change once it does."),
    calcCard,
    h("div", { class: "grid grid-2 section" },
      play("1 · Decide in calm, not in stress", [
        "Stress costs rise non-linearly: in 2016 SAR forwards and options repriced sharply and SAMA told banks to stop selling options on riyal forwards. The cheapest time to buy tail protection or set up lines is when nobody wants them.",
        "Write down your <b>escalation triggers</b> now, e.g. 12m points beyond carry above a threshold, offshore quotes more than 50bp off parity for 5+ days, a sharp CDS jump, falling central bank foreign assets, or new FX restrictions. Pair each with a pre-agreed hedge ratio step.",
        "Triggers don't protect against gaps: the SNB floor (2015) and most EM floats moved 10–30% on day one. Hold some protection <i>before</i> the trigger.",
      ]),
      play("2 · Partial direct hedging and tail options", [
        "A <b>partial direct hedge</b> (say 25–50% in SAR/AED/QAR forwards) caps the tail at a fraction of the carry cost. Use the table above to find the ratio where expected cost is flat but the tail is tolerable.",
        "<b>Out-of-the-money USD calls / local puts</b> are cheap in calm regimes with low implied vol. They cover a step devaluation, the historical Gulf template. Check whether they are onshore deliverable or offshore NDOs, and the regulator's stance.",
        "Longer tenors reduce roll risk, since a break typically comes after forwards and vols have already repriced.",
      ]),
      play("3 · Know what your hedge settles on", [
        "In <b>Qatar 2017</b> the onshore peg held while offshore quotes were up to ~6% weaker. The loss depended on whether NAV, custodian FX and NDF fixings referenced onshore or offshore prices.",
        "In <b>Lebanon</b> the official rate stayed at 1,507.5 for three years after dollars stopped being available at it. A hedge fixing on the official rate would have paid nothing.",
        "Keep <b>onshore banking access</b> (to reach central-bank liquidity at the peg) and <b>ISDA/CSA lines</b> with several dealers who quote the currency: in 2017 several UK banks stopped dealing QAR.",
      ]),
      play("4 · Correlated and indirect hedges", [
        "<b>Oil puts</b> cover the 1986, 1998, 2015–16 and 2020 channel (price collapse). They <i>lose</i> in the 2026 channel (price up, volumes down) and in political shocks like 2017.",
        "<b>Sovereign CDS</b> has tracked peg stress for weaker credits (Bahrain 2018) but hardly moves for Saudi Arabia, the UAE or Qatar.",
        "<b>Diversifying across GCC currencies helps little</b>: the pegs share a shock and a policy philosophy, so treat them as one position. Kuwait's basket is a partial exception.",
      ]),
      play("5 · Remember the upside and the other risks", [
        "Gulf pressure has run <b>both ways</b>: 2007–08 speculation was for revaluation, and Kuwait's 2007 move was an appreciation. A USD proxy hedge would have gained. Don't overpay for protection that only works one way.",
        "<b>Convertibility and transfer risk</b> (capital controls, deposit freezes, as in Argentina 2001 and Lebanon 2019) cannot be hedged with FX forwards. Diversify custody, hold liquidity offshore, and monitor non-resident deposit flows.",
        "<b>Counterparty and settlement risk</b> rises in the break itself (several Russian forward counterparties failed in 1998).",
      ]),
      play("6 · Stress-test three distinct scenarios", [
        "<b>Offshore dislocation</b>: onshore peg holds, offshore −4 to −7% for ~6 months, with liquidity gaps (Qatar 2017).",
        `<b>Step to a new peg</b>: −10 to −20% overnight, then stable (Oman 1986 ${omr ? "" : ""}, Iraq 2020, UK 1967).`,
        `<b>Float</b>: −25% on day one, ${kztS ? spct(kztS.chg["12m"], 0) : "−45%"} after a year (Kazakhstan 2015), with forward markets closed or rationed in between.`,
      ]),
    ),
    h("p", { class: "callout warn small section", text: "General research on hedging mechanics, not investment advice or a recommendation for any portfolio. Validate costs, instruments and documentation with your trading desk, counterparties and risk function." }),
  );
}
