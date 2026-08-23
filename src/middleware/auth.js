// src/middleware/auth.js
const clientStore = require("../stores/clientStore");

function requireSuuntoClient(req, res, next) {
  const client = clientStore.get(req.session.id);
  if (!client) {
    return res.status(401).json({ error: "Non authentifié. Appelle /api/login d'abord." });
  }
  req.suunto = client;
  next();
}

// Pour les routes qui n'ont pas besoin du client Suunto (ex: snap-to-road)
// mais qu'on veut quand même réserver aux utilisateurs connectés, pour ne
// pas laisser n'importe qui consommer le quota de la clé ORS.
function requireSession(req, res, next) {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: "Non authentifié. Appelle /api/login d'abord." });
  }
  next();
}

module.exports = { requireSuuntoClient, requireSession };
