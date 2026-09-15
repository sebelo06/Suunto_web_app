// js/main.js
import { state } from "./state.js";
import { initTheme } from "./theme.js";
import { initAuth, showLogin } from "./auth.js";
import { initEvolutionTab, renderEvolution } from "./evolution.js";
import { initRouteEditor } from "./route-editor.js";
import { initOverviewMap } from "./overview-map.js";
import { initCollapsibles } from "./collapse.js";
import "./workout-detail.js"; // câble le tiroir de détail (backdrop, Échap)
import "./workouts.js"; // câble le bouton "charger plus de séances"

initTheme();
initAuth();
initEvolutionTab();
initCollapsibles();

// --- Sidebar réductible --------------------------------------------------

const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");

function readSidebarCollapsed() {
  try { return localStorage.getItem("suunto-sidebar-collapsed") === "1"; } catch { return false; }
}
function writeSidebarCollapsed(collapsed) {
  try { localStorage.setItem("suunto-sidebar-collapsed", collapsed ? "1" : "0"); } catch { /* ignore */ }
}

if (readSidebarCollapsed()) {
  sidebar.classList.add("collapsed");
  sidebarToggle.setAttribute("aria-pressed", "true");
}

sidebarToggle.addEventListener("click", () => {
  const collapsed = sidebar.classList.toggle("collapsed");
  sidebarToggle.setAttribute("aria-pressed", String(collapsed));
  sidebarToggle.setAttribute("aria-label", collapsed ? "Développer le menu" : "Réduire le menu");
  writeSidebarCollapsed(collapsed);
});

// --- Onglets -----------------------------------------------------------

const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = {
  evolution: document.getElementById("tab-evolution"),
  tracking: document.getElementById("tab-tracking"),
  sessions: document.getElementById("tab-sessions"),
  itinerary: document.getElementById("tab-itinerary"),
  overview: document.getElementById("tab-overview"),
};

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    if (btn.classList.contains("active")) return;
    tabButtons.forEach((b) => {
      const on = b === btn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    Object.entries(tabPanels).forEach(([name, panel]) => {
      panel.style.display = name === tab ? "block" : "none";
      panel.classList.remove("enter");
    });
    const activePanel = tabPanels[tab];
    void activePanel.offsetWidth; // force le reflow pour rejouer l'animation
    activePanel.classList.add("enter");
    if (tab === "itinerary") {
      // La carte Leaflet doit être initialisée (et redimensionnée)
      // seulement une fois son conteneur visible, sinon elle se
      // rend avec une taille nulle.
      initRouteEditor();
      requestAnimationFrame(() => state.editorMap && state.editorMap.invalidateSize());
    }
    if (tab === "overview") {
      initOverviewMap();
      requestAnimationFrame(() => state.overviewMap && state.overviewMap.invalidateSize());
    }
    if (tab === "evolution") {
      // Le conteneur du graphique a une largeur nulle tant que l'onglet
      // est caché ; on redessine une fois qu'il devient visible.
      requestAnimationFrame(() => renderEvolution());
    }
  });
});

// Au chargement : pas de vérification de session automatique ici
// (l'API ne fournit pas de "/me"). On part sur l'écran de connexion.
showLogin();
