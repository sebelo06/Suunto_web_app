// js/info-pop.js
// Petite infobulle « c'est quoi ? » réutilisable pour expliquer une métrique
// avancée (ACWR, forme du jour…). Un bouton « i » suivi d'un panneau : il
// s'ouvre au survol / focus, se fige au clic, se ferme sur Échap ou clic dehors.
// Le style vit dans css/styles.css (.info-pop-btn / .info-pop).
//
// Le bouton et le panneau sont insérés comme frères dans un en-tête en
// position:relative ; le panneau s'ancre donc sur cet en-tête.

import { icon } from "./icons.js";

let uid = 0;

// Renvoie le HTML (bouton + panneau) à injecter dans un en-tête de carte.
// `bodyHTML` = contenu déjà en HTML (paragraphes courts, <b> autorisés).
export function infoPop(title, bodyHTML, label = "À propos de cette métrique") {
  const id = `ipop-${++uid}`;
  return (
    `<button type="button" class="info-pop-btn" aria-label="${label}" aria-expanded="false" aria-controls="${id}" title="${label}">${icon("info", 15)}</button>` +
    `<div class="info-pop" id="${id}" role="tooltip" hidden><div class="info-pop-title">${title}</div>${bodyHTML}</div>`
  );
}

// Câble tous les couples bouton/panneau sous `root` (idempotent).
export function wireInfoPops(root = document) {
  root.querySelectorAll(".info-pop-btn").forEach((btn) => {
    if (btn.dataset.wired) return;
    const pop = root.querySelector(`#${btn.getAttribute("aria-controls")}`);
    if (!pop) return;
    btn.dataset.wired = "1";

    let pinned = false;
    const open = () => { pop.hidden = false; btn.setAttribute("aria-expanded", "true"); };
    const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };

    // Survol : ouverture immédiate, fermeture différée le temps de passer
    // du bouton au panneau sans le voir disparaître.
    const maybeClose = () => {
      if (pinned) return;
      setTimeout(() => {
        if (!pinned && !btn.matches(":hover") && !pop.matches(":hover")) close();
      }, 80);
    };
    btn.addEventListener("mouseenter", open);
    pop.addEventListener("mouseenter", open);
    btn.addEventListener("mouseleave", maybeClose);
    pop.addEventListener("mouseleave", maybeClose);

    // Clavier + clic pour figer (accessibilité / tactile).
    btn.addEventListener("focus", open);
    btn.addEventListener("blur", () => { if (!pinned) close(); });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      pinned = !pinned;
      pinned ? open() : close();
    });

    const onKey = (e) => { if (e.key === "Escape") { pinned = false; close(); } };
    const onOutside = (e) => {
      if (pinned && !pop.contains(e.target) && !btn.contains(e.target)) { pinned = false; close(); }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onOutside, true);
  });
}
