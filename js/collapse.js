// js/collapse.js
// Repli progressif des sections denses de l'onglet « Suivi ».
// Chaque <section class="dash-block" data-collapsible> a un en-tête cliquable
// (.block-toggle) et un corps (.dash-block-body). Les sections marquées
// data-default-collapsed sont repliées au tout premier chargement, pour offrir
// un « premier contact » calme ; l'état choisi ensuite est mémorisé.
//
// Le corps reste dans le flux (grille 0fr/1fr) même replié : sa LARGEUR est donc
// correcte au rendu, ce qui évite aux graphes SVG de se dessiner à une largeur
// nulle quand leur section démarre repliée.

const KEY = "suunto-collapsed-sections";

function hasSaved() {
  try { return localStorage.getItem(KEY) !== null; } catch { return false; }
}
function readSaved() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}
function writeSaved(ids) {
  try { localStorage.setItem(KEY, JSON.stringify([...ids])); } catch { /* stockage indisponible */ }
}

function apply(section, btn, collapsed) {
  section.classList.toggle("collapsed", collapsed);
  btn.setAttribute("aria-expanded", String(!collapsed));
}

export function initCollapsibles(root = document) {
  const sections = [...root.querySelectorAll(".dash-block[data-collapsible]")];
  if (!sections.length) return;

  const saved = readSaved();
  const restore = hasSaved();

  const persist = () => {
    const ids = new Set();
    sections.forEach((s) => { if (s.classList.contains("collapsed")) ids.add(s.id); });
    writeSaved(ids);
  };

  sections.forEach((section) => {
    const btn = section.querySelector(".block-toggle");
    const body = section.querySelector(".dash-block-body");
    if (!btn || !body) return;

    const collapsed = restore
      ? saved.has(section.id)
      : section.hasAttribute("data-default-collapsed");
    apply(section, btn, collapsed);

    btn.addEventListener("click", () => {
      apply(section, btn, !section.classList.contains("collapsed"));
      persist();
    });
  });

  // Fige les valeurs par défaut dès le premier affichage, pour qu'un pli
  // ultérieur d'une autre section ne « rouvre » pas celles repliées par défaut.
  if (!restore) persist();
}
