// Survival / hazard statistics over IRR peg spells, computed in the browser so filters are live.

export const monthIndex = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + (m - 1); };
export const ymFromIndex = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;

export const DEFAULT_STATE = {
  def: "narrow",          // narrow = pegs/currency boards/<=2% bands; broad adds crawling pegs/bands
  era: 1946,              // exposure counted from this year (delayed entry for older spells)
  realign: 10,            // count in-peg step realignments >= this % as breaks (0 = don't count)
  direction: "down",      // "down" excludes appreciations; "both" counts any break
  excludeBW: true,        // ignore the 1971-73 Bretton Woods collapse (anchor itself broke)
  excludeLeftCensored: true,
  cohort: "all",          // all | usd | hydro | hydro_usd | gcc
};

/**
 * Merge raw spells into "peg lives" according to what counts as a break.
 * Returns [{iso3, name, start, end, months, entry, exit, event, reason, eventSpell, anchor, hydro, gcc}]
 */
export function buildLives(data, state) {
  const byC = new Map();
  for (const s of data.spells) {
    if (s.def !== state.def) continue;
    if (!byC.has(s.iso3)) byC.set(s.iso3, []);
    byC.get(s.iso3).push(s);
  }
  const lives = [];
  const eraStart = state.era * 12;
  for (const [iso3, arr] of byC) {
    arr.sort((a, b) => monthIndex(a.start) - monthIndex(b.start));
    const c = data.countries[iso3] || {};
    let cur = null;
    arr.forEach((s, i) => {
      if (!cur) cur = { iso3, start: s.start, leftCensored: s.left_censored };
      let close = true, event = false;
      if (s.reason === "realign") {
        const size = s.realign_pct;
        const counts = state.realign > 0 && size !== null && Math.abs(size) * 100 >= state.realign &&
          (state.direction === "both" || size < 0) && !(state.excludeBW && s.bretton_woods);
        const next = arr[i + 1];
        const contiguous = next && monthIndex(next.start) === monthIndex(s.end) + 1;
        if (counts) event = true;
        else if (contiguous) close = false;
      } else if (s.reason === "exit") {
        event = !(state.excludeBW && s.bretton_woods) && !(state.direction === "down" && s.direction === "up");
      }
      if (!close) return;
      const start = monthIndex(cur.start), end = monthIndex(s.end);
      const life = {
        iso3, name: c.name || iso3, start: cur.start, end: s.end, months: end - start + 1,
        event, reason: s.reason, eventSpell: event ? s : null, anchor: s.anchor, basis: s.basis,
        hydro: !!c.hydrocarbon, gcc: !!c.gcc, leftCensored: cur.leftCensored, endSource: s.end_source,
      };
      cur = null;
      if (end < eraStart) return;
      life.entry = Math.max(0, eraStart - start);
      life.exit = life.months;
      lives.push(life);
    });
  }
  return lives.filter((l) => {
    if (state.excludeLeftCensored && l.leftCensored) return false;
    switch (state.cohort) {
      case "usd": return l.anchor === "USD";
      case "hydro": return l.hydro;
      case "hydro_usd": return l.hydro && l.anchor === "USD";
      case "gcc": return l.gcc;
      default: return true;
    }
  });
}

/** Kaplan–Meier with delayed entry; ages in months. */
export function kaplanMeier(lives) {
  const times = [...new Set(lives.filter((l) => l.event).map((l) => l.exit))].sort((a, b) => a - b);
  const out = { t: [0], S: [1], n: [lives.length], d: [0], green: [0] };
  let S = 1, g = 0;
  for (const t of times) {
    let n = 0, d = 0;
    for (const l of lives) {
      if (l.entry < t && t <= l.exit) n++;
      if (l.event && l.exit === t) d++;
    }
    if (!n) continue;
    S *= 1 - d / n;
    g += n > d ? d / (n * (n - d)) : 0;
    out.t.push(t); out.S.push(S); out.n.push(n); out.d.push(d); out.green.push(g);
  }
  return out;
}

const idxAt = (km, age) => { let i = 0; while (i + 1 < km.t.length && km.t[i + 1] <= age) i++; return i; };

/** P(break within H months | survived to age A months), with a 95% Greenwood CI. */
export function conditionalBreak(km, lives, A, H) {
  const i0 = idxAt(km, A), i1 = idxAt(km, A + H);
  const ratio = km.S[i0] > 0 ? km.S[i1] / km.S[i0] : NaN;
  const v = km.green[i1] - km.green[i0];
  const se = Math.sqrt(v);
  const logR = Math.log(ratio);
  const lo = ratio > 0 ? 1 - Math.min(1, Math.exp(logR + 1.96 * se)) : NaN;
  const hi = ratio > 0 ? 1 - Math.exp(logR - 1.96 * se) : NaN;
  let atRisk = 0, events = 0;
  for (const l of lives) {
    if (l.entry <= A && l.exit > A) atRisk++;
    if (l.event && l.exit > A && l.exit <= A + H) events++;
  }
  return { p: 1 - ratio, lo, hi, atRisk, events };
}

export const AGE_BUCKETS = [[0, 1], [1, 2], [2, 5], [5, 10], [10, 20], [20, 30], [30, 40], [40, Infinity]];

/** Annual hazard by peg age bucket: events / peg-years at risk, with Byar 95% CI. */
export function hazardByAge(lives, buckets = AGE_BUCKETS) {
  return buckets.map(([a, b]) => {
    const lo = a * 12, hi = b * 12;
    let exposure = 0, events = 0;
    for (const l of lives) {
      const s = Math.max(l.entry, lo), e = Math.min(l.exit, hi);
      if (e > s) exposure += e - s;
      if (l.event && l.exit > lo && l.exit <= hi) events++;
    }
    const py = exposure / 12;
    return { a, b, events, py, rate: py ? events / py : NaN, ...byar(events, py) };
  });
}

export function byar(d, py) {
  if (!py) return { ciLo: NaN, ciHi: NaN };
  const lo = d === 0 ? 0 : d * Math.pow(1 - 1 / (9 * d) - 1.96 / (3 * Math.sqrt(d)), 3) / py;
  const d1 = d + 1;
  const hi = d1 * Math.pow(1 - 1 / (9 * d1) + 1.96 / (3 * Math.sqrt(d1)), 3) / py;
  return { ciLo: lo, ciHi: hi };
}

/** Pooled annual hazard for pegs older than A years. */
export function hazardOlderThan(lives, Ayears) {
  const [r] = hazardByAge(lives, [[Ayears, Infinity]]);
  return r;
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export function summarize(values) {
  const v = values.filter((x) => x !== null && x !== undefined && isFinite(x)).sort((a, b) => a - b);
  return { n: v.length, p10: quantile(v, 0.1), p25: quantile(v, 0.25), p50: quantile(v, 0.5), p75: quantile(v, 0.75), p90: quantile(v, 0.9), min: v[0], max: v[v.length - 1] };
}

/** Event-study fan: path arrays are index=100 at the last pegged month, offsets -24..+36. */
export function fan(events, basis = "anchor", minN = 5) {
  const key = basis === "usd" ? "path_usd" : "path_anchor";
  const rows = [];
  for (let k = 0; k <= 60; k++) {
    const vals = events.map((e) => e[key] ? e[key][k] : null).filter((x) => x !== null && x !== undefined);
    const s = summarize(vals);
    rows.push({ k: k - 24, ...s, ok: s.n >= minN });
  }
  return rows;
}

// Implied devaluation probability from forward points (drift-adjustment logic, Svensson 1993).
// Risk-neutral: F = (1-p)*F_carry + p*F_carry/(1-D) => p = (F/F_carry - 1)*(1-D)/D
export function impliedProbability({ spot, forward, tenorYears, rLocal, rUsd, devaluation }) {
  const carry = spot * (1 + rLocal * tenorYears) / (1 + rUsd * tenorYears);
  const excess = forward / carry - 1;
  const D = devaluation;
  const p = excess * (1 - D) / D;
  return { carry, excess, p };
}
