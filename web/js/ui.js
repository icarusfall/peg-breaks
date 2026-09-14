// Shared DOM helpers, formatting, data loading and the base-rate filter row.
import { DEFAULT_STATE } from "./stats.js";

export function h(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v; // authored static copy only, never data
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}

const MINUS = "−";
export const pct = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? "–" : `${(v * 100).toFixed(d)}%`.replace("-", MINUS));
export const spct = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? "–" : `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v * 100).toFixed(d)}%`);
export const num = (v, d = 0) => (v === null || v === undefined || !isFinite(v) ? "–" : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }).replace("-", MINUS));
export const bp = (v) => (v === null || v === undefined || !isFinite(v) ? "–" : `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v).toFixed(0)}bp`);
export const signClass = (v) => (v < -0.0005 ? "neg" : v > 0.0005 ? "pos" : "");
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtYM = (ym) => { const [y, m] = ym.split("-"); return `${MONTHS[+m - 1]} ${y}`; };
export const fmtISO = (iso) => { const [y, m, d] = iso.split("-"); return `${+d} ${MONTHS[+m - 1]} ${y}`; };

const cache = new Map();
export function loadJSON(path) {
  if (!cache.has(path)) cache.set(path, fetch(path).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); }));
  return cache.get(path);
}

export function store(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : { ...fallback }; } catch { return { ...fallback }; }
}
export function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }

// shared base-rate filter state (likelihood, impact, mitigation read the same slice)
export const baseState = store("pbx.baseState", DEFAULT_STATE);
export function setBase(patch) { Object.assign(baseState, patch); save("pbx.baseState", baseState); }

export function pageHead(title, lede) {
  return h("div", { class: "page-head" }, h("h1", { text: title }), lede ? h("p", { class: "lede", text: lede }) : null);
}

export function tile(label, value, note) {
  return h("div", { class: "tile" }, h("div", { class: "label", text: label }), h("div", { class: "value", text: value }), note ? h("div", { class: "note", text: note }) : null);
}

/** Table. columns: [{label, key|get, fmt, r, cls}] */
export function table(columns, rows, { onRowClick, maxHeight } = {}) {
  const thead = h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.r ? "r" : "", text: c.label }))));
  const tbody = h("tbody");
  for (const row of rows) {
    const tr = h("tr", { class: onRowClick ? "clickable" : "" });
    for (const c of columns) {
      const raw = c.get ? c.get(row) : row[c.key];
      const content = c.fmt ? c.fmt(raw, row) : raw;
      const td = h("td", { class: [c.r ? "r" : "", c.cls ? c.cls(raw, row) : ""].join(" ").trim() });
      if (content instanceof Node) td.appendChild(content); else td.textContent = content ?? "–";
      tr.appendChild(td);
    }
    if (onRowClick) {
      tr.tabIndex = 0;
      tr.addEventListener("click", () => onRowClick(row));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") onRowClick(row); });
    }
    tbody.appendChild(tr);
  }
  const wrap = h("div", { class: "table-wrap" }, h("table", { class: "data" }, thead, tbody));
  if (maxHeight) { wrap.style.maxHeight = maxHeight; wrap.style.overflowY = "auto"; }
  return wrap;
}

/** Card with an optional chart/table toggle. */
export function card({ title, sub, body, tableFn, actions }) {
  const chartBox = h("div");
  const tableBox = h("div", { hidden: true });
  const toggle = tableFn ? h("button", { class: "linkbtn", type: "button", text: "Show table" }) : null;
  if (toggle) {
    toggle.addEventListener("click", () => {
      const showing = !tableBox.hidden;
      if (!showing) tableBox.replaceChildren(tableFn());
      tableBox.hidden = showing;
      chartBox.hidden = !showing;
      toggle.textContent = showing ? "Show table" : "Show chart";
    });
  }
  const c = h("section", { class: "card" },
    h("div", { class: "card-head" }, h("h3", { text: title }), h("div", { class: "chart-actions" }, actions || null, toggle)),
    sub ? h("p", { class: "sub", text: sub }) : null, chartBox, tableBox);
  if (body) chartBox.appendChild(body);
  c.chartBox = chartBox;
  return c;
}

export function field(label, control) { return h("label", { class: "field" }, h("span", { text: label }), control); }

export function selectEl(options, value, onChange) {
  const s = h("select", { onchange: (e) => onChange(e.target.value) }, options.map(([v, l]) => h("option", { value: v, text: l, selected: String(v) === String(value) })));
  return s;
}
export function segmented(options, value, onChange, ariaLabel) {
  const wrap = h("div", { class: "seg", role: "group", "aria-label": ariaLabel || "" });
  for (const [v, l] of options) {
    const b = h("button", { type: "button", "aria-pressed": String(String(v) === String(value)), text: l });
    b.addEventListener("click", () => { wrap.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); onChange(v); });
    wrap.appendChild(b);
  }
  return wrap;
}
export function checkbox(label, checked, onChange) {
  return h("label", { class: "check" }, h("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) }), label);
}
export function numberInput(value, onChange, { step = "any", min, max, width } = {}) {
  const i = h("input", { type: "number", value, step, min, max, oninput: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) onChange(v); } });
  if (width) i.style.width = width;
  return i;
}

export const COHORTS = [["all", "All pegs"], ["usd", "USD-anchored"], ["hydro", "Hydrocarbon exporters"], ["hydro_usd", "Hydrocarbon + USD anchor"], ["gcc", "GCC only"]];

export function baseFilters(onChange, extra = []) {
  const s = baseState;
  const upd = (patch) => { setBase(patch); onChange(); };
  return h("div", { class: "filters", role: "region", "aria-label": "Sample filters" },
    field("Peg definition", segmented([["narrow", "Hard pegs"], ["broad", "+ crawling"]], s.def, (v) => upd({ def: v }), "Peg definition")),
    field("Count exposure from", selectEl([[1946, "1946"], [1960, "1960"], [1974, "1974 (post-Bretton Woods)"], [1990, "1990"], [2000, "2000"]], s.era, (v) => upd({ era: +v }))),
    field("Step realignment counts as a break if ≥", selectEl([[0, "Don't count"], [5, "5%"], [10, "10%"], [20, "20%"], [33, "33%"]], s.realign, (v) => upd({ realign: +v }))),
    field("Direction", segmented([["down", "Weaker only"], ["both", "Either way"]], s.direction, (v) => upd({ direction: v }), "Direction")),
    field("Cohort", selectEl(COHORTS, s.cohort, (v) => upd({ cohort: v }))),
    checkbox("Ignore 1971–73 Bretton Woods collapse", s.excludeBW, (v) => upd({ excludeBW: v })),
    checkbox("Drop spells with unknown start", s.excludeLeftCensored, (v) => upd({ excludeLeftCensored: v })),
    ...extra,
  );
}

export function sourcesList(sources) {
  return h("ul", { class: "sources" }, sources.map((s) => h("li", {}, h("a", { href: s.url, target: "_blank", rel: "noopener", text: s.title || s.url }))));
}
