import { h, loadJSON } from "./ui.js";
import { hideTooltip } from "./charts.js";
import home from "./pages/home.js";
import gulf from "./pages/gulf.js";
import likelihood from "./pages/likelihood.js";
import impact from "./pages/impact.js";
import signals from "./pages/signals.js";
import episodes from "./pages/episodes.js";
import mitigation from "./pages/mitigation.js";
import method from "./pages/method.js";
import data from "./pages/data.js";
import portfolio from "./pages/portfolio.js";
import screen from "./pages/screen.js";

const routes = { "": home, gulf, likelihood, impact, signals, episodes, episode: episodes, portfolio, screen, mitigation, method, data };
const TITLES = { "": "Peg Break Explorer", gulf: "Gulf 2026", likelihood: "How likely?", impact: "How bad?", signals: "Early signals", episodes: "Episodes", episode: "Episode", portfolio: "Portfolio", screen: "Screen", mitigation: "Mitigation", method: "Method", data: "Download data" };

async function render() {
  const [, name = "", ...rest] = (location.hash || "#/").slice(1).split("/");
  const page = routes[name] || home;
  const main = document.getElementById("main");
  hideTooltip();
  document.querySelectorAll(".nav a").forEach((a) => {
    const target = a.getAttribute("href").slice(2);
    if (target === name || (name === "episode" && target === "episodes")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.getElementById("nav").classList.remove("open");
  document.title = name ? `${TITLES[name] || "Peg Break Explorer"} · Peg Break Explorer` : "Peg Break Explorer";
  main.style.opacity = "0.55";
  try {
    const node = await page({ name, params: rest });
    main.replaceChildren(node);
  } catch (err) {
    console.error(err);
    main.replaceChildren(h("div", { class: "callout warn" }, h("strong", { text: "Couldn't load this view. " }), h("span", { text: String(err.message || err) })));
  }
  main.style.opacity = "";
  if (!rest.length || name === "episode") window.scrollTo({ top: 0 });
}

// theme toggle (explicit choice overrides the OS setting)
const root = document.documentElement;
try { const t = localStorage.getItem("pbx.theme"); if (t) root.dataset.theme = t; } catch { /* ignore */ }
document.querySelector(".theme-toggle").addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("pbx.theme", root.dataset.theme); } catch { /* ignore */ }
});
const navToggle = document.querySelector(".nav-toggle");
navToggle.addEventListener("click", () => {
  const nav = document.getElementById("nav");
  nav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(nav.classList.contains("open")));
});

// Monitoring banner: refresh checks and data staleness
Promise.all([loadJSON("data/processed/alerts.json").catch(() => null), loadJSON("data/processed/regimes.json")]).then(([al, reg]) => {
  const msgs = (al?.alerts || []).filter((a) => a.level !== "low").map((a) => a.message);
  const days = Math.round((Date.now() - Date.parse(reg.meta.generated)) / 864e5);
  if (days > 45) msgs.push(`Data last rebuilt ${days} days ago (${reg.meta.generated}); the monthly refresh may not have run.`);
  if (!msgs.length) return;
  const bar = h("div", { class: "banner" }, h("strong", { text: "Monitor: " }), h("span", { text: msgs.join(" · ") }));
  document.querySelector(".site-header").after(bar);
});

// FRED API terms require this notice whenever FRED-sourced data is displayed
loadJSON("data/processed/gcc.json").then((g) => {
  if (!g.fred_api) return;
  document.querySelector(".site-footer").appendChild(h("p", {},
    "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis. ",
    h("a", { href: "https://fred.stlouisfed.org/docs/api/terms_of_use.html", target: "_blank", rel: "noopener", text: "FRED® API Terms of Use" })));
}).catch(() => {});

window.addEventListener("hashchange", render);
render();
