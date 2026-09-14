import { h, pageHead, card, table, loadJSON, pct, num, field, numberInput, store, save, fmtISO } from "../ui.js";
import { impliedProbability } from "../stats.js";
import { lineChart, SERIES_COLORS } from "../charts.js";

const calc = store("pbx.implied", { spot: 3.75, forward: 3.7975, tenor: 1, diff: 0, dev: 10 });
const PRESETS = [
  { label: "SAR, Dec 2015: 825 pts", spot: 3.75, forward: 3.8325, note: "Gulf News/Reuters" },
  { label: "SAR, Jan 2016: 975 pts", spot: 3.75, forward: 3.8475, note: "Bloomberg-reported peak" },
  { label: "QAR onshore, Jun 2017: 1y at 3.70", spot: 3.64, forward: 3.70, note: "Reuters via Gulf News" },
  { label: "BHD, Jun 2018: 408 pts (5 dp)", spot: 0.376, forward: 0.38008, note: "points convention assumed" },
];
const DAY = 864e5;

const SIGNALS = [
  { signal: "Forward points well above the rate differential", why: "The forward embeds expected devaluation × probability plus risk and liquidity premia (Svensson's drift adjustment).", lead: "Weeks to months", fp: "High: SAR 1999, 2015–16, 2020 and BHD 2018 all held", eg: "SAR 2016, BHD 2018, QAR 2017", gcc: "Not sourced here (needs Bloomberg/Refinitiv). The calm in CDS suggests no large move." },
  { signal: "Offshore/onshore wedge; banks stop quoting", why: "Segmentation lets offshore pricing reflect fear the central bank isn't meeting.", lead: "Late stage, or none", fp: "QAR 2017 wedge ~6% reversed without a break", eg: "THB 1997, QAR 2017, MYR 1998", gcc: "Yahoo proxy shows no persistent off-parity quotes for SAR/AED/QAR (see Gulf monitor)." },
  { signal: "Parallel-market premium; FX rationing", why: "When the official rate is defended by rationing, the parallel rate reveals the clearing price and usually sets break size.", lead: "Months to years", fp: "Low, but timing is highly uncertain", eg: "NGN 2016, EGP 2016/24, LBP, BOB 2026, IQD", gcc: "None: GCC currencies are fully convertible. Iraq's parallel dinar is ~17% below official." },
  { signal: "Usable reserves draining vs short-term needs", why: "A peg breaks when usable foreign assets run out relative to potential outflows (M2, short-term debt, forward book).", lead: "6–24 months", fp: "Medium: Saudi reserves fell ~⅓ in 2014–17 without a break", eg: "THB 1997, KRW 1997, AZN 2015, LKR 2022, BOB 2026", gcc: "QCB reserves up ~10% y/y (Jul 2026); SWF buffers intact. Bahrain thin." },
  { signal: "Terms-of-trade shock vs fiscal breakeven", why: "For commodity exporters, a lasting price or volume collapse turns a peg into a fiscal choice.", lead: "6–18 months", fp: "Medium: GCC chose austerity in 1998, 2016 and 2020", eg: "OMR 1986, RUB 1998/2014, KZT 2015, NGN 2016, IQD 2020", gcc: "2026 twist: price high, volumes collapsed for Qatar/Kuwait/Bahrain." },
  { signal: "Anchor tightening into a local downturn", why: "Pegs import the anchor's policy; defending becomes politically costly when domestic conditions call for easing.", lead: "Months", fp: "Medium", eg: "GBP/ITL/SEK 1992, MXN 1994", gcc: "Fed on hold at 3.50–3.75% with hikes priced while Qatar contracts ~9%." },
  { signal: "Interbank rate spikes / local–anchor spread", why: "Currency boards and hard pegs defend with rates; stress shows in local money markets before spot.", lead: "Days to weeks", fp: "Medium: HKD 1997–98 held", eg: "HKD 1997, SEK 1992, TRY 2001", gcc: "Watch SAIBOR/QIBOR/EIBOR vs SOFR; not sourced here." },
  { signal: "Sovereign CDS jumps", why: "Credit and currency stress are joint when the state is the backstop.", lead: "Weeks", fp: "Medium", eg: "BHD 2018", gcc: "Muted: Saudi −9bp YTD, UAE/Qatar +6bp; Bahrain the outlier." },
  { signal: "Deposit flight and dollarisation", why: "Residents moving deposits to dollars or abroad is the run that reserves must meet.", lead: "Months", fp: "Low when large", eg: "ARS 2001, LBP 2019, QAR 2017 (non-resident deposits)", gcc: "Qatar repatriated ~$13bn to support banks (Aug 2026): watch non-resident deposits." },
  { signal: "Regulatory ‘tells’: derivative bans, FX restrictions", why: "Authorities curbing hedging or speculation signals pressure, and changes your toolkit.", lead: "Weeks to months", fp: "High: SAMA's 2016 options ban preceded no break", eg: "SAMA 2016, BoT 1997, Malaysia 1998", gcc: "None reported in 2026." },
  { signal: "Peer and neighbour breaks", why: "Competitiveness and contagion: once a peer devalues, the case for holding weakens.", lead: "Days to months", fp: "Medium", eg: "KZT after RUB and CNY 2015; ERM 1992; Asia 1997", gcc: "No GCC peer has broken; Bolivia (Jun 2026) is unrelated." },
  { signal: "Official reaffirmations", why: "Not informative in either direction; the SNB called its floor a cornerstone three days before dropping it.", lead: "n/a", fp: "n/a", eg: "CHF 2015", gcc: "All GCC central banks reaffirm routinely." },
];

export default async function signals() {
  const eps = await loadJSON("data/processed/episodes.json");
  const byId = Object.fromEntries(eps.episodes.map((e) => [e.id, e]));

  // ---- implied probability calculator ----
  const out = h("div");
  const inputs = {};
  const render = () => {
    save("pbx.implied", calc);
    const r = impliedProbability({ spot: calc.spot, forward: calc.forward, tenorYears: calc.tenor, rLocal: calc.diff / 100, rUsd: 0, devaluation: calc.dev / 100 });
    const grid = [5, 10, 15, 20, 30].map((d) => ({ d, p: impliedProbability({ spot: calc.spot, forward: calc.forward, tenorYears: calc.tenor, rLocal: calc.diff / 100, rUsd: 0, devaluation: d / 100 }).p }));
    out.replaceChildren(
      h("div", { class: "result-row" },
        h("div", { class: "tile" }, h("div", { class: "label", text: `Implied chance of a ${calc.dev}% devaluation within ${calc.tenor}y` }), h("div", { class: "value", text: isFinite(r.p) ? pct(Math.max(0, r.p), 1) : "–" }), h("div", { class: "note", text: "risk-neutral: an upper bound on the true probability" })),
        h("div", { class: "tile" }, h("div", { class: "label", text: "Forward premium beyond carry" }), h("div", { class: "value", text: `${num(r.excess * 1e4, 0)}bp` }), h("div", { class: "note", text: `carry-only forward ${r.carry.toFixed(5)}` }))),
      table([{ label: "If the devaluation would be", key: "d", fmt: (v) => `${v}%` }, { label: "Implied probability", key: "p", r: true, fmt: (v) => (isFinite(v) ? pct(Math.max(0, Math.min(1, v)), 1) : "–") }], grid),
    );
  };
  const inp = (key, label, step) => field(label, inputs[key] = numberInput(calc[key], (v) => { calc[key] = v; render(); }, { step }));
  const calcCard = h("section", { class: "card" },
    h("h3", { text: "What are forward points implying?" }),
    h("p", { class: "sub", text: "Enter the outright forward and the money-market rate differential. Without a devaluation expectation, the forward equals spot adjusted for carry; anything beyond that is priced as probability × size. Leave the differential at 0 to read quoted points gross of carry." }),
    h("div", { class: "calc" }, inp("spot", "Spot / peg", "0.0001"), inp("forward", "Outright forward", "0.0001"), inp("tenor", "Tenor (years)", "0.25"), inp("diff", "Local minus USD rate (% p.a.)", "0.05"), inp("dev", "Devaluation size if it happens (%)", "1")),
    h("div", { class: "tags", style: { marginTop: "10px" } }, PRESETS.map((p) => h("button", { type: "button", class: "tag", title: p.note, text: p.label, onclick: () => { Object.assign(calc, { spot: p.spot, forward: p.forward, tenor: 1, diff: 0 }); for (const k of ["spot", "forward", "tenor", "diff"]) inputs[k].value = calc[k]; render(); } }))),
    out,
    h("p", { class: "small muted", style: { marginTop: "10px" }, text: "Presets use reported forward levels with a zero rate differential, because the contemporaneous SAIBOR–LIBOR and QIBOR–LIBOR spreads aren't sourced here, so the probabilities are gross of carry. In every preset shown, the peg held." }),
  );
  render();

  // ---- evidence charts ----
  const miniChart = (ep, height = 260) => {
    const el = h("div");
    const d0 = Date.parse(`${ep.date}T00:00:00Z`);
    const series = ep.series.filter((s) => !s.missing);
    setTimeout(() => lineChart(el, {
      series: series.map((s, k) => ({ name: s.label, color: SERIES_COLORS[k], step: true, points: s.t.map((t, j) => [d0 + t * DAY, s.v[j]]) })),
      xType: "time", yFormat: (v) => v.toFixed(3), tooltipValue: (v) => v.toFixed(4),
      refY: ep.peg ? [{ y: ep.peg, label: `peg ${ep.peg}` }] : [], refX: [{ x: d0, label: "event" }],
      markers: (ep.datapoints || []).map((p) => ({ x: Date.parse(`${p.date}T00:00:00Z`), label: p.label })), height,
    }));
    return el;
  };

  return h("div", {},
    pageHead("Are there clues a break is imminent?", "What has preceded breaks, how early, and how often each signal gave false alarms, especially in the Gulf, where every stress episode since 1986 has ended with the peg intact."),
    h("div", { class: "callout warn prose", html: "<strong>No indicator reliably times a break.</strong> Early-warning research, starting with Kaminsky, Lizondo &amp; Reinhart (1998), finds signals that raise the odds over a roughly 24-month window, with many false alarms. For a hard, well-funded peg, the practical use of signals is to <em>escalate hedging in steps</em> rather than to call the day." }),
    h("div", { class: "section" }, calcCard),
    h("div", { class: "section" }, card({
      title: "Signal checklist",
      sub: "Evidence from the episode library, with this tool's reading for the Gulf in September 2026.",
      body: table([{ label: "Signal", key: "signal", cls: () => "" }, { label: "Why it matters", key: "why" }, { label: "Typical lead", key: "lead" }, { label: "False alarms", key: "fp" }, { label: "Examples", key: "eg" }, { label: "Gulf, Sep 2026", key: "gcc" }], SIGNALS),
    })),
    h("div", { class: "grid grid-2 section" },
      card({ title: "Offshore wedge without a break: Qatar 2017", sub: "Onshore (BIS) held at 3.64 while the offshore proxy (Yahoo) gapped. Hover dots for the dated evidence.", body: miniChart(byId["qar-2017"]) }),
      card({ title: "Forward stress without a break: Saudi Arabia 2015–16", sub: "Spot stayed at 3.75 while 1y forward points reached record territory and SAMA banned options on riyal forwards.", body: miniChart(byId["sar-2016"]) })),
    h("div", { class: "section" }, card({
      title: "Further reading",
      body: h("ul", { class: "sources" },
        [["Kaminsky, Lizondo & Reinhart (1998), Leading Indicators of Currency Crises, IMF Staff Papers. Best-performing indicators: exports, real exchange rate deviation from trend, broad money / reserves, output, equity prices.", "https://www.imf.org/external/pubs/ft/staffp/1998/03-98/kaminsky.htm"],
          ["Frankel & Rose (1996), Currency crashes in emerging markets: an empirical treatment, Journal of International Economics.", "https://doi.org/10.1016/S0022-1996(96)01441-9"],
          ["Eichengreen, Rose & Wyplosz (1995), Exchange market mayhem, Economic Policy: the exchange-market-pressure index (rate, reserves, interest rates).", "https://doi.org/10.2307/1344538"],
          ["Svensson (1993), Assessing target zone credibility: mean reversion and devaluation expectations, European Economic Review: the drift-adjustment method behind the calculator.", "https://doi.org/10.1016/0014-2921(93)90039-G"],
          ["Ilzetzki, Reinhart & Rogoff (2019), Exchange Arrangements Entering the 21st Century: Which Anchor Will Hold?, QJE, and the classification data used here.", "https://www.ilzetzki.com/irr-data"],
          ["Obstfeld & Rogoff (1995), The Mirage of Fixed Exchange Rates, Journal of Economic Perspectives.", "https://doi.org/10.1257/jep.9.4.73"],
        ].map(([t, u]) => h("li", {}, h("a", { href: u, target: "_blank", rel: "noopener", text: t })))),
    })),
  );
}
