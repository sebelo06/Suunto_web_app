// Tests des briques pures de « Planifier une séance » : node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  TEMPLATES, newPlanFrom, flattenPlan, planSeconds, planMeters, resolveHrRange, stepZone,
  estimateTrimp, timeByZone, projectAcwr, validatePlan, planToText, suggestSession, minutes, meters, zone, step, repeat,
} from "../js/workout-plan.js";
import { computeAcwr } from "../js/training-load.js";
import { planToGuide, validateGuide, toWatchText, buildZip } from "../js/guide-export.js";

const T = [60, 70, 80, 90];
const ctx = { maxHr: 190, thresholds: T };

test("flattenPlan déplie les répétitions", () => {
  const p = newPlanFrom("threshold");
  assert.equal(flattenPlan(p).length, 1 + 3 * 2 + 1);
});

test("durées : temps et distance convertie à l'allure", () => {
  const p = { name: "x", steps: [step("work", minutes(10), zone(4)), step("work", meters(1000), zone(4))] };
  assert.equal(planSeconds(p, 300), 600 + 300);
  assert.equal(Math.round(planMeters(p, 300)), 2000 + 1000);
});

test("zones → bpm avec les bornes réglables", () => {
  const r = resolveHrRange(zone(2), ctx); // 60–70 % de 190
  assert.deepEqual([r.min, r.max], [114, 133]);
  assert.equal(resolveHrRange(zone(2), { thresholds: T }), null); // pas de FCmax
  assert.equal(resolveHrRange(zone(1), ctx).min, 95); // zone 1 : plancher à 50 % de la FCmax, pas 0 bpm
  assert.deepEqual(resolveHrRange({ type: "hr", min: 150, max: 140 }, ctx), { min: 140, max: 150, mid: 145 });
});

test("zone déduite d'une fourchette de FC", () => {
  assert.equal(stepZone({ kind: "work", target: { type: "hr", min: 160, max: 170 } }, ctx), 4); // 86,8 % de 190
  assert.equal(stepZone({ kind: "work", target: { type: "hr", min: 175, max: 185 } }, ctx), 5); // 94,7 %
  assert.equal(stepZone({ kind: "recovery", target: { type: "none" } }, ctx), 1); // zone par défaut du type d'étape
});

test("TRIMP prévisionnel = Σ minutes × poids de zone", () => {
  const p = { name: "x", steps: [step("steady", minutes(30), zone(2)), step("work", minutes(10), zone(4))] };
  assert.equal(estimateTrimp(p, ctx), 30 * 2 + 10 * 4);
  assert.deepEqual(timeByZone(p, ctx), [0, 1800, 0, 600, 0]);
});

test("projection ACWR : ajouter de la charge la fait monter", () => {
  const series = Array.from({ length: 35 }, (_, i) => ({ date: `d${i}`, trimp: i % 2 ? 60 : 0, active: !!(i % 2) }));
  const now = projectAcwr(series, 0, 0, computeAcwr);
  const heavy = projectAcwr(series, 300, 0, computeAcwr);
  assert.ok(heavy.after > now.after);
  assert.equal(heavy.baseline, now.baseline); // « sans séance » ne dépend pas de la séance
  assert.ok(heavy.after > heavy.baseline);
  assert.equal(series.length, 35); // la série d'entrée n'est pas mutée
  const tomorrow = projectAcwr(series, 100, 1, computeAcwr);
  assert.ok(tomorrow.after > tomorrow.baseline);
  assert.equal(tomorrow.today, now.today);
});

test("validatePlan signale les plans invalides", () => {
  assert.ok(validatePlan({ steps: [] }).length);
  assert.ok(validatePlan({ steps: [repeat(0, [step("work", minutes(1))])] }).length);
  for (const t of TEMPLATES) assert.deepEqual(validatePlan(t.build()), [], t.id);
});

test("toWatchText : ASCII et troncature", () => {
  assert.equal(toWatchText("Échauffement à 3×10’", 40), "Echauffement a 3x10'");
  assert.equal(toWatchText("abcdefghijklmnop", 5), "abcde");
});

test("tous les modèles donnent un guide valide", () => {
  for (const t of TEMPLATES) {
    const plan = t.build();
    const guide = planToGuide(plan, ctx);
    const { errors } = validateGuide(guide, plan, ctx);
    assert.deepEqual(errors, [], `${t.id}: ${errors.join(" | ")}`);
  }
});

test("guide : transitions sans stepId, cibles FC, dernière étape manuelle", () => {
  const guide = planToGuide(newPlanFrom("threshold"), ctx);
  const json = JSON.stringify(guide);
  assert.ok(!json.includes("stepId"));
  assert.equal(guide.steps[0].transitions[0].condition.type, "stepDuration");
  assert.equal(guide.steps[0].fields.find((f) => f.type === "targetHeartRate").min, 114);
  assert.equal(guide.steps.at(-1).transitions, undefined);
  assert.equal(guide.steps[1].type, "repeat");
  assert.equal(guide.steps[1].times, 3);
});

test("guide : étape en distance → transition stepDistance", () => {
  const guide = planToGuide(newPlanFrom("short-intervals"), ctx);
  const effort = guide.steps[1].steps[0];
  assert.equal(effort.transitions[0].condition.type, "stepDistance");
  assert.equal(effort.fields[0].type, "stepDistanceCountdown");
});

test("sans FCmax : avertissement et pas de cible de zone", () => {
  const plan = newPlanFrom("easy");
  const guide = planToGuide(plan, { thresholds: T });
  assert.ok(!guide.steps[0].fields.some((f) => f.type === "targetHeartRate"));
  assert.ok(validateGuide(guide, plan, { thresholds: T }).warnings.length);
});

test("ZIP : archive lisible par unzip, contenu intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  const data = new TextEncoder().encode(JSON.stringify(planToGuide(newPlanFrom("easy"), ctx)));
  const icon = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
  return buildZip([{ name: "guide.json", data }, { name: "icon.png", data: icon }]).arrayBuffer().then((ab) => {
    const f = join(dir, "g.zip");
    writeFileSync(f, Buffer.from(ab));
    const test = execFileSync("unzip", ["-t", f]).toString();
    assert.match(test, /No errors detected/);
    const out = execFileSync("unzip", ["-p", f, "guide.json"]);
    assert.equal(out.toString(), Buffer.from(data).toString());
  });
});

test("récapitulatif texte : étapes, répétitions, cibles en bpm", () => {
  const txt = planToText(newPlanFrom("threshold"), ctx);
  assert.match(txt, /^Seuil 3x10 min\n/);
  assert.match(txt, /1\. Échauffement - 15 min - FC 114-133 bpm \(zone 2\)/);
  assert.match(txt, /2\. Répéter 3 fois :\n   a\. Effort - 10 min - FC 152-171 bpm \(zone 4\)\n   b\. Récupération - 3 min/);
  assert.match(planToText(newPlanFrom("easy"), { thresholds: T }), /zone 2/); // sans FCmax : zone seule
});

test("suggestion : charge trop haute ou forme basse → footing facile", () => {
  assert.equal(suggestSession({ readiness: 80, acwr: 1.7 }).templateId, "easy");
  assert.equal(suggestSession({ readiness: 40, acwr: 1.0 }).templateId, "easy");
  assert.equal(suggestSession({ readiness: 80, acwr: 1.0, hoursSinceHard: 20 }).templateId, "easy");
  assert.equal(suggestSession({ readiness: 80, acwr: 1.4 }).templateId, "easy");
  assert.equal(suggestSession({ readiness: 80, acwr: 1.0, hardSessionsLast7: 3 }).templateId, "easy");
});

test("suggestion : frais et charge maîtrisée → intensité, qui tourne", () => {
  assert.equal(suggestSession({ readiness: 75, acwr: 1.0, hardSessionsLast7: 0, hoursSinceHard: 100 }).templateId, "threshold");
  assert.equal(suggestSession({ readiness: 75, acwr: 1.0, hardSessionsLast7: 1 }).templateId, "short-intervals");
  assert.equal(suggestSession({ readiness: 75, acwr: 1.0, hardSessionsLast7: 2 }).templateId, "long");
});

test("suggestion : forme moyenne et charge basse → sortie longue ; données absentes → prudent", () => {
  assert.equal(suggestSession({ readiness: 55, acwr: 0.6 }).templateId, "long");
  assert.equal(suggestSession({ readiness: 55, acwr: 1.0 }).templateId, "easy");
  const none = suggestSession({});
  assert.equal(none.templateId, "easy");
  assert.equal(none.lowConfidence, true);
  assert.ok(suggestSession({ readiness: 75, acwr: 1.0 }).reasons.some((r) => r.includes("75/100")));
});

test("toute suggestion renvoie un modèle existant", () => {
  const ids = new Set(TEMPLATES.map((t) => t.id));
  for (const readiness of [null, 30, 55, 80]) for (const acwr of [null, 0.5, 1, 1.4, 1.8]) for (const hard of [0, 1, 2, 3]) {
    const s = suggestSession({ readiness, acwr, hardSessionsLast7: hard });
    assert.ok(ids.has(s.templateId), s.templateId);
    s.alternatives.forEach((a) => assert.ok(ids.has(a), a));
  }
});
