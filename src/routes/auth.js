// src/routes/auth.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const { SuuntoClient } = require("suunto-api-wrapper");
const clientStore = require("../stores/clientStore");

const router = express.Router();

// Anti brute-force sur les identifiants Suunto : 10 tentatives / 15 min / IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives de connexion. Réessaie plus tard." },
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email et password requis" });
  }

  try {
    const suunto = await SuuntoClient.login({ email, password });
    clientStore.set(req.session.id, suunto);
    // Force express-session à considérer la session comme "initialisée"
    // pour qu'il renvoie bien le cookie au navigateur (sinon, avec
    // saveUninitialized: false, aucun cookie n'est émis et chaque
    // requête suivante repart avec une session vide -> 401).
    req.session.authenticated = true;
    res.json({ ok: true });
  } catch (err) {
    console.error("Login Suunto échoué:", err.message);
    res.status(401).json({ error: "Identifiants invalides ou API Suunto indisponible" });
  }
});

router.post("/logout", (req, res) => {
  clientStore.delete(req.session.id);
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
