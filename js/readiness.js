// js/readiness.js
//
// Widget "Forme du jour" : croise récupération, sommeil et charge
// d'entraînement récente en un score 0–100 assorti d'une reco
// actionnable. C'est un indicateur d'aide, volontairement formulé en
// suggestion ("vise…", "si tu le sens") plutôt qu'en ordre — quand le
// score se trompe, un conseil prudent vieillit mieux qu'un ordre.
//
// Les données arrivent de deux loaders indépendants (wellness.js et
// workouts.js) qui poussent chacun leur part via un setter ; on rend dès
// qu'au moins un signal est disponible, en dégradant proprement les
// signaux manquants (repondération sur ceux présents).
import { icon, ACTIVITY_NAMES } from "./icons.js";
import { formatDuration } from "./format.js";
import { computeTrimp, resolveMaxHr } from "./training-load.js";

let recoveryBalance = null; // 0..1
let sleepDuration = null; // secondes
let sleepQuality = null; // 0..1
let workouts = null;
let wellnessReceived = false;
let workoutsReceived = false;

const card = document.getElementById("readiness-card");

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function updateReadinessWellness({ recovery = null, sleepDuration: dur = null, sleepQuality: qual = null } = {}) {
  recoveryBalance = recovery;
  sleepDuration = dur;
  sleepQuality = qual;
  wellnessReceived = true;
  render();
}

export function updateReadinessWorkouts(list) {
  workouts = list || [];
  workoutsReceived = true;
  render();
}

// Sommeil : 60 % durée (4 h → 20, 8 h → 100), 40 % qualité brute.
function sleepScoreFrom(dur, qual) {
  if (dur == null && qual == null) return null;
  const durScore = dur != null ? clamp(((dur / 3600 - 4) / 4) * 80 + 20, 0, 100) : null;
  const qualScore = qual != null ? qual * 100 : null;
  if (durScore != null && qualScore != null) return 0.6 * durScore + 0.4 * qualScore;
  return durScore != null ? durScore : qualScore;
}

// Charge : ratio charge aiguë (7 j) / charge chronique hebdomadaire
// moyenne. La charge par séance est le TRIMP par zone (dose pondérée par
// l'intensité, socle training-load) ; le score étant un ratio, il est
// invariant d'échelle — passer du proxy durée×FC au vrai TRIMP ne change pas
// le calibrage. Frais ou équilibré → prêt (score haut) ; surcharge → fatigue.
function loadScoreFrom(list) {
  if (!list || !list.length) return { score: null, ratio: null };
  const now = Date.now();
  const DAY = 86400000;
  const { maxHr } = resolveMaxHr(list); // FCmax fiabilisée du corpus
  let acute = 0;
  let total = 0;
  let oldest = now;
  list.forEach((w) => {
    const t = new Date(w.startTime).getTime();
    if (Number.isNaN(t)) return;
    // TRIMP par zone ; repli sur la durée seule si aucune donnée FC, pour ne
    // pas ignorer purement et simplement la séance.
    const trimp = computeTrimp(w, { maxHr }).value;
    const unit = trimp > 0 ? trimp : (w.totalTime || 0) / 60;
    total += unit;
    if ((now - t) / DAY <= 7) acute += unit;
    if (t < oldest) oldest = t;
  });
  const spanWeeks = Math.max((now - oldest) / DAY / 7, 1);
  const chronicWeekly = total / spanWeeks;
  if (chronicWeekly <= 0) return { score: null, ratio: null };
  const ratio = acute / chronicWeekly;
  return { score: clamp(100 - Math.max(0, ratio - 1) * 55, 0, 100), ratio };
}

// Effort récent : malus temporaire appliqué au score juste après une
// séance, pour coller au ressenti de fatigue immédiate. Ampleur = durée ×
// intensité (FC), décroissance linéaire sur une fenêtre de 3–8 h (plus la
// séance est grosse, plus la fenêtre est longue), retour à 0 ensuite.
function recentEffort(list) {
  if (!list || !list.length) return null;
  const now = Date.now();
  let latest = null;
  let latestT = -Infinity;
  list.forEach((w) => {
    const t = new Date(w.startTime).getTime();
    if (!Number.isNaN(t) && t > latestT) {
      latestT = t;
      latest = w;
    }
  });
  if (!latest) return null;

  const mins = (latest.totalTime || 0) / 60;
  const hr = latest.hrdata?.workoutAvgHR;
  const intensity = hr ? clamp(hr / 150, 0.6, 1.6) : 1;
  const effort = mins * intensity;
  const endMs = latestT + (latest.totalTime || 0) * 1000;
  const hoursSince = (now - endMs) / 3600000;
  const windowH = clamp(3 + effort / 25, 3, 8);
  if (hoursSince >= windowH || hoursSince < -0.1) return null; // trop ancienne / future

  const factor = clamp(1 - hoursSince / windowH, 0, 1);
  const penalty = clamp(effort / 5, 6, 18) * factor;
  const d = new Date(latestT);
  const today = new Date();
  const isToday =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return { workout: latest, penalty, remainingH: Math.max(1, Math.ceil(windowH - hoursSince)), isToday };
}

function signalBar(label, score) {
  if (score == null) {
    return `<div class="signal"><div class="signal-top"><span>${label}</span><span class="signal-val">—</span></div><div class="signal-track"><div class="signal-fill" style="width:0"></div></div></div>`;
  }
  const s = Math.round(score);
  return `<div class="signal"><div class="signal-top"><span>${label}</span><span class="signal-val">${s}</span></div><div class="signal-track"><div class="signal-fill" style="width:${s}%"></div></div></div>`;
}

function render() {
  if (!card) return;
  if (!wellnessReceived && !workoutsReceived) return; // garde le squelette

  const recScore = recoveryBalance != null ? recoveryBalance * 100 : null;
  const slpScore = sleepScoreFrom(sleepDuration, sleepQuality);
  const load = loadScoreFrom(workouts);
  const ldScore = load.score;
  const effort = recentEffort(workouts);

  const comps = [
    { label: "Récupération", score: recScore, weight: 0.45 },
    { label: "Sommeil", score: slpScore, weight: 0.35 },
    { label: "Charge", score: ldScore, weight: 0.2 },
  ];
  const present = comps.filter((c) => c.score != null);

  if (!present.length) {
    // Rien d'exploitable : on n'affiche le vide qu'une fois les deux
    // sources revenues, pour ne pas flasher un état vide transitoire.
    if (wellnessReceived && workoutsReceived) {
      card.innerHTML = `<div class="empty"><span class="empty-icon">${icon("gauge", 28)}</span>Pas encore assez de données pour évaluer ta forme du jour.</div>`;
    }
    return;
  }

  const totalW = present.reduce((s, c) => s + c.weight, 0);
  const baseScore = present.reduce((s, c) => s + c.score * c.weight, 0) / totalW;
  // Malus post-séance (option B) appliqué avant le calcul de l'état, pour
  // que la couleur et l'étiquette reflètent la fatigue immédiate.
  const score = Math.round(clamp(baseScore - (effort ? effort.penalty : 0), 0, 100));

  let level;
  let accent;
  let stateLabel;
  let reco;
  if (score >= 66) {
    level = "fresh";
    accent = "var(--route)";
    stateLabel = "Reposé";
    reco = "Bon jour pour une séance intense — fractionné ou seuil, si tu le sens.";
  } else if (score >= 45) {
    level = "neutral";
    accent = "var(--accent-gold)";
    stateLabel = "Neutre";
    reco = "Vise une séance modérée : endurance ou footing facile en Z2.";
  } else {
    level = "tired";
    accent = "var(--signal)";
    stateLabel = "Fatigué";
    reco = "Lève le pied — repos ou sortie très facile en récupération active.";
  }

  // Séance récente : le stimulus est pris, on remplace la reco "va
  // t'entraîner" par un message d'assimilation qui référence la séance.
  // Ton prudent : on ne bloque pas la double-séance.
  if (effort) {
    stateLabel = "Séance encaissée";
    const name = (ACTIVITY_NAMES[effort.workout.activityId] || "séance").toLowerCase();
    const dur = formatDuration(effort.workout.totalTime || 0);
    const dayWord = effort.isToday ? "aujourd'hui" : "récemment";
    reco = `Déjà ${dur} de ${name} ${dayWord} — laisse ton corps assimiler : repos ou récup active (marche, mobilité). Si tu remets ça, garde-la facile.`;
  }

  // Raison en une ligne = transparence, sur laquelle repose la
  // confiance. Reposé → on met en avant les points forts ; sinon les
  // freins (facteurs les plus bas).
  const factors = [];
  if (recScore != null) {
    const pct = Math.round(recoveryBalance * 100);
    factors.push({ score: recScore, good: `récup à ${pct} %`, bad: `récupération basse (${pct} %)` });
  }
  if (slpScore != null) {
    const durTxt = sleepDuration != null ? formatDuration(sleepDuration) : `qualité ${Math.round(sleepQuality * 100)} %`;
    const shortNight = sleepDuration != null && sleepDuration / 3600 < 6.5;
    factors.push({ score: slpScore, good: `nuit de ${durTxt}`, bad: shortNight ? `nuit courte (${durTxt})` : "sommeil de qualité moyenne" });
  }
  if (ldScore != null) {
    factors.push({ score: ldScore, good: "charge maîtrisée", bad: "charge élevée cette semaine" });
  }
  const sorted = [...factors].sort((a, b) => a.score - b.score);
  let reason;
  if (effort && effort.penalty >= 1) {
    reason = `Score abaissé après l'effort — il remonte d'ici ~${effort.remainingH} h.`;
  } else if (level === "fresh") {
    reason = "Points forts : " + [...sorted].reverse().slice(0, 2).map((f) => f.good).join(" · ");
  } else {
    const neg = sorted.filter((f) => f.score < 60).slice(0, 2);
    reason = (neg.length ? "À surveiller : " : "Bilan : ") + (neg.length ? neg.map((f) => f.bad) : sorted.slice(0, 1).map((f) => f.good)).join(" · ");
  }

  const R = 40;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - score / 100);

  card.style.setProperty("--ready-accent", accent);
  card.innerHTML = `
    <div class="readiness-head">
      <span class="tile-icon">${icon("gauge", 18)}</span>
      <span class="readiness-title">Forme du jour</span>
    </div>
    <div class="readiness-main">
      <div class="readiness-gauge">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="gauge-bg" cx="50" cy="50" r="${R}"></circle>
          <circle class="gauge-fg" cx="50" cy="50" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
        </svg>
        <div class="gauge-label"><span class="gauge-score">${score}</span><span class="gauge-max">/100</span></div>
      </div>
      <div class="readiness-body">
        <div class="readiness-state">${stateLabel}</div>
        <div class="readiness-reco">${reco}</div>
        <div class="readiness-reason">${reason}</div>
      </div>
    </div>
    <div class="readiness-signals">
      ${comps.map((c) => signalBar(c.label, c.score)).join("")}
    </div>
  `;
}
