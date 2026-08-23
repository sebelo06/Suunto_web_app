// js/route-editor.js
import { state } from "./state.js";
import { api } from "./api.js";
import { addTileLayer } from "./theme.js";
import { fetchElevations } from "./map.js";

let editorPoints = []; // [{lat, lng}, ...] — points cliqués par l'utilisateur
let editorMarkers = [];
let editorPolyline = null;
let snappedRoute = null; // [{lat, lng}, ...] — résultat d'un alignement ORS, ou null
let snappedPolyline = null;

const editorUndoBtn = document.getElementById("editor-undo");
const editorClearBtn = document.getElementById("editor-clear");
const editorSnapBtn = document.getElementById("editor-snap");
const editorDownloadBtn = document.getElementById("editor-download");
const editorSnapStatus = document.getElementById("editor-snap-status");
const routeNameInput = document.getElementById("route-name");

export function initRouteEditor() {
  if (state.editorInitialized) return;
  state.editorInitialized = true;

  const center = state.lastKnownWorkoutPosition || [46.6, 2.4];
  const zoom = state.lastKnownWorkoutPosition ? 12 : 6;
  state.editorMap = L.map("editor-map", { zoomControl: true, attributionControl: true }).setView(center, zoom);
  state.editorTileLayer = addTileLayer(state.editorMap, state.currentTheme);
  state.editorMapRecentered = !!state.lastKnownWorkoutPosition;

  state.editorMap.on("click", (e) => {
    addEditorPoint(e.latlng.lat, e.latlng.lng);
  });

  editorUndoBtn.addEventListener("click", undoEditorPoint);
  editorClearBtn.addEventListener("click", clearEditorRoute);
  editorSnapBtn.addEventListener("click", snapToRoad);
  editorDownloadBtn.addEventListener("click", downloadGpx);
}

// Recentre la carte de l'éditeur sur la position d'une séance récente,
// une seule fois (à la création de la carte ou dès que la position est
// connue si la carte existe déjà).
export function recenterEditorMap(position) {
  if (state.editorMap && !state.editorMapRecentered) {
    state.editorMap.setView(position, 12);
    state.editorMapRecentered = true;
  }
}

// Toute modification des points cliqués invalide un alignement précédent :
// le tracé aligné ne correspond plus aux waypoints actuels.
function clearSnappedRoute() {
  snappedRoute = null;
  if (snappedPolyline) { state.editorMap.removeLayer(snappedPolyline); snappedPolyline = null; }
  editorSnapStatus.style.display = "none";
}

function refreshEditorUi() {
  if (editorPolyline) { state.editorMap.removeLayer(editorPolyline); editorPolyline = null; }
  if (editorPoints.length > 1) {
    editorPolyline = L.polyline(
      editorPoints.map((p) => [p.lat, p.lng]),
      { color: "#ff5a2b", weight: 3.5, dashArray: snappedRoute ? "6 6" : null, opacity: snappedRoute ? 0.5 : 1 }
    ).addTo(state.editorMap);
  }
  editorUndoBtn.disabled = editorPoints.length === 0;
  editorClearBtn.disabled = editorPoints.length === 0;
  editorSnapBtn.disabled = editorPoints.length < 2;
  editorDownloadBtn.disabled = editorPoints.length < 2;
}

function addEditorPoint(lat, lng) {
  editorPoints.push({ lat, lng });
  const marker = L.circleMarker([lat, lng], {
    radius: 5, color: "#ff5a2b", fillColor: "#ff5a2b", fillOpacity: 1,
  }).addTo(state.editorMap);
  editorMarkers.push(marker);
  clearSnappedRoute();
  refreshEditorUi();
}

function undoEditorPoint() {
  editorPoints.pop();
  const marker = editorMarkers.pop();
  if (marker) state.editorMap.removeLayer(marker);
  clearSnappedRoute();
  refreshEditorUi();
}

function clearEditorRoute() {
  editorMarkers.forEach((m) => state.editorMap.removeLayer(m));
  editorMarkers = [];
  editorPoints = [];
  clearSnappedRoute();
  refreshEditorUi();
}

async function snapToRoad() {
  editorSnapBtn.disabled = true;
  const originalLabel = editorSnapBtn.textContent;
  editorSnapBtn.textContent = "Alignement…";
  editorSnapStatus.style.display = "none";

  try {
    const result = await api("/api/route/snap", {
      method: "POST",
      body: JSON.stringify({ points: editorPoints }),
    });
    snappedRoute = result.points;

    if (snappedPolyline) state.editorMap.removeLayer(snappedPolyline);
    snappedPolyline = L.polyline(
      snappedRoute.map((p) => [p.lat, p.lng]),
      { color: "#49c6b5", weight: 4 }
    ).addTo(state.editorMap);
    state.editorMap.fitBounds(snappedPolyline.getBounds(), { padding: [24, 24] });

    editorSnapStatus.textContent = "Tracé aligné sur les chemins (pointillés = tes points d'origine).";
    editorSnapStatus.style.display = "block";
    refreshEditorUi(); // repasse le tracé des waypoints en pointillé
  } catch (err) {
    editorSnapStatus.textContent = err.message;
    editorSnapStatus.style.display = "block";
  } finally {
    editorSnapBtn.textContent = originalLabel;
    editorSnapBtn.disabled = editorPoints.length < 2;
  }
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Ajoute des points intermédiaires le long des segments cliqués, pour
// que le tracé (et l'altitude interrogée) suive le terrain plutôt que
// de couper en ligne droite entre deux clics espacés. Espacement
// ~30 m (proche de la résolution du dataset EU-DEM 25 m), plafonné
// pour rester raisonnable en nombre d'appels à l'API d'altitude.
function densifyRoute(points, spacingMeters = 30, maxPoints = 400) {
  if (points.length < 2) return points;
  const dense = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1], cur = points[i];
    const dist = haversineMeters(prev, cur);
    const steps = Math.max(1, Math.round(dist / spacingMeters));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      dense.push({ lat: prev.lat + (cur.lat - prev.lat) * t, lng: prev.lng + (cur.lng - prev.lng) * t });
    }
  }
  if (dense.length > maxPoints) {
    const factor = Math.ceil(dense.length / maxPoints);
    return dense.filter((_, i) => i % factor === 0 || i === dense.length - 1);
  }
  return dense;
}

function buildGpx(points, name) {
  const trkpts = points
    .map((p) => {
      const eleTag = p.ele != null ? `\n        <ele>${p.ele.toFixed(1)}</ele>` : "";
      return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${eleTag}\n      </trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Suivi Suunto" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${(name || "Itinéraire").replace(/[<>&]/g, "")}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

async function downloadGpx() {
  if (editorPoints.length < 2) return;

  editorDownloadBtn.disabled = true;
  const originalLabel = editorDownloadBtn.textContent;
  editorDownloadBtn.textContent = "Calcul du tracé…";

  const densePoints = densifyRoute(snappedRoute || editorPoints);

  editorDownloadBtn.textContent = "Récupération de l'altitude…";
  let pointsWithElevation = densePoints;
  try {
    const elevations = await fetchElevations(densePoints);
    pointsWithElevation = densePoints.map((p, i) => ({ ...p, ele: elevations[i] }));
  } catch (err) {
    console.error("Altitude indisponible, export sans élévation:", err);
  }

  const gpx = buildGpx(pointsWithElevation, routeNameInput.value);
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = (routeNameInput.value || "itineraire").trim().replace(/\s+/g, "-").toLowerCase();
  a.href = url;
  a.download = `${safeName || "itineraire"}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  editorDownloadBtn.textContent = originalLabel;
  editorDownloadBtn.disabled = editorPoints.length < 2;
}
