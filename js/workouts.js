// js/workouts.js
import { state } from "./state.js";
import { api } from "./api.js";
import { icon, ACTIVITY_ICONS, ACTIVITY_NAMES } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { formatDuration, formatDistance, formatClock } from "./format.js";
import { renderLineChart } from "./charts.js";
import { openWorkoutDetail } from "./workout-detail.js";
import { recenterEditorMap } from "./route-editor.js";
import { updateReadinessWorkouts } from "./readiness.js";
import { updateKpiData } from "./kpi.js";
import { loadHistory } from "./history.js";

const workoutList = document.getElementById("workout-list");
const workoutLoadMoreBtn = document.getElementById("workout-load-more");

let latestWorkouts = null;
const WORKOUT_PAGE_SIZE = 20;
let workoutOffset = 0;
let workoutsHasMore = true;
let workoutsLoadingMore = false;

function renderTrendChart(workouts) {
  const trendCard = document.getElementById("trend-card");
  const trendHint = document.getElementById("trend-hint");
  const recent = [...workouts].slice(0, 8).reverse();
  const items = recent.map((w) => ({
    value: (w.totalDistance || 0) / 1000,
    label: new Date(w.startTime).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
  }));
  const distColor = getComputedStyle(document.documentElement).getPropertyValue("--signal").trim() || "#ff6a3d";
  renderLineChart(trendCard, items, { color: distColor, formatValue: (v) => `${v.toFixed(1)} km` });
  if (trendHint) trendHint.textContent = items.length ? "Distance (km) des 8 dernières séances" : "";
}

// Formule de Riegel (T2 = T1 * (D2/D1)^1.06) : on prend la course à
// pied la plus "performante" parmi les séances récentes (celle qui
// prédit le 10 km le plus rapide) comme référence, puis on en déduit
// les autres distances.
const PREDICT_WINDOW_DAYS = 90; // « forme actuelle » : on ignore les courses plus anciennes
const HEATMAP_DAYS = 14 * 7 + 7; // 14 semaines + la semaine partielle de départ

function renderRacePredictor(workouts) {
  const card = document.getElementById("predict-card");
  const hint = document.getElementById("predict-hint");
  if (!card) return;

  const since = Date.now() - PREDICT_WINDOW_DAYS * 86400000;
  const runs = workouts.filter(
    (w) => w.activityId === 1 && w.totalDistance > 1000 && w.totalTime > 0 && new Date(w.startTime).getTime() >= since
  );
  if (!runs.length) {
    card.innerHTML = `<div class="empty"><span class="empty-icon">${icon("activity", 28)}</span>Pas assez de courses à pied récentes pour prédire un temps.</div>`;
    if (hint) hint.textContent = "";
    return;
  }

  const REF = 10000;
  let best = runs[0];
  let bestPredicted10k = Infinity;
  runs.forEach((w) => {
    const predicted10k = w.totalTime * Math.pow(REF / w.totalDistance, 1.06);
    if (predicted10k < bestPredicted10k) {
      bestPredicted10k = predicted10k;
      best = w;
    }
  });

  const targets = [
    { label: "5 km", d: 5000 },
    { label: "10 km", d: 10000 },
    { label: "Semi", d: 21097 },
    { label: "Marathon", d: 42195 },
  ];

  card.innerHTML = `
    <div class="predict-grid">
      ${targets
        .map(({ label, d }) => {
          const seconds = best.totalTime * Math.pow(d / best.totalDistance, 1.06);
          return `<div class="predict-item"><div class="value">${formatClock(seconds)}</div><div class="label">${label}</div></div>`;
        })
        .join("")}
    </div>
  `;
  if (hint) hint.textContent = `Basé sur ta course du ${new Date(best.startTime).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} (${formatDistance(best.totalDistance)})`;
}

// Grille de régularité façon GitHub : 14 dernières semaines, une case
// par jour, coloriée selon la distance parcourue ce jour-là.
function renderCalendarHeatmap(workouts) {
  const container = document.getElementById("calendar-heatmap");
  const hint = document.getElementById("heatmap-hint");
  if (!container) return;

  const WEEKS = 14;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - (WEEKS * 7 - 1));
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // recule jusqu'au lundi

  const byDay = {};
  workouts.forEach((w) => {
    const key = new Date(w.startTime).toISOString().slice(0, 10);
    byDay[key] = (byDay[key] || 0) + (w.totalDistance || 0);
  });
  const maxVal = Math.max(...Object.values(byDay), 1);

  const weeks = [];
  let week = [];
  for (const cur = new Date(start); cur <= today; cur.setDate(cur.getDate() + 1)) {
    const key = cur.toISOString().slice(0, 10);
    const val = byDay[key] || 0;
    const ratio = val / maxVal;
    const level = val === 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
    week.push({ date: new Date(cur), val, level });
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) weeks.push(week);

  let lastMonth = null;
  const monthsHtml = weeks
    .map((w) => {
      const m = w[0].date.getMonth();
      const label = m !== lastMonth ? w[0].date.toLocaleDateString("fr-FR", { month: "short" }) : "";
      lastMonth = m;
      return `<span>${label}</span>`;
    })
    .join("");

  const cellsHtml = weeks
    .map((w) =>
      w
        .map((c) => {
          const dateLabel = c.date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
          const valLabel = c.val ? formatDistance(c.val) : "";
          return `<div class="heatmap-cell level-${c.level}" role="img" tabindex="-1" aria-label="${dateLabel} : ${valLabel || "aucune séance"}" data-date="${dateLabel}" data-val="${valLabel}"></div>`;
        })
        .join("")
    )
    .join("");

  const dayLabels = ["Lun", "", "Mer", "", "", "Sam", ""];
  const daysHtml = dayLabels.map((d) => `<span>${d}</span>`).join("");

  container.innerHTML = `
    <div class="heatmap-wrap" role="group" aria-label="Régularité : distance par jour, flèches pour parcourir">
      <div class="heatmap-days">${daysHtml}</div>
      <div class="heatmap-main">
        <div class="heatmap-months">${monthsHtml}</div>
        <div class="heatmap-grid">${cellsHtml}</div>
      </div>
      <div class="heatmap-tooltip" id="heatmap-tooltip"></div>
    </div>
    <div class="heatmap-legend">
      <span>Moins</span>
      <div class="heatmap-cell level-0"></div>
      <div class="heatmap-cell level-1"></div>
      <div class="heatmap-cell level-2"></div>
      <div class="heatmap-cell level-3"></div>
      <div class="heatmap-cell level-4"></div>
      <span>Plus</span>
    </div>
  `;
  if (hint) hint.textContent = `${WEEKS} dernières semaines`;

  const tooltip = document.getElementById("heatmap-tooltip");
  const wrap = container.querySelector(".heatmap-wrap");
  const showTip = (cell) => {
    tooltip.textContent = cell.dataset.val ? `${cell.dataset.date} · ${cell.dataset.val}` : cell.dataset.date;
    const rect = cell.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = `${rect.left - wrapRect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - wrapRect.top}px`;
    tooltip.style.display = "block";
  };
  wrap.addEventListener("mouseover", (e) => {
    const cell = e.target.closest(".heatmap-cell");
    if (cell) showTip(cell);
  });
  wrap.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget || !wrap.contains(e.relatedTarget)) tooltip.style.display = "none";
  });

  // Clavier : un seul arrêt de tabulation (« tabindex itinérant »), flèches
  // ←/→ = semaine précédente/suivante, ↑/↓ = jour précédent/suivant.
  const cells = [...container.querySelectorAll(".heatmap-grid .heatmap-cell")];
  if (cells.length) cells[cells.length - 1].tabIndex = 0;
  const move = (from, to) => {
    const next = cells[Math.max(0, Math.min(cells.length - 1, to))];
    from.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  };
  wrap.addEventListener("focusin", (e) => { if (e.target.classList?.contains("heatmap-cell")) showTip(e.target); });
  wrap.addEventListener("focusout", () => { tooltip.style.display = "none"; });
  wrap.addEventListener("keydown", (e) => {
    const cell = e.target.closest?.(".heatmap-grid .heatmap-cell");
    if (!cell) return;
    const i = cells.indexOf(cell);
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (step == null) return;
    e.preventDefault();
    move(cell, i + step);
  });
}

function renderWorkoutList() {
  const workouts = latestWorkouts || [];
  workoutList.innerHTML = workouts
    .map((w, i) => `
      <div class="workout-row" data-index="${i}">
        <div class="workout-row-main">
          <div class="activity-icon">${icon(ACTIVITY_ICONS[w.activityId] || "mountain", 19)}</div>
          <div>
            <div class="workout-activity">${ACTIVITY_NAMES[w.activityId] || "Séance"}</div>
            <div class="workout-date">${new Date(w.startTime).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</div>
          </div>
        </div>
        <div class="workout-row-metrics">
          <div class="workout-metric"><div class="value">${formatDuration(w.totalTime || 0)}</div><div class="label">Durée</div></div>
          <div class="workout-metric"><div class="value">${formatDistance(w.totalDistance)}</div><div class="label">Distance</div></div>
          <div class="workout-metric"><div class="value">${w.totalAscent != null ? `+${Math.round(w.totalAscent)} m` : "—"}</div><div class="label">D+</div></div>
          <div class="workout-metric"><div class="value">${w.hrdata?.workoutAvgHR ? `${Math.round(w.hrdata.workoutAvgHR)} bpm` : "—"}</div><div class="label">FC moy</div></div>
        </div>
        <div class="workout-chevron">${icon("chevronRight", 18)}</div>
      </div>
    `)
    .join("");

  workoutList.querySelectorAll(".workout-row").forEach((row) => {
    row.addEventListener("click", () => {
      const w = workouts[Number(row.dataset.index)];
      openWorkoutDetail(w.username, w.workoutKey || w.key);
    });
  });

  workoutLoadMoreBtn.style.display = workoutsHasMore ? "inline-flex" : "none";
}

export async function loadWorkouts() {
  try {
    workoutOffset = 0;
    workoutsHasMore = true;
    const workouts = await api(`/api/workouts?limit=${WORKOUT_PAGE_SIZE}&offset=0`);
    workoutOffset = workouts.length;
    if (workouts.length < WORKOUT_PAGE_SIZE) workoutsHasMore = false;
    latestWorkouts = workouts;
    updateKpiData({ workouts });
    renderTrendChart(workouts);
    // Première peinture avec la page déjà chargée, puis affinage avec l'historique
    // complet (sinon calendrier et prédiction ne verraient que les 20 dernières séances).
    renderRacePredictor(workouts);
    renderCalendarHeatmap(workouts);
    updateReadinessWorkouts(workouts);
    loadHistory({ minDays: HEATMAP_DAYS })
      .then((history) => {
        renderRacePredictor(history);
        renderCalendarHeatmap(history);
        updateReadinessWorkouts(history);
      })
      .catch(() => { /* on garde le rendu provisoire */ });

    if (!workouts.length) {
      workoutList.innerHTML = `<div class="empty"><span class="empty-icon">${icon("mountain", 28)}</span>Aucune séance trouvée.<br>Va enregistrer une sortie avec ta montre !</div>`;
      workoutLoadMoreBtn.style.display = "none";
      return;
    }
    renderWorkoutList();

    // Retient la position pour centrer la carte de l'éditeur d'itinéraire
    // dès sa création (immédiatement si elle existe déjà, ou plus tard
    // à la première ouverture de l'onglet Itinéraire).
    const firstPos = workouts[0]?.startPosition;
    if (firstPos) {
      state.lastKnownWorkoutPosition = [firstPos.y, firstPos.x];
      recenterEditorMap(state.lastKnownWorkoutPosition);
    }
  } catch (err) {
    workoutList.innerHTML = `<div class="empty"><span class="empty-icon">${icon("alertTriangle", 28)}</span>${escapeHtml(err.message)}</div>`;
    workoutLoadMoreBtn.style.display = "none";
  }
}

export async function loadMoreWorkouts() {
  if (workoutsLoadingMore || !workoutsHasMore) return;
  workoutsLoadingMore = true;
  workoutLoadMoreBtn.disabled = true;
  workoutLoadMoreBtn.textContent = "Chargement…";
  try {
    const more = await api(`/api/workouts?limit=${WORKOUT_PAGE_SIZE}&offset=${workoutOffset}`);
    workoutOffset += more.length;
    if (more.length < WORKOUT_PAGE_SIZE) workoutsHasMore = false;
    latestWorkouts = (latestWorkouts || []).concat(more);
    updateKpiData({ workouts: latestWorkouts });
    renderTrendChart(latestWorkouts);
    renderWorkoutList();
  } catch {
    workoutsHasMore = true;
  } finally {
    workoutsLoadingMore = false;
    workoutLoadMoreBtn.disabled = false;
    workoutLoadMoreBtn.textContent = "Charger plus de séances";
  }
}

export function getLatestWorkouts() {
  return latestWorkouts;
}

workoutLoadMoreBtn.addEventListener("click", loadMoreWorkouts);
