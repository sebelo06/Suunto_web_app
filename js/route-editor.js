// js/route-editor.js
import { state } from "./state.js";
import { api } from "./api.js";
import { addTileLayer } from "./theme.js";
import { fetchElevations } from "./map.js";
import { icon } from "./icons.js";
import { formatDistance, formatDuration } from "./format.js";

let editorPoints = []; // [{lat, lng}, ...] — points cliqués par l'utilisateur
let editorMarkers = [];
let editorPolyline = null;
let snappedRoute = null; // [{lat, lng, ele?}, ...] — résultat d'un alignement BRouter, ou null
let snappedPolyline = null;
let routeStats = null; // { distanceMeters, ascentMeters, ... } renvoyé par l'alignement
let routeProvider = null; // moteur ayant produit le tracé ("brouter")
let autoSnapTimer = null; // anti-rebond pour l'alignement automatique
// Compteur monotone : chaque appel d'alignement prend un numéro, et seul le
// résultat du dernier appel émis est appliqué. Plus robuste que comparer le
// nombre de points (couvre aussi un futur déplacement de point ou un
// changement de sport, qui ne changent pas le total).
let snapRequestSeq = 0;

const editorUndoBtn = document.getElementById("editor-undo");
const editorClearBtn = document.getElementById("editor-clear");
const editorSnapBtn = document.getElementById("editor-snap");
const editorDownloadBtn = document.getElementById("editor-download");
const editorSnapStatus = document.getElementById("editor-snap-status");
const editorActivitySelect = document.getElementById("editor-activity");
const routeNameInput = document.getElementById("route-name");
const routeStatsEl = document.getElementById("route-stats");
const routeTilesEl = document.getElementById("route-stat-tiles");
const routeElevRangeEl = document.getElementById("route-elevation-range");
const routeElevPlotEl = document.getElementById("route-elevation-plot");

let elevMapMarker = null; // marqueur de survol synchronisé profil ↔ carte

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

  // Survol de la carte → met en évidence le point correspondant sur le profil
  // (l'inverse du survol du profil, qui bouge un marqueur sur la carte).
  state.editorMap.on("mousemove", onMapHover);
  state.editorMap.on("mouseout", clearElevationHover);

  editorUndoBtn.addEventListener("click", undoEditorPoint);
  editorClearBtn.addEventListener("click", clearEditorRoute);
  editorSnapBtn.addEventListener("click", snapToRoad);
  editorDownloadBtn.addEventListener("click", downloadGpx);
  // Changer de sport réaligne le tracé existant : les chemins choisis dépendent
  // du profil (sentiers en rando, routes rapides à vélo).
  if (editorActivitySelect) {
    editorActivitySelect.addEventListener("change", () => {
      clearSnappedRoute();
      refreshEditorUi();
      if (editorPoints.length >= 2) performSnap({ auto: true });
    });
  }
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
  routeStats = null;
  routeProvider = null;
  if (snappedPolyline) { state.editorMap.removeLayer(snappedPolyline); snappedPolyline = null; }
  editorSnapStatus.style.display = "none";
  hideRouteStats();
}

// Planifie un alignement automatique sur les chemins peu après le dernier
// clic. L'anti-rebond évite d'appeler BRouter à chaque point quand on trace
// vite plusieurs points d'affilée : on n'aligne qu'une fois posé.
function scheduleAutoSnap() {
  if (autoSnapTimer) clearTimeout(autoSnapTimer);
  if (editorPoints.length < 2) return;
  autoSnapTimer = setTimeout(() => {
    autoSnapTimer = null;
    performSnap({ auto: true });
  }, 500);
}

function refreshEditorUi() {
  if (editorPolyline) { state.editorMap.removeLayer(editorPolyline); editorPolyline = null; }
  if (editorPoints.length > 1) {
    editorPolyline = L.polyline(
      editorPoints.map((p) => [p.lat, p.lng]),
      { color: "#7c3aed", weight: 3.5, dashArray: snappedRoute ? "6 6" : null, opacity: snappedRoute ? 0.5 : 1 }
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
    radius: 5, color: "#7c3aed", fillColor: "#7c3aed", fillOpacity: 1,
  }).addTo(state.editorMap);
  editorMarkers.push(marker);
  clearSnappedRoute();
  refreshEditorUi();
  scheduleAutoSnap();
}

function undoEditorPoint() {
  editorPoints.pop();
  const marker = editorMarkers.pop();
  if (marker) state.editorMap.removeLayer(marker);
  clearSnappedRoute();
  refreshEditorUi();
  scheduleAutoSnap();
}

function clearEditorRoute() {
  if (autoSnapTimer) { clearTimeout(autoSnapTimer); autoSnapTimer = null; }
  editorMarkers.forEach((m) => state.editorMap.removeLayer(m));
  editorMarkers = [];
  editorPoints = [];
  clearSnappedRoute();
  refreshEditorUi();
}

// Le bouton « Aligner » ne fait que forcer un ré-alignement immédiat :
// le tracé suit les chemins automatiquement à chaque point posé.
function snapToRoad() {
  if (autoSnapTimer) { clearTimeout(autoSnapTimer); autoSnapTimer = null; }
  return performSnap({ auto: false });
}

// Aligne le tracé sur les chemins via BRouter et le dessine. En mode auto,
// on ne recadre pas la carte (recadrer à chaque point serait désagréable)
// et un échec reste discret : on garde les segments droits en repli.
async function performSnap({ auto } = {}) {
  if (editorPoints.length < 2) return;

  const originalLabel = editorSnapBtn.textContent;
  editorSnapBtn.disabled = true;
  editorSnapBtn.textContent = "Alignement…";
  if (!auto) editorSnapStatus.style.display = "none";

  // Numérote cet appel : si l'utilisateur édite le tracé ou change de sport
  // pendant la requête, un appel plus récent aura un numéro supérieur et ce
  // résultat-ci sera ignoré à son retour.
  const seq = ++snapRequestSeq;
  const activityType = editorActivitySelect ? editorActivitySelect.value : "hiking";

  try {
    const result = await api("/api/route/snap", {
      method: "POST",
      body: JSON.stringify({ points: editorPoints, activityType }),
    });
    if (seq !== snapRequestSeq) return; // résultat périmé
    snappedRoute = result.points;
    routeStats = result.stats || null;
    routeProvider = result.provider || null;

    if (snappedPolyline) state.editorMap.removeLayer(snappedPolyline);
    snappedPolyline = L.polyline(
      snappedRoute.map((p) => [p.lat, p.lng]),
      { color: "#f43f5e", weight: 4 }
    ).addTo(state.editorMap);
    if (!auto) state.editorMap.fitBounds(snappedPolyline.getBounds(), { padding: [24, 24] });

    editorSnapStatus.style.display = "none";
    renderRouteStats(routeStats, routeProvider, snappedRoute);
    refreshEditorUi(); // repasse le tracé des waypoints en pointillé
  } catch (err) {
    // En auto on reste silencieux et on garde le tracé droit en repli ;
    // en manuel on remonte l'erreur pour que l'utilisateur comprenne.
    if (seq === snapRequestSeq && !auto) {
      hideRouteStats();
      editorSnapStatus.textContent = err.message;
      editorSnapStatus.style.display = "block";
    }
  } finally {
    if (seq === snapRequestSeq) {
      editorSnapBtn.textContent = originalLabel;
      editorSnapBtn.disabled = editorPoints.length < 2;
    }
  }
}

// --- Panneau de stats visuel : tuiles + profil altimétrique --------------

const ENGINE_LABELS = { brouter: "BRouter" };
let elevationProfile = []; // [{ d(m), ele, lat, lng }] pour le survol synchronisé

function hideRouteStats() {
  if (routeStatsEl) routeStatsEl.hidden = true;
  clearElevationHover();
  elevationProfile = [];
}

// Construit le profil (distance cumulée + altitude) à partir des points alignés,
// et en dérive gain/perte/min/max — de la même série que la courbe, pour que les
// chiffres affichés correspondent exactement à ce qui est tracé.
function buildElevationProfile(points) {
  const profile = [];
  let cumulative = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) cumulative += haversineMeters(points[i - 1], p);
    if (Number.isFinite(p.ele)) {
      profile.push({ d: cumulative, ele: p.ele, lat: p.lat, lng: p.lng });
    }
  }
  if (profile.length < 2) return null;

  let gain = 0, loss = 0;
  let min = profile[0].ele, max = profile[0].ele;
  for (let i = 1; i < profile.length; i++) {
    const delta = profile[i].ele - profile[i - 1].ele;
    // Seuil anti-bruit : on ignore les micro-variations du modèle d'altitude.
    if (delta > 0.5) gain += delta;
    else if (delta < -0.5) loss += -delta;
    if (profile[i].ele < min) min = profile[i].ele;
    if (profile[i].ele > max) max = profile[i].ele;
  }
  return { profile, gain, loss, min, max, total: cumulative };
}

function tile(iconName, accent, value, unit, label) {
  const unitHtml = unit ? `<span class="unit">${unit}</span>` : "";
  return `
    <div class="stat-tile" style="--tile-accent: ${accent};">
      <span class="tile-icon">${icon(iconName, 18)}</span>
      <div class="value">${value}${unitHtml}</div>
      <div class="label">${label}</div>
    </div>`;
}

function renderRouteStats(stats, provider, points) {
  if (!routeStatsEl) return;
  const elev = buildElevationProfile(points);
  // Le gain/perte du profil priment (cohérents avec la courbe) ; sinon on
  // retombe sur l'ascension filtrée renvoyée par le moteur.
  const gain = elev ? elev.gain : stats?.ascentMeters;
  const loss = elev ? elev.loss : stats?.descentMeters;

  const tiles = [];
  if (Number.isFinite(stats?.distanceMeters)) {
    tiles.push(tile("activity", "var(--signal)", formatDistance(stats.distanceMeters), "", "Distance"));
  }
  if (Number.isFinite(gain)) {
    tiles.push(tile("mountain", "var(--signal)", String(Math.round(gain)), "m", "Dénivelé +"));
  }
  if (Number.isFinite(loss)) {
    tiles.push(tile("mountain", "#5b8def", String(Math.round(loss)), "m", "Dénivelé −"));
  }
  if (Number.isFinite(stats?.durationSeconds) && stats.durationSeconds > 0) {
    tiles.push(tile("gauge", "#c084fc", formatDuration(stats.durationSeconds), "", "Durée est."));
  }
  const badge = ENGINE_LABELS[provider]
    ? `<span class="route-engine-badge">Tracé aligné via ${ENGINE_LABELS[provider]}</span>`
    : "";
  routeTilesEl.innerHTML = tiles.join("") + badge;

  const elevationFig = document.getElementById("route-elevation");
  if (elev) {
    elevationFig.hidden = false;
    routeElevRangeEl.textContent = `${Math.round(elev.max)} m max · ${Math.round(elev.min)} m min`;
    renderElevationChart(elev);
  } else {
    elevationFig.hidden = true;
    clearElevationHover();
    elevationProfile = [];
  }

  routeStatsEl.hidden = false;
}

// Trace le profil en aire (SVG inline) et branche le survol synchronisé.
function renderElevationChart(elev) {
  const W = 600, H = 168, padL = 34, padR = 10, padT = 10, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const range = elev.max - elev.min || 1;
  const x = (d) => padL + (d / (elev.total || 1)) * plotW;
  const y = (e) => padT + (1 - (e - elev.min) / range) * plotH;
  const bottom = padT + plotH;

  elevationProfile = elev.profile;

  const linePts = elev.profile.map((p) => `${x(p.d).toFixed(1)} ${y(p.ele).toFixed(1)}`);
  const linePath = "M" + linePts.join(" L");
  const areaPath = `${linePath} L${x(elev.total).toFixed(1)} ${bottom} L${padL} ${bottom} Z`;

  // Point le plus haut, pour le marquer.
  let peak = elev.profile[0];
  for (const p of elev.profile) if (p.ele > peak.ele) peak = p;

  // Lignes de grille + labels Y (min, tiers, max) et labels X (0, milieu, total).
  const yTicks = [elev.min, elev.min + range / 3, elev.min + (2 * range) / 3, elev.max];
  const grid = yTicks
    .map((e) => `<line class="elev-grid" x1="${padL}" y1="${y(e).toFixed(1)}" x2="${W - padR}" y2="${y(e).toFixed(1)}"/>`)
    .join("");
  const yLabels = yTicks
    .map((e) => `<text class="elev-axis" x="${padL - 5}" y="${(y(e) + 3).toFixed(1)}" text-anchor="end">${Math.round(e)}</text>`)
    .join("");
  const km = (m) => (m / 1000).toFixed(1);
  const xLabels = `
    <text class="elev-axis" x="${padL}" y="${H - 6}" text-anchor="start">0 km</text>
    <text class="elev-axis" x="${padL + plotW / 2}" y="${H - 6}" text-anchor="middle">${km(elev.total / 2)} km</text>
    <text class="elev-axis" x="${W - padR}" y="${H - 6}" text-anchor="end">${km(elev.total)} km</text>`;

  routeElevPlotEl.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      ${grid}${yLabels}${xLabels}
      <path class="elev-area" d="${areaPath}"/>
      <path class="elev-line" d="${linePath}"/>
      <circle class="elev-peak" cx="${x(peak.d).toFixed(1)}" cy="${y(peak.ele).toFixed(1)}" r="4"/>
      <line class="elev-guide" id="elev-guide" x1="0" y1="${padT}" x2="0" y2="${bottom}"/>
      <circle class="elev-cursor" id="elev-cursor" cx="0" cy="0" r="4"/>
      <rect id="elev-overlay" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair"/>
    </svg>
    <div class="route-elevation-tip" id="elev-tip"></div>`;

  // Mémorise les fonctions d'échelle pour positionner le curseur au survol.
  routeElevPlotEl._scale = { x, y, padL, plotW };
  const overlay = routeElevPlotEl.querySelector("#elev-overlay");
  overlay.addEventListener("pointermove", (e) => {
    const rect = overlay.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    highlightElevation(nearestByDistance(ratio * elev.total));
  });
  overlay.addEventListener("pointerleave", clearElevationHover);
}

// Index du point de profil le plus proche d'une distance cumulée donnée.
function nearestByDistance(targetD) {
  let lo = 0, hi = elevationProfile.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (elevationProfile[mid].d < targetD) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(elevationProfile[lo - 1].d - targetD) < Math.abs(elevationProfile[lo].d - targetD)) {
    return lo - 1;
  }
  return lo;
}

// Met en évidence un point : guide + curseur sur le profil, marqueur sur la carte.
function highlightElevation(index) {
  const p = elevationProfile[index];
  const scale = routeElevPlotEl._scale;
  if (!p || !scale) return;
  const px = scale.x(p.d), py = scale.y(p.ele);
  const guide = routeElevPlotEl.querySelector("#elev-guide");
  const cursor = routeElevPlotEl.querySelector("#elev-cursor");
  const tip = routeElevPlotEl.querySelector("#elev-tip");
  if (guide) { guide.setAttribute("x1", px); guide.setAttribute("x2", px); guide.style.opacity = "1"; }
  if (cursor) { cursor.setAttribute("cx", px); cursor.setAttribute("cy", py); cursor.style.opacity = "1"; }
  if (tip) {
    tip.textContent = `${Math.round(p.ele)} m · ${(p.d / 1000).toFixed(1)} km`;
    tip.style.left = `${(scale.padL + (p.d / (elevationProfile[elevationProfile.length - 1].d || 1)) * scale.plotW) / 600 * 100}%`;
    tip.style.opacity = "1";
  }
  // Marqueur synchronisé sur la carte.
  if (!elevMapMarker) {
    elevMapMarker = L.circleMarker([p.lat, p.lng], {
      radius: 6, color: "#fff", weight: 2, fillColor: "#f43f5e", fillOpacity: 1,
      interactive: false, // ne pas intercepter les événements de survol de la carte
    }).addTo(state.editorMap);
  } else {
    elevMapMarker.setLatLng([p.lat, p.lng]);
  }
}

// Survol de la carte : trouve le point du profil le plus proche du curseur (en
// pixels écran) et le met en évidence s'il est assez près du tracé.
function onMapHover(e) {
  if (elevationProfile.length < 2) return;
  const cursor = e.containerPoint;
  let best = -1, bestDist2 = Infinity;
  for (let i = 0; i < elevationProfile.length; i++) {
    const pt = state.editorMap.latLngToContainerPoint([elevationProfile[i].lat, elevationProfile[i].lng]);
    const dx = pt.x - cursor.x, dy = pt.y - cursor.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < bestDist2) { bestDist2 = dist2; best = i; }
  }
  if (best >= 0 && bestDist2 <= 24 * 24) highlightElevation(best);
  else clearElevationHover();
}

function clearElevationHover() {
  const guide = routeElevPlotEl?.querySelector("#elev-guide");
  const cursor = routeElevPlotEl?.querySelector("#elev-cursor");
  const tip = routeElevPlotEl?.querySelector("#elev-tip");
  if (guide) guide.style.opacity = "0";
  if (cursor) cursor.style.opacity = "0";
  if (tip) tip.style.opacity = "0";
  if (elevMapMarker) { state.editorMap.removeLayer(elevMapMarker); elevMapMarker = null; }
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

  // Quand le tracé aligné porte déjà l'altitude à chaque point (renvoyée par
  // BRouter), on l'exporte tel quel : pas de densification ni
  // d'appel séparé au service d'altitude. On ne retombe sur ce pipeline que
  // pour un export en ligne droite (tracé non aligné).
  const snappedHasElevation =
    snappedRoute && snappedRoute.length >= 2 && snappedRoute.every((p) => p.ele != null);

  let pointsWithElevation;
  if (snappedHasElevation) {
    pointsWithElevation = snappedRoute;
  } else {
    const densePoints = densifyRoute(snappedRoute || editorPoints);
    editorDownloadBtn.textContent = "Récupération de l'altitude…";
    pointsWithElevation = densePoints;
    try {
      const elevations = await fetchElevations(densePoints);
      pointsWithElevation = densePoints.map((p, i) => ({ ...p, ele: elevations[i] }));
    } catch (err) {
      console.error("Altitude indisponible, export sans élévation:", err);
    }
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
