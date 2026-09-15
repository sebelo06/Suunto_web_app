// js/evolution.js
//
// Onglet "page d'accueil" : agrège l'historique des séances par semaine,
// mois ou année et affiche un tableau + graphique paramétrables (l'usager
// choisit les métriques qu'il veut suivre, persistées en localStorage).
import { api } from "./api.js";
import { icon, ACTIVITY_NAMES, ACTIVITY_ICONS } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { formatDuration, formatPaceValue } from "./format.js";
import { renderLineChart } from "./charts.js";

function aggDistance(items) { return items.reduce((s, w) => s + (w.totalDistance || 0), 0) / 1000; }
function aggCount(items) { return items.length; }
function aggDuration(items) { return items.reduce((s, w) => s + (w.totalTime || 0), 0); }
function aggAscent(items) { return items.reduce((s, w) => s + (w.totalAscent || 0), 0); }
function aggPace(items) {
  // Sans filtre sport, on ne calcule l'allure que sur la course à pied
  // (mélanger vélo/course fausserait la moyenne). Avec un sport choisi,
  // les séances sont déjà toutes de ce sport.
  const runs = evoSport === "all" ? items.filter((w) => w.activityId === 1) : items;
  const valid = runs.filter((w) => w.totalDistance > 0 && w.totalTime > 0);
  if (!valid.length) return null;
  const dist = valid.reduce((s, w) => s + w.totalDistance, 0);
  const time = valid.reduce((s, w) => s + w.totalTime, 0);
  return time / (dist / 1000);
}
function aggHr(items) {
  const withHr = items.filter((w) => w.hrdata?.workoutAvgHR && w.totalTime);
  if (!withHr.length) return null;
  const weightedSum = withHr.reduce((s, w) => s + w.hrdata.workoutAvgHR * w.totalTime, 0);
  const totalTime = withHr.reduce((s, w) => s + w.totalTime, 0);
  return weightedSum / totalTime;
}

// --- VO2max effectif ------------------------------------------------------
//
// Idée (inspirée de Runalyze) : à partir du couple allure/FC de chaque
// course (corrigé du dénivelé), on estime un coût en oxygène "brut" via
// l'équation ACSM, qu'on ramène à un VO2max en le divisant par la fraction
// de FC max utilisée pendant la séance. Cette estimation brute est
// systématiquement biaisée (la relation %FCmax / %VO2max n'est pas
// linéaire), donc on la recale avec un facteur de calibration individuel :
// on prend la meilleure performance récente (l'effort le plus proche du
// maximal), on calcule son "vrai" VO2max via la courbe %VO2max/durée de
// Daniels (qui ne dépend que de l'allure et de la durée, pas de la FC), et
// le rapport entre les deux devient le facteur appliqué à toutes les
// séances. Résultat : un indicateur de forme qui suit l'évolution réelle,
// indépendamment de l'allure brute.
const VO2MAX_LOOKBACK_DAYS = 180;
const VO2MAX_MIN_DURATION_S = 600; // écarte les sorties trop courtes (estimation trop bruitée)
const VO2MAX_HARD_EFFORT_HR_FRAC = 0.8; // seuil pour repérer un effort proche du maximal

function runningGrade(w) {
  if (!w.totalDistance || !w.totalAscent) return 0;
  return Math.min(w.totalAscent / w.totalDistance, 0.3); // clamp : dénivelé aberrant = donnée GPS foireuse
}

// Coût en oxygène (ml/kg/min) à une allure donnée, équation ACSM course à
// pied. Ne dépend pas du poids : la formule est déjà normalisée par kg.
function acsmVo2Cost(speedMPerMin, grade) {
  return 0.2 * speedMPerMin + 0.9 * speedMPerMin * grade + 3.5;
}

// Fraction du VO2max mobilisée pour un effort continu de `durationMin`
// minutes (courbe de Daniels & Gilbert, indépendante de la FC).
function danielsVo2maxFraction(durationMin) {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * durationMin) + 0.2989558 * Math.exp(-0.1932605 * durationMin);
}

function workoutMaxHr(w) {
  return w.hrdata?.userMaxHR || w.hrdata?.hrmax || w.hrdata?.workoutMaxHR || null;
}

// Estimation brute (non calibrée) du VO2max d'une séance, à partir du ratio
// coût-en-oxygène / fraction de FC max utilisée.
function rawVo2max(w) {
  const avgHr = w.hrdata?.workoutAvgHR;
  const maxHr = workoutMaxHr(w);
  if (w.activityId !== 1 || !w.totalDistance || !w.totalTime || !avgHr || !maxHr) return null;
  const hrFrac = Math.min(avgHr / maxHr, 1);
  if (hrFrac <= 0) return null;
  const speedMPerMin = w.totalDistance / (w.totalTime / 60);
  const vo2Cost = acsmVo2Cost(speedMPerMin, runningGrade(w));
  return { raw: vo2Cost / hrFrac, vo2Cost, hrFrac };
}

let vo2maxCache = new Map(); // clé séance -> VO2max effectif calibré
function vo2maxKey(w) { return w.workoutKey || w.key || `${w.username || ""}-${w.startTime}`; }

// Reconstruit le cache de VO2max effectif à partir de l'historique chargé.
// Le facteur de calibration est dérivé de la meilleure performance récente
// (effort le plus proche du maximal sur les VO2MAX_LOOKBACK_DAYS derniers
// jours) ; à défaut, on retombe sur la meilleure estimation brute
// disponible, quelle que soit son intensité.
function buildVo2maxCache(workouts) {
  vo2maxCache = new Map();
  const now = Date.now();
  const candidates = workouts
    .filter((w) => w.totalTime >= VO2MAX_MIN_DURATION_S)
    .map((w) => ({ w, est: rawVo2max(w) }))
    .filter((c) => c.est);
  if (!candidates.length) return;

  const recent = candidates.filter((c) => now - new Date(c.w.startTime).getTime() <= VO2MAX_LOOKBACK_DAYS * 86400000);
  const hardEfforts = recent.filter((c) => c.est.hrFrac >= VO2MAX_HARD_EFFORT_HR_FRAC);
  const pool = hardEfforts.length ? hardEfforts : recent.length ? recent : candidates;
  const best = pool.reduce((a, b) => (b.est.raw > a.est.raw ? b : a));

  const durationMin = best.w.totalTime / 60;
  const trueVo2max = best.est.vo2Cost / danielsVo2maxFraction(durationMin);
  const calibrationFactor = trueVo2max / best.est.raw;

  candidates.forEach(({ w, est }) => vo2maxCache.set(vo2maxKey(w), est.raw * calibrationFactor));
}

function aggVo2max(items) {
  const runs = evoSport === "all" ? items.filter((w) => w.activityId === 1) : items;
  const values = runs.map((w) => vo2maxCache.get(vo2maxKey(w))).filter((v) => v != null);
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

const EVO_METRICS = {
  distance: { label: "Distance", color: "#ff6a3d", compute: aggDistance, format: (v) => v.toFixed(1) + " km", higherIsBetter: true },
  count: { label: "Séances", color: "#4fa3c9", compute: aggCount, format: (v) => String(v), higherIsBetter: true },
  duration: { label: "Durée", color: "#49c6b5", compute: aggDuration, format: (v) => formatDuration(v), higherIsBetter: true },
  pace: { label: "Allure /km", color: "#e8c547", compute: aggPace, format: formatPaceValue, higherIsBetter: false },
  hr: { label: "FC moyenne", color: "#e5484d", compute: aggHr, format: (v) => Math.round(v) + " bpm", higherIsBetter: false },
  ascent: { label: "Dénivelé +", color: "#ff9c4a", compute: aggAscent, format: (v) => Math.round(v) + " m", higherIsBetter: true },
  vo2max: { label: "VO2max effectif", color: "#8e6fe8", compute: aggVo2max, format: (v) => v.toFixed(1) + " ml/kg/min", higherIsBetter: true },
};
const EVO_PERIOD_COUNT = 8;
const EVO_PERIOD_LABELS = { week: "semaine", month: "mois", year: "année" };

function readStoredEvoPeriod() { try { return localStorage.getItem("suunto-evo-period"); } catch { return null; } }
function writeStoredEvoPeriod(v) { try { localStorage.setItem("suunto-evo-period", v); } catch { /* ignore */ } }
function readStoredEvoMetrics() {
  try {
    const arr = JSON.parse(localStorage.getItem("suunto-evo-metrics") || "null");
    return Array.isArray(arr) && arr.length ? arr.filter((m) => EVO_METRICS[m]) : null;
  } catch { return null; }
}
function writeStoredEvoMetrics(arr) { try { localStorage.setItem("suunto-evo-metrics", JSON.stringify(arr)); } catch { /* ignore */ } }
function readStoredEvoSport() { try { return localStorage.getItem("suunto-evo-sport"); } catch { return null; } }
function writeStoredEvoSport(v) { try { localStorage.setItem("suunto-evo-sport", v); } catch { /* ignore */ } }

let evolutionWorkouts = null;
let evolutionLoading = false;
let evoPeriod = readStoredEvoPeriod() || "week";
let evoMetrics = readStoredEvoMetrics() || ["distance", "count", "pace", "hr"];
let evoSport = readStoredEvoSport() || "all"; // "all" ou un activityId (en string)

// Séances filtrées sur le sport choisi, pour isoler l'évolution d'une
// seule pratique (ex: comparer uniquement les courses à pied entre elles).
function getEvoFilteredWorkouts() {
  if (!evolutionWorkouts) return [];
  if (evoSport === "all") return evolutionWorkouts;
  return evolutionWorkouts.filter((w) => String(w.activityId) === evoSport);
}

function evoPeriodStart(date, granularity) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (granularity === "week") {
    const dayOffset = (d.getDay() + 6) % 7; // lundi = début de semaine
    d.setDate(d.getDate() - dayOffset);
  } else if (granularity === "month") {
    d.setDate(1);
  } else {
    d.setMonth(0, 1);
  }
  return d;
}
function evoPeriodAfter(date, granularity) {
  const d = new Date(date);
  if (granularity === "week") d.setDate(d.getDate() + 7);
  else if (granularity === "month") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}
function evoPeriodLabel(date, granularity) {
  if (granularity === "week") return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  if (granularity === "month") return date.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  return date.toLocaleDateString("fr-FR", { year: "numeric" });
}

// Génère les N dernières périodes calendaires (même sans séance dedans,
// pour bien visualiser les coupures) et y range les séances correspondantes.
function buildEvoPeriods(workouts, granularity) {
  const starts = [];
  let cursor = evoPeriodStart(new Date(), granularity);
  for (let i = 0; i < EVO_PERIOD_COUNT; i++) {
    starts.unshift(cursor);
    const prevDay = new Date(cursor);
    prevDay.setDate(prevDay.getDate() - 1);
    cursor = evoPeriodStart(prevDay, granularity);
  }
  return starts.map((start) => {
    const end = evoPeriodAfter(start, granularity);
    const items = workouts.filter((w) => {
      const t = new Date(w.startTime);
      return t >= start && t < end;
    });
    return { start, end, items };
  });
}

function renderEvoMetricPicker() {
  const el = document.getElementById("evo-metric-picker");
  if (!el) return;
  el.innerHTML = Object.entries(EVO_METRICS)
    .map(([key, m]) => `<button type="button" class="evo-metric-chip ${evoMetrics.includes(key) ? "active" : ""}" aria-pressed="${evoMetrics.includes(key)}" data-metric="${key}">${m.label}</button>`)
    .join("");
  el.querySelectorAll(".evo-metric-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.metric;
      if (evoMetrics.includes(key)) {
        if (evoMetrics.length === 1) return; // garde toujours au moins une métrique affichée
        evoMetrics = evoMetrics.filter((k) => k !== key);
      } else {
        evoMetrics = [...evoMetrics, key];
      }
      writeStoredEvoMetrics(evoMetrics);
      renderEvoMetricPicker();
      renderEvolution();
    });
  });
}

// Ne propose que les sports réellement présents dans l'historique chargé,
// pour ne pas polluer le filtre avec des activités jamais pratiquées.
function renderEvoSportPicker() {
  const el = document.getElementById("evo-sport-switch");
  if (!el || !evolutionWorkouts) return;

  const counts = new Map();
  evolutionWorkouts.forEach((w) => counts.set(w.activityId, (counts.get(w.activityId) || 0) + 1));
  const sports = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));

  if (evoSport !== "all" && !sports.some((id) => String(id) === evoSport)) {
    evoSport = "all";
    writeStoredEvoSport(evoSport);
  }

  const chips = [
    `<button type="button" class="evo-sport-chip ${evoSport === "all" ? "active" : ""}" aria-pressed="${evoSport === "all"}" data-sport="all">Tous les sports</button>`,
    ...sports.map((id) => {
      const label = ACTIVITY_NAMES[id] || `Sport ${id}`;
      const iconName = ACTIVITY_ICONS[id] || "medal";
      return `<button type="button" class="evo-sport-chip ${evoSport === String(id) ? "active" : ""}" aria-pressed="${evoSport === String(id)}" data-sport="${id}">${icon(iconName, 14)}${label}</button>`;
    }),
  ];
  el.innerHTML = chips.join("");

  el.querySelectorAll(".evo-sport-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      evoSport = btn.dataset.sport;
      writeStoredEvoSport(evoSport);
      el.querySelectorAll(".evo-sport-chip").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      renderEvolution();
    });
  });
}

export function renderEvolution() {
  const chart = document.getElementById("evo-chart");
  const chartHint = document.getElementById("evo-chart-hint");
  const table = document.getElementById("evo-table");
  const hint = document.getElementById("evo-hint");
  if (!evolutionWorkouts || !table) return;

  const filtered = getEvoFilteredWorkouts();

  // Périodes triées de la plus récente à la plus ancienne pour le tableau.
  const periodsDesc = buildEvoPeriods(filtered, evoPeriod).reverse();

  const primaryKey = evoMetrics[0];
  const primary = EVO_METRICS[primaryKey];
  if (primary && chart) {
    const chrono = [...periodsDesc].reverse();
    const items = chrono.map((p) => ({ value: primary.compute(p.items) ?? 0, label: evoPeriodLabel(p.start, evoPeriod) }));
    renderLineChart(chart, items, { color: primary.color, formatValue: (v) => primary.format(v) });
  }
  if (chartHint) chartHint.textContent = primary ? `${primary.label} par ${EVO_PERIOD_LABELS[evoPeriod]}` : "";

  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = `<tr><th>Période</th>${evoMetrics.map((k) => `<th>${EVO_METRICS[k].label}</th>`).join("")}</tr>`;

  const rowsHtml = periodsDesc
    .map((p, idx) => {
      const older = periodsDesc[idx + 1];
      const cells = evoMetrics
        .map((k) => {
          const m = EVO_METRICS[k];
          const val = m.compute(p.items);
          const olderVal = older ? m.compute(older.items) : null;
          let delta = "";
          if (val != null && olderVal != null && olderVal !== 0) {
            const pct = ((val - olderVal) / olderVal) * 100;
            if (Math.abs(pct) >= 1) {
              const up = pct > 0;
              const positive = m.higherIsBetter ? up : !up;
              delta = `<span class="evo-delta ${positive ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%</span>`;
            }
          }
          return `<td>${val == null ? "—" : m.format(val)}${delta}</td>`;
        })
        .join("");
      return `<tr><td class="evo-period-cell">${evoPeriodLabel(p.start, evoPeriod)}${idx === 0 ? " · en cours" : ""}</td>${cells}</tr>`;
    })
    .join("");

  tbody.innerHTML = rowsHtml || `<tr><td style="padding:16px;">Pas encore de données${evoSport !== "all" ? " pour ce sport" : ""}.</td></tr>`;
  if (hint) {
    const sportLabel = evoSport !== "all" ? ` · ${ACTIVITY_NAMES[Number(evoSport)] || "sport filtré"}` : "";
    hint.textContent = filtered.length ? `${filtered.length} séance${filtered.length > 1 ? "s" : ""} analysée${filtered.length > 1 ? "s" : ""}${sportLabel}` : "";
  }
}

export async function loadEvolutionData() {
  if (evolutionLoading) return;
  evolutionLoading = true;
  try {
    const pageSize = 50;
    const maxPages = 4; // jusqu'à 200 séances d'historique pour des moyennes fiables
    let offset = 0;
    let all = [];
    for (let i = 0; i < maxPages; i++) {
      const page = await api(`/api/workouts?limit=${pageSize}&offset=${offset}`);
      all = all.concat(page);
      offset += page.length;
      if (page.length < pageSize) break;
    }
    evolutionWorkouts = all;
    buildVo2maxCache(all);
    renderEvoSportPicker();
    renderEvolution();
  } catch (err) {
    const chart = document.getElementById("evo-chart");
    if (chart) chart.innerHTML = `<div class="empty"><span class="empty-icon">${icon("alertTriangle", 28)}</span>${escapeHtml(err.message)}</div>`;
  } finally {
    evolutionLoading = false;
  }
}

export function initEvolutionTab() {
  document.querySelectorAll(".evo-period-btn").forEach((btn) => {
    const initOn = btn.dataset.period === evoPeriod;
    btn.classList.toggle("active", initOn);
    btn.setAttribute("aria-pressed", String(initOn));
    btn.addEventListener("click", () => {
      evoPeriod = btn.dataset.period;
      writeStoredEvoPeriod(evoPeriod);
      document.querySelectorAll(".evo-period-btn").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      renderEvolution();
    });
  });
  renderEvoMetricPicker();
}
