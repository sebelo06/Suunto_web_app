// js/guide-export.js
//
// Traduit une séance planifiée (workout-plan.js) en Guide SuuntoPlus : un
// `guide.json` (+ une icône 300×300) empaqueté en ZIP, installable depuis
// SuuntoPlus Editor. Format : apizone.suunto.com/suuntoplus-guide-description.
//
// Règles de traduction (toutes issues de la doc, vérifiées sur le simulateur) :
//   - une étape en durée / distance avance toute seule via une transition
//     `stepDuration` / `stepDistance` ; `stepId` est omis → « étape suivante » ;
//   - une étape sans transition attend l'appui manuel (dernière étape, ou durée
//     inconnue) ;
//   - les répétitions ne contiennent que des étapes simples (pas d'imbrication) ;
//   - tout texte affiché sur la montre est réduit à l'ASCII et tronqué : son jeu
//     de caractères est limité.
import { STEP_KINDS, describeDuration, resolveHrRange, flattenPlan } from "./workout-plan.js";

const LIMITS = { name: 60, description: 256, shortDescription: 23, owner: 64, stepTitle: 13, fieldTitle: 12, noteText: 54 };

// Accents et typographie → ASCII ; le reste de l'Unicode est retiré.
export function toWatchText(str, max) {
  const ascii = String(str ?? "")
    .replace(/[’‘`]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/×/g, "x")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return max ? ascii.slice(0, max).trim() : ascii;
}

function targetField(target, hr, title = "FC cible") {
  if (hr) return { type: "targetHeartRate", title: toWatchText(title, LIMITS.fieldTitle), value: hr.mid, min: hr.min, max: hr.max };
  if (target?.type === "pace") {
    // Le Guide exprime l'allure cible en vitesse (m/s) : min = le plus lent.
    const slow = 1000 / target.slow;
    const fast = 1000 / target.fast;
    return { type: "targetPace", title: toWatchText("Allure", LIMITS.fieldTitle), value: +((slow + fast) / 2).toFixed(3), min: +slow.toFixed(3), max: +fast.toFixed(3) };
  }
  return null;
}

// Étape du plan → étape "fields" du Guide.
function toFieldsStep(st, ctx, isLast) {
  const hr = resolveHrRange(st.target, ctx);
  const isTime = st.duration.type === "time";

  const fields = [
    isTime
      ? { type: "stepDurationCountdown", title: "Reste", value: st.duration.seconds }
      : { type: "stepDistanceCountdown", title: "Reste", value: st.duration.meters },
  ];
  const target = targetField(st.target, hr);
  if (target) fields.push(target);
  fields.push({ type: "heartRate", title: "FC moy", window: "manualLap", aggregate: "average" });

  const label = STEP_KINDS[st.kind]?.label ?? "Etape";
  const hrTxt = hr ? ` FC ${hr.min}-${hr.max}` : "";
  const out = {
    type: "fields",
    title: toWatchText(label, LIMITS.stepTitle),
    createManualLap: true,
    fields,
    notification: {
      title: toWatchText(label, LIMITS.stepTitle),
      text: toWatchText(`${describeDuration(st.duration)}${hrTxt}`, LIMITS.noteText),
    },
  };
  // Dernière étape du plan : pas de transition, l'athlète termine à la main.
  if (!isLast) {
    out.transitions = [{ condition: isTime ? { type: "stepDuration", value: st.duration.seconds } : { type: "stepDistance", value: st.duration.meters } }];
  }
  return out;
}

function summarize(plan) {
  return plan.steps
    .map((item) =>
      item.type === "repeat"
        ? `${item.times}x(${item.steps.map((s) => describeDuration(s.duration)).join(" / ")})`
        : describeDuration(item.duration)
    )
    .join(" + ");
}

// Construit l'objet guide.json. `ctx` : { maxHr, thresholds } pour résoudre les
// zones en bpm. Sans FCmax, les cibles de zone ne sont pas exportées (le
// validateur le signale en avertissement).
export function planToGuide(plan, ctx = {}, { owner = "Suivi Suunto (perso)", url = "https://localhost/suivi-suunto" } = {}) {
  const items = plan.steps;
  const steps = items.map((item, i) => {
    const isLastItem = i === items.length - 1;
    if (item.type === "repeat") {
      return {
        type: "repeat",
        times: item.times,
        // Toutes les étapes de la répétition portent leur transition (sans stepId :
        // « étape suivante »). Ce que la montre fait après la dernière (boucle puis
        // sortie) n'est pas documenté : à confirmer sur la vraie montre.
        steps: item.steps.map((s) => toFieldsStep(s, ctx, false)),
      };
    }
    return toFieldsStep(item, ctx, isLastItem);
  });

  const name = toWatchText(plan.name || "Seance", LIMITS.name) || "Seance";
  return {
    type: "sequence",
    name,
    description: toWatchText(`${name} : ${summarize(plan)}`, LIMITS.description),
    shortDescription: toWatchText(plan.name || "Seance", LIMITS.shortDescription) || "Seance",
    owner: toWatchText(owner, LIMITS.owner),
    url,
    usage: "workout",
    externalId: plan.externalId || `plan-${Date.now().toString(36)}`,
    steps,
  };
}

// Contrôle les règles de la doc. Renvoie { errors, warnings } ; ce n'est pas le
// validateur officiel de Suunto — seulement ce qui est écrit dans la spec.
export function validateGuide(guide, plan = null, ctx = {}) {
  const errors = [];
  const warnings = [];
  const len = (v, lo, hi, label) => {
    if (typeof v !== "string" || v.length < lo || v.length > hi) errors.push(`${label} : ${lo} à ${hi} caractères requis`);
  };
  if (guide.type !== "sequence") errors.push('type doit valoir "sequence"');
  if (guide.usage !== "workout") errors.push('usage doit valoir "workout"');
  len(guide.name, 1, LIMITS.name, "name");
  len(guide.description, 1, LIMITS.description, "description");
  len(guide.shortDescription, 1, LIMITS.shortDescription, "shortDescription");
  len(guide.owner, 1, LIMITS.owner, "owner");
  len(guide.url, 1, 256, "url");
  if (!guide.steps?.length || guide.steps.length > 1000) errors.push("steps : 1 à 1000 étapes");

  const checkFields = (s, path) => {
    if (s.title && s.title.length > LIMITS.stepTitle) errors.push(`${path}.title dépasse ${LIMITS.stepTitle} caractères`);
    if (!s.fields?.length) errors.push(`${path} : aucun champ à afficher`);
    (s.fields || []).forEach((f, i) => {
      if (f.title && f.title.length > LIMITS.fieldTitle) errors.push(`${path}.fields[${i}].title dépasse ${LIMITS.fieldTitle} caractères`);
      if (f.type?.startsWith("target") && !(f.min <= f.value && f.value <= f.max)) errors.push(`${path}.fields[${i}] : min <= value <= max attendu`);
    });
    if (s.notification && (s.notification.title.length > LIMITS.stepTitle || s.notification.text.length > LIMITS.noteText)) {
      errors.push(`${path}.notification dépasse 13 / 54 caractères`);
    }
  };
  (guide.steps || []).forEach((s, i) => {
    if (s.type === "fields") checkFields(s, `steps[${i}]`);
    else if (s.type === "repeat") {
      if (!(s.times >= 1 && s.times <= 100)) errors.push(`steps[${i}].times : 1 à 100`);
      (s.steps || []).forEach((c, j) => (c.type === "fields" ? checkFields(c, `steps[${i}].steps[${j}]`) : errors.push(`steps[${i}].steps[${j}] : étapes simples uniquement dans une répétition`)));
    } else errors.push(`steps[${i}] : type "${s.type}" inconnu`);
  });

  if (plan && !ctx.maxHr && flattenPlan(plan).some((st) => st.target?.type === "hrZone")) {
    warnings.push("FC max inconnue : les cibles de zone ne sont pas exportées (aucune séance avec FC dans l'historique).");
  }
  if (plan && flattenPlan(plan).some((st) => st.target?.type === "none")) {
    warnings.push("Certaines étapes n'ont pas de cible : la montre n'affichera que la durée.");
  }
  return { errors, warnings };
}

// --- ZIP (stockage sans compression) ---------------------------------------
// Le paquet ne contient que deux petits fichiers : inutile d'embarquer une
// librairie de compression (l'app n'a pas d'étape de build).

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const push = (arr, ...parts) => parts.forEach((p) => arr.push(p));

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const header = [];
    // En-tête local : signature, version 20, flags 0x0800 (UTF-8), méthode 0 (stockée), date/heure neutres.
    push(header, u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes);
    chunks.push(...header, data);
    const localSize = header.reduce((s, p) => s + p.length, 0) + data.length;

    const c = [];
    push(c, u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes);
    central.push(c);
    offset += localSize;
  }
  const centralStart = offset;
  const centralParts = central.flat();
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const end = [];
  push(end, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(centralStart), u16(0));
  return new Blob([...chunks, ...centralParts, ...end], { type: "application/zip" });
}

// Icône 300×300 obligatoire dans le paquet : à-plat dans la couleur d'accent,
// avec les initiales du nom. Générée au canvas, donc aucun fichier à embarquer.
export function makeIconPng(label = "S") {
  const size = 300;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  g.fillStyle = "#ff6a3d";
  g.fillRect(0, 0, size, size);
  g.fillStyle = "#ffffff";
  g.font = "700 150px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label.slice(0, 2).toUpperCase(), size / 2, size / 2 + 8);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))) : reject(new Error("Icône non générée"))), "image/png");
  });
}

// PNG de l'icône en base64, pour l'envoi direct au serveur.
export async function makeIconBase64(label) {
  const bytes = await makeIconPng(label);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function buildGuideZip(guide) {
  const enc = new TextEncoder();
  const icon = await makeIconPng(guide.name.charAt(0) || "S");
  return buildZip([
    { name: "guide.json", data: enc.encode(JSON.stringify(guide, null, 2)) },
    { name: "icon.png", data: icon },
  ]);
}
