// src/stores/clientStore.js
//
// Table sessionId -> instance SuuntoClient authentifiée, derrière une
// interface simple (get/set/delete) plutôt qu'une Map exposée directement.
//
// L'implémentation par défaut est en mémoire : elle ne survit pas à un
// redémarrage et n'est pas partagée entre plusieurs instances du serveur.
// Pour scaler horizontalement, fournis une implémentation qui respecte la
// même interface (ex. un store Redis via `connect-redis`/`ioredis`, en
// sérialisant le sessionKey Suunto plutôt que l'instance SuuntoClient
// elle-même) et remplace `module.exports` ci-dessous.

class InMemoryClientStore {
  constructor() {
    this.clients = new Map();
  }

  get(sessionId) {
    return this.clients.get(sessionId);
  }

  set(sessionId, client) {
    this.clients.set(sessionId, client);
  }

  delete(sessionId) {
    this.clients.delete(sessionId);
  }
}

module.exports = new InMemoryClientStore();
