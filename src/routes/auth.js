// src/routes/auth.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const { SuuntoClient } = require("suunto-api-wrapper");
const clientStore = require("../stores/clientStore");
const sessionPersistence = require("../stores/sessionPersistence");

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
    // Persiste le credential pour survivre à un redémarrage (no-op sur le
    // web ; chiffré via Keychain en mode desktop). Le mot de passe n'est
    // jamais stocké : seul le sessionKey (jeton révocable) l'est.
    sessionPersistence.save({ email, sessionKey: suunto.sessionKey });
    res.json({ ok: true });
  } catch (err) {
    console.error("Login Suunto échoué:", err.message);
    res.status(401).json({ error: "Identifiants invalides ou API Suunto indisponible" });
  }
});

router.post("/logout", (req, res) => {
  clientStore.delete(req.session.id);
  sessionPersistence.clear();
  req.session.destroy(() => res.json({ ok: true }));
});

// Indique au frontend, au chargement, s'il est déjà authentifié — l'API
// Suunto n'ayant pas de "/me". Sur le web, si le client est encore en
// mémoire (pas de redémarrage), on répond authenticated:true : un simple
// refresh ne fait donc plus retomber sur l'écran de connexion.
//
// En mode desktop, si le client n'est plus en mémoire mais qu'un credential
// a été persisté, on réhydrate un SuuntoClient à partir du sessionKey (sans
// mot de passe) et on ré-arme la session : l'app rouvre déjà connectée.
router.get("/session", (req, res) => {
  let client = clientStore.get(req.session.id);

  if (!client) {
    const credential = sessionPersistence.load();
    if (credential && credential.sessionKey) {
      client = new SuuntoClient({
        email: credential.email,
        sessionKey: credential.sessionKey,
      });
      clientStore.set(req.session.id, client);
      req.session.authenticated = true;
    }
  }

  res.json({ authenticated: Boolean(client) });
});

module.exports = router;
