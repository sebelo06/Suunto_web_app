// js/wellness.js
import { api } from "./api.js";
import { icon } from "./icons.js";
import { escapeHtml } from "./dom.js";
import { formatDuration } from "./format.js";
import { renderLineChart } from "./charts.js";
import { refreshWeekTile } from "./workouts.js";
import { updateReadinessWellness } from "./readiness.js";

const wellnessTiles = document.getElementById("wellness-tiles");

// Même principe que renderTrendChart, pour la durée de sommeil des
// dernières nuits (triées du plus ancien au plus récent).
function renderSleepTrend(nights) {
  const trendCard = document.getElementById("trend-sleep-card");
  const trendHint = document.getElementById("trend-sleep-hint");
  const recent = nights.slice(0, 8).reverse();
  const items = recent.map((n) => ({
    value: (n.entryData?.duration || 0) / 3600,
    label: new Date(n.entryData?.bedtimeStart || n.timestamp).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
  }));
  const sleepColor = getComputedStyle(document.documentElement).getPropertyValue("--route").trim() || "#4fd1c0";
  renderLineChart(trendCard, items, { color: sleepColor, formatValue: (v) => `${v.toFixed(1)} h` });
  if (trendHint) trendHint.textContent = items.length ? "Heures dormies des 8 dernières nuits" : "";
}

export async function loadWellness() {
  try {
    const [sleep, recovery] = await Promise.all([
      api("/api/wellness/sleep").catch(() => []),
      api("/api/wellness/recovery").catch(() => []),
    ]);

    // Les entrées de sommeil "réelles" (pas les siestes) triées par
    // heure de coucher, on prend la plus récente.
    const nights = (sleep || [])
      .filter((entry) => !entry.entryData?.isNap)
      .sort((a, b) => new Date(b.entryData?.bedtimeStart || b.timestamp) - new Date(a.entryData?.bedtimeStart || a.timestamp));
    const lastNight = nights[0]?.entryData;
    renderSleepTrend(nights);

    // La récupération est envoyée par intervalles de 30 min : on
    // prend la mesure la plus récente.
    const recoveryEntries = [...(recovery || [])].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );
    const lastRecovery = recoveryEntries[0]?.entryData;

    updateReadinessWellness({
      recovery: lastRecovery?.balance ?? null,
      sleepDuration: lastNight?.duration ?? null,
      sleepQuality: lastNight?.quality ?? null,
    });

    wellnessTiles.innerHTML = `
      <div class="stat-tile featured" style="--tile-accent: var(--signal);">
        <span class="tile-icon">${icon("zap", 18)}</span>
        <div class="value">${lastRecovery?.balance != null ? Math.round(lastRecovery.balance * 100) + "%" : "—"}</div>
        <div class="label">Récupération</div>
      </div>
      <div class="stat-tile" style="--tile-accent: var(--route);">
        <span class="tile-icon">${icon("moon", 18)}</span>
        <div class="value">${lastNight ? formatDuration(lastNight.duration) : "—"}</div>
        <div class="label">Sommeil (dernière nuit)</div>
      </div>
      <div class="stat-tile" style="--tile-accent: var(--accent-gold);">
        <span class="tile-icon">${icon("sparkles", 18)}</span>
        <div class="value">${lastNight?.quality != null ? Math.round(lastNight.quality * 100) + "%" : "—"}</div>
        <div class="label">Qualité de sommeil</div>
      </div>
      <div class="stat-tile" id="week-tile" style="--tile-accent: var(--accent-sky);">
        <span class="tile-icon">${icon("calendar", 18)}</span>
        <div class="value">—</div>
        <div class="label">Cette semaine</div>
      </div>
    `;
    refreshWeekTile();
  } catch (err) {
    wellnessTiles.innerHTML = `<div class="empty"><span class="empty-icon">${icon("alertTriangle", 28)}</span>${escapeHtml(err.message)}</div>`;
  }
}
