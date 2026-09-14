// Minimal SVG charts: line (with bands, reference lines, markers, crosshair tooltip),
// column, and range (quantile) charts. Colours are CSS variables so theme switches apply live.
const NS = "http://www.w3.org/2000/svg";
export const SERIES_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}
function text(parent, x, y, str, attrs = {}) {
  const t = el("text", { x, y, ...attrs }, parent);
  t.textContent = str;
  return t;
}
const scale = (d0, d1, r0, r1) => {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = (v) => r0 + (v - d0) * k;
  f.invert = (p) => (k === 0 ? d0 : d0 + (p - r0) / k);
  return f;
};

export function niceTicks(min, max, count = 5) {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(12));
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (ms) => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
function timeTicks(min, max, target = 6) {
  const DAY = 864e5, span = max - min;
  const opts = [
    [1, "m"], [3, "m"], [6, "m"], [12, "y"], [24, "y"], [60, "y"], [120, "y"], [240, "y"],
  ];
  const months = span / (30.44 * DAY);
  let [step, kind] = opts.find(([s]) => months / s <= target) || opts[opts.length - 1];
  const d = new Date(min);
  let y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (kind === "y") { m = 0; y = Math.ceil((y + (d.getUTCMonth() || d.getUTCDate() > 1 ? 1 : 0)) / (step / 12)) * (step / 12); }
  else m = Math.ceil(m / step) * step;
  const out = [];
  for (let i = 0; i < 400; i++) {
    const t = Date.UTC(y, m, 1);
    if (t > max) break;
    if (t >= min) out.push({ v: t, label: kind === "y" ? String(new Date(t).getUTCFullYear()) : `${MONTHS[new Date(t).getUTCMonth()]} ${String(new Date(t).getUTCFullYear()).slice(2)}` });
    m += step;
    while (m >= 12) { m -= 12; y += 1; }
  }
  return out;
}

// ---------- tooltip ----------
const tip = () => document.getElementById("tooltip");
export function showTooltip(evt, title, rows) {
  const t = tip();
  t.replaceChildren();
  if (title) { const h = document.createElement("div"); h.className = "tt-title"; h.textContent = title; t.appendChild(h); }
  for (const r of rows) {
    const row = document.createElement("div"); row.className = "tt-row";
    if (r.color) { const k = document.createElement("i"); k.className = "tt-key"; k.style.background = r.color; row.appendChild(k); }
    const b = document.createElement("b"); b.textContent = r.value; row.appendChild(b);
    if (r.label) { const s = document.createElement("span"); s.textContent = r.label; row.appendChild(s); }
    t.appendChild(row);
  }
  t.hidden = false;
  const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}
export const hideTooltip = () => { tip().hidden = true; };

function legend(container, items) {
  const lg = document.createElement("div");
  lg.className = "legend";
  for (const it of items) {
    const k = document.createElement("span"); k.className = "key";
    const sw = document.createElement("i"); sw.className = it.rect ? "swatch-rect" : "swatch-line"; sw.style.background = it.color;
    const lab = document.createElement("span"); lab.textContent = it.name;
    k.append(sw, lab); lg.appendChild(k);
  }
  container.appendChild(lg);
}

function responsive(container, draw) {
  let lastW = 0;
  const run = () => { const w = Math.floor(container.clientWidth); if (w && w !== lastW) { lastW = w; draw(w); } };
  const ro = new ResizeObserver(run);
  ro.observe(container);
  run();
  return { redraw: () => { lastW = 0; run(); } };
}

// last point with x <= v (for step series) or nearest point
function lookup(points, v, step) {
  let lo = 0, hi = points.length - 1;
  if (hi < 0) return null;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (points[mid][0] <= v) lo = mid; else hi = mid - 1; }
  if (step) return points[lo][0] <= v ? points[lo] : null;
  const a = points[lo], b = points[Math.min(lo + 1, points.length - 1)];
  return Math.abs(a[0] - v) <= Math.abs(b[0] - v) ? a : b;
}

/**
 * opts: { series:[{name,color,points:[[x,y]],step,width}], bands:[{name,color,points:[[x,lo,hi]]}],
 *   xType:'time'|'number', xFormat, yFormat, xTitle, yTitle, yDomain, xDomain, refX:[{x,label}], refY:[{y,label}],
 *   markers:[{x,label}], height, zeroBaseline }
 */
export function lineChart(container, opts) {
  container.classList.add("chart");
  container.replaceChildren();
  const nSeries = (opts.series?.length || 0) + (opts.bands?.length || 0);
  if (nSeries >= 2 && opts.legend !== false) {
    legend(container, [
      ...(opts.bands || []).filter((b) => b.name).map((b) => ({ name: b.name, color: b.color, rect: true })),
      ...(opts.series || []).map((s) => ({ name: s.name, color: s.color })),
    ]);
  }
  const holder = document.createElement("div");
  container.appendChild(holder);
  const H = opts.height || 280;
  const xFmt = opts.xFormat || (opts.xType === "time" ? fmtDate : (v) => String(v));
  const yFmt = opts.yFormat || ((v) => v.toLocaleString());

  const draw = (W) => {
    holder.replaceChildren();
    const all = [];
    for (const s of opts.series || []) for (const p of s.points) if (p[1] !== null && isFinite(p[1])) all.push(p);
    const bandPts = [];
    for (const b of opts.bands || []) for (const p of b.points) if (p[1] !== null) bandPts.push(p);
    const xs = [...all.map((p) => p[0]), ...bandPts.map((p) => p[0])];
    const ys = [...all.map((p) => p[1]), ...bandPts.flatMap((p) => [p[1], p[2]]), ...(opts.refY || []).map((r) => r.y)];
    if (!xs.length) { holder.textContent = "No data for this selection."; holder.className = "muted small"; return; }
    let [x0, x1] = opts.xDomain || [Math.min(...xs), Math.max(...xs)];
    let [y0, y1] = opts.yDomain || [Math.min(...ys), Math.max(...ys)];
    if (opts.zeroBaseline) y0 = Math.min(0, y0);
    if (!opts.yDomain) { const pad = (y1 - y0) * 0.06 || Math.abs(y1) * 0.01 || 1; y0 -= opts.zeroBaseline && y0 === 0 ? 0 : pad; y1 += pad; }
    const yt = niceTicks(y0, y1, Math.max(3, Math.round(H / 60)));
    if (!opts.yDomain && yt.length) { y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt[yt.length - 1]); }
    const labW = Math.max(...yt.map((v) => yFmt(v).length)) * 6.6 + 10;
    const m = { l: Math.max(36, labW), r: opts.rightPad ?? 16, t: opts.markers?.length ? 22 : 10, b: opts.xTitle ? 42 : 26 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.ariaLabel || opts.yTitle || "chart" }, holder);
    const X = scale(x0, x1, m.l, W - m.r), Y = scale(y0, y1, H - m.b, m.t);

    for (const v of yt) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "grid-line" }, svg);
      text(svg, m.l - 8, Y(v) + 4, yFmt(v), { class: "tick", "text-anchor": "end" });
    }
    el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axis-line" }, svg);
    const xt = opts.xType === "time" ? timeTicks(x0, x1, Math.max(3, Math.floor((W - m.l - m.r) / 90))) :
      niceTicks(x0, x1, Math.max(3, Math.floor((W - m.l - m.r) / 80))).map((v) => ({ v, label: (opts.xTickFormat || xFmt)(v) }));
    for (const t of xt) text(svg, X(t.v), H - m.b + 16, t.label, { class: "tick", "text-anchor": "middle" });
    if (opts.xTitle) text(svg, (m.l + W - m.r) / 2, H - 6, opts.xTitle, { class: "axis-title", "text-anchor": "middle" });
    if (opts.yTitle) text(svg, m.l, m.t - (opts.markers?.length ? 12 : 0) + 0, "", {});

    const clipId = `c${Math.random().toString(36).slice(2)}`;
    const cp = el("clipPath", { id: clipId }, el("defs", {}, svg));
    el("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H - m.b }, cp);
    const plot = el("g", { "clip-path": `url(#${clipId})` }, svg);

    for (const b of opts.bands || []) {
      const pts = b.points.filter((p) => p[1] !== null && p[2] !== null);
      if (!pts.length) continue;
      const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[2]).toFixed(1)}`).join("") +
        pts.slice().reverse().map((p) => `L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("") + "Z";
      el("path", { d, style: `fill:${b.color}`, stroke: "none" }, plot);
    }
    for (const r of opts.refY || []) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(r.y), y2: Y(r.y), class: "ref-line" }, svg);
      if (r.label) text(svg, W - m.r - 4, Y(r.y) - 5, r.label, { class: "ref-label", "text-anchor": "end" });
    }
    for (const r of opts.refX || []) {
      if (r.x < x0 || r.x > x1) continue;
      el("line", { x1: X(r.x), x2: X(r.x), y1: m.t, y2: H - m.b, class: "ref-line" }, svg);
      if (r.label) text(svg, X(r.x) + 5, m.t + 11, r.label, { class: "ref-label" });
    }
    // draw in reverse so the first-listed series sits on top
    for (const s of [...(opts.series || [])].reverse()) {
      let d = "", pen = false, prev = null;
      for (const p of s.points) {
        if (p[1] === null || !isFinite(p[1])) { pen = false; continue; }
        const px = X(p[0]).toFixed(1), py = Y(p[1]).toFixed(1);
        if (!pen) d += `M${px},${py}`;
        else if (s.step) d += `H${px}V${py}`;
        else d += `L${px},${py}`;
        pen = true; prev = p;
      }
      if (s.step && prev) d += `H${(X(x1)).toFixed(1)}`;
      el("path", { d, fill: "none", style: `stroke:${s.color}`, "stroke-width": s.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: s.opacity ?? 1 }, plot);
    }
    // markers along the top edge
    const markerEls = [];
    for (const mk of opts.markers || []) {
      if (mk.x < x0 || mk.x > x1) continue;
      el("line", { x1: X(mk.x), x2: X(mk.x), y1: m.t - 6, y2: H - m.b, class: "marker-line" }, svg);
      const c = el("circle", { cx: X(mk.x), cy: m.t - 10, r: 4.5, class: "marker-dot", tabindex: 0 }, svg);
      const hit = el("circle", { cx: X(mk.x), cy: m.t - 10, r: 12, class: "hit" }, svg);
      const show = (e) => showTooltip(e, xFmt(mk.x), [{ value: mk.label }]);
      for (const n of [c, hit]) { n.addEventListener("pointermove", show); n.addEventListener("pointerleave", hideTooltip); }
      c.addEventListener("focus", () => { const r = c.getBoundingClientRect(); show({ clientX: r.right, clientY: r.bottom }); });
      c.addEventListener("blur", hideTooltip);
      markerEls.push(hit);
    }

    // crosshair
    const cross = el("line", { y1: m.t, y2: H - m.b, class: "crosshair", visibility: "hidden" }, svg);
    const dots = (opts.series || []).map((s) => el("circle", { r: 4, style: `fill:${s.color}`, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden", "pointer-events": "none" }, svg));
    const overlay = el("rect", { x: m.l, y: m.t, width: Math.max(0, W - m.l - m.r), height: Math.max(0, H - m.t - m.b), class: "hit", tabindex: 0, "aria-label": "Chart data: use arrow keys" }, svg);
    for (const h of markerEls) svg.appendChild(h);
    const primary = (opts.series || []).find((s) => s.points.length) || { points: (opts.bands?.[0]?.points || []).map((p) => [p[0], p[1]]) };
    let idx = primary.points.length - 1;
    const render = (xv, evt) => {
      const snap = lookup(primary.points, xv, primary.step) || primary.points[0];
      if (!snap) return;
      const sx = X(snap[0]);
      cross.setAttribute("x1", sx); cross.setAttribute("x2", sx); cross.setAttribute("visibility", "visible");
      const rows = [];
      (opts.bands || []).forEach((b) => {
        const p = lookup(b.points, snap[0], false);
        if (p && p[1] !== null) rows.push({ value: `${yFmt(p[1])} – ${yFmt(p[2])}`, label: b.name, color: b.color });
      });
      (opts.series || []).forEach((s, i) => {
        const p = lookup(s.points, snap[0], s.step);
        const ok = p && p[1] !== null && (s.step || Math.abs(p[0] - snap[0]) <= (x1 - x0) * 0.02);
        if (ok) {
          dots[i].setAttribute("cx", X(s.step ? snap[0] : p[0])); dots[i].setAttribute("cy", Y(p[1])); dots[i].setAttribute("visibility", "visible");
          rows.push({ value: (opts.tooltipValue || yFmt)(p[1], s, p), label: s.name, color: s.color });
        } else dots[i].setAttribute("visibility", "hidden");
      });
      showTooltip(evt, (opts.tooltipTitle || xFmt)(snap[0]), rows.reverse());
    };
    overlay.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      render(X.invert((e.clientX - r.left) * (W / r.width)), e);
    });
    const leave = () => { hideTooltip(); cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); };
    overlay.addEventListener("pointerleave", leave);
    overlay.addEventListener("blur", leave);
    overlay.addEventListener("keydown", (e) => {
      if (!primary.points.length) return;
      if (e.key === "ArrowLeft") idx = Math.max(0, idx - Math.ceil(primary.points.length / 60));
      else if (e.key === "ArrowRight") idx = Math.min(primary.points.length - 1, idx + Math.ceil(primary.points.length / 60));
      else return;
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      render(primary.points[idx][0], { clientX: r.left + X(primary.points[idx][0]) * (r.width / W), clientY: r.top + 20 });
    });
  };
  return responsive(holder, draw);
}

/** Column chart. opts: { items:[{label, value, color, tooltip:[rows], valueLabel}], yFormat, height, xTitle, yDomain } */
export function columnChart(container, opts) {
  container.classList.add("chart");
  container.replaceChildren();
  const holder = document.createElement("div");
  container.appendChild(holder);
  const H = opts.height || 240;
  const yFmt = opts.yFormat || ((v) => v.toLocaleString());
  return responsive(holder, (W) => {
    holder.replaceChildren();
    const items = opts.items;
    const vmax = opts.yDomain ? opts.yDomain[1] : Math.max(...items.map((d) => d.hi ?? d.value ?? 0), 0);
    const yt = niceTicks(0, vmax || 1, 4);
    const top = Math.max(vmax, yt[yt.length - 1] || 1);
    const labW = Math.max(...yt.map((v) => yFmt(v).length)) * 6.6 + 10;
    const m = { l: Math.max(36, labW), r: 10, t: 20, b: opts.xTitle ? 44 : 30 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.ariaLabel || "column chart" }, holder);
    const Y = scale(0, top, H - m.b, m.t);
    for (const v of yt) {
      el("line", { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: "grid-line" }, svg);
      text(svg, m.l - 8, Y(v) + 4, yFmt(v), { class: "tick", "text-anchor": "end" });
    }
    const band = (W - m.l - m.r) / items.length;
    const bw = Math.min(24, band * 0.6);
    items.forEach((d, i) => {
      const cx = m.l + band * (i + 0.5);
      const v = d.value ?? 0;
      const y = Y(v), h = H - m.b - y;
      const r = Math.min(4, h, bw / 2);
      const x = cx - bw / 2, base = H - m.b;
      if (h > 0) {
        el("path", { d: `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${base}Z`, style: `fill:${d.color || "var(--s1)"}` }, svg);
      }
      if (d.lo !== undefined && d.hi !== undefined && d.hi > d.lo) {
        el("line", { x1: cx, x2: cx, y1: Y(d.lo), y2: Y(Math.min(d.hi, top)), stroke: "var(--ink-2)", "stroke-width": 1.2, opacity: 0.7 }, svg);
      }
      if (d.valueLabel) text(svg, cx, Math.min(y, d.hi !== undefined ? Y(Math.min(d.hi, top)) : y) - 6, d.valueLabel, { class: "end-label", "text-anchor": "middle" });
      text(svg, cx, H - m.b + 16, d.label, { class: "tick", "text-anchor": "middle" });
      const hit = el("rect", { x: cx - band / 2, y: m.t, width: band, height: H - m.t - m.b, class: "hit", tabindex: 0 }, svg);
      const show = (e) => showTooltip(e, d.label, d.tooltip || [{ value: yFmt(v) }]);
      hit.addEventListener("pointermove", show);
      hit.addEventListener("pointerleave", hideTooltip);
      hit.addEventListener("focus", () => { const b = hit.getBoundingClientRect(); show({ clientX: b.left + b.width / 2, clientY: b.top + 30 }); });
      hit.addEventListener("blur", hideTooltip);
    });
    el("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "axis-line" }, svg);
    if (opts.xTitle) text(svg, (m.l + W - m.r) / 2, H - 8, opts.xTitle, { class: "axis-title", "text-anchor": "middle" });
  });
}

/** Horizontal quantile ranges. opts: { rows:[{label, p10,p25,p50,p75,p90,n}], xFormat, xDomain, color } */
export function rangeChart(container, opts) {
  container.classList.add("chart");
  container.replaceChildren();
  const holder = document.createElement("div");
  container.appendChild(holder);
  const rows = opts.rows;
  const rowH = 38;
  const H = rows.length * rowH + 40;
  const xFmt = opts.xFormat || ((v) => v.toFixed(2));
  return responsive(holder, (W) => {
    holder.replaceChildren();
    const vals = rows.flatMap((r) => [r.p10, r.p90]).filter((v) => v !== null && isFinite(v));
    let [x0, x1] = opts.xDomain || [Math.min(0, ...vals), Math.max(0, ...vals)];
    const xt = niceTicks(x0, x1, Math.max(3, Math.floor(W / 110)));
    x0 = Math.min(x0, xt[0]); x1 = Math.max(x1, xt[xt.length - 1]);
    const m = { l: opts.labelWidth || 70, r: 54, t: 8, b: 30 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.ariaLabel || "range chart" }, holder);
    const X = scale(x0, x1, m.l, W - m.r);
    for (const v of xt) {
      el("line", { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, class: v === 0 ? "axis-line" : "grid-line" }, svg);
      text(svg, X(v), H - m.b + 16, xFmt(v), { class: "tick", "text-anchor": "middle" });
    }
    const color = opts.color || "var(--s1)";
    rows.forEach((r, i) => {
      const cy = m.t + rowH * (i + 0.5);
      text(svg, m.l - 10, cy + 4, r.label, { class: "tick", "text-anchor": "end" });
      if (!r.n) { text(svg, m.l + 4, cy + 4, "no events", { class: "tick" }); return; }
      el("line", { x1: X(r.p10), x2: X(r.p90), y1: cy, y2: cy, stroke: "var(--axis)", "stroke-width": 2, "stroke-linecap": "round" }, svg);
      const bx = X(Math.min(r.p25, r.p75)), bw = Math.max(2, Math.abs(X(r.p75) - X(r.p25)));
      el("rect", { x: bx, y: cy - 7, width: bw, height: 14, rx: 4, style: `fill:${color}`, opacity: 0.35 }, svg);
      el("circle", { cx: X(r.p50), cy, r: 5, style: `fill:${color}`, stroke: "var(--surface)", "stroke-width": 2 }, svg);
      text(svg, W - m.r + 8, cy + 4, `n=${r.n}`, { class: "tick" });
      const hit = el("rect", { x: 0, y: cy - rowH / 2, width: W, height: rowH, class: "hit", tabindex: 0 }, svg);
      const show = (e) => showTooltip(e, `${r.label} after break (n=${r.n})`, [
        { value: xFmt(r.p50), label: "median" }, { value: `${xFmt(r.p25)} to ${xFmt(r.p75)}`, label: "middle half" },
        { value: `${xFmt(r.p10)} to ${xFmt(r.p90)}`, label: "10th–90th pct" },
      ]);
      hit.addEventListener("pointermove", show);
      hit.addEventListener("pointerleave", hideTooltip);
      hit.addEventListener("focus", () => { const b = hit.getBoundingClientRect(); show({ clientX: b.left + 80, clientY: b.bottom }); });
      hit.addEventListener("blur", hideTooltip);
    });
  });
}
