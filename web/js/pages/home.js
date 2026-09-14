import { h, loadJSON, pct, num, bp, tile } from "../ui.js";
import { DEFAULT_STATE, buildLives, kaplanMeier, conditionalBreak, hazardOlderThan, summarize } from "../stats.js";

export default async function home() {
  const [data, gcc, cur, eps] = await Promise.all([
    loadJSON("data/processed/regimes.json"), loadJSON("data/processed/gcc.json"),
    loadJSON("data/curated/current.json"), loadJSON("data/processed/episodes.json"),
  ]);
  const lives = buildLives(data, DEFAULT_STATE);
  const km = kaplanMeier(lives);
  const old = hazardOlderThan(lives, 30);
  const c5 = conditionalBreak(km, lives, 40 * 12, 60);
  const events = lives.filter((l) => l.event).map((l) => l.eventSpell);
  const s12 = summarize(events.map((e) => (e.chg_anchor && e.chg_anchor["12"]) ?? (e.chg_usd && e.chg_usd["12"])));

  const q = (href, question, answer, go) => h("a", { class: "card q-card", href }, h("div", { class: "q", text: question }), h("p", { class: "a", text: answer }), h("span", { class: "go", text: go }));

  const gulfTiles = ["SAR", "AED", "QAR"].map((c) => {
    const p = gcc.pegs[c];
    const sc = cur.scorecard.find((r) => r.ccy === c);
    const dev = p.offshore_dev_bp;
    return h("a", { class: "tile q-card", href: "#/gulf" },
      h("div", { class: "label", text: `${c} · ${p.country}` }),
      h("div", { class: "value", text: p.onshore_last ? p.onshore_last[1].toFixed(4) : "–" }),
      h("div", { class: "note", text: p.offshore_quality?.suspect ? `Onshore at parity ${p.parity} · offshore proxy unreliable in 2026 (see Gulf page)` : `Parity ${p.parity} · offshore proxy ${dev ? bp(dev.last) : "–"} (max ${dev ? Math.round(dev.max_abs_90d) : "–"}bp, 90d)` }),
      sc ? h("div", { style: { marginTop: "6px" } }, h("span", { class: `status ${sc.stress}`, text: `Stress: ${sc.stress}` })) : null);
  });

  const featured = eps.episodes.filter((e) => e.featured);
  return h("div", {},
    h("div", { class: "page-head" },
      h("h1", { text: "When do currency pegs break, and what happens next?" }),
      h("p", { class: "lede", text: "For portfolios that proxy-hedge SAR, AED and QAR with USD, the residual risk is the peg itself. This tool puts that risk in historical context: base rates across every de facto peg since 1946, the damage when pegs broke, the signals that came first, and the choices available to a hedger." })),
    h("div", { class: "grid grid-2" },
      q("#/likelihood", "How likely is a break?", `Hard pegs that had already lasted 30+ years broke at about ${pct(old.rate, 1)} a year (${old.events} break${old.events === 1 ? "" : "s"} in ${num(old.py)} peg-years; 95% interval up to ${pct(old.ciHi, 1)}). Over five years that is ${pct(1 - Math.exp(-old.rate * 5), 0)}, or up to ${pct(1 - Math.exp(-old.ciHi * 5), 0)} at the top of the interval. Old pegs are rare, so the answer is very sensitive to how you define a break and which pegs you compare.`, "Explore base rates →"),
      q("#/impact", "If it breaks, how bad can it get?", `The median break left the currency ${pct(-s12.p50, 0)} weaker a year later, and one in ten lost more than ${pct(-s12.p10, 0)}. The Gulf's own precedent is smaller: Oman devalued by about 10% in one step in 1986, and the rate has held since.`, "See the damage distribution →"),
      q("#/signals", "Are there clues it's imminent?", "Forward points above carry, offshore/onshore wedges, parallel-market premiums and draining reserves have all preceded breaks. In the Gulf they have also flagged false alarms repeatedly (1998–99, 2016, 2017, 2018, 2020).", "Review the signals →"),
      q("#/mitigation", "What else can I do?", "Compare the carry cost of hedging directly with the expected tail loss, agree switch triggers before you need them, and check which rate your hedges settle against. In Qatar 2017 the offshore rate broke while the onshore peg held.", "Size the trade-offs →"),
    ),
    h("h2", { text: "Gulf pegs today" }),
    h("p", { class: "muted small", text: `Onshore: BIS reference rates to ${gcc.pegs.SAR.onshore_last?.[0] || "–"}. Offshore proxy: Yahoo composite quotes, filtered for bad ticks. Briefing as of ${cur.as_of}.` }),
    h("div", { class: "grid grid-4" }, ...gulfTiles,
      h("a", { class: "tile q-card", href: "#/gulf" }, h("div", { class: "label", text: "Brent crude" }), h("div", { class: "value", text: `$${gcc.brent_last[1].toFixed(0)}` }), h("div", { class: "note", text: `${gcc.brent_last[0]} · ${gcc.brent_source}` }))),
    h("div", { class: "callout section" }, h("strong", { text: cur.headline + " " }), h("a", { href: "#/gulf", text: "Read the September 2026 briefing →" })),
    h("h2", { text: "Featured episodes" }),
    h("div", { class: "grid grid-3" }, featured.map((e) => h("a", { class: "card ep-card", href: `#/episode/${e.id}` },
      h("div", { class: "ep-meta", text: `${e.date.slice(0, 4)} · ${e.kind === "break" ? "Break" : e.kind === "stress" ? "Stress, peg held" : "Edge case"}` }),
      h("div", { class: "ep-title", text: e.title }),
      h("div", { class: "ep-stat", text: e.hedger_lesson.split(". ")[0] + "." })))),
  );
}
