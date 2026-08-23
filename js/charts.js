// js/charts.js
//
// Petit graphique en courbe (SVG fait maison, sans librairie) avec
// aire dégradée sous la ligne, partagé par les tendances distance/sommeil
// et l'onglet Évolution.
import { icon } from "./icons.js";

// Lisse une série de points [x,y] en courbe (astuce des points milieux,
// sans dépendance externe) plutôt qu'une ligne brisée.
function buildSmoothPath(points) {
  if (points.length < 2) return points.length ? `M ${points[0][0]} ${points[0][1]}` : "";
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const mx = (x0 + x1) / 2;
    d += ` Q ${mx} ${y0} ${mx} ${(y0 + y1) / 2} Q ${mx} ${y1} ${x1} ${y1}`;
  }
  return d;
}

export function renderLineChart(container, items, { color, formatValue }) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="empty"><span class="empty-icon">${icon("trendingUp", 28)}</span>Pas encore assez de données pour une tendance.</div>`;
    return;
  }

  const width = Math.max(container.clientWidth || 320, 200);
  const height = 130;
  const padTop = 16, padBottom = 16, padRight = 10;
  const values = items.map((it) => it.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const mid = (max + min) / 2;

  // Échelle de valeurs sur la gauche (min / milieu / max), pour donner un
  // ordre de grandeur au tracé plutôt qu'une courbe sans repère.
  const yLabels = [max, mid, min].map((v) => formatValue(v));
  const padLeft = Math.min(64, Math.max(...yLabels.map((s) => s.length)) * 6 + 14);

  const stepX = items.length > 1 ? (width - padLeft - padRight) / (items.length - 1) : 0;

  const points = items.map((it, i) => {
    const x = padLeft + stepX * i;
    const y = padTop + (1 - (it.value - min) / range) * (height - padTop - padBottom);
    return [x, y];
  });

  const linePath = buildSmoothPath(points);
  const baseY = height - 6;
  const areaPath = `${linePath} L ${points[points.length - 1][0]} ${baseY} L ${points[0][0]} ${baseY} Z`;
  const gradientId = `grad-${Math.random().toString(36).slice(2, 9)}`;

  const gridYs = [max, mid, min].map((v) => padTop + (1 - (v - min) / range) * (height - padTop - padBottom));
  const grid = gridYs
    .map(
      (y, i) => `
      <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="var(--panel-line)" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${(padLeft - 8).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" style="font-size:9.5px; font-family:var(--mono); fill:var(--muted);">${yLabels[i]}</text>`
    )
    .join("");

  const dots = points
    .map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${color}" stroke="var(--bg-elevated)" stroke-width="2"><title>${items[i].label} · ${formatValue(items[i].value)}</title></circle>`)
    .join("");

  container.innerHTML = `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.32" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${grid}
      <path d="${areaPath}" fill="url(#${gradientId})" stroke="none" />
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      ${dots}
    </svg>
    <div class="trend-x-labels" style="padding-left:${padLeft}px; padding-right:${padRight}px;">${items.map((it) => `<span>${it.label}</span>`).join("")}</div>
  `;
}
