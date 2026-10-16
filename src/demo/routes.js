// src/demo/routes.js
//
// Mode démo : remplace l'API Suunto par des données générées localement
// (voir data.js). Monté AVANT les vraies routes dans src/app.js quand
// SUUNTO_DEMO=1, il court-circuite la connexion : l'app s'ouvre directement
// sur le tableau de bord, sans compte.
//
// Les routes inconnues (ex. /api/route/snap) retombent sur les vraies routes ;
// on marque la session comme authentifiée pour qu'elles restent utilisables.
const express = require("express");
const { getDemoData, getWorkoutData, publicWorkout } = require("./data");

const router = express.Router();

router.use((req, res, next) => {
  req.session.authenticated = true;
  next();
});

router.get("/session", (req, res) => res.json({ authenticated: true }));
router.post("/login", (req, res) => res.json({ ok: true }));
router.post("/logout", (req, res) => res.json({ ok: true }));

router.get("/workouts", (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const offset = Number(req.query.offset) || 0;
  res.json(getDemoData().workouts.slice(offset, offset + limit).map(publicWorkout));
});

router.get("/workouts/:username/:key", (req, res) => {
  const w = getDemoData().byKey.get(req.params.key);
  if (!w) return res.status(404).json({ error: "Séance démo introuvable" });
  res.json(publicWorkout(w));
});

router.get("/workouts/:username/:key/data", (req, res) => {
  const data = getWorkoutData(req.params.key);
  if (!data) return res.status(404).json({ error: "Séance démo introuvable" });
  res.json(data);
});

router.get("/wellness/sleep", (req, res) => res.json(getDemoData().sleep));
router.get("/wellness/recovery", (req, res) => res.json(getDemoData().recovery));
router.get("/wellness/activity", (req, res) => res.json(getDemoData().activity));
router.get("/wellness/sleepstages", (req, res) => res.json(getDemoData().sleepStages));

// Envoi de guide : simulé (rien n'est écrit nulle part).
router.post("/guides", (req, res) => {
  const { guide, guideId } = req.body || {};
  if (!guide || typeof guide !== "object") return res.status(400).json({ error: "Guide invalide." });
  res.json({ id: guideId || `demo-${Date.now().toString(36)}`, name: guide.name, updated: Boolean(guideId) });
});

module.exports = router;
