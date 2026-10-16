// js/history.js
//
// Historique de séances PARTAGÉ : plusieurs cartes (ACWR, volume, zones FC,
// régularité, prédiction, forme du jour) ont besoin de remonter plus loin que
// la première page de la liste. Plutôt que de re-parcourir chacune
// /api/workouts (et de griller le rate limit du backend), on charge l'historique
// une seule fois, page par page, et on ne va chercher que ce qui manque quand
// une carte demande plus de profondeur.
import { api } from "./api.js";

const PAGE = 40;

let all = [];
let exhausted = false;
let queue = Promise.resolve(); // sérialise les chargements concurrents

const oldestMs = () => Math.min(...all.map((w) => new Date(w.startTime).getTime()));

async function fill(minDays, maxPages) {
  while (!exhausted && all.length < maxPages * PAGE) {
    if (all.length) {
      const oldest = oldestMs();
      if (Number.isFinite(oldest) && (Date.now() - oldest) / 86400000 >= minDays) break;
    }
    const page = await api(`/api/workouts?limit=${PAGE}&offset=${all.length}`);
    if (!Array.isArray(page) || !page.length) { exhausted = true; break; }
    all = all.concat(page);
    if (page.length < PAGE) exhausted = true;
  }
}

// Renvoie les séances couvrant au moins `minDays` jours (ou tout l'historique
// si plus court), dans la limite de `maxPages` pages. Les appels concurrents
// partagent le même cache ; une erreur réseau ne bloque pas les suivants.
export function loadHistory({ minDays, maxPages = 20 }) {
  const run = queue.then(() => fill(minDays, maxPages));
  queue = run.catch(() => {});
  return run.then(() => all.slice());
}

// À appeler à la connexion / déconnexion : un autre compte ne doit pas voir
// l'historique du précédent.
export function resetHistory() {
  all = [];
  exhausted = false;
}
