// js/overview-map.js
import { state } from "./state.js";
import { api } from "./api.js";
import { addTileLayer } from "./theme.js";
import { decodePolyline } from "./map.js";

const overviewStatus = document.getElementById("overview-status");
const overviewLoadBtn = document.getElementById("overview-load");

export function initOverviewMap() {
  if (state.overviewInitialized) return;
  state.overviewInitialized = true;
  const center = state.lastKnownWorkoutPosition || [46.6, 2.4];
  const zoom = state.lastKnownWorkoutPosition ? 11 : 6;
  state.overviewMap = L.map("overview-map", { zoomControl: true, attributionControl: true }).setView(center, zoom);
  state.overviewTileLayer = addTileLayer(state.overviewMap, state.currentTheme);
  overviewLoadBtn.addEventListener("click", loadOverviewRoutes);
}

// Superpose les tracés de plusieurs séances avec une faible opacité :
// les zones traversées souvent apparaissent plus lumineuses là où les
// lignes se chevauchent, à la manière d'une carte de chaleur.
async function loadOverviewRoutes() {
  overviewLoadBtn.disabled = true;
  overviewStatus.textContent = "Chargement des séances…";

  try {
    const workouts = await api("/api/workouts?limit=50");
    const withRoute = workouts.filter((w) => w.polyline);

    if (!withRoute.length) {
      overviewStatus.textContent = "Aucune séance avec tracé GPS trouvée parmi les 50 dernières.";
      overviewLoadBtn.disabled = false;
      return;
    }

    const allBounds = [];
    withRoute.forEach((w) => {
      const points = decodePolyline(w.polyline).map(([lat, lng]) => [lat, lng]);
      if (points.length < 2) return;
      L.polyline(points, {
        color: "#ff6a3d",
        weight: 2.5,
        opacity: 0.16,
        lineCap: "round",
      }).addTo(state.overviewMap);
      allBounds.push(...points);
    });

    if (allBounds.length) {
      state.overviewMap.fitBounds(L.latLngBounds(allBounds), { padding: [24, 24] });
    }

    overviewStatus.textContent = `${withRoute.length} séance${withRoute.length > 1 ? "s" : ""} affichée${withRoute.length > 1 ? "s" : ""} sur ${workouts.length} chargée${workouts.length > 1 ? "s" : ""}.`;
  } catch (err) {
    overviewStatus.textContent = err.message;
  } finally {
    overviewLoadBtn.disabled = false;
  }
}
