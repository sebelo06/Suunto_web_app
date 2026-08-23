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

module.exports = router;
