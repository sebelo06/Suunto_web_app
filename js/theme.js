// js/theme.js
import { state } from "./state.js";

const TILE_URLS = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
};

function makeBaseTileLayer(theme) {
  return L.tileLayer(TILE_URLS[theme] || TILE_URLS.dark, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20,
    maxNativeZoom: 20,
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

export function addTileLayer(map, theme) {
  const base = makeBaseTileLayer(theme).addTo(map);
  const topo = makeTopoTileLayer();
  const sport = makeSportTileLayer();
  const osm = makeOsmTileLayer();
  L.control
    .layers({ Carte: base, "Course/Vélo": sport, Relief: topo, OpenStreetMap: osm }, null, { position: "topright", collapsed: true })
    .addTo(map);
  return base;
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

// Met à jour les tuiles des cartes déjà instanciées quand le thème change.
function refreshMapTiles(theme) {
  const url = TILE_URLS[theme] || TILE_URLS.dark;
  [state.currentTileLayer, state.editorTileLayer, state.overviewTileLayer].forEach((layer) => {
    if (layer && typeof layer.setUrl === "function") layer.setUrl(url);
  });
}

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
