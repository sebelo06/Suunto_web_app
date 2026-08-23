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

module.exports = router;
