// js/format.js
export function formatDuration(seconds) {
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

export function formatDistance(meters) {
  if (!meters) return "—";
  return (meters / 1000).toFixed(1) + " km";
}

export function formatPace(totalDistanceMeters, totalTimeSeconds) {
  // On calcule l'allure directement à partir de la distance et de la
  // durée totales (déjà utilisées pour les tuiles Distance/Durée),
  // plutôt que de se fier au champ avgPace de l'API dont l'unité
  // réelle s'est révélée peu fiable/incohérente à l'usage.
  if (!totalDistanceMeters || !totalTimeSeconds) return "—";
  const km = totalDistanceMeters / 1000;
  const secPerKm = totalTimeSeconds / km;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, "0")} /km`;
}

export function formatPaceValue(secPerKm) {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export function formatClock(totalSeconds) {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
