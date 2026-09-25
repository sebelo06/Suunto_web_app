// js/theme.js
import { state } from "./state.js";

// Fond de carte principal : OpenStreetMap standard, gratuit et SANS clé API.
// (CARTO a supprimé son fond gratuit ; ses tuiles renvoient désormais une
// image « API key required ».) Le thème sombre est obtenu côté CSS via un
// filtre appliqué à la classe « base-tiles » quand data-theme="dark" ; on ne
// change donc plus l'URL selon le thème.
const BASE_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

function makeBaseTileLayer() {
  return L.tileLayer(BASE_TILE_URL, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: "abc",
    maxZoom: 19,
    maxNativeZoom: 19,
    className: "base-tiles",
  });
}

function makeTopoTileLayer() {
  return L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    subdomains: "abc",
    maxZoom: 17,
    maxNativeZoom: 17,
  });
}

function makeSportTileLayer() {
  return L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | &copy; <a href="https://www.cyclosm.org">CyclOSM</a>',
    subdomains: "abc",
    maxZoom: 20,
    maxNativeZoom: 20,
    // Comme le fond par défaut, on laisse le filtre CSS « base-tiles »
    // l'assombrir en thème sombre.
    className: "base-tiles",
  });
}

function makeOsmTileLayer() {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: "abc",
    maxZoom: 19,
    maxNativeZoom: 19,
  });
}

export function addTileLayer(map) {
  const base = makeBaseTileLayer();
  const topo = makeTopoTileLayer();
  const sport = makeSportTileLayer().addTo(map); // CyclOSM : fond par défaut
  const osm = makeOsmTileLayer();
  L.control
    .layers({ "Course/Vélo": sport, Carte: base, Relief: topo, OpenStreetMap: osm }, null, { position: "topright", collapsed: true })
    .addTo(map);
  return sport;
}

// --- Gestion du thème : clair / sombre / système -------------------------

const STORAGE_KEY = "suunto-theme";
const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

function readPref() {
  try {
    const p = localStorage.getItem(STORAGE_KEY);
    return p === "light" || p === "dark" || p === "system" ? p : "system";
  } catch {
    return "system";
  }
}

function writePref(pref) {
  try { localStorage.setItem(STORAGE_KEY, pref); } catch { /* ignore */ }
}

// Résout une préférence (dont « system ») vers un thème concret.
function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return darkMedia.matches ? "dark" : "light";
}

// Le fond de carte de base est identique en clair et en sombre : c'est un
// filtre CSS (voir « .base-tiles » dans styles.css, actif sous
// data-theme="dark") qui l'assombrit. Rien à recharger côté tuiles au
// changement de thème — data-theme est déjà posé sur <html> par applyTheme.
function refreshMapTiles() {}

// Reflète la préférence active dans le sélecteurs de thème.
function syncSwitch(pref) {
  document.querySelectorAll(".theme-switch [data-theme-choice]").forEach((btn) => {
    const on = btn.dataset.themeChoice === pref;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

function applyTheme(pref) {
  const theme = resolveTheme(pref);
  state.currentTheme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  refreshMapTiles(theme);
  syncSwitch(pref);
}

export function initTheme() {
  applyTheme(readPref());

  // Plusieurs sélecteurs coexistent (écran de connexion + bandeau du
  // tableau de bord) : on écoute au niveau du document et on les
  // resynchronise tous via syncSwitch().
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".theme-switch [data-theme-choice]");
    if (!btn) return;
    const pref = btn.dataset.themeChoice;
    writePref(pref);
    applyTheme(pref);
  });

  // En mode « système », suit les changements de préférence de l'OS en direct.
  darkMedia.addEventListener("change", () => {
    if (readPref() === "system") applyTheme("system");
  });
}
