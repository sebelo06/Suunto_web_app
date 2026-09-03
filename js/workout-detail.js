// js/workout-detail.js
import { state } from "./state.js";
import { api } from "./api.js";
import { icon, ACTIVITY_ICONS, ACTIVITY_NAMES } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { formatDuration, formatDistance, formatPace } from "./format.js";
import { decodePolyline, buildRouteMap } from "./map.js";
import { renderHrChart } from "./charts.js";
import { setDashGreeting, resetDashGreeting } from "./dash-greeting.js";

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

// 5 zones FC "classiques" (% de FC max), seuils par défaut, configurables
// par l'usager et persistés en localStorage (même logique que les
// métriques de l'onglet Évolution).
const HR_ZONE_COLORS = ["#4fa3c9", "#49c6b5", "#e8c547", "#ff9c4a", "#e5484d"];
const HR_ZONE_NAMES = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"];
const DEFAULT_HR_ZONE_THRESHOLDS = [60, 70, 80, 90]; // bornes entre Z1/Z2, Z2/Z3, Z3/Z4, Z4/Z5, en % FC max

function readStoredHrZoneThresholds() {
  try {
    const arr = JSON.parse(localStorage.getItem("suunto-hr-zone-thresholds") || "null");
    if (Array.isArray(arr) && arr.length === 4 && arr.every((n) => Number.isFinite(n))) return arr;
  } catch { /* ignore */ }
  return null;
}
function writeStoredHrZoneThresholds(arr) {
  try { localStorage.setItem("suunto-hr-zone-thresholds", JSON.stringify(arr)); } catch { /* ignore */ }
}
let hrZoneThresholds = readStoredHrZoneThresholds() || DEFAULT_HR_ZONE_THRESHOLDS;

// Approximation de la fonction d'erreur (Abramowitz & Stegun 7.1.26),
// utilisée pour estimer une distribution normale de FC.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normalCdf(x, mean, sigma) { return 0.5 * (1 + erf((x - mean) / (sigma * Math.SQRT2))); }

// Beaucoup de séances Suunto n'ont pas de timeInZone0..5 renseigné (pas de
// répartition par zone fournie par l'API pour ce type de séance/capteur).
// Dans ce cas on estime la répartition du temps par zone à partir d'une
// distribution normale centrée sur la FC moyenne (écart-type dérivé de
// l'écart avg/max) — approximation clairement signalée comme telle.
function estimateZoneTimes(w, maxHr, boundsPct) {
  const avg = w.hrdata?.workoutAvgHR;
  const totalTime = w.totalTime;
  if (!avg || !totalTime || !maxHr) return null;
  const max = w.hrdata?.workoutMaxHR || maxHr;
  const sigma = Math.max(6, (max - avg) / 1.8);
  const bpmBounds = boundsPct.map((b) => (b / 100) * maxHr);
  const cdfs = bpmBounds.map((b, i) => (i === 0 ? 0 : i === bpmBounds.length - 1 ? 1 : normalCdf(b, avg, sigma)));
  const masses = cdfs.slice(1).map((c, i) => Math.max(0, c - cdfs[i]));
  const massSum = masses.reduce((a, b) => a + b, 0) || 1;
  return masses.map((m) => (m / massSum) * totalTime);
}

// Temps passé dans chaque zone calculé directement depuis les échantillons FC
// (le plus précis, et surtout recalculé selon les seuils choisis par l'usager,
// contrairement aux timeInZone figés par la montre). `samples` = [{ t, hr }].
function sampleZoneTimes(samples, maxHr, boundsPct) {
  const pts = (samples || []).filter((s) => Number.isFinite(s.hr) && s.hr > 0 && Number.isFinite(s.t));
  if (pts.length < 2 || !maxHr) return null;
  const bpm = boundsPct.map((b) => (b / 100) * maxHr); // longueur 6 : [0, ...seuils, 100%]
  const zoneOf = (hr) => {
    for (let z = 4; z >= 0; z--) if (hr >= bpm[z]) return z;
    return 0;
  };
  const times = [0, 0, 0, 0, 0];
  for (let i = 0; i < pts.length - 1; i++) {
    const dt = Math.max(0, pts[i + 1].t - pts[i].t);
    times[zoneOf(pts[i].hr)] += dt;
  }
  return times.some((v) => v > 0) ? times : null;
}

function buildHrZonesHtml(w) {
  const raw = ["timeInZone0", "timeInZone1", "timeInZone2", "timeInZone3", "timeInZone4", "timeInZone5"].map((k) => w[k] || 0);
  const rawTotal = raw.reduce((a, b) => a + b, 0);
  const maxHr = w.hrdata?.userMaxHR || w.hrdata?.hrmax || w.hrdata?.workoutMaxHR || null;
  const bounds = [0, ...hrZoneThresholds, 100];

  let values, estimated;
  const sampleVals = sampleZoneTimes(w.hrSamples, maxHr, bounds);
  if (sampleVals) {
    values = sampleVals;
    estimated = false;
  } else if (rawTotal > 0) {
    values = [raw[0] + raw[1], raw[2], raw[3], raw[4], raw[5]];
    estimated = false;
  } else {
    values = estimateZoneTimes(w, maxHr, bounds);
    estimated = true;
  }
  if (!values) {
    return `
      <div class="hr-zones">
        <div class="hr-zones-label">Répartition zones FC</div>
        <div class="hr-zone-empty">Pas de données de fréquence cardiaque pour cette séance.</div>
      </div>
    `;
  }

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
      writeStoredHrZoneThresholds(hrZoneThresholds);
      rerender(true);
    });
  });

  container.querySelector("#hr-zone-settings-reset").addEventListener("click", () => {
    hrZoneThresholds = [...DEFAULT_HR_ZONE_THRESHOLDS];
    writeStoredHrZoneThresholds(hrZoneThresholds);
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
      </div>
      ${hrSamples.length >= 2 ? `
      <div class="hr-zones" id="hr-chart-section">
        <div class="hr-zones-header">
          <div class="hr-zones-label">Fréquence cardiaque</div>
          <div class="hr-chart-meta">moy ${w.hrdata?.workoutAvgHR ?? "—"} · max ${w.hrdata?.workoutMaxHR ?? "—"} bpm</div>
        </div>
        <div id="hr-chart"></div>
      </div>` : ""}
      <div id="hr-zones-container">${buildHrZonesHtml(w)}</div>
    `;

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
