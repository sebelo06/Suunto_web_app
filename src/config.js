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

module.exports = {
  NODE_ENV,
  isProduction,
  PORT: process.env.PORT || 3000,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "http://localhost:5500",
  SESSION_SECRET,
  ORS_API_KEY: process.env.ORS_API_KEY,
};
