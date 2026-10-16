// src/config.js
//
// Centralise la lecture et la validation des variables d'environnement.
// En production, on préfère planter au démarrage plutôt que de tourner
// avec un secret de session par défaut connu de tout le monde.

const DEFAULT_SESSION_SECRET = "change-moi-en-prod";

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;

if (isProduction && SESSION_SECRET === DEFAULT_SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET manquant ou laissé à sa valeur par défaut alors que NODE_ENV=production. " +
      "Définis une vraie valeur secrète (voir .env.example) avant de démarrer le serveur."
  );
}

const DEFAULT_FRONTEND_ORIGINS = ["http://localhost:5500", "http://localhost:8080"];
const FRONTEND_ORIGINS = process.env.FRONTEND_ORIGIN
  ? process.env.FRONTEND_ORIGIN.split(",").map((o) => o.trim())
  : DEFAULT_FRONTEND_ORIGINS;

const DEMO = ["1", "true"].includes(String(process.env.SUUNTO_DEMO || "").toLowerCase());

module.exports = {
  DEMO,
  NODE_ENV,
  isProduction,
  PORT: process.env.PORT || 3000,
  FRONTEND_ORIGIN: FRONTEND_ORIGINS,
  SESSION_SECRET,
};
