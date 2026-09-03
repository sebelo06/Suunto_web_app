// src/routes/workouts.js
const express = require("express");
const { requireSuuntoClient } = require("../middleware/auth");
const { unwrap } = require("../utils/unwrap");

const router = express.Router();

router.get("/", requireSuuntoClient, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const offset = Number(req.query.offset) || 0;
    const workouts = await req.suunto.workouts.own({ limit, offset });
    res.json(unwrap(workouts));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération des séances" });
  }
});

router.get("/:username/:key", requireSuuntoClient, async (req, res) => {
  try {
    const { username, key } = req.params;
    const detail = await req.suunto.workouts.byKey(username, key);
    res.json(unwrap(detail));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération du détail de la séance" });
  }
});

// Séries temporelles fines d'une séance (FC seconde par seconde, tracé GPS
// enrichi). L'endpoint n'est pas wrappé par suunto-api-wrapper : on l'appelle
// via le client HTTP brut. Il est indexé par `key` seule (pas de username).
router.get("/:username/:key/data", requireSuuntoClient, async (req, res) => {
  try {
    const { key } = req.params;
    const resp = await req.suunto.http.get(`/apiserver/v1/workouts/${encodeURIComponent(key)}/data`, { timeoutMs: 15000 });
    const payload = resp.data?.payload ?? resp.data ?? {};
    res.json({
      heartrates: Array.isArray(payload.heartrates) ? payload.heartrates : [],
      locations: Array.isArray(payload.locations) ? payload.locations : [],
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération des données de séance" });
  }
});

module.exports = router;
