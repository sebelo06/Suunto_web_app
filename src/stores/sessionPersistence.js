// src/stores/sessionPersistence.js
//
// Seam de persistance du credential de session (email + sessionKey Suunto),
// pour survivre à un redémarrage du process. On persiste le sessionKey — un
// jeton bearer révocable — plutôt que le mot de passe, qui n'est jamais stocké.
//
// Par défaut AUCUN adaptateur n'est branché : c'est un no-op total, donc le
// déploiement web se comporte exactement comme avant (session en mémoire,
// perdue au redémarrage). Le mode desktop (Electron) injecte un adaptateur
// chiffré via `use()` au démarrage.
//
// Interface d'un adaptateur :
//   save({ email, sessionKey })  -> void   (persiste le credential)
//   load()                       -> { email, sessionKey } | null
//   clear()                      -> void   (efface le credential)

let adapter = null;

module.exports = {
  use(impl) {
    adapter = impl;
  },
  save(credential) {
    if (adapter && credential && credential.sessionKey) adapter.save(credential);
  },
  load() {
    return adapter ? adapter.load() : null;
  },
  clear() {
    if (adapter) adapter.clear();
  },
};
