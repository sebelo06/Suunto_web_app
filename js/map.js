// js/map.js
import { state } from "./state.js";
import { addTileLayer } from "./theme.js";

// Décodeur d'encoded polyline (algorithme standard Google, précision 5),
// pour ne pas dépendre d'une librairie de carte externe.
export function decodePolyline(encoded) {
  let index = 0, lat = 0, lng = 0;
  const points = [];
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// Sous-échantillonne pour rester raisonnable en nombre d'appels à
// l'API d'altitude sur les longs parcours (juste pour la coloration,
// le tracé affiché reste basé sur tous les points GPS d'origine).
function subsamplePoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const factor = Math.ceil(points.length / maxPoints);
  return points.filter((_, i) => i % factor === 0 || i === points.length - 1);
}

// Interroge Open Topo Data (API publique gratuite, sans clé) pour
// l'altitude de chaque point. eudem25m (25 m, Europe) en priorité,
// avec repli sur srtm30m si le point est hors de sa couverture.
// Par lots de 100 points max, avec un léger délai entre lots pour
// respecter la limite de 1 requête/seconde de l'API publique.
export async function fetchElevations(points) {
  const CHUNK_SIZE = 100;
  const results = [];

  for (let i = 0; i < points.length; i += CHUNK_SIZE) {
    const chunk = points.slice(i, i + CHUNK_SIZE);
    const locations = chunk.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|");
    const url = `https://api.opentopodata.org/v1/eudem25m,srtm30m?locations=${locations}`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === "OK") {
        data.results.forEach((r) => results.push(r.elevation));
      } else {
        chunk.forEach(() => results.push(null));
      }
    } catch {
      chunk.forEach(() => results.push(null));
    }

    if (i + CHUNK_SIZE < points.length) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }

  return results;
}

async function colorRouteByElevation(map, initialLine, points) {
  if (typeof L.hotline !== "function") return; // plugin non chargé, on garde le tracé uni
  const sampled = subsamplePoints(points, 150).map(([lat, lng]) => ({ lat, lng }));

  try {
    const elevations = await fetchElevations(sampled);
    const valid = elevations.filter((e) => e != null);
    if (!valid.length) return;

    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const hotlineData = sampled.map((p, i) => [p.lat, p.lng, elevations[i] ?? min]);

    if (map.hasLayer(initialLine)) map.removeLayer(initialLine);
    L.hotline(hotlineData, {
      min, max,
      palette: { 0.0: "#4fd1c0", 0.5: "#e8c547", 1.0: "#ff6a3d" },
      weight: 4,
      outlineWidth: 0,
    }).addTo(map);
  } catch (err) {
    console.error("Altitude indisponible, tracé laissé en couleur unie:", err);
  }
}

export function buildRouteMap(containerId, points) {
  if (!points.length) return;
  requestAnimationFrame(() => {
    const map = L.map(containerId, { zoomControl: true, attributionControl: true });
    state.currentMap = map;
    state.currentTileLayer = addTileLayer(map, state.currentTheme);

    const latLngs = points; // déjà au format [lat, lng]
    const initialLine = L.polyline(latLngs, { color: "#49c6b5", weight: 3.5 }).addTo(map);
    map.fitBounds(initialLine.getBounds(), { padding: [24, 24] });

    L.circleMarker(latLngs[0], { radius: 6, color: "#49c6b5", fillColor: "#49c6b5", fillOpacity: 1 }).addTo(map);
    L.circleMarker(latLngs[latLngs.length - 1], { radius: 6, color: "#ff6a3d", fillColor: "#ff6a3d", fillOpacity: 1 }).addTo(map);

    // Amélioration progressive : une fois l'altitude récupérée pour
    // chaque point, on remplace le trait uni par un tracé coloré du
    // bleu-vert (bas) à l'orange (haut), pour visualiser le profil
    // du parcours directement sur la carte.
    colorRouteByElevation(map, initialLine, latLngs);
  });
}
