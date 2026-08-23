// js/dash-greeting.js
//
// En-tête d'accueil ("Bon retour" + date du jour), utilisé par auth.js
// (état initial) et workout-detail.js (remplacé par le nom/date de la
// séance ouverte). Module séparé sans dépendance pour éviter un cycle
// d'imports entre ces deux-là.
const dashGreetingTitle = document.getElementById("dash-greeting-title");
const dashDate = document.getElementById("dash-date");

export function resetDashGreeting() {
  dashGreetingTitle.textContent = "Bon retour";
  dashDate.textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export function setDashGreeting(title, dateText) {
  dashGreetingTitle.textContent = title;
  dashDate.textContent = dateText;
}
