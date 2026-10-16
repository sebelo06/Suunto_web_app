// js/workout-plan.js
//
// Modèle d'une séance planifiée — Horizon 6 de la feuille de route. Module PUR
// (aucun accès au DOM ni au réseau) : il se teste sous Node et ne connaît rien
// de Suunto ; la traduction vers le format Guide vit dans guide-export.js.
//
// Une séance est une suite d'éléments, chacun étant :
//   - une étape  { type:"step", kind, duration, target }
//   - ou une répétition { type:"repeat", times, steps:[étape…] } (un seul niveau :
//     les répétitions imbriquées n'existent pas dans le format Guide de Suunto).
//
//   duration : { type:"time", seconds } | { type:"distance", meters }
//   target   : { type:"hrZone", zone:1..5 }            zone FC (bornes réglables)
//            | { type:"hr", min, max }                  fourchette FC en bpm
//            | { type:"pace", fast, slow }              allure en s/km
//            | { type:"none" }
import { HR_ZONE_WEIGHTS, zoneBoundsPct, readHrZoneThresholds } from "./training-load.js";

export const STEP_KINDS = {
  warmup: { label: "Échauffement", defaultZone: 1 },
  work: { label: "Effort", defaultZone: 4 },
  recovery: { label: "Récupération", defaultZone: 1 },
  cooldown: { label: "Retour au calme", defaultZone: 1 },
  steady: { label: "Endurance", defaultZone: 2 },
};

const Z1_FLOOR_PCT = 50;
export const DEFAULT_PACE_SEC_PER_KM = 330; // repli quand une étape est en distance sans allure connue

// --- Fabriques --------------------------------------------------------------

export const minutes = (m) => ({ type: "time", seconds: Math.round(m * 60) });
export const meters = (m) => ({ type: "distance", meters: Math.round(m) });
export const zone = (z) => ({ type: "hrZone", zone: z });

export function step(kind, duration, target) {
  return { type: "step", kind, duration, target: target || zone(STEP_KINDS[kind]?.defaultZone ?? 2) };
}
export function repeat(times, steps) {
  return { type: "repeat", times, steps };
}

// Séances types. Fonctions (et non constantes) pour livrer des copies neuves
// que l'éditeur peut muter sans abîmer le modèle.
export const TEMPLATES = [
  {
    id: "easy",
    label: "Footing facile",
    blurb: "45 min en endurance fondamentale",
    build: () => ({ name: "Footing facile", steps: [step("steady", minutes(45), zone(2))] }),
  },
  {
    id: "threshold",
    label: "Seuil 3×10'",
    blurb: "3 blocs de 10 min en zone 4",
    build: () => ({
      name: "Seuil 3x10 min",
      steps: [
        step("warmup", minutes(15), zone(2)),
        repeat(3, [step("work", minutes(10), zone(4)), step("recovery", minutes(3), zone(2))]),
        step("cooldown", minutes(10), zone(1)),
      ],
    }),
  },
  {
    id: "short-intervals",
    label: "Fractionné 10×400 m",
    blurb: "10 courtes accélérations en zone 5",
    build: () => ({
      name: "Fractionne 10x400 m",
      steps: [
        step("warmup", minutes(15), zone(2)),
        repeat(10, [step("work", meters(400), zone(5)), step("recovery", minutes(1.5), zone(1))]),
        step("cooldown", minutes(10), zone(1)),
      ],
    }),
  },
  {
    id: "hills",
    label: "Côtes 8×1'",
    blurb: "8 côtes courtes, descente en récupération",
    build: () => ({
      name: "Cotes 8x1 min",
      steps: [
        step("warmup", minutes(15), zone(2)),
        repeat(8, [step("work", minutes(1), zone(5)), step("recovery", minutes(1.5), zone(1))]),
        step("cooldown", minutes(10), zone(1)),
      ],
    }),
  },
  {
    id: "long",
    label: "Sortie longue",
    blurb: "1 h 45 en endurance, dernier quart plus soutenu",
    build: () => ({
      name: "Sortie longue 1h45",
      steps: [step("steady", minutes(80), zone(2)), step("steady", minutes(25), zone(3))],
    }),
  },
];

export function newPlanFrom(templateId) {
  const t = TEMPLATES.find((x) => x.id === templateId) || TEMPLATES[0];
  return t.build();
}

// --- Lecture du plan --------------------------------------------------------

// Étapes dans l'ordre d'exécution, répétitions dépliées.
export function flattenPlan(plan) {
  const out = [];
  for (const item of plan?.steps || []) {
    if (item.type === "repeat") {
      for (let i = 0; i < (item.times || 0); i++) out.push(...item.steps);
    } else {
      out.push(item);
    }
  }
  return out;
}

// Secondes d'une étape. Une étape en distance a besoin d'une allure pour être
// convertie en temps ; à défaut on prend celle du repli.
export function stepSeconds(st, paceSecPerKm = DEFAULT_PACE_SEC_PER_KM) {
  if (st.duration?.type === "time") return st.duration.seconds || 0;
  if (st.duration?.type === "distance") return ((st.duration.meters || 0) / 1000) * paceSecPerKm;
  return 0;
}

export function planSeconds(plan, paceSecPerKm) {
  return flattenPlan(plan).reduce((s, st) => s + stepSeconds(st, paceSecPerKm), 0);
}

export function planMeters(plan, paceSecPerKm = DEFAULT_PACE_SEC_PER_KM) {
  return flattenPlan(plan).reduce((s, st) => {
    if (st.duration?.type === "distance") return s + (st.duration.meters || 0);
    return s + (stepSeconds(st, paceSecPerKm) / paceSecPerKm) * 1000;
  }, 0);
}

// --- Cibles de FC -----------------------------------------------------------

// Fourchette de FC (bpm) d'une cible, ou null si elle n'est pas exprimable en FC
// (allure, aucune cible) ou si la FCmax manque pour une zone. `thresholds` : les
// 4 bornes en % de FCmax — mêmes réglages que le détail de séance.
export function resolveHrRange(target, { maxHr, thresholds = readHrZoneThresholds() } = {}) {
  if (!target) return null;
  if (target.type === "hr") {
    const lo = Math.round(Math.min(target.min, target.max));
    const hi = Math.round(Math.max(target.min, target.max));
    return { min: lo, max: hi, mid: Math.round((lo + hi) / 2) };
  }
  if (target.type === "hrZone" && maxHr) {
    const b = zoneBoundsPct(thresholds);
    const z = Math.min(5, Math.max(1, target.zone));
    // Zone 1 : la borne basse théorique est 0 %, inexploitable sur une jauge de
    // montre ; on la relève à 50 % de la FCmax (repos actif).
    const lo = Math.round(((z === 1 ? Math.max(b[0], Z1_FLOOR_PCT) : b[z - 1]) / 100) * maxHr);
    const hi = Math.round((b[z] / 100) * maxHr);
    return { min: lo, max: hi, mid: Math.round((lo + hi) / 2) };
  }
  return null;
}

// Zone FC (1..5) effectivement visée par une étape : sert à la couleur de
// l'aperçu et au TRIMP prévisionnel.
export function stepZone(st, { maxHr, thresholds = readHrZoneThresholds() } = {}) {
  const t = st.target;
  if (t?.type === "hrZone") return Math.min(5, Math.max(1, t.zone));
  if (t?.type === "hr" && maxHr) {
    const pct = ((t.min + t.max) / 2 / maxHr) * 100;
    const bounds = zoneBoundsPct(thresholds);
    for (let z = 1; z <= 5; z++) if (pct < bounds[z]) return z;
    return 5;
  }
  return STEP_KINDS[st.kind]?.defaultZone ?? 2;
}

// --- Charge prévisionnelle --------------------------------------------------

// TRIMP d'Edwards prévisionnel : Σ minutes × poids de la zone visée — la même
// formule que computeTrimp sur une séance réalisée, pour que prévu et réalisé
// soient comparables (jalon J6).
export function estimateTrimp(plan, opts = {}) {
  return flattenPlan(plan).reduce(
    (sum, st) => sum + (stepSeconds(st, opts.paceSecPerKm) / 60) * HR_ZONE_WEIGHTS[stepZone(st, opts) - 1],
    0
  );
}

// Temps prévu par zone [z1..z5] en secondes, pour l'aperçu.
export function timeByZone(plan, opts = {}) {
  const out = [0, 0, 0, 0, 0];
  for (const st of flattenPlan(plan)) out[stepZone(st, opts) - 1] += stepSeconds(st, opts.paceSecPerKm);
  return out;
}

// ACWR si on ajoutait `trimp` à la série de charge quotidienne (celle de
// buildDailyLoad, qui s'arrête aujourd'hui), `dayOffset` jours plus tard
// (0 = aujourd'hui, 1 = demain…). `computeAcwr` est injecté pour garder ce
// module sans dépendance au reste de l'app.
// Renvoie { today, baseline, after } :
//   today    ACWR d'aujourd'hui ;
//   baseline ACWR ce jour-là SANS la séance (la fenêtre glisse : une grosse
//            séance d'il y a 6 jours sort de la charge aiguë, donc le ratio peut
//            baisser tout seul) ;
//   after    ACWR ce jour-là AVEC la séance. C'est baseline → after qui mesure
//            l'effet de la séance, pas today → after.
export function projectAcwr(series, trimp, dayOffset, computeAcwr) {
  const base = Array.isArray(series) ? series.map((d) => ({ ...d })) : [];
  if (!base.length) return { today: null, baseline: null, after: null };
  const today = computeAcwr(base).ratio;

  const targetIdx = base.length - 1 + Math.max(0, dayOffset);
  while (base.length <= targetIdx) base.push({ date: null, trimp: 0, active: false });
  const baseline = computeAcwr(base, targetIdx).ratio;
  base[targetIdx] = { ...base[targetIdx], trimp: (base[targetIdx].trimp || 0) + trimp };
  return { today, baseline, after: computeAcwr(base, targetIdx).ratio };
}

// --- Validation -------------------------------------------------------------

export function validatePlan(plan) {
  const errors = [];
  const checkStep = (st, where) => {
    if (!STEP_KINDS[st.kind]) errors.push(`${where} : type d'étape inconnu`);
    const d = st.duration;
    if (d?.type === "time" && !(d.seconds >= 5)) errors.push(`${where} : durée trop courte (5 s minimum)`);
    else if (d?.type === "distance" && !(d.meters >= 50)) errors.push(`${where} : distance trop courte (50 m minimum)`);
    else if (!d || !["time", "distance"].includes(d.type)) errors.push(`${where} : durée manquante`);
    const t = st.target;
    if (t?.type === "hr" && !(t.min > 0 && t.max >= t.min)) errors.push(`${where} : fourchette de FC invalide`);
    if (t?.type === "pace" && !(t.fast > 0 && t.slow >= t.fast)) errors.push(`${where} : fourchette d'allure invalide`);
  };
  if (!plan?.steps?.length) errors.push("La séance n'a aucune étape.");
  (plan?.steps || []).forEach((item, i) => {
    const where = `Étape ${i + 1}`;
    if (item.type === "repeat") {
      if (!Number.isInteger(item.times) || item.times < 1 || item.times > 100) errors.push(`${where} : nombre de répétitions entre 1 et 100`);
      if (!item.steps?.length) errors.push(`${where} : la répétition est vide`);
      (item.steps || []).forEach((s, j) => checkStep(s, `${where}.${j + 1}`));
    } else {
      checkStep(item, where);
    }
  });
  return errors;
}

// Libellé court d'une durée pour les titres et descriptions.
export function describeDuration(d) {
  if (d?.type === "distance") return d.meters >= 1000 ? `${(d.meters / 1000).toFixed(1).replace(/\.0$/, "")} km` : `${d.meters} m`;
  const s = d?.seconds || 0;
  if (s % 60 === 0) return `${s / 60} min`;
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// Récapitulatif en texte brut, à recopier dans le constructeur de séances de
// l'app Suunto (section Watch) : une ligne par étape, cible en bpm quand la FC
// max est connue.
export function planToText(plan, opts = {}) {
  const line = (st) => {
    const t = st.target;
    const r = resolveHrRange(t, opts);
    let target = "sans cible";
    if (t?.type === "hrZone") target = r ? `FC ${r.min}-${r.max} bpm (zone ${t.zone})` : `zone ${t.zone}`;
    else if (t?.type === "hr") target = `FC ${r.min}-${r.max} bpm`;
    else if (t?.type === "pace") {
      const f = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
      target = `allure ${f(t.fast)}-${f(t.slow)} /km`;
    }
    return `${STEP_KINDS[st.kind]?.label ?? st.kind} - ${describeDuration(st.duration)} - ${target}`;
  };
  const out = [];
  let n = 1;
  for (const item of plan.steps || []) {
    if (item.type === "repeat") {
      out.push(`${n}. Répéter ${item.times} fois :`);
      item.steps.forEach((s, j) => out.push(`   ${String.fromCharCode(97 + j)}. ${line(s)}`));
    } else {
      out.push(`${n}. ${line(item)}`);
    }
    n += 1;
  }
  return `${plan.name || "Séance"}\n${out.join("\n")}`;
}

// --- Suggestion de la séance du jour ---------------------------------------

// Choisit un modèle selon la fraîcheur, la charge et les séances intenses
// récentes. Règles volontairement simples et lisibles : chaque suggestion
// renvoie les raisons chiffrées qui l'ont motivée, pour pouvoir la contester.
//   readiness          score « Forme du jour » 0-100, ou null
//   acwr               ratio charge aiguë / chronique, ou null
//   hardSessionsLast7  nombre de séances majoritairement en zones 4-5 sur 7 jours
//   hoursSinceHard     heures depuis la dernière séance intense, ou null
// Renvoie { templateId, reasons[], alternatives[], lowConfidence }.
export function suggestSession({ readiness = null, acwr = null, hardSessionsLast7 = 0, hoursSinceHard = null } = {}) {
  const fmt = (v) => v.toFixed(2).replace(".", ",");
  const reasons = [];
  const easy = (why) => ({ templateId: "easy", reasons: [...reasons, why], alternatives: [], lowConfidence: false });

  if (readiness == null && acwr == null) {
    return { templateId: "easy", reasons: ["Données de forme et de charge indisponibles : proposition prudente."], alternatives: [], lowConfidence: true };
  }
  if (readiness != null) reasons.push(`Forme du jour ${readiness}/100`);
  if (acwr != null) reasons.push(`ACWR ${fmt(acwr)}`);

  if (acwr != null && acwr > 1.5) return easy("charge récente trop élevée : jour facile pour redescendre");
  if (readiness != null && readiness < 45) return easy("forme basse : privilégie la récupération");
  if (hoursSinceHard != null && hoursSinceHard < 36) return easy(`séance intense il y a ${Math.round(hoursSinceHard)} h : laisse le corps assimiler`);
  if (acwr != null && acwr > 1.3) return easy("charge en zone de prudence : évite d'ajouter de l'intensité");
  if (hardSessionsLast7 >= 3) return easy(`déjà ${hardSessionsLast7} séances intenses cette semaine`);

  const underloaded = acwr != null && acwr < 0.8;
  if (readiness != null && readiness >= 66) {
    // Frais et charge maîtrisée : on peut placer de l'intensité ; le type tourne
    // selon ce qui a déjà été fait cette semaine.
    const order = ["threshold", "short-intervals", "hills"];
    const templateId = hardSessionsLast7 >= 2 ? "long" : order[hardSessionsLast7];
    if (underloaded) reasons.push("charge basse : tu peux monter");
    return {
      templateId,
      reasons: [...reasons, hardSessionsLast7 === 0 ? "aucune séance intense récente" : `${hardSessionsLast7} séance(s) intense(s) cette semaine`],
      alternatives: ["threshold", "short-intervals", "hills", "long"].filter((id) => id !== templateId),
      lowConfidence: false,
    };
  }
  // Forme moyenne (ou seule la charge est connue) : du volume facile plutôt que de l'intensité.
  return {
    templateId: underloaded ? "long" : "easy",
    reasons: [...reasons, underloaded ? "charge basse : une sortie plus longue à allure facile" : "forme moyenne : endurance facile"],
    alternatives: underloaded ? ["easy"] : ["long"],
    lowConfidence: readiness == null || acwr == null,
  };
}
