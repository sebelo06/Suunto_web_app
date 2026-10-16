// js/planner.js
//
// Onglet « Planifier » : construire une séance structurée (étapes, répétitions,
// cibles de FC), voir sa charge prévisionnelle et son effet sur l'ACWR, puis
// l'exporter en Guide SuuntoPlus. Toute la logique vit dans workout-plan.js et
// guide-export.js ; ce fichier ne fait que l'interface.
import { loadHistory } from "./history.js";
import { escapeHtml } from "./dom.js";
import { icon } from "./icons.js";
import { formatDuration, formatPaceValue } from "./format.js";
import { buildDailyLoad, computeAcwr, computeTrimp, acwrStatus, resolveMaxHr, readHrZoneThresholds } from "./training-load.js";
import { getReadinessSnapshot } from "./readiness.js";
import {
  STEP_KINDS, TEMPLATES, DEFAULT_PACE_SEC_PER_KM, newPlanFrom, step, repeat, minutes, zone, flattenPlan,
  stepSeconds, stepZone, describeDuration, planSeconds, planMeters, estimateTrimp, timeByZone, projectAcwr, resolveHrRange, validatePlan, planToText, suggestSession,
} from "./workout-plan.js";
import { planToGuide, validateGuide, buildGuideZip, makeIconBase64 } from "./guide-export.js";
import { api } from "./api.js";

const STORAGE_KEY = "suunto-planner-plan";
const ZONE_COLORS = ["#4fa3c9", "#49c6b5", "#e8c547", "#ff9c4a", "#e5484d"];
const DAY_OPTIONS = [["0", "Aujourd'hui"], ["1", "Demain"], ["2", "Après-demain"]];

let root = null;
let plan = null;
let dayOffset = 1;
let openPath = null; // étape dépliée dans l'éditeur (une seule à la fois)
let dragPath = null; // élément en cours de glisser-déposer
let exportBusy = false;
let sendStatus = null; // { ok, text } du dernier envoi vers la montre
let ctx = { maxHr: null, maxHrSource: "none", thresholds: readHrZoneThresholds(), series: [], paceSecPerKm: DEFAULT_PACE_SEC_PER_KM, paceFromRuns: false, hard: { count7: 0, hoursSince: null }, loaded: false };

// --- Persistance locale -----------------------------------------------------

function readStoredPlan() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return p && Array.isArray(p.steps) ? p : null;
  } catch { return null; }
}
function storePlan() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plan)); } catch { /* ignore */ }
}

// --- Contexte issu de l'historique -----------------------------------------

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

// Séances « intenses » = au moins 30 % de leur TRIMP en zones 4-5. Renvoie le
// nombre sur les 7 derniers jours et les heures écoulées depuis la dernière.
function recentHardSessions(history, maxHr) {
  const now = Date.now();
  let count7 = 0;
  let last = null;
  for (const w of history) {
    const start = new Date(w.startTime).getTime();
    if (!Number.isFinite(start) || now - start > 7 * 86400000) continue;
    const t = computeTrimp(w, { maxHr });
    if (!(t.value > 0) || (t.perZone[3] + t.perZone[4]) / t.value < 0.3) continue;
    count7 += 1;
    const end = start + (w.totalTime || 0) * 1000;
    if (last == null || end > last) last = end;
  }
  return { count7, hoursSince: last == null ? null : (now - last) / 3600000 };
}

async function loadContext() {
  try {
    const history = await loadHistory({ minDays: 42 });
    const { maxHr, source } = resolveMaxHr(history);
    const series = buildDailyLoad(history).series;
    // Allure de référence : médiane des courses à pied des 90 derniers jours, pour
    // convertir les étapes en distance en durée.
    const since = Date.now() - 90 * 86400000;
    const paces = history
      .filter((w) => w.activityId === 1 && w.totalDistance > 1000 && w.totalTime > 0 && new Date(w.startTime).getTime() >= since)
      .map((w) => w.totalTime / (w.totalDistance / 1000));
    const pace = median(paces);
    const hard = recentHardSessions(history, maxHr);
    ctx = { ...ctx, maxHr, maxHrSource: source, series, paceSecPerKm: pace || DEFAULT_PACE_SEC_PER_KM, paceFromRuns: Boolean(pace), hard, thresholds: readHrZoneThresholds(), loaded: true };
  } catch {
    ctx = { ...ctx, loaded: true };
  }
  render();
}

// --- Petits utilitaires -----------------------------------------------------

const planOpts = () => ({ maxHr: ctx.maxHr, thresholds: ctx.thresholds, paceSecPerKm: ctx.paceSecPerKm });

function parsePace(text) {
  const m = String(text).trim().match(/^(\d{1,2})[:'](\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
const fmtPaceInput = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

function getContainer(path) {
  const [i, j] = String(path).split(".").map(Number);
  return j == null || Number.isNaN(j) ? { list: plan.steps, index: i } : { list: plan.steps[i].steps, index: j };
}
const getNode = (path) => { const { list, index } = getContainer(path); return list[index]; };

function stepLabel(kind) { return STEP_KINDS[kind]?.label || kind; }

// « 3 » → "" ; « 1.2 » → "1" : l'étape à l'intérieur d'une répétition se repère
// par son parent, les étapes de premier niveau par une chaîne vide.
const parentOf = (path) => (String(path).includes(".") ? String(path).split(".")[0] : "");
const siblingPath = (path, index) => (String(path).includes(".") ? `${parentOf(path)}.${index}` : String(index));

// --- Rendu ------------------------------------------------------------------

// Résumé de la cible en une courte phrase, lisible sans déplier l'étape.
function targetSummary(st) {
  const t = st.target || { type: "none" };
  const r = resolveHrRange(t, planOpts());
  if (t.type === "hrZone") return `Z${t.zone}${r ? ` · ${r.min}–${r.max} bpm` : ""}`;
  if (t.type === "hr" && r) return `${r.min}–${r.max} bpm`;
  if (t.type === "pace") return `${fmtPaceInput(t.fast)}–${fmtPaceInput(t.slow)} /km`;
  return "Sans cible";
}

// Cibles « précises » (FC en bpm, allure), rangées dans un volet replié : la
// plupart des séances se règlent avec les seules pastilles de zone.
function advancedTarget(st, path) {
  const t = st.target || { type: "none" };
  const type = t.type;
  const opt = (v, label) => `<option value="${v}"${type === v ? " selected" : ""}>${label}</option>`;
  let extra = "";
  if (type === "hr") {
    extra = `
      <input type="number" data-f="hrMin" data-path="${path}" value="${t.min}" min="40" max="230" aria-label="FC minimale">
      <span class="pl-hint">à</span>
      <input type="number" data-f="hrMax" data-path="${path}" value="${t.max}" min="40" max="230" aria-label="FC maximale">
      <span class="pl-hint">bpm</span>`;
  } else if (type === "pace") {
    extra = `
      <input type="text" data-f="paceFast" data-path="${path}" value="${fmtPaceInput(t.fast)}" size="4" aria-label="Allure la plus rapide (min:s par km)">
      <span class="pl-hint">à</span>
      <input type="text" data-f="paceSlow" data-path="${path}" value="${fmtPaceInput(t.slow)}" size="4" aria-label="Allure la plus lente (min:s par km)">
      <span class="pl-hint">/km</span>`;
  }
  return `
    <details class="pl-adv"${type === "hr" || type === "pace" ? " open" : ""}>
      <summary>Cible précise (FC, allure)</summary>
      <div class="pl-inline">
        <select data-f="target" data-path="${path}" aria-label="Type de cible">
          ${opt("hrZone", "Zone FC")}${opt("hr", "FC (bpm)")}${opt("pace", "Allure")}${opt("none", "Sans cible")}
        </select>${extra}
      </div>
    </details>`;
}

function stepForm(st, path, { first, last }) {
  const d = st.duration;
  const isTime = d.type === "time";
  const value = isTime ? +(d.seconds / 60).toFixed(2) : d.meters;
  const t = st.target || { type: "none" };
  const r = t.type === "hrZone" ? resolveHrRange(t, planOpts()) : null;
  const seg = (unit, label) => `<button type="button" data-act="unit" data-unit="${unit}" data-path="${path}" aria-pressed="${(unit === "time") === isTime}">${label}</button>`;
  return `
    <div class="pl-step-form">
      <label class="pl-field"><span>Type</span>
        <select data-f="kind" data-path="${path}">
          ${Object.entries(STEP_KINDS).map(([k, v]) => `<option value="${k}"${st.kind === k ? " selected" : ""}>${v.label}</option>`).join("")}
        </select>
      </label>
      <div class="pl-field"><span>${isTime ? "Durée" : "Distance"}</span>
        <div class="pl-inline">
          <input type="number" data-f="dur" data-path="${path}" value="${value}" min="0" step="${isTime ? 0.5 : 50}" aria-label="${isTime ? "Durée en minutes" : "Distance en mètres"}">
          <div class="pl-seg" role="group" aria-label="Unité">${seg("time", "min")}${seg("distance", "m")}</div>
        </div>
      </div>
      <div class="pl-field pl-field-wide"><span>Intensité</span>
        <div class="pl-inline">
          <div class="pl-zones" role="group" aria-label="Zone de FC visée">
            ${[1, 2, 3, 4, 5].map((z) => `<button type="button" class="pl-zbtn" data-act="zone" data-z="${z}" data-path="${path}" aria-pressed="${t.type === "hrZone" && t.zone === z}" style="--zc:${ZONE_COLORS[z - 1]}">Z${z}</button>`).join("")}
          </div>
          ${t.type === "hrZone" ? `<span class="pl-hint">${r ? `${r.min}–${r.max} bpm` : "FC max inconnue"}</span>` : ""}
        </div>
      </div>
      ${advancedTarget(st, path)}
      <div class="pl-form-actions">
        <button type="button" data-act="up" data-path="${path}" aria-label="Monter"${first ? " disabled" : ""}>↑ Monter</button>
        <button type="button" data-act="down" data-path="${path}" aria-label="Descendre"${last ? " disabled" : ""}>↓ Descendre</button>
      </div>
    </div>`;
}

function rowActions(path, label) {
  return `
    <span class="pl-actions">
      <button type="button" data-act="dup" data-path="${path}" aria-label="Dupliquer ${label}" title="Dupliquer">${icon("copy", 14)}</button>
      <button type="button" data-act="del" data-path="${path}" aria-label="Supprimer ${label}" title="Supprimer">${icon("close", 14)}</button>
    </span>`;
}

const gripHtml = (path) => `<span class="pl-grip" draggable="true" data-drag="${path}" title="Glisser pour réordonner" aria-hidden="true">${icon("grip", 14)}</span>`;

function stepRow(st, path, pos) {
  const open = openPath === path;
  const z = stepZone(st, planOpts());
  return `
    <div class="pl-step${open ? " is-open" : ""}" data-path="${path}">
      <div class="pl-step-head">
        ${gripHtml(path)}
        <button type="button" class="pl-step-toggle" data-act="toggle" data-path="${path}" aria-expanded="${open}">
          <span class="pl-zone-dot" style="background:${ZONE_COLORS[z - 1]}"></span>
          <span class="pl-step-kind">${escapeHtml(stepLabel(st.kind))}</span>
          <span class="pl-step-dur">${describeDuration(st.duration)}</span>
          <span class="pl-step-target">${escapeHtml(targetSummary(st))}</span>
        </button>
        ${rowActions(path, "l'étape")}
      </div>
      ${open ? stepForm(st, path, pos) : ""}
    </div>`;
}

function editorHtml() {
  const n = plan.steps.length;
  return plan.steps
    .map((item, i) => {
      const pos = { first: i === 0, last: i === n - 1 };
      if (item.type !== "repeat") return stepRow(item, String(i), pos);
      const m = item.steps.length;
      return `
        <div class="pl-repeat" data-path="${i}">
          <div class="pl-repeat-head">
            ${gripHtml(i)}
            <span class="pl-repeat-label">Répéter</span>
            <span class="pl-stepper">
              <button type="button" data-act="rep-dec" data-path="${i}" aria-label="Une répétition de moins"${item.times <= 1 ? " disabled" : ""}>−</button>
              <output aria-live="polite">${item.times}</output>
              <button type="button" data-act="rep-inc" data-path="${i}" aria-label="Une répétition de plus"${item.times >= 100 ? " disabled" : ""}>+</button>
            </span>
            <span class="pl-hint">fois</span>
            <span class="pl-actions">
              <button type="button" data-act="up" data-path="${i}" aria-label="Monter la répétition"${pos.first ? " disabled" : ""}>↑</button>
              <button type="button" data-act="down" data-path="${i}" aria-label="Descendre la répétition"${pos.last ? " disabled" : ""}>↓</button>
              <button type="button" data-act="dup" data-path="${i}" aria-label="Dupliquer la répétition" title="Dupliquer">${icon("copy", 14)}</button>
              <button type="button" data-act="del" data-path="${i}" aria-label="Supprimer la répétition" title="Supprimer">${icon("close", 14)}</button>
            </span>
          </div>
          <div class="pl-repeat-body">
            ${item.steps.map((s, j) => stepRow(s, `${i}.${j}`, { first: j === 0, last: j === m - 1 })).join("")}
            <button type="button" class="pl-add" data-act="add-inner" data-path="${i}">${icon("plus", 13)}Ajouter une étape au bloc</button>
          </div>
        </div>`;
    })
    .join("");
}

function previewHtml() {
  const steps = flattenPlan(plan);
  const total = steps.reduce((s, st) => s + stepSeconds(st, ctx.paceSecPerKm), 0) || 1;
  const bars = steps
    .map((st) => {
      const sec = stepSeconds(st, ctx.paceSecPerKm);
      const z = stepZone(st, planOpts());
      const r = resolveHrRange(st.target, planOpts());
      const tip = `${stepLabel(st.kind)} · ${formatDuration(sec)} · zone ${z}${r ? ` (${r.min}–${r.max} bpm)` : ""}`;
      return `<i style="flex:${(sec / total) * 1000};height:${18 + z * 16}%;background:${ZONE_COLORS[z - 1]}" title="${escapeHtml(tip)}"></i>`;
    })
    .join("");
  return `<div class="pl-bars" role="img" aria-label="Profil d'intensité de la séance">${bars}</div>`;
}

function projectionHtml(trimp) {
  if (!ctx.series.length) return `<div class="pl-proj-empty">Historique de charge indisponible : pas de projection.</div>`;
  const { today, baseline: before, after } = projectAcwr(ctx.series, trimp, dayOffset, computeAcwr);
  if (before == null || after == null) return `<div class="pl-proj-empty">Pas assez d'historique pour projeter l'ACWR.</div>`;
  const dayLabel = DAY_OPTIONS.find(([v]) => Number(v) === dayOffset)?.[1].toLowerCase() ?? "ce jour-là";
  const s0 = acwrStatus(before);
  const s1 = acwrStatus(after);
  const color = { low: "var(--muted)", optimal: "var(--route)", watch: "var(--accent-gold)", high: "var(--signal)", none: "var(--muted)" };
  const fmt = (v) => v.toFixed(2).replace(".", ",");
  return `
    <div class="pl-proj">
      <div class="pl-proj-row">
        <span>Sans séance</span><b style="color:${color[s0.key]}">${fmt(before)}</b><small>${s0.label}</small>
      </div>
      <div class="pl-proj-arrow">→</div>
      <div class="pl-proj-row">
        <span>Avec cette séance</span><b style="color:${color[s1.key]}">${fmt(after)}</b><small>${s1.label}</small>
      </div>
    </div>
    <p class="pl-hint pl-context">ACWR ${dayLabel}, avec et sans la séance${dayOffset > 0 && today != null ? ` · aujourd'hui : ${fmt(today)}` : ""}.</p>
    ${s1.key === "high" ? `<p class="pl-warn">${icon("alertTriangle", 13)} Cette séance te placerait en zone de risque élevé : envisage de la raccourcir ou de la décaler.</p>` : ""}`;
}

function suggestionHtml() {
  const snap = getReadinessSnapshot();
  const acwr = ctx.series.length ? computeAcwr(ctx.series).ratio : null;
  const s = suggestSession({ readiness: snap ? snap.score : null, acwr, hardSessionsLast7: ctx.hard.count7, hoursSinceHard: ctx.hard.hoursSince });
  const tpl = TEMPLATES.find((t) => t.id === s.templateId);
  if (!tpl) return "";
  const alts = s.alternatives
    .map((id) => TEMPLATES.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => `<button type="button" class="pl-chip" data-act="template" data-id="${t.id}">${escapeHtml(t.label)}</button>`)
    .join("");
  return `
    <div class="pl-suggest">
      <div class="pl-section-label" style="margin:0">Suggestion du jour${s.lowConfidence ? ' <span class="pl-hint">(peu de données)</span>' : ""}</div>
      <div class="pl-suggest-main"><b>${escapeHtml(tpl.label)}</b><span class="pl-hint">${escapeHtml(tpl.blurb)}</span></div>
      <ul class="pl-reasons">${s.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
      <div class="pl-suggest-actions">
        <button type="button" class="pl-use" data-act="template" data-id="${tpl.id}">Utiliser cette séance</button>
        ${alts ? `<span class="pl-hint">ou</span>${alts}` : ""}
      </div>
      <p class="pl-hint pl-context">Règles simples (forme du jour, ACWR, séances intenses des 7 derniers jours) : une aide, pas une prescription.</p>
    </div>`;
}

function exportHtml(errors, warnings) {
  const hasErrors = errors.length > 0;
  return `
    ${errors.length ? `<ul class="pl-issues pl-issues-error">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>` : ""}
    ${warnings.length ? `<ul class="pl-issues">${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : ""}
    <div class="pl-export-btns">
      <button type="button" class="primary-outline" data-act="zip"${hasErrors || exportBusy ? " disabled" : ""}>
        ${icon("check", 14)}${exportBusy ? "Préparation…" : "Télécharger le Guide (.zip)"}
      </button>
      <button type="button" data-act="send"${hasErrors || exportBusy ? " disabled" : ""}>
        ${exportBusy ? "Envoi…" : plan.guideId ? "Mettre à jour sur la montre" : "Envoyer vers la montre"}
      </button>
      <button type="button" data-act="json"${hasErrors ? " disabled" : ""}>guide.json seul</button>
    </div>
    ${sendStatus ? `<p class="pl-hint" role="status" style="color:${sendStatus.ok ? "var(--signal)" : "var(--danger)"}">${escapeHtml(sendStatus.text)}</p>` : ""}
    <details class="pl-install">
      <summary>Récapitulatif à recopier dans l'app Suunto</summary>
      <p class="pl-hint">Sans câble ni éditeur : dans l'app Suunto, section Watch, le constructeur de séances crée des Guides qui se synchronisent sur la montre. Recopie les étapes ci-dessous.</p>
      <pre class="pl-recap" id="pl-recap">${escapeHtml(planToText(plan, planOpts()))}</pre>
      <button type="button" data-act="copy">Copier le récapitulatif</button>
    </details>
    <details class="pl-install">
      <summary>Installer le paquet via SuuntoPlus Editor</summary>
      <ol>
        <li>Brancher la montre en <b>USB</b> (le Bluetooth oblige à la désappairer de l'app mobile).</li>
        <li>Dans VS Code avec SuuntoPlus Editor, ouvrir le dossier du Guide (dézipper le paquet) et lancer « SuuntoPlus: Deploy to Watch ».</li>
        <li>Sur la montre : choisir le sport, ouvrir le menu, sélectionner le Guide.</li>
      </ol>
      <p class="pl-hint">Chargement testé sur le simulateur ; l'enchaînement en fin de répétition reste à confirmer sur la vraie montre.</p>
    </details>`;
}

function render() {
  if (!root || !plan) return;
  const opts = planOpts();
  const planErrors = validatePlan(plan);
  const guide = planErrors.length ? null : planToGuide(plan, opts);
  const check = guide ? validateGuide(guide, plan, opts) : { errors: planErrors, warnings: [] };

  const secs = planSeconds(plan, ctx.paceSecPerKm);
  const trimp = estimateTrimp(plan, opts);
  const zt = timeByZone(plan, opts);
  const hard = zt[3] + zt[4];

  const hrInfo = ctx.maxHr
    ? `FC max ${ctx.maxHr} bpm (${ctx.maxHrSource === "user" ? "réglée" : "observée"})`
    : "FC max inconnue : les zones ne sont pas converties en bpm";
  const paceInfo = ctx.paceFromRuns ? `${formatPaceValue(ctx.paceSecPerKm)} (médiane de tes courses, 90 j)` : `${formatPaceValue(ctx.paceSecPerKm)} (valeur par défaut)`;

  root.innerHTML = `
    <div class="card pl-card">
      ${suggestionHtml()}
      <div class="pl-section-label">Ou partir d'un modèle</div>
      <div class="pl-templates" role="group" aria-label="Modèles de séance">
        ${TEMPLATES.map((t) => `<button type="button" class="pl-chip" data-act="template" data-id="${t.id}" title="${escapeHtml(t.blurb)}">${escapeHtml(t.label)}</button>`).join("")}
      </div>
      <div class="pl-name-row">
        <label for="pl-name">Nom de la séance</label>
        <input type="text" id="pl-name" data-f="name" value="${escapeHtml(plan.name)}" maxlength="60">
      </div>

      <div class="pl-editor">${editorHtml()}</div>
      <div class="pl-add-row">
        <button type="button" class="pl-add" data-act="add-step">${icon("plus", 13)}Ajouter une étape</button>
        <button type="button" class="pl-add" data-act="add-repeat">${icon("plus", 13)}Ajouter une répétition</button>
      </div>

      <div class="pl-section-label">Aperçu</div>
      ${previewHtml()}
      <div class="pl-legend">${ZONE_COLORS.map((c, i) => `<span><i style="background:${c}"></i>Z${i + 1}</span>`).join("")}</div>

      <div class="pl-tiles">
        <div class="detail-stat"><div class="value">${formatDuration(secs)}</div><div class="label">Durée</div></div>
        <div class="detail-stat"><div class="value">${(planMeters(plan, ctx.paceSecPerKm) / 1000).toFixed(1)} km</div><div class="label">Distance estimée</div></div>
        <div class="detail-stat" title="TRIMP d'Edwards prévisionnel : Σ minutes × poids de la zone visée"><div class="value">${Math.round(trimp)}</div><div class="label">Charge (TRIMP)</div></div>
        <div class="detail-stat"><div class="value">${formatDuration(hard)}</div><div class="label">En zones 4-5</div></div>
      </div>
      <p class="pl-hint pl-context">${escapeHtml(hrInfo)} · allure de référence ${escapeHtml(paceInfo)}</p>

      <div class="pl-section-label">Effet sur la charge
        <select id="pl-day" aria-label="Jour de la séance">${DAY_OPTIONS.map(([v, l]) => `<option value="${v}"${String(dayOffset) === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      </div>
      ${projectionHtml(trimp)}

      <div class="pl-section-label">Envoyer sur la montre</div>
      ${exportHtml(check.errors, check.warnings)}
    </div>`;
}

// --- Actions ----------------------------------------------------------------

function defaultStep(kind = "steady") {
  return step(kind, minutes(10), zone(STEP_KINDS[kind].defaultZone));
}

function setTarget(st, type) {
  if (type === "hrZone") st.target = zone(STEP_KINDS[st.kind]?.defaultZone ?? 2);
  else if (type === "hr") {
    const r = resolveHrRange(zone(STEP_KINDS[st.kind]?.defaultZone ?? 2), planOpts());
    st.target = { type: "hr", min: r ? r.min : 140, max: r ? r.max : 150 };
  } else if (type === "pace") st.target = { type: "pace", fast: Math.max(150, ctx.paceSecPerKm - 15), slow: ctx.paceSecPerKm + 15 };
  else st.target = { type: "none" };
}

function changeUnit(st, unit) {
  if (st.duration.type === unit) return;
  if (unit === "distance") st.duration = { type: "distance", meters: Math.max(50, Math.round((st.duration.seconds / ctx.paceSecPerKm) * 1000 / 50) * 50) };
  else st.duration = { type: "time", seconds: Math.max(5, Math.round((st.duration.meters / 1000) * ctx.paceSecPerKm)) };
}

function onChange(e) {
  const el = e.target;
  if (el.id === "pl-day") { dayOffset = Number(el.value); render(); return; }
  const f = el.dataset.f;
  if (!f) return;
  if (f === "name") { plan.name = el.value; storePlan(); return; } // pas de rerender : on garde le focus
  const node = el.dataset.path != null ? getNode(el.dataset.path) : null;
  if (!node) return;
  const num = Number(el.value);

  if (f === "kind") node.kind = el.value;
  else if (f === "dur") {
    if (!(num > 0)) return render();
    if (node.duration.type === "time") node.duration.seconds = Math.round(num * 60);
    else node.duration.meters = Math.round(num);
  } else if (f === "target") setTarget(node, el.value);
  else if (f === "hrMin") node.target.min = num;
  else if (f === "hrMax") node.target.max = num;
  else if (f === "paceFast") { const p = parsePace(el.value); if (p) node.target.fast = p; }
  else if (f === "paceSlow") { const p = parsePace(el.value); if (p) node.target.slow = p; }

  storePlan();
  render();
}

// Échange l'élément avec son voisin ; renvoie son nouveau chemin (ou null si
// le déplacement est impossible) pour que l'étape dépliée le suive.
function move(path, delta) {
  const { list, index } = getContainer(path);
  const to = index + delta;
  if (to < 0 || to >= list.length) return null;
  [list[index], list[to]] = [list[to], list[index]];
  return siblingPath(path, to);
}

function duplicate(path) {
  const { list, index } = getContainer(path);
  list.splice(index + 1, 0, structuredClone(list[index]));
  return siblingPath(path, index + 1);
}

// Glisser-déposer : on ne réordonne qu'au sein d'une même liste (premier niveau,
// ou intérieur d'une même répétition), les répétitions ne s'imbriquant pas.
function dropOn(targetPath) {
  if (dragPath == null || targetPath === dragPath || parentOf(targetPath) !== parentOf(dragPath)) return false;
  const from = getContainer(dragPath);
  const to = getContainer(targetPath);
  const [item] = from.list.splice(from.index, 1);
  to.list.splice(to.index, 0, item);
  openPath = null;
  storePlan();
  render();
  return true;
}

async function downloadZip() {
  exportBusy = true;
  render();
  try {
    const guide = planToGuide(plan, planOpts());
    const blob = await buildGuideZip(guide);
    saveBlob(blob, `guide-${slug(plan.name)}.zip`);
  } finally {
    exportBusy = false;
    render();
  }
}

// Envoie le Guide au compte Suunto (créé la 1re fois, mis à jour ensuite) ;
// la montre le reçoit à la prochaine synchro de l'app mobile.
async function sendToWatch() {
  exportBusy = true;
  sendStatus = null;
  render();
  try {
    if (!plan.externalId) plan.externalId = `plan-${Date.now().toString(36)}`;
    const guide = planToGuide(plan, planOpts());
    const icon = await makeIconBase64(guide.name.charAt(0) || "S");
    const res = await api("/api/guides", { method: "POST", body: JSON.stringify({ guide, icon, guideId: plan.guideId }) });
    plan.guideId = res.id;
    storePlan();
    sendStatus = { ok: true, text: `${res.updated ? "Guide mis à jour" : "Guide envoyé"} : « ${res.name} ». Synchronise l'app Suunto pour le récupérer sur la montre.` };
  } catch (err) {
    sendStatus = { ok: false, text: err.message };
  } finally {
    exportBusy = false;
    render();
  }
}

const slug = (s) => String(s || "seance").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "seance";

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyRecap(btn) {
  const text = planToText(plan, planOpts());
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Repli : sélection du texte affiché, à copier à la main.
    const pre = root.querySelector("#pl-recap");
    const range = document.createRange();
    range.selectNodeContents(pre);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const label = btn.textContent;
  btn.textContent = "Copié";
  setTimeout(() => { btn.textContent = label; }, 1500);
}

function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  const path = btn.dataset.path;

  if (act === "template") { plan = newPlanFrom(btn.dataset.id); openPath = null; }
  else if (act === "toggle") openPath = openPath === path ? null : path;
  else if (act === "add-step") { plan.steps.push(defaultStep()); openPath = String(plan.steps.length - 1); }
  else if (act === "add-repeat") { plan.steps.push(repeat(3, [step("work", minutes(3), zone(4)), step("recovery", minutes(2), zone(1))])); openPath = null; }
  else if (act === "add-inner") { const inner = plan.steps[Number(path)].steps; inner.push(defaultStep("work")); openPath = `${path}.${inner.length - 1}`; }
  else if (act === "unit") changeUnit(getNode(path), btn.dataset.unit);
  else if (act === "zone") getNode(path).target = zone(Number(btn.dataset.z));
  else if (act === "rep-dec" || act === "rep-inc") {
    const rep = plan.steps[Number(path)];
    rep.times = Math.max(1, Math.min(100, rep.times + (act === "rep-inc" ? 1 : -1)));
  }
  else if (act === "up" || act === "down") {
    const moved = move(path, act === "up" ? -1 : 1);
    openPath = openPath === path ? moved : null;
  }
  else if (act === "dup") {
    const copy = duplicate(path);
    openPath = getNode(copy).type === "step" ? copy : null;
  }
  else if (act === "del") {
    const { list, index } = getContainer(path);
    list.splice(index, 1);
    openPath = null;
    // Une répétition vidée n'a plus de sens : on la retire.
    plan.steps = plan.steps.filter((it) => it.type !== "repeat" || it.steps.length);
  } else if (act === "zip") { downloadZip(); return; }
  else if (act === "send") { sendToWatch(); return; }
  else if (act === "copy") { copyRecap(btn); return; }
  else if (act === "json") {
    saveBlob(new Blob([JSON.stringify(planToGuide(plan, planOpts()), null, 2)], { type: "application/json" }), `guide-${slug(plan.name)}.json`);
    return;
  }
  storePlan();
  render();
}

function initDragAndDrop() {
  const rowOf = (el) => el.closest?.(".pl-step, .pl-repeat");
  const clearMarks = () => root.querySelectorAll(".is-drop, .is-dragging").forEach((n) => n.classList.remove("is-drop", "is-dragging"));

  root.addEventListener("dragstart", (e) => {
    const grip = e.target.closest?.("[data-drag]");
    if (!grip) return;
    dragPath = grip.dataset.drag;
    const row = rowOf(grip);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragPath);
    if (row) { e.dataTransfer.setDragImage(row, 16, 16); row.classList.add("is-dragging"); }
  });
  root.addEventListener("dragover", (e) => {
    if (dragPath == null) return;
    const row = rowOf(e.target);
    if (!row || row.dataset.path === dragPath || parentOf(row.dataset.path) !== parentOf(dragPath)) return;
    e.preventDefault(); // autorise le dépôt
    root.querySelectorAll(".is-drop").forEach((n) => n.classList.remove("is-drop"));
    row.classList.add("is-drop");
  });
  root.addEventListener("drop", (e) => {
    const row = rowOf(e.target);
    if (row && dropOn(row.dataset.path)) e.preventDefault();
  });
  root.addEventListener("dragend", () => { dragPath = null; clearMarks(); });
}

// --- Entrée -----------------------------------------------------------------

let initialized = false;
export function initPlanner() {
  if (initialized) return;
  initialized = true;
  root = document.getElementById("planner-root");
  if (!root) return;
  plan = readStoredPlan() || newPlanFrom("threshold");
  root.addEventListener("change", onChange);
  root.addEventListener("click", onClick);
  initDragAndDrop();
  render();
  loadContext();
}
