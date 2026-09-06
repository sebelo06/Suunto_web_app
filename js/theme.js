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

export function initTheme() {
  state.currentTheme = "dark";
  document.documentElement.setAttribute("data-theme", "dark");
}
