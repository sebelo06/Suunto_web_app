// src/utils/unwrap.js
//
// Certains endpoints Suunto renvoient un tableau brut, d'autres une
// enveloppe { error, payload, metadata }. On gère les deux cas ici
// plutôt que de supposer un format unique.
function unwrap(response) {
  return Array.isArray(response) ? response : (response?.payload ?? response);
}

module.exports = { unwrap };
