// js/training-load.js
//
// Socle de charge d'entraînement — Horizon 0 de la feuille de route.
// Deux briques dont dépendront tous les indicateurs de charge à venir
// (ACWR, CTL·ATL·TSB, monotonie…) :
//
//   1. FCmax fiabilisée — une valeur stable dérivée des données RÉELLES de
//      l'athlète, plutôt qu'un 220−âge théorique ou la FCmax de la seule
//      séance courante (qui varie d'une sortie à l'autre).
//   2. TRIMP par zone — la dose d'une séance, pondérée par l'intensité
//      (méthode d'Edwards : Σ minutes_zone × poids de zone).
//
// Tout est calculé sur les données déjà présentes dans l'app : `hrdata`,
// `timeInZone0..5` figés par la montre, et à défaut la FC moyenne de la
// séance. Aucune nouvelle intégration requise.

// --- Seuils de zones (source unique, partagée avec l'UI du détail) ----------
// Bornes entre Z1/Z2, Z2/Z3, Z3/Z4, Z4/Z5, en % de FC max. Configurables par
// l'usager et persistées en localStorage ; c'est la même clé que celle lue
// par l'onglet de détail de séance, pour que calcul et affichage ne divergent
// jamais.
export const DEFAULT_HR_ZONE_THRESHOLDS = [60, 70, 80, 90];
const HR_ZONE_THRESHOLDS_KEY = "suunto-hr-zone-thresholds";

export function readHrZoneThresholds() {
  try {
    const arr = JSON.parse(localStorage.getItem(HR_ZONE_THRESHOLDS_KEY) || "null");
    if (Array.isArray(arr) && arr.length === 4 && arr.every((n) => Number.isFinite(n))) return arr;
  } catch { /* ignore */ }
  return [...DEFAULT_HR_ZONE_THRESHOLDS];
}
export function writeHrZoneThresholds(arr) {
  try { localStorage.setItem(HR_ZONE_THRESHOLDS_KEY, JSON.stringify(arr)); } catch { /* ignore */ }
}

// Bornes complètes [0, ...seuils, 100] en % de FC max (longueur 6 → 5 zones).
export function zoneBoundsPct(thresholds = readHrZoneThresholds()) {
  return [0, ...thresholds, 100];
}

// Poids d'Edwards : Z1→1 … Z5→5. Une minute en Z5 « coûte » cinq fois une
// minute en Z1 — c'est ce qui distingue le TRIMP d'un simple cumul de durée.
export const HR_ZONE_WEIGHTS = [1, 2, 3, 4, 5];

// --- Répartition du temps par zone -----------------------------------------
// (helpers déplacés depuis workout-detail.js pour être partagés : le calcul
//  de charge et l'affichage des zones reposent désormais sur le même code.)

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
// répartition fournie par l'API pour ce type de séance/capteur). Dans ce cas
// on estime la répartition du temps par zone à partir d'une distribution
// normale centrée sur la FC moyenne (écart-type dérivé de l'écart avg/max) —
// approximation clairement signalée comme telle en aval.
export function estimateZoneTimes(w, maxHr, boundsPct) {
  const avg = w?.hrdata?.workoutAvgHR;
  const totalTime = w?.totalTime;
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
// (le plus précis, et recalculé selon les seuils choisis par l'usager,
// contrairement aux timeInZone figés par la montre). `samples` = [{ t, hr }].
export function sampleZoneTimes(samples, maxHr, boundsPct) {
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

// Répartition unifiée du temps (secondes) dans les 5 zones, par ordre de
// fiabilité décroissante. Renvoie { times:[5], method } ou null si aucune
// donnée FC exploitable.
//   - "samples"   : échantillons FC seconde/seconde (le plus exact) ;
//   - "zones"     : timeInZone0..5 figés par la montre (Z0 replié dans Z1) ;
//   - "estimated" : estimation gaussienne depuis la FC moyenne.
// Recale une répartition de temps par zone sur la durée RÉELLE de la séance.
// La somme des temps par zone ne peut pas dépasser la durée ; or les
// `timeInZone` figés par la montre ne sont PAS exprimés en secondes (une séance
// qui les porte gonfle la charge d'un facteur ~1000). `totalTime` est fiable
// (secondes — c'est la durée affichée au détail), on l'utilise comme référence.
// On ne recale que quand la somme dépasse nettement la durée (facteur > 1,5),
// pour ne pas toucher aux répartitions déjà cohérentes (échantillons FC,
// estimation) ni aux séances avec pauses (somme légèrement < durée).
function normalizeToDuration(times, totalTime) {
  const sum = times.reduce((a, b) => a + b, 0);
  const dur = Number(totalTime);
  if (sum > 0 && Number.isFinite(dur) && dur > 0 && sum > dur * 1.5) {
    const f = dur / sum;
    return times.map((s) => s * f);
  }
  return times;
}

export function zoneTimesFor(w, maxHr, thresholds = readHrZoneThresholds()) {
  const bounds = zoneBoundsPct(thresholds);

  let result = null;
  const fromSamples = sampleZoneTimes(w?.hrSamples, maxHr, bounds);
  if (fromSamples) {
    result = { times: fromSamples, method: "samples" };
  } else {
    const raw = ["timeInZone0", "timeInZone1", "timeInZone2", "timeInZone3", "timeInZone4", "timeInZone5"]
      .map((k) => Number(w?.[k]) || 0);
    if (raw.reduce((a, b) => a + b, 0) > 0) {
      // La montre expose 6 zones ; on replie Z0 (échauffement/repos) dans Z1
      // pour rester sur les 5 zones classiques du reste de l'app.
      result = { times: [raw[0] + raw[1], raw[2], raw[3], raw[4], raw[5]], method: "zones" };
    } else {
      const est = estimateZoneTimes(w, maxHr, bounds);
      if (est) result = { times: est, method: "estimated" };
    }
  }

  if (!result) return null;
  // Garde-fou d'unité, appliqué quelle que soit la source : la répartition doit
  // tenir dans la durée réelle de la séance (voir normalizeToDuration).
  result.times = normalizeToDuration(result.times, w?.totalTime);
  return result;
}

// --- FCmax fiabilisée -------------------------------------------------------

// Plage physiologiquement plausible d'une FC max humaine ; sert de garde-fou
// contre les valeurs aberrantes (capteur, artefact) des deux côtés.
const MAXHR_FLOOR = 120;
const MAXHR_CEIL = 220;
const plausible = (v) => Number.isFinite(v) && v >= MAXHR_FLOOR && v <= MAXHR_CEIL;

// FCmax fiabilisée à partir du corpus réel de séances. Ordre de préférence :
//   1. une FCmax explicitement réglée par l'athlète (hrdata.userMaxHR) ;
//   2. la plus haute FC réellement enregistrée sur l'ensemble des séances —
//      c'est une borne basse solide de la vraie FCmax, et le réel prime sur
//      la théorie.
// Si la FC observée dépasse le réglage utilisateur, on retient l'observée :
// un pic mesuré au-dessus du réglage signale un réglage périmé.
// Renvoie { maxHr, source } avec source ∈ {"user","observed","none"} ;
// maxHr vaut null quand rien de plausible n'est disponible (les appelants
// doivent dégrader proprement — pas de 220−âge inventé ici).
export function resolveMaxHr(workouts, current = null) {
  const list = Array.isArray(workouts) ? workouts : [];
  const pool = current ? [current, ...list] : list;

  const userMax = pool.map((w) => w?.hrdata?.userMaxHR).find(plausible);

  let observed = null;
  for (const w of pool) {
    const m = w?.hrdata?.workoutMaxHR;
    if (plausible(m) && (observed == null || m > observed)) observed = m;
  }

  if (plausible(userMax) && observed != null) {
    return observed > userMax
      ? { maxHr: observed, source: "observed" }
      : { maxHr: userMax, source: "user" };
  }
  if (plausible(userMax)) return { maxHr: userMax, source: "user" };
  if (observed != null) return { maxHr: observed, source: "observed" };
  return { maxHr: null, source: "none" };
}

// --- TRIMP par zone ---------------------------------------------------------

// TRIMP d'Edwards d'une séance : Σ (minutes passées en zone i) × poids_i.
// Une FCmax sert à placer les bornes de zones ; elle est inutile quand la
// montre fournit déjà timeInZone0..5. Renvoie { value, method, perZone } ;
// value=0 et method=null si aucune donnée FC n'est exploitable — au caller de
// décider d'un repli (durée seule, par ex.).
export function computeTrimp(w, { maxHr = null, thresholds = readHrZoneThresholds() } = {}) {
  const zt = zoneTimesFor(w, maxHr, thresholds);
  if (!zt) return { value: 0, method: null, perZone: [0, 0, 0, 0, 0] };
  const perZone = zt.times.map((sec, i) => (sec / 60) * HR_ZONE_WEIGHTS[i]);
  const value = perZone.reduce((a, b) => a + b, 0);
  return { value, method: zt.method, perZone };
}

// --- Historisation : série quotidienne continue de charge -------------------

// Clé de jour = date UTC (YYYY-MM-DD), cohérente avec la heatmap calendrier.
const dayKeyUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

// Série quotidienne CONTINUE de charge (TRIMP), du premier jour d'activité à
// aujourd'hui, avec les jours SANS séance à 0. C'est le socle « historique de
// charge » dont dépendent tous les indicateurs de l'Horizon 2 : ACWR,
// CTL·ATL·TSB et monotonie ont besoin d'une série continue — un jour de repos
// est une charge nulle, pas un trou (sans quoi les moyennes glissantes et les
// décroissances exponentielles sont fausses).
//
// La profondeur de la série est celle des séances fournies : passer plus
// d'historique (pagination) donne une série plus longue, sans changer ce code.
// Renvoie { series:[{ date, trimp, active }], activeDays, totalDays, from, to }.
export function buildDailyLoad(workouts, { maxHr, thresholds = readHrZoneThresholds() } = {}) {
  const dated = (Array.isArray(workouts) ? workouts : [])
    .map((w) => ({ t: new Date(w?.startTime).getTime(), w }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);

  if (!dated.length) return { series: [], activeDays: 0, totalDays: 0, from: null, to: null };

  // FCmax fiabilisée du corpus par défaut, pour que toutes les séances soient
  // évaluées avec les mêmes bornes de zones (comparabilité inter-séances).
  const resolvedMax = maxHr ?? resolveMaxHr(workouts).maxHr;

  // Somme du TRIMP par jour.
  const byDay = new Map();
  for (const { t, w } of dated) {
    const key = dayKeyUTC(t);
    const trimp = computeTrimp(w, { maxHr: resolvedMax, thresholds }).value;
    byDay.set(key, (byDay.get(key) || 0) + trimp);
  }

  // Remplissage continu du premier jour d'activité à aujourd'hui (UTC).
  const start = new Date(dated[0].t); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);

  const series = [];
  let activeDays = 0;
  for (const cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const key = cur.toISOString().slice(0, 10);
    const trimp = byDay.get(key) || 0;
    if (trimp > 0) activeDays += 1;
    series.push({ date: key, trimp, active: trimp > 0 });
  }

  return {
    series,
    activeDays,
    totalDays: series.length,
    from: series[0]?.date ?? null,
    to: series[series.length - 1]?.date ?? null,
  };
}

// --- ACWR (acute:chronic workload ratio) ------------------------------------

// Rapport charge aiguë (7 j) / charge chronique (moyenne hebdo sur 28 j),
// méthode "rolling average" (Gabbett) sur la série quotidienne continue.
// C'est le signal de risque de blessure le mieux établi : une charge aiguë qui
// s'emballe au-dessus de la base chronique précède le pic de blessures.
//   aiguë     = Σ TRIMP des 7 derniers jours
//   chronique = Σ TRIMP des 28 derniers jours ÷ 4  → charge hebdomadaire moyenne
//   ratio     = aiguë / chronique
export const ACWR_ACUTE_DAYS = 7;
export const ACWR_CHRONIC_DAYS = 28;

// Zones de lecture (consensus littérature) : la « sweet spot » 0,8–1,3 minimise
// le risque ; en dessous on se désentraîne, au-dessus le risque grimpe.
export function acwrStatus(ratio) {
  if (ratio == null) return { key: "none", label: "—" };
  if (ratio < 0.8) return { key: "low", label: "Sous-charge" };
  if (ratio <= 1.3) return { key: "optimal", label: "Optimal" };
  if (ratio <= 1.5) return { key: "watch", label: "Prudence" };
  return { key: "high", label: "Risque élevé" };
}

// Σ TRIMP sur les n derniers jours se terminant à l'index `end` (inclus).
function windowSum(series, end, n) {
  let s = 0;
  for (let i = Math.max(0, end - n + 1); i <= end; i++) s += series[i].trimp;
  return s;
}

// ACWR à une date (index dans la série continue ; par défaut le dernier jour).
// `reliable` est faux tant qu'on n'a pas 28 j d'historique avant ce point — le
// ratio existe mais reste indicatif (base chronique incomplète).
export function computeAcwr(series, endIndex = (series?.length ?? 0) - 1) {
  if (!series || !series.length || endIndex < 0) {
    return { ratio: null, acute: 0, chronic: 0, reliable: false, status: acwrStatus(null) };
  }
  const acute = windowSum(series, endIndex, ACWR_ACUTE_DAYS);
  const chronic = windowSum(series, endIndex, ACWR_CHRONIC_DAYS) / (ACWR_CHRONIC_DAYS / 7);
  const ratio = chronic > 0 ? acute / chronic : null;
  const reliable = endIndex + 1 >= ACWR_CHRONIC_DAYS && chronic > 0;
  return { ratio, acute, chronic, reliable, status: acwrStatus(ratio) };
}

// Trend jour par jour de l'ACWR (pour une courbe), à partir du moment où une
// charge chronique non nulle existe.
export function acwrTrend(series) {
  const out = [];
  if (!series) return out;
  for (let i = 0; i < series.length; i++) {
    const { ratio } = computeAcwr(series, i);
    if (ratio != null) out.push({ date: series[i].date, ratio });
  }
  return out;
}
