// js/acwr.js
//
// Carte « Charge & risque » (Horizon 2, première brique) : affiche l'ACWR
// courant — rapport charge aiguë (7 j) / chronique (28 j) — assorti de sa zone
// de risque et d'une courbe de tendance.
//
// Contrairement à la liste de séances (paginée à 20), cette carte fait son
// PROPRE chargement d'historique, assez profond pour une charge chronique
// fiable (28 j + marge), puis dérive la série quotidienne continue via le socle
// training-load.
import { api } from "./api.js";
import { icon } from "./icons.js";
import { renderLineChart } from "./charts.js";
import { buildDailyLoad, computeAcwr, acwrTrend, ACWR_CHRONIC_DAYS } from "./training-load.js";

const HISTORY_PAGE = 40;   // taille de page du fetch dédié
const MAX_PAGES = 6;       // garde-fou : ≤ 240 séances
const TARGET_DAYS = 42;    // profondeur visée (28 j chronique + marge)
const TREND_DAYS = 30;     // fenêtre de la courbe de tendance

// Couleur associée à chaque zone de risque ACWR.
const STATUS_COLOR = {
  low: "var(--muted)",
  optimal: "var(--route)",
  watch: "var(--accent-gold)",
  high: "var(--signal)",
  none: "var(--muted)",
};

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

// Bande horizontale des zones (ratio 0,5 → 2,0) avec un curseur sur la valeur.
const BAND_MIN = 0.5;
const BAND_MAX = 2.0;
function bandHtml(ratio) {
  const span = BAND_MAX - BAND_MIN;
  const seg = (a, b, color) => `<div style="width:${((b - a) / span) * 100}%;background:${color}"></div>`;
  const segments =
    seg(0.5, 0.8, "var(--muted)") +
    seg(0.8, 1.3, "var(--route)") +
    seg(1.3, 1.5, "var(--accent-gold)") +
    seg(1.5, 2.0, "var(--signal)");
  const clamped = Math.min(BAND_MAX, Math.max(BAND_MIN, ratio ?? BAND_MIN));
  const left = ((clamped - BAND_MIN) / span) * 100;
  const marker = ratio == null ? "" : `<div class="acwr-band-marker" style="left:${left}%"></div>`;
  const ticks = [0.8, 1.3, 1.5]
    .map((t) => `<span style="left:${((t - BAND_MIN) / span) * 100}%">${t.toString().replace(".", ",")}</span>`)
    .join("");
  return `<div class="acwr-band">${segments}${marker}</div><div class="acwr-band-ticks">${ticks}</div>`;
}

export function renderAcwrCard(card, workouts) {
  const { series, totalDays } = buildDailyLoad(workouts);
  const acwr = computeAcwr(series);
  const color = STATUS_COLOR[acwr.status.key] || "var(--muted)";

  if (acwr.ratio == null) {
    card.innerHTML = `
      <div class="acwr-head"><span class="tile-icon">${icon("activity", 18)}</span><span class="acwr-title">Charge &amp; risque</span></div>
      <div class="empty" style="padding:8px 0 2px;"><span class="empty-icon">${icon("activity", 26)}</span>Pas encore assez d'historique pour évaluer la charge.</div>`;
    return;
  }

  const ratioTxt = acwr.ratio.toFixed(2).replace(".", ",");

  // Courbe de tendance : ACWR jour par jour sur la fenêtre récente.
  const trend = acwrTrend(series).slice(-TREND_DAYS);

  card.style.setProperty("--acwr-accent", color);
  card.innerHTML = `
    <div class="acwr-head">
      <span class="tile-icon">${icon("activity", 18)}</span>
      <span class="acwr-title">Charge &amp; risque</span>
      <span class="acwr-sub-range">${totalDays} j d'historique</span>
    </div>
    <div class="acwr-main">
      <div class="acwr-figure">
        <div class="acwr-ratio">${ratioTxt}</div>
        <div class="acwr-status" style="color:${color}">${acwr.status.label}</div>
      </div>
      <div class="acwr-detail">
        ${bandHtml(acwr.ratio)}
        <div class="acwr-values">
          <span><b>${Math.round(acwr.acute)}</b> aiguë · 7 j</span>
          <span><b>${Math.round(acwr.chronic)}</b> chronique · hebdo</span>
        </div>
      </div>
    </div>
    ${acwr.reliable ? "" : `<div class="acwr-note">${icon("alertTriangle", 13)} Base chronique incomplète (&lt; ${ACWR_CHRONIC_DAYS} j) — indicatif.</div>`}
    <div class="acwr-trend-label">Tendance ACWR</div>
    <div id="acwr-trend"></div>
  `;

  const trendEl = card.querySelector("#acwr-trend");
  // `date` est une chaîne ISO "AAAA-MM-JJ" : on ajoute une heure locale pour
  // éviter le décalage d'un jour dû à l'interprétation UTC de la date seule.
  const fmtDate = (iso) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  renderLineChart(
    trendEl,
    trend.map((p) => ({ label: fmtDate(p.date), value: p.ratio })),
    { color, formatValue: (v) => v.toFixed(2).replace(".", ",") }
  );
}

export async function loadAcwr() {
  const card = document.getElementById("acwr-card");
  if (!card) return;
  try {
    const workouts = await fetchHistory();
    renderAcwrCard(card, workouts);
  } catch (err) {
    card.innerHTML = `
      <div class="acwr-head"><span class="tile-icon">${icon("activity", 18)}</span><span class="acwr-title">Charge &amp; risque</span></div>
      <div class="empty" style="padding:8px 0 2px;"><span class="empty-icon">${icon("alertTriangle", 26)}</span>${err.message}</div>`;
  }
}
