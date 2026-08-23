// js/theme.js
import { state } from "./state.js";

// localStorage peut lever (navigation privée Safari, contexte sandboxé) :
// on ne veut jamais que ça bloque le rendu de l'appli pour autant.
function readStoredTheme() {
  try { return localStorage.getItem("suunto-theme"); } catch { return null; }
}
function writeStoredTheme(theme) {
  try { localStorage.setItem("suunto-theme", theme); } catch { /* ignore */ }
}

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

export function addTileLayer(map, theme) {
  const base = makeBaseTileLayer(theme).addTo(map);
  const topo = makeTopoTileLayer();
  const sport = makeSportTileLayer();
  L.control
    .layers({ Carte: base, "Course/Vélo": sport, Relief: topo }, null, { position: "topright", collapsed: true })
    .addTo(map);
  return base;
}

export function initTheme() {
  const themeToggle = document.getElementById("theme-toggle");
  state.currentTheme = readStoredTheme() || "light";

  function applyTheme(theme) {
    state.currentTheme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.textContent = theme === "dark" ? "Mode clair" : "Mode sombre";
    writeStoredTheme(theme);
    if (state.currentTileLayer && state.currentMap) {
      state.currentMap.removeLayer(state.currentTileLayer);
      state.currentTileLayer = addTileLayer(state.currentMap, theme);
    }
    if (state.editorTileLayer && state.editorMap) {
      state.editorMap.removeLayer(state.editorTileLayer);
      state.editorTileLayer = addTileLayer(state.editorMap, theme);
    }
    if (state.overviewTileLayer && state.overviewMap) {
      state.overviewMap.removeLayer(state.overviewTileLayer);
      state.overviewTileLayer = addTileLayer(state.overviewMap, theme);
    }
  }

  themeToggle.addEventListener("click", () => {
    applyTheme(state.currentTheme === "dark" ? "light" : "dark");
  });

  applyTheme(state.currentTheme);
}
