import { h, pageHead, card, table, loadJSON, num } from "../ui.js";

export default async function method() {
  const [data, eps, gcc] = await Promise.all([loadJSON("data/processed/regimes.json"), loadJSON("data/processed/episodes.json"), loadJSON("data/processed/gcc.json")]);
  const nC = Object.keys(data.countries).length;
  const codes = Object.entries(data.codes).map(([k, v]) => ({ code: k, label: v, narrow: data.meta.definitions.narrow.includes(+k) ? "✓" : "", broad: data.meta.definitions.broad.includes(+k) ? "✓" : "" }));
  const sec = (title, html) => h("section", { class: "card prose" }, h("h3", { text: title }), h("div", { html }));

  return h("div", {},
    pageHead("Method, data and limitations", `Regime data for ${nC} countries, ${num(data.spells.length)} peg spells across two definitions, ${eps.episodes.length} curated episodes. Pipeline generated ${data.meta.generated}; latest BIS month ${data.meta.bis_latest}.`),
    h("div", { class: "grid grid-2" },
      sec("What counts as a peg", `
        <p>Peg status comes from the <b>Ilzetzki–Reinhart–Rogoff (IRR) de facto classification</b>, monthly for every country from 1940 to 2019. It is based on how exchange rates actually behaved, including parallel markets, not on what governments announced.</p>
        <p><b>Hard pegs</b> (the default) are fine codes 2–4: pre-announced pegs and currency boards, pre-announced bands within ±2%, and de facto pegs. <b>+ crawling</b> adds crawling pegs and bands within ±2% (codes 5–8). Code 1 (no separate legal tender, e.g. euro members) is treated as leaving the sample, not as a break.</p>`),
      sec("What counts as a break", `
        <ul>
          <li><b>Regime exit</b>: the classification moves from a peg code to anything looser (managed float, free float, freely falling, dual market). Classification blips of up to two months where the rate barely moved (&lt;2%) are merged.</li>
          <li><b>Step realignment</b>: still classified as a peg, but the rate against the anchor jumped by at least 5% within two months (monthly BIS averages, against IRR's anchor currency). The filter chooses the threshold that counts, 10% by default. This captures devalue-and-re-peg events like Oman 1986.</li>
          <li><b>After 2019</b>: pegs still in place at the end of IRR are followed in BIS monthly data. A break is recorded the first month the rate moves more than 5% from its H2-2019 level. Bolivia's June 2026 float, which is after the latest BIS month, is added from curated sources.</li>
          <li><b>Bretton Woods</b>: the 1971–73 collapse, when the anchor itself broke, is excluded by default.</li>
        </ul>`),
      sec("Statistics", `
        <ul>
          <li><b>Survival</b>: Kaplan–Meier product-limit estimator with <i>delayed entry</i>. A peg that began before the chosen start year enters the risk set at its age in that year. Pegs still in place at the end of the data are censored. 95% bands use Greenwood's variance on the log scale.</li>
          <li><b>Conditional probability</b>: P(break within H | survived to A) = 1 − S(A+H)/S(A).</li>
          <li><b>Hazard by age</b>: breaks ÷ peg-years at risk within each age band, with Byar's approximation to the Poisson 95% interval.</li>
          <li><b>Impact</b>: value change of the local currency against the anchor (or USD), from the last pegged month to 1, 3, 6, 12 and 24 months later. The event-study fan shows 10th/25th/50th/75th/90th percentiles where at least five breaks have data.</li>
          <li><b>Implied probability</b>: forward = (1−p)·carry-forward + p·carry-forward/(1−D), solved for p. This is a risk-neutral quantity, including risk and liquidity premia.</li>
        </ul>`),
      sec("Limitations to keep in mind", `
        <ul>
          <li><b>Independence.</b> Survival statistics treat pegs as independent. Breaks cluster in global shocks, and GCC pegs would face correlated pressure.</li>
          <li><b>Monthly averages</b> understate day-one gaps and smear breaks over two months. Use the daily episodes for jump size.</li>
          <li><b>Basket pegs</b> (e.g. Kuwait) can't be measured against their true anchor, so only regime exits count for them.</li>
          <li><b>Official vs market rates.</b> BIS series are official/reference rates. Lebanon, Nigeria, Turkmenistan and Bolivia show how an official rate can hide a parallel-market break.</li>
          <li><b>Forward points, interbank rates, reserves and CDS history</b> are not in the free data. Figures for them are dated news citations, not series.</li>
          <li><b>Yahoo Finance</b> closes for pegged currencies are composite quotes that often reflect offshore dealing. They are a useful <i>proxy</i> (they capture QAR 2017) but noisy, and are filtered for bad ticks. They are not an authoritative fixing.</li>
          <li><b>Curated narratives</b> summarise the cited sources. Check primary sources before relying on any figure.</li>
        </ul>`),
      sec("Data sources, terms and attribution", `
        <ul>
          <li><b>IRR classification</b>: Ilzetzki, Reinhart &amp; Rogoff (2019, QJE; 2021, Handbook of International Economics), <a href="https://www.ilzetzki.com/irr-data" target="_blank" rel="noopener">ilzetzki.com/irr-data</a>. Cite when using.</li>
          <li><b>BIS US dollar exchange rates</b> (WS_XRU), daily and monthly, bulk download from <a href="https://data.bis.org" target="_blank" rel="noopener">data.bis.org</a>. Source: BIS; attribution required.</li>
          <li><b>Yahoo Finance</b> via the unofficial <code>yfinance</code> library, with Brent from <code>BZ=F</code> (${gcc.brent_source}). Yahoo's terms restrict automated collection and redistribution, so this is suitable for internal research only. For production use or wider distribution, replace it with a licensed feed (Bloomberg, LSEG/Refinitiv) for offshore spot, forwards and NDFs.</li>
          <li><b>FRED</b>: not used in the published data. FRED's terms prohibit scraping. If you set <code>FRED_API_KEY</code>, the pipeline makes one API call for Brent (EIA series DCOILBRENTEU). The app must then display "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis", and third-party series need their owner's permission beyond personal use.</li>
          <li><b>News and official sources</b> for episodes and the 2026 briefing are linked where cited.</li>
        </ul>`),
      sec("Refreshing the data", `
        <p>The pipeline is a monthly batch job, not a live feed. It is sequential, pauses between requests, and each source is downloaded once:</p>
        <pre style="overflow-x:auto;background:var(--surface-2);padding:10px;border-radius:6px"><code>pip install -r requirements-pipeline.txt
cd pipeline
python fetch_raw.py            # IRR, BIS bulk, Yahoo (+ FRED API if key set)
python build_regimes.py
python build_episodes.py
python build_gcc.py</code></pre>
        <p>Update <code>data/curated/current.json</code> and <code>episodes.json</code> by hand as events develop, then commit <code>data/processed</code>. Railway redeploys on push.</p>`),
    ),
    h("div", { class: "section" }, card({
      title: "IRR fine classification codes",
      body: table([{ label: "Code", key: "code", r: true }, { label: "Arrangement", key: "label" }, { label: "Hard peg", key: "narrow" }, { label: "+ crawling", key: "broad" }], codes),
    })),
  );
}
