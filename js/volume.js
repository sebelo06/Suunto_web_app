// js/volume.js
//
// Carte « Volume glissant » (Horizon 1 — Consolider le suivi) : durée,
// distance et dénivelé cumulés sur 7 / 28 / 365 jours, chacun comparé à la
// période immédiatement précédente (delta %). C'est le reporting descriptif de
// base — le « qu'est-ce que j'ai fait » — avant tout indicateur de charge.
//
// Comme les cartes ACWR et Distribution FC, elle fait son PROPRE chargement
// d'historique : la fenêtre 365 j demande bien plus de profondeur que les 20
// séances de la liste. Le fetch s'arrête dès que l'historique est assez
// profond, assez ancien ou épuisé.
import { loadHistory } from "./history.js";
import { icon } from "./icons.js";
import { formatDuration } from "./format.js";

const HISTORY_PAGE = 40;   // taille de page du fetch dédié
const MAX_PAGES = 20;      // garde-fou : ≤ 800 séances
const TARGET_DAYS = 730;   // 365 j affichés + 365 j de période précédente

// Fenêtres affichées. `compare` : on ne compare à la période précédente que si
// l'historique la couvre réellement, sinon le delta serait faussement positif.
const WINDOWS = [
  { days: 7, label: "7 jours" },
  { days: 28, label: "28 jours" },
  { days: 365, label: "365 jours" },
];

function fetchHistory() {
  return loadHistory({ minDays: TARGET_DAYS, maxPages: MAX_PAGES });
}

// Somme durée / distance / dénivelé des séances dont l'horodatage tombe dans
// [from, to[. Les champs manquants comptent pour 0 (une séance sans GPS a bien
// une durée, elle ne doit pas disparaître du cumul de temps).
function sumRange(dated, from, to) {
  const acc = { time: 0, distance: 0, ascent: 0, count: 0 };
  for (const { t, w } of dated) {
    if (t < from || t >= to) continue;
    acc.time += Number(w.totalTime) || 0;
    acc.distance += Number(w.totalDistance) || 0;
    acc.ascent += Number(w.totalAscent) || 0;
    acc.count += 1;
  }
  return acc;
}

// Cumuls par fenêtre + delta vs période précédente de même longueur.
// `comparable` dit si l'historique remonte assez loin pour que la comparaison
// ait un sens ; sinon on masque le delta plutôt que d'afficher un « +100 % »
// qui ne reflète que la profondeur du fetch.
export function buildVolume(workouts, now = Date.now()) {
  const dated = (Array.isArray(workouts) ? workouts : [])
    .map((w) => ({ t: new Date(w?.startTime).getTime(), w }))
    .filter((x) => Number.isFinite(x.t) && x.t <= now);
  const oldest = dated.length ? Math.min(...dated.map((x) => x.t)) : null;

  return WINDOWS.map(({ days, label }) => {
    const span = days * 86400000;
    const current = sumRange(dated, now - span, now + 1);
    const previous = sumRange(dated, now - 2 * span, now - span);
    const comparable = oldest != null && oldest <= now - 2 * span;
    return { days, label, current, previous, comparable };
  });
}

// Delta relatif, en %. Null quand la période précédente est vide : « +∞ % »
// n'apprend rien, on préfère ne rien afficher.
function delta(cur, prev) {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

function deltaHtml(cur, prev, comparable) {
  if (!comparable) return `<span class="vol-delta vol-delta-none">—</span>`;
  const d = delta(cur, prev);
  if (d == null) return `<span class="vol-delta vol-delta-none">nouveau</span>`;
  const rounded = Math.round(d);
  // Sous 1 %, on parle de stabilité plutôt que d'un « +0 % » trompeur.
  if (rounded === 0) return `<span class="vol-delta vol-delta-flat">stable</span>`;
  const cls = rounded > 0 ? "vol-delta-up" : "vol-delta-down";
  return `<span class="vol-delta ${cls}">${rounded > 0 ? "▲ +" : "▼ −"}${Math.abs(rounded)} %</span>`;
}

function formatAscent(meters) {
  if (!meters) return "—";
  return `${Math.round(meters).toLocaleString("fr-FR")} m`;
}

function formatKm(meters) {
  if (!meters) return "—";
  const km = meters / 1000;
  return `${(km >= 100 ? Math.round(km) : Math.round(km * 10) / 10).toLocaleString("fr-FR")} km`;
}

const METRICS = [
  { key: "time", label: "Durée", format: (v) => (v ? formatDuration(v) : "—") },
  { key: "distance", label: "Distance", format: formatKm },
  { key: "ascent", label: "Dénivelé +", format: formatAscent },
];

export function renderVolumeCard(card, workouts) {
  const windows = buildVolume(workouts);

  if (!windows.some((w) => w.current.count > 0)) {
    card.innerHTML = `<div class="empty" style="padding:8px 0 2px;"><span class="empty-icon">${icon("activity", 26)}</span>Aucune séance sur les 12 derniers mois.</div>`;
    return;
  }

  const columns = windows
    .map((win) => {
      const rows = METRICS.map(
        (m) => `
        <div class="vol-row">
          <span class="vol-metric">${m.label}</span>
          <span class="vol-value">${m.format(win.current[m.key])}</span>
          ${deltaHtml(win.current[m.key], win.previous[m.key], win.comparable)}
        </div>`
      ).join("");
      return `
      <div class="vol-col">
        <div class="vol-col-head">
          <span class="vol-window">${win.label}</span>
          <span class="vol-count">${win.current.count} séance${win.current.count > 1 ? "s" : ""}</span>
        </div>
        ${rows}
      </div>`;
    })
    .join("");

  card.innerHTML = `<div class="vol-grid">${columns}</div>
    <div class="vol-note">Delta comparé à la période précédente de même durée.</div>`;
}

export async function loadVolume() {
  const card = document.getElementById("volume-card");
  if (!card) return;
  try {
    const workouts = await fetchHistory();
    renderVolumeCard(card, workouts);
  } catch (err) {
    card.innerHTML = `<div class="empty" style="padding:8px 0 2px;"><span class="empty-icon">${icon("alertTriangle", 26)}</span>${err.message}</div>`;
  }
}
