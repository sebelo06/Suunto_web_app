// js/workout-detail.js
import { state } from "./state.js";
import { api } from "./api.js";
import { icon, ACTIVITY_ICONS, ACTIVITY_NAMES } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { formatDuration, formatDistance, formatPace } from "./format.js";
import { decodePolyline, buildRouteMap } from "./map.js";
import { renderHrChart } from "./charts.js";
import { buildSpeedSamples, computeDecoupling, renderDecouplingCard } from "./decoupling.js";
import { setDashGreeting, resetDashGreeting } from "./dash-greeting.js";
import {
  DEFAULT_HR_ZONE_THRESHOLDS,
  readHrZoneThresholds,
  writeHrZoneThresholds,
  zoneBoundsPct,
  zoneTimesFor,
  computeTrimp,
} from "./training-load.js";

const trackingListView = document.getElementById("tracking-list-view");
const trackingDetailView = document.getElementById("tracking-detail-view");
const workoutDetailPage = document.getElementById("workout-detail-page");

export function closeWorkoutDetail() {
  trackingDetailView.style.display = "none";
  trackingListView.style.display = "";
  workoutDetailPage.innerHTML = "";
  resetDashGreeting();
  if (state.currentMap) { state.currentMap.remove(); state.currentMap = null; state.currentTileLayer = null; }
}

// Couleurs et libellés des 5 zones FC "classiques" (affichage). La logique de
// calcul (seuils, estimation, temps par zone, TRIMP) vit dans training-load.js
// et est partagée avec le socle de charge — ici on ne garde que l'UI.
const HR_ZONE_COLORS = ["#4fa3c9", "#49c6b5", "#e8c547", "#ff9c4a", "#e5484d"];
const HR_ZONE_NAMES = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"];

// Seuils configurables par l'usager (état mutable de l'UI), initialisés depuis
// le stockage partagé pour rester synchrones avec le reste de l'app.
let hrZoneThresholds = readHrZoneThresholds();

function buildHrZonesHtml(w) {
  const maxHr = w.hrdata?.userMaxHR || w.hrdata?.hrmax || w.hrdata?.workoutMaxHR || null;
  const bounds = zoneBoundsPct(hrZoneThresholds);

  // Répartition unifiée via le socle (échantillons FC → timeInZone → estimation),
  // avec le même garde-fou d'unité que la charge et la distribution hebdo.
  const zt = zoneTimesFor(w, maxHr, hrZoneThresholds);
  if (!zt) {
    return `
      <div class="hr-zones">
        <div class="hr-zones-label">Répartition zones FC</div>
        <div class="hr-zone-empty">Pas de données de fréquence cardiaque pour cette séance.</div>
      </div>
    `;
  }

  const values = zt.times;
  const estimated = zt.method === "estimated";

  const total = values.reduce((a, b) => a + b, 0);
  const segments = values
    .map((v, i) => {
      const pct = (v / total) * 100;
      return pct > 0 ? `<div class="hr-zone-segment" style="width:${pct}%; background:${HR_ZONE_COLORS[i]};"></div>` : "";
    })
    .join("");

  const legend = values
    .map((v, i) => {
      if (!v) return "";
      const pct = Math.round((v / total) * 100);
      const bpm = maxHr ? ` (${Math.round((bounds[i] / 100) * maxHr)}-${bounds[i + 1] >= 100 ? Math.round(maxHr) : Math.round((bounds[i + 1] / 100) * maxHr)} bpm)` : "";
      return `<span><span class="hr-zone-dot" style="background:${HR_ZONE_COLORS[i]};"></span>${HR_ZONE_NAMES[i]}${bpm} · ${formatDuration(v)} · ${pct}%</span>`;
    })
    .join("");

  return `
    <div class="hr-zones">
      <div class="hr-zones-header">
        <div class="hr-zones-label">Répartition zones FC${estimated ? ' <span class="hr-zones-estimated">(estimation)</span>' : ""}</div>
        <button type="button" id="hr-zone-settings-toggle" class="hr-zone-settings-btn" title="Configurer les seuils">${icon("settings", 15)}</button>
      </div>
      ${estimated ? '<div class="hr-zone-estimate-note">Zones par séance non fournies par Suunto pour cette activité — estimation à partir de la FC moyenne/max.</div>' : ""}
      <div id="hr-zone-settings" class="hr-zone-settings" hidden>
        ${hrZoneThresholds
          .map(
            (t, i) => `
          <label class="hr-zone-threshold-field">
            <span>Z${i + 1}/Z${i + 2}</span>
            <input type="number" min="1" max="99" step="1" data-threshold-index="${i}" value="${t}" />
            <span>%</span>
          </label>`
          )
          .join("")}
        <button type="button" id="hr-zone-settings-reset" class="hr-zone-settings-reset">Réinitialiser</button>
      </div>
      <div class="hr-zone-bar">${segments}</div>
      <div class="hr-zone-legend">${legend}</div>
    </div>
  `;
}

function bindHrZonesEvents(container, w, rerender) {
  const toggle = container.querySelector("#hr-zone-settings-toggle");
  const panel = container.querySelector("#hr-zone-settings");
  if (!toggle || !panel) return;

  toggle.addEventListener("click", () => { panel.hidden = !panel.hidden; });

  panel.querySelectorAll("input[data-threshold-index]").forEach((input) => {
    input.addEventListener("change", () => {
      const i = Number(input.dataset.thresholdIndex);
      let v = Math.round(Number(input.value));
      if (!Number.isFinite(v)) v = hrZoneThresholds[i];
      v = Math.max(1, Math.min(99, v));
      const next = [...hrZoneThresholds];
      next[i] = v;
      for (let j = 1; j < next.length; j++) next[j] = Math.max(next[j], next[j - 1] + 1);
      for (let j = next.length - 2; j >= 0; j--) next[j] = Math.min(next[j], next[j + 1] - 1);
      hrZoneThresholds = next;
      writeHrZoneThresholds(hrZoneThresholds);
      rerender(true);
    });
  });

  container.querySelector("#hr-zone-settings-reset").addEventListener("click", () => {
    hrZoneThresholds = [...DEFAULT_HR_ZONE_THRESHOLDS];
    writeHrZoneThresholds(hrZoneThresholds);
    rerender(true);
  });
}

// Construit le détail d'une séance dans le conteneur donné. `onClose` est
// appelé par le bouton "Retour aux séances".
export async function renderWorkoutDetailInto(container, username, key, onClose) {
  if (state.currentMap) { state.currentMap.remove(); state.currentMap = null; state.currentTileLayer = null; }
  const mapId = `route-map-${container.id}`;
  setDashGreeting("Chargement…", "");

  container.innerHTML = `
    <div class="detail-header">
      <button class="close-detail-btn">${icon("chevronLeft", 15)}Retour aux séances</button>
      <div class="workout-row-main">
        <div class="skeleton" style="width:38px;height:38px;border-radius:12px;"></div>
        <div class="skeleton" style="width:120px;height:16px;"></div>
      </div>
    </div>
    <div style="padding:20px;"><div class="skeleton" style="height:220px;"></div></div>
  `;
  container.querySelector(".close-detail-btn").addEventListener("click", () => onClose?.());

  try {
    const [w, workoutData] = await Promise.all([
      api(`/api/workouts/${encodeURIComponent(username)}/${encodeURIComponent(key)}`),
      api(`/api/workouts/${encodeURIComponent(username)}/${encodeURIComponent(key)}/data`).catch(() => null),
    ]);
    // Échantillons FC (t = secondes écoulées, hr = bpm) : alimentent la courbe
    // et le calcul exact des zones. Absents sur les séances sans capteur FC.
    const hrSamples = (workoutData?.heartrates || [])
      .filter((s) => Number.isFinite(s?.hr) && s.hr > 0)
      .map((s) => ({ t: s.t, hr: s.hr }));
    w.hrSamples = hrSamples;

    // Vitesse dérivée du GPS (Suunto ne fournit pas de série de vitesse) pour le
    // découplage cardiaque Pa:HR. Null si la séance n'a pas de tracé exploitable.
    const speedSamples = buildSpeedSamples(workoutData?.locations || []);
    const decoupling = computeDecoupling(hrSamples, speedSamples);

    // Charge de la séance (TRIMP par zone). On utilise la même FCmax que les
    // barres de zones ci-dessous pour rester cohérent visuellement ; le socle
    // de charge (readiness) s'appuie, lui, sur une FCmax fiabilisée du corpus.
    const detailMaxHr = w.hrdata?.userMaxHR || w.hrdata?.hrmax || w.hrdata?.workoutMaxHR || null;
    const trimp = computeTrimp(w, { maxHr: detailMaxHr, thresholds: hrZoneThresholds });
    const trimpMethodLabel = { samples: "d'après la FC seconde/seconde", zones: "d'après les zones de la montre", estimated: "estimé depuis la FC moyenne" }[trimp.method] || "";

    const points = w.polyline ? decodePolyline(w.polyline) : [];
    setDashGreeting(
      ACTIVITY_NAMES[w.activityId] || "Séance",
      new Date(w.startTime).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    );

    container.innerHTML = `
      <div class="detail-header">
        <button class="close-detail-btn">${icon("chevronLeft", 15)}Retour aux séances</button>
        <div class="workout-row-main">
          <div class="activity-icon">${icon(ACTIVITY_ICONS[w.activityId] || "mountain", 19)}</div>
          <div>
            <div class="workout-activity">${ACTIVITY_NAMES[w.activityId] || "Séance"}</div>
            <div class="workout-date">${new Date(w.startTime).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</div>
          </div>
        </div>
      </div>
      ${points.length ? `<div class="route-map" id="${mapId}"></div>` : ""}
      <div class="detail-stats">
        <div class="detail-stat"><div class="value">${formatDistance(w.totalDistance)}</div><div class="label">Distance</div></div>
        <div class="detail-stat"><div class="value">${formatDuration(w.totalTime || 0)}</div><div class="label">Durée</div></div>
        <div class="detail-stat"><div class="value">${formatPace(w.totalDistance, w.totalTime)}</div><div class="label">Allure moyenne</div></div>
        <div class="detail-stat"><div class="value">${w.hrdata?.workoutAvgHR ?? "—"}</div><div class="label">FC moyenne</div></div>
        <div class="detail-stat"><div class="value">${w.hrdata?.workoutMaxHR ?? "—"}</div><div class="label">FC max</div></div>
        <div class="detail-stat"><div class="value">${w.totalAscent != null ? Math.round(w.totalAscent) + " m" : "—"}</div><div class="label">Dénivelé +</div></div>
        <div class="detail-stat"><div class="value">${w.cadence?.avg != null ? Math.round(w.cadence.avg) : "—"}</div><div class="label">Cadence moy.</div></div>
        <div class="detail-stat"><div class="value">${w.cadence?.max != null ? Math.round(w.cadence.max) : "—"}</div><div class="label">Cadence max</div></div>
        <div class="detail-stat"${trimpMethodLabel ? ` title="TRIMP d'Edwards ${trimpMethodLabel}"` : ""}><div class="value">${trimp.value > 0 ? Math.round(trimp.value) : "—"}</div><div class="label">Charge (TRIMP)</div></div>
      </div>
      ${hrSamples.length >= 2 ? `
      <div class="hr-zones" id="hr-chart-section">
        <div class="hr-zones-header">
          <div class="hr-zones-label">Fréquence cardiaque</div>
          <div class="hr-chart-meta">moy ${w.hrdata?.workoutAvgHR ?? "—"} · max ${w.hrdata?.workoutMaxHR ?? "—"} bpm</div>
        </div>
        <div id="hr-chart"></div>
      </div>` : ""}
      <div id="decoupling-container"></div>
      <div id="hr-zones-container">${buildHrZonesHtml(w)}</div>
    `;

    if (decoupling) renderDecouplingCard(container.querySelector("#decoupling-container"), decoupling);
    if (points.length) buildRouteMap(mapId, points);
    if (hrSamples.length >= 2) {
      const hrColor = getComputedStyle(document.documentElement).getPropertyValue("--signal").trim() || "#e5484d";
      renderHrChart(document.getElementById("hr-chart"), hrSamples, { color: hrColor });
    }

    const rerenderHrZones = (keepOpen) => {
      const hrContainer = container.querySelector("#hr-zones-container");
      if (!hrContainer) return;
      hrContainer.innerHTML = buildHrZonesHtml(w);
      const panel = container.querySelector("#hr-zone-settings");
      if (panel && keepOpen) panel.hidden = false;
      bindHrZonesEvents(container, w, rerenderHrZones);
    };
    bindHrZonesEvents(container, w, rerenderHrZones);

    container.querySelector(".close-detail-btn").addEventListener("click", () => onClose?.());
  } catch (err) {
    setDashGreeting("Erreur", "");
    container.innerHTML = `
      <div class="detail-header">
        <button class="close-detail-btn">${icon("chevronLeft", 15)}Retour aux séances</button>
        <div class="workout-activity">Erreur</div>
      </div>
      <div class="empty" style="padding:30px 20px;"><span class="empty-icon">${icon("alertTriangle", 28)}</span>${escapeHtml(err.message)}</div>
    `;
    container.querySelector(".close-detail-btn").addEventListener("click", () => onClose?.());
  }
}

export async function openWorkoutDetail(username, key) {
  trackingListView.style.display = "none";
  trackingDetailView.style.display = "block";
  window.scrollTo({ top: 0, behavior: "instant" });
  await renderWorkoutDetailInto(workoutDetailPage, username, key, closeWorkoutDetail);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && trackingDetailView.style.display !== "none") closeWorkoutDetail();
});
