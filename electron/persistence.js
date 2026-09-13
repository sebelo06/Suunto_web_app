// electron/persistence.js
//
// Adaptateur de persistance de session pour le mode desktop. Stocke le
// credential { email, sessionKey } dans le dossier userData de l'app,
// chiffré au repos via `safeStorage` (adossé au Keychain macOS / DPAPI
// Windows / libsecret Linux). On ne stocke jamais le mot de passe : le
// sessionKey est un jeton bearer, révocable côté Suunto.
//
// Branché sur le seam src/stores/sessionPersistence via `use()` au démarrage
// (voir electron/server.js). Doit être utilisé après app.whenReady() pour que
// getPath('userData') et safeStorage soient disponibles.

const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");

function filePath() {
  return path.join(app.getPath("userData"), "suunto-session.bin");
}

module.exports = {
  save({ email, sessionKey }) {
    const json = JSON.stringify({ email, sessionKey });
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, "utf8"); // fallback rare (keychain indisponible)
    try {
      fs.writeFileSync(filePath(), data, { mode: 0o600 });
    } catch (err) {
      console.error("Persistance session: échec écriture", err.message);
    }
  },

  load() {
    try {
      const data = fs.readFileSync(filePath());
      const json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(data)
        : data.toString("utf8");
      return JSON.parse(json);
    } catch {
      return null; // pas de credential, ou illisible -> on repart du login
    }
  },

  clear() {
    try {
      fs.unlinkSync(filePath());
    } catch {
      /* déjà absent : rien à faire */
    }
  },
};
