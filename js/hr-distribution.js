// js/hr-distribution.js
//
// Carte « Distribution FC hebdo » (Horizon 1 — Consolider le suivi) : le temps
// passé en Z1→Z5 agrégé semaine par semaine, en barres empilées. Elle répond au
// « comment est répartie mon intensité » et révèle une dérive vers trop de
// haute intensité (Z4–Z5) au fil des semaines.
//
// Comme la carte ACWR, elle fait son PROPRE chargement d'historique (assez
// profond pour une dizaine de semaines), puis dérive le temps par zone de
// chaque séance via le socle training-load — même cascade que le détail de
// séance : échantillons FC → timeInZone de la montre → estimation gaussienne.
import { api } from "./api.js";
import { icon } from "./icons.js";
import { formatDuration } from "./format.js";
import { zoneTimesFor, resolveMaxHr } from "./training-load.js";

const HISTORY_PAGE = 40;   // taille de page du fetch dédié
const MAX_PAGES = 6;       // garde-fou : ≤ 240 séances
const TARGET_DAYS = 90;    // profondeur visée (~13 semaines)
const MAX_WEEKS = 12;      // nombre de semaines affichées

// Couleurs et libellés des 5 zones FC (affichage) — mêmes teintes que le détail
// de séance pour une lecture cohérente d'un écran à l'autre. La logique de
// calcul vit dans training-load.js ; ici on ne garde que l'UI.
const HR_ZONE_COLORS = ["#4fa3c9", "#49c6b5", "#e8c547", "#ff9c4a", "#e5484d"];
const HR_ZONE_NAMES = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"];

// Charge suffisamment de pages pour couvrir TARGET_DAYS, sans dépasser le
// garde-fou. S'arrête tôt dès que l'historique est assez profond ou épuisé.
async function fetchHistory() {
  let all = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await api(`/api/workouts?limit=${HISTORY_PAGE}&offset=${p * HISTORY_PAGE}`);
    if (!Array.isArray(page) || !page.length) break;
    all = all.concat(page);
    if (page.length < HISTORY_PAGE) break; // dernière page
    const oldest = Math.min(...all.map((w) => new Date(w.startTime).getTime()));
    if (Number.isFinite(oldest) && (Date.now() - oldest) / 86400000 >= TARGET_DAYS) break;
  }
  return all;
}

// Lundi 00:00 (heure locale) de la semaine contenant `d` — les semaines
// d'entraînement se comptent classiquement du lundi au dimanche.
function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // 0 = lundi … 6 = dimanche
  x.setDate(x.getDate() - dow);
  return x;
}

// Agrège le temps par zone (secondes) semaine par semaine, en remplissant les
// semaines SANS séance avec des zéros (pas de trou dans l'axe temporel) — comme
// buildDailyLoad le fait au jour le jour. Renvoie une liste chronologique
// { start, label, times:[5], total }.
export function buildWeeklyZones(workouts) {
  const dated = (Array.isArray(workouts) ? workouts : [])
    .map((w) => ({ t: new Date(w?.startTime).getTime(), w }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  if (!dated.length) return [];

  // FCmax fiabilisée du corpus : mêmes bornes de zones pour toutes les séances.
  const maxHr = resolveMaxHr(workouts).maxHr;

  // Somme du temps par zone, indexée par lundi de la semaine (timestamp).
  const byWeek = new Map();
  for (const { t, w } of dated) {
    const zt = zoneTimesFor(w, maxHr); // temps par zone déjà recalés sur la durée
    if (!zt) continue;
    const key = weekStart(t).getTime();
    const acc = byWeek.get(key) || [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) acc[i] += zt.times[i];
    byWeek.set(key, acc);
  }
  if (!byWeek.size) return [];

  // Remplissage continu du premier au dernier lundi.
  const first = weekStart(dated[0].t);
  const last = weekStart(dated[dated.length - 1].t);
  const out = [];
  for (const cur = new Date(first); cur <= last; cur.setDate(cur.getDate() + 7)) {
    const times = byWeek.get(cur.getTime()) || [0, 0, 0, 0, 0];
    out.push({
      start: new Date(cur),
      label: cur.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
      times,
      total: times.reduce((a, b) => a + b, 0),
    });
  }
  return out;
}

// Plafond « propre » (en secondes) pour l'axe Y : on arrondit le max au pas
// d'heure lisible juste au-dessus, pour des graduations rondes (3 h, 6 h…)
// plutôt que 5,7 h — et pour que la plus haute barre ne colle pas au bord.
function niceCeilSec(sec) {
  const h = sec / 3600;
  const step = h > 8 ? 2 : h > 2 ? 1 : h > 1 ? 0.5 : 0.25; // pas, en heures
  return Math.max(step, Math.ceil(h / step) * step) * 3600;
}

// Étiquette d'axe Y — unité COHÉRENTE sur tout l'axe (heures ou minutes selon
// le plafond), et "0" laissé nu : sans ça le bas affichait "0 min" à côté d'un
// haut en "h", ce qui donnait un axe aux unités mélangées.
function axisTime(sec, useHours) {
  if (sec <= 0) return "0";
  if (useHours) return `${(Math.round((sec / 3600) * 10) / 10).toString().replace(".", ",")} h`;
  return `${Math.round(sec / 60)} min`;
}

// Graphe en barres empilées : une colonne par semaine, segments Z1 (bas) → Z5
// (haut), hauteur proportionnelle au temps total de la semaine.
function renderStackedBars(container, weeks) {
  const width = Math.max(container.clientWidth || 320, 240);
  const height = 190;
  const padTop = 14, padBottom = 26, padRight = 8;

  const maxTotal = Math.max(...weeks.map((w) => w.total), 1);
  const axisMax = niceCeilSec(maxTotal);   // plafond arrondi → graduations rondes
  const useHours = axisMax >= 3600;         // unité fixée pour tout l'axe
  const yTicks = [axisMax, axisMax / 2, 0];
  const yLabels = yTicks.map((v) => axisTime(v, useHours));
  const padLeft = Math.min(60, Math.max(...yLabels.map((s) => s.length)) * 6.5 + 12);

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const baseY = padTop + plotH;
  const step = plotW / weeks.length;
  const barW = Math.min(40, step * 0.62);

  const grid = yTicks
    .map((v, i) => {
      const y = baseY - (v / axisMax) * plotH;
      return `
      <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="var(--panel-line)" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${(padLeft - 8).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" style="font-size:9.5px; font-family:var(--mono); fill:var(--muted);">${yLabels[i]}</text>`;
    })
    .join("");

  const bars = weeks
    .map((w, i) => {
      const cx = padLeft + step * (i + 0.5);
      const x = cx - barW / 2;
      if (w.total <= 0) return "";
      let yTop = baseY;
      const segs = w.times
        .map((sec, z) => {
          if (sec <= 0) return "";
          const h = (sec / axisMax) * plotH;
          yTop -= h;
          const pct = Math.round((sec / w.total) * 100);
          const tip = `Sem. ${w.label} · ${HR_ZONE_NAMES[z]} · ${formatDuration(Math.round(sec))} · ${pct}%`;
          return `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${HR_ZONE_COLORS[z]}" data-tip="${tip}"><title>${tip}</title></rect>`;
        })
        .join("");
      return segs;
    })
    .join("");

  // Au-delà d'une poignée de colonnes, on n'affiche qu'une étiquette sur N.
  const maxXLabels = 8;
  const labelEvery = Math.max(1, Math.ceil(weeks.length / maxXLabels));
  const xLabels = weeks
    .map((w, i) => {
      if (i % labelEvery !== 0 && i !== weeks.length - 1) return "";
      const cx = padLeft + step * (i + 0.5);
      return `<text x="${cx.toFixed(1)}" y="${(height - 8).toFixed(1)}" text-anchor="middle" style="font-size:9.5px; font-family:var(--mono); fill:var(--muted);">${w.label}</text>`;
    })
    .join("");

  return `<svg class="hr-week-svg" viewBox="0 0 ${width} ${height}">${grid}${bars}${xLabels}</svg>`;
}

export function renderHrWeekCard(card, workouts) {
  const all = buildWeeklyZones(workouts);
  const weeks = all.slice(-MAX_WEEKS);

  if (!weeks.some((w) => w.total > 0)) {
    card.innerHTML = `<div class="empty" style="padding:8px 0 2px;"><span class="empty-icon">${icon("activity", 26)}</span>Pas encore assez de données de fréquence cardiaque pour une distribution hebdo.</div>`;
    return;
  }

  // Part de haute intensité (Z4–Z5) : le signal de dérive. On compare les 4
  // dernières semaines actives aux 4 précédentes pour donner une tendance.
  const active = weeks.filter((w) => w.total > 0);
  const share = (list) => {
    const tot = list.reduce((a, w) => a + w.total, 0);
    const high = list.reduce((a, w) => a + w.times[3] + w.times[4], 0);
    return tot > 0 ? high / tot : null;
  };
  const recent = share(active.slice(-4));
  const prior = active.length > 4 ? share(active.slice(-8, -4)) : null;

  let trendNote = "";
  if (recent != null) {
    const pct = Math.round(recent * 100);
    let arrow = "", cls = "";
    if (prior != null) {
      const delta = recent - prior;
      if (delta > 0.03) { arrow = " ↗"; cls = "hr-week-up"; }
      else if (delta < -0.03) { arrow = " ↘"; cls = "hr-week-down"; }
    }
    trendNote = `<span class="hr-week-high ${cls}">Haute intensité (Z4–Z5) : <b>${pct}&nbsp;%</b>${arrow}</span>`;
  }

  const legend = HR_ZONE_NAMES
    .map((name, i) => `<span><span class="hr-zone-dot" style="background:${HR_ZONE_COLORS[i]};"></span>${name}</span>`)
    .join("");

  card.innerHTML = `
    <div class="hr-week-head">
      <span class="hr-week-sub">${active.length} semaine${active.length > 1 ? "s" : ""} actives · temps par zone</span>
      ${trendNote}
    </div>
    <div id="hr-week-chart"></div>
    <div class="hr-zone-legend hr-week-legend">${legend}</div>
  `;

  const chartEl = card.querySelector("#hr-week-chart");
  chartEl.innerHTML = renderStackedBars(chartEl, weeks);
  attachTooltip(card, chartEl);
}

// Infobulle au survol d'un segment : temps de la zone pour la semaine visée.
// Le <title> SVG reste comme repli natif ; ceci offre un rendu cohérent avec
// l'app et suit le curseur.
function attachTooltip(card, chartEl) {
  const svg = chartEl.querySelector("svg");
  if (!svg) return;
  const tip = document.createElement("div");
  tip.className = "hr-week-tip";
  tip.hidden = true;
  chartEl.style.position = "relative";
  chartEl.appendChild(tip);

  const show = (rect) => { tip.textContent = rect.getAttribute("data-tip"); tip.hidden = false; };
  svg.addEventListener("mouseover", (e) => {
    const r = e.target.closest?.("rect[data-tip]");
    if (r) show(r);
  });
  svg.addEventListener("mousemove", (e) => {
    if (tip.hidden) return;
    const box = chartEl.getBoundingClientRect();
    tip.style.left = `${e.clientX - box.left}px`;
    tip.style.top = `${e.clientY - box.top}px`;
  });
  svg.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget?.closest?.("rect[data-tip]")) tip.hidden = true;
  });
}

export async function loadHrDistribution() {
  const card = document.getElementById("hr-week-card");
  if (!card) return;
  try {
    const workouts = await fetchHistory();
    renderHrWeekCard(card, workouts);
  } catch (err) {
    card.innerHTML = `<div class="empty" style="padding:8px 0 2px;"><span class="empty-icon">${icon("alertTriangle", 26)}</span>${err.message}</div>`;
  }
}
