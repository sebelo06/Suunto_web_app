// js/kpi.js
//
// Grille de tuiles KPI configurable du bloc « Aujourd'hui ». Ce module est
// le seul propriétaire de #wellness-tiles : wellness.js et workouts.js lui
// poussent leurs données (updateKpiData), il en déduit les valeurs et rend
// les tuiles sélectionnées par le client. La sélection (quels KPI afficher,
// dans la limite de MAX_KPIS) est mémorisée en localStorage — c'est une
// préférence d'affichage par navigateur, pas une donnée métier.
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { formatDuration, formatDistance, formatClock } from "./format.js";

const grid = document.getElementById("wellness-tiles");

export const MAX_KPIS = 8;
const STORAGE_KEY = "suunto:kpi-selection";

// Données brutes alimentées par les autres modules.
const data = {
  recovery: null,   // dernier échantillon de récupération ({ balance })
  sleepNight: null, // entryData de la dernière nuit
  activity: null,   // échantillons d'activité 24/7 (15 min), du plus ancien au plus récent
  workouts: null,   // séances récentes (les plus récentes en premier)
  error: null,      // message d'erreur de chargement bien-être, le cas échéant
};

// ---------------------------------------------------------------------------
// Petits calculs dérivés des séances.
// ---------------------------------------------------------------------------
function weekStats() {
  if (!data.workouts) return null;
  const now = new Date();
  const start = new Date(now);
  const dayOffset = (now.getDay() + 6) % 7; // lundi = début de semaine
  start.setDate(now.getDate() - dayOffset);
  start.setHours(0, 0, 0, 0);
  const thisWeek = data.workouts.filter((w) => new Date(w.startTime) >= start);
  return {
    distance: thisWeek.reduce((s, w) => s + (w.totalDistance || 0), 0),
    count: thisWeek.length,
  };
}

function monthDistance() {
  if (!data.workouts) return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return data.workouts
    .filter((w) => new Date(w.startTime) >= start)
    .reduce((s, w) => s + (w.totalDistance || 0), 0);
}

// Cumul du jour (minuit local) des échantillons d'activité 24/7.
function todayActivity() {
  if (!data.activity) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return data.activity
    .filter((e) => new Date(e.timestamp) >= start)
    .reduce(
      (acc, e) => ({
        steps: acc.steps + (e.entryData?.stepCount || 0),
        kcal: acc.kcal + (e.entryData?.energyConsumption || 0) / 4184, // joules → kcal
      }),
      { steps: 0, kcal: 0 }
    );
}

// Meilleure prédiction 10 km parmi les courses récentes (formule de Riegel).
function bestPredicted10k() {
  if (!data.workouts) return null;
  const runs = data.workouts.filter((w) => w.activityId === 1 && w.totalDistance > 1000 && w.totalTime > 0);
  if (!runs.length) return null;
  const REF = 10000;
  let best = Infinity;
  runs.forEach((w) => {
    const t = w.totalTime * Math.pow(REF / w.totalDistance, 1.06);
    if (t < best) best = t;
  });
  return best;
}

// ---------------------------------------------------------------------------
// Catalogue des KPI disponibles. `value()` renvoie une chaîne, ou null quand
// la donnée n'est pas encore là (la tuile affiche alors « — »). `label` peut
// être une chaîne ou une fonction (label dynamique, ex. nombre de séances).
// ---------------------------------------------------------------------------
const CATALOG = [
  {
    id: "recovery", label: "Récupération", icon: "zap",
    accent: "var(--signal)", defaultOn: true, featured: true,
    value: () => (data.recovery?.balance != null ? Math.round(data.recovery.balance * 100) + "%" : null),
  },
  {
    id: "sleep", label: "Sommeil (dernière nuit)", icon: "moon",
    accent: "var(--route)", defaultOn: true,
    value: () => (data.sleepNight ? formatDuration(data.sleepNight.duration) : null),
  },
  {
    id: "sleepQuality", label: "Qualité de sommeil", icon: "sparkles",
    accent: "var(--accent-gold)", defaultOn: true,
    value: () => (data.sleepNight?.quality != null ? Math.round(data.sleepNight.quality * 100) + "%" : null),
  },
  {
    id: "week", icon: "calendar", accent: "var(--accent-sky)", defaultOn: true,
    label: () => {
      const s = weekStats();
      return s ? `Cette semaine · ${s.count} séance${s.count > 1 ? "s" : ""}` : "Cette semaine";
    },
    value: () => {
      const s = weekStats();
      return s ? formatDistance(s.distance) : null;
    },
  },
  {
    id: "monthDistance", label: "Distance (ce mois)", icon: "activity",
    accent: "var(--signal)", defaultOn: true,
    value: () => {
      const d = monthDistance();
      return d != null ? formatDistance(d) : null;
    },
  },
  {
    id: "restingHr", label: "FC au repos (nuit)", icon: "heart",
    accent: "var(--danger)", defaultOn: true,
    value: () => (data.sleepNight?.hrMin != null ? Math.round(data.sleepNight.hrMin) + " bpm" : null),
  },
  {
    id: "hrv", label: "VFC (nuit)", icon: "pulse",
    accent: "var(--accent-sky)", defaultOn: false,
    value: () => (data.sleepNight?.avgHrv != null ? Math.round(data.sleepNight.avgHrv) + " ms" : null),
  },
  {
    id: "deepSleep", label: "Sommeil profond", icon: "moon",
    accent: "var(--accent-sky)", defaultOn: false,
    value: () => (data.sleepNight?.deepSleepDuration != null ? formatDuration(data.sleepNight.deepSleepDuration) : null),
  },
  {
    id: "remSleep", label: "Sommeil paradoxal (REM)", icon: "sparkles",
    accent: "var(--accent-gold)", defaultOn: false,
    value: () => (data.sleepNight?.remSleepDuration != null ? formatDuration(data.sleepNight.remSleepDuration) : null),
  },
  {
    id: "steps", label: "Pas (aujourd'hui)", icon: "activity",
    accent: "var(--signal)", defaultOn: false,
    value: () => {
      const a = todayActivity();
      return a ? Math.round(a.steps).toLocaleString("fr-FR") : null;
    },
  },
  {
    id: "energy", label: "Énergie (aujourd'hui)", icon: "zap",
    accent: "var(--danger)", defaultOn: false,
    value: () => {
      const a = todayActivity();
      return a ? Math.round(a.kcal).toLocaleString("fr-FR") + " kcal" : null;
    },
  },
  {
    id: "racePrediction", label: "Prédiction 10 km", icon: "target",
    accent: "var(--accent-gold)", defaultOn: false,
    value: () => {
      const t = bestPredicted10k();
      return t != null ? formatClock(t) : null;
    },
  },
];

const CATALOG_IDS = new Set(CATALOG.map((k) => k.id));
const DEFAULT_SELECTION = CATALOG.filter((k) => k.defaultOn).map((k) => k.id);

// ---------------------------------------------------------------------------
// Sélection persistée.
// ---------------------------------------------------------------------------
function loadSelection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_SELECTION];
    const ids = JSON.parse(raw).filter((id) => CATALOG_IDS.has(id));
    return ids.length ? ids.slice(0, MAX_KPIS) : [...DEFAULT_SELECTION];
  } catch {
    return [...DEFAULT_SELECTION];
  }
}

function saveSelection(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* stockage indisponible (navigation privée…) : on garde la sélection en mémoire */
  }
}

let selection = loadSelection();
let panelOpen = false;

const labelOf = (k) => (typeof k.label === "function" ? k.label() : k.label);

// ---------------------------------------------------------------------------
// Rendu.
// ---------------------------------------------------------------------------
function tileHtml(k) {
  const val = k.value();
  return `
    <div class="stat-tile${k.featured ? " featured" : ""}" style="--tile-accent: ${k.accent};">
      <span class="tile-icon">${icon(k.icon, k.featured ? 18 : 18)}</span>
      <div class="value">${val != null ? escapeHtml(val) : "—"}</div>
      <div class="label">${escapeHtml(labelOf(k))}</div>
    </div>`;
}

function panelHtml() {
  const rows = CATALOG.map((k) => {
    const checked = selection.includes(k.id);
    const disabled = !checked && selection.length >= MAX_KPIS;
    return `
      <label class="kpi-option${disabled ? " is-disabled" : ""}">
        <input type="checkbox" data-kpi="${k.id}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}>
        <span class="kpi-option-icon" style="--tile-accent: ${k.accent};">${icon(k.icon, 16)}</span>
        <span class="kpi-option-name">${escapeHtml(labelOf(k))}</span>
        <span class="kpi-option-check">${icon("check", 15)}</span>
      </label>`;
  }).join("");
  return `
    <div class="kpi-config-panel" id="kpi-config-panel" role="dialog" aria-label="Choix des indicateurs">
      <div class="kpi-config-head">
        <span>Indicateurs affichés</span>
        <span class="kpi-config-count">${selection.length}/${MAX_KPIS}</span>
        <button type="button" class="kpi-config-close" id="kpi-config-close" aria-label="Fermer">${icon("close", 16)}</button>
      </div>
      <div class="kpi-config-list">${rows}</div>
    </div>`;
}

export function renderKpiTiles() {
  if (!grid) return;

  if (data.error && !data.recovery && !data.sleepNight) {
    grid.innerHTML = `<div class="empty"><span class="empty-icon">${icon("alertTriangle", 28)}</span>${escapeHtml(data.error)}</div>`;
    return;
  }

  const tiles = selection
    .map((id) => CATALOG.find((k) => k.id === id))
    .filter(Boolean)
    .map(tileHtml)
    .join("");

  const addTile = `
    <button type="button" class="stat-tile kpi-add-tile" id="kpi-add-tile" aria-haspopup="dialog" aria-expanded="${panelOpen}">
      <span class="tile-icon">${icon("plus", 18)}</span>
      <div class="label">Ajouter / retirer</div>
    </button>`;

  grid.innerHTML = tiles + addTile + (panelOpen ? panelHtml() : "");
  wirePanel();
}

function wirePanel() {
  const addBtn = document.getElementById("kpi-add-tile");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      panelOpen = !panelOpen;
      renderKpiTiles();
    });
  }
  if (!panelOpen) return;

  document.getElementById("kpi-config-close")?.addEventListener("click", () => {
    panelOpen = false;
    renderKpiTiles();
  });

  document.querySelectorAll("#kpi-config-panel input[data-kpi]").forEach((input) => {
    input.addEventListener("change", (e) => {
      const id = e.target.dataset.kpi;
      if (e.target.checked) {
        if (selection.length >= MAX_KPIS) { e.target.checked = false; return; }
        // On respecte l'ordre du catalogue pour un affichage stable.
        selection = CATALOG.filter((k) => selection.includes(k.id) || k.id === id).map((k) => k.id);
      } else {
        selection = selection.filter((x) => x !== id);
      }
      saveSelection(selection);
      renderKpiTiles();
    });
  });
}

// ---------------------------------------------------------------------------
// API pour les autres modules.
// ---------------------------------------------------------------------------
export function updateKpiData(patch) {
  Object.assign(data, patch);
  if (patch.error === undefined && (patch.recovery || patch.sleepNight)) data.error = null;
  renderKpiTiles();
}
