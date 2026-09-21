import { h, pageHead, card, table, loadJSON, num } from "../ui.js";

const BASE = "data/processed/downloads/";

export default async function data() {
  const mf = await loadJSON(`${BASE}manifest.json`);
  const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
  const file = (name) => mf.files.find((f) => f.name === name);
  const dl = (name, label, note) => {
    const f = file(name);
    return h("a", { class: "card q-card", href: `${BASE}${name}`, download: name },
      h("div", { class: "q", text: label }), h("p", { class: "a", text: `${note} · ${f ? size(f.bytes) : ""}` }), h("span", { class: "go", text: "Download ↓" }));
  };
  return h("div", {},
    pageHead("Download the data", `Everything behind this tool in one workbook or as CSVs: ${mf.tables.length} tables, generated ${mf.generated}.`),
    h("div", { class: "grid grid-2" },
      dl("peg_breaks_dataset.xlsx", "Excel workbook (.xlsx)", "One sheet per table, plus a README sheet"),
      dl("peg_breaks_dataset_csv.zip", "CSV files (.zip)", "One CSV per table, plus README.csv")),
    h("div", { class: "section" }, card({
      title: "Tables",
      sub: "Value changes are fractions (−0.25 = the currency lost 25%). 'proxy' columns are the shortfall of a USD/GBP proxy hedge vs a proper local-currency hedge for a GBP investor.",
      body: table([{ label: "Table", key: "name" }, { label: "Rows", key: "rows", r: true, fmt: (v) => num(v) }, { label: "Columns", key: "columns", r: true }, { label: "Contents", key: "description" }], mf.tables),
    })),
    h("p", { class: "callout small section", html: "Please cite Ilzetzki, Reinhart &amp; Rogoff for the regime classification and the BIS for exchange rates. Brent is EIA data via the FRED® API (not endorsed or certified by the Federal Reserve Bank of St. Louis). <b>Raw Yahoo Finance prices are not included</b> because Yahoo's terms restrict redistribution; statistics derived from them are. See <a href=\"#/method\">Method</a> for definitions." }),
  );
}
