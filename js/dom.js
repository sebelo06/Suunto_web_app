// js/dom.js
//
// Échappe une valeur avant de l'injecter dans un template innerHTML, pour
// les cas où le texte affiché ne vient pas d'une énumération fixe côté
// client (ex: messages d'erreur renvoyés par le backend).
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
