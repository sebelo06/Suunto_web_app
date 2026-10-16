// src/routes/wellness.js
const express = require("express");
const { requireSuuntoClient } = require("../middleware/auth");
const { unwrap } = require("../utils/unwrap");

const router = express.Router();

router.get("/sleep", requireSuuntoClient, async (req, res) => {
  try {
    const sleep = await req.suunto.wellness.sleep({ since: 0 });
    res.json(unwrap(sleep));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération du sommeil" });
  }
});

router.get("/recovery", requireSuuntoClient, async (req, res) => {
  try {
    const recovery = await req.suunto.wellness.recovery();
    res.json(unwrap(recovery));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération de la récupération" });
  }
});

// Flux 24/7 volumineux (un échantillon par 15 min) : on borne la fenêtre,
// 7 jours par défaut, ou `?since=<ms epoch>` pour la fixer explicitement.
const DEFAULT_WINDOW_MS = 7 * 86400000;
function sinceParam(req) {
  const since = Number(req.query.since);
  return Number.isFinite(since) && since >= 0 ? since : Date.now() - DEFAULT_WINDOW_MS;
}

router.get("/activity", requireSuuntoClient, async (req, res) => {
  try {
    const activity = await req.suunto.wellness.activity({ since: sinceParam(req) });
    res.json(unwrap(activity));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération de l'activité quotidienne" });
  }
});

router.get("/sleepstages", requireSuuntoClient, async (req, res) => {
  try {
    const stages = await req.suunto.wellness.sleepStages({ since: sinceParam(req) });
    res.json(unwrap(stages));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération des phases de sommeil" });
  }
});

module.exports = router;
