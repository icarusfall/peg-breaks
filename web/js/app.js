import { h } from "./ui.js";
import { hideTooltip } from "./charts.js";
import home from "./pages/home.js";
import gulf from "./pages/gulf.js";
import likelihood from "./pages/likelihood.js";
import impact from "./pages/impact.js";
import signals from "./pages/signals.js";
import episodes from "./pages/episodes.js";
import mitigation from "./pages/mitigation.js";
import method from "./pages/method.js";

const routes = { "": home, gulf, likelihood, impact, signals, episodes, episode: episodes, mitigation, method };
const TITLES = { "": "Peg Break Explorer", gulf: "Gulf 2026", likelihood: "How likely?", impact: "How bad?", signals: "Early signals", episodes: "Episodes", episode: "Episode", mitigation: "Mitigation", method: "Method" };

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

window.addEventListener("hashchange", render);
render();
