// js/charts.js
//
// Petit graphique en courbe (SVG fait maison, sans librairie) avec
// aire dégradée sous la ligne, partagé par les tendances distance/sommeil
// et l'onglet Évolution.
import { icon } from "./icons.js";

// Lisse une série de points [x,y] via une spline Catmull-Rom convertie en
// courbes de Bézier cubiques. Contrairement à l'astuce des points milieux, la
// courbe passe exactement par chaque mesure et suit la pente locale, ce qui
// donne un tracé plus naturel et moins ondulant. `tension` (0 = anguleux,
// 1 = très lisse) est volontairement bas pour rester proche des données.
function buildSmoothPath(points, tension = 0.6) {
  if (points.length < 2) return points.length ? `M ${points[0][0]} ${points[0][1]}` : "";
  const k = tension / 6;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * k;
    const c1y = p1[1] + (p2[1] - p0[1]) * k;
    const c2x = p2[0] - (p3[0] - p1[0]) * k;
    const c2y = p2[1] - (p3[1] - p1[1]) * k;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

// Courbe de fréquence cardiaque au fil d'une séance. Différent de
// renderLineChart : beaucoup d'échantillons (donc pas de point par mesure),
// axe X temporel en mm:ss, et baseline calée sur la FC min plutôt que 0.
// `samples` = [{ t: secondes écoulées, hr: bpm }]. Retourne false si rien à tracer.
export function renderHrChart(container, samples, { color }) {
  if (!container) return false;
  const pts = (samples || []).filter((s) => Number.isFinite(s.hr) && s.hr > 0 && Number.isFinite(s.t));
  if (pts.length < 2) { container.innerHTML = ""; return false; }

  const width = Math.max(container.clientWidth || 320, 200);
  const height = 150;
  const padTop = 16, padBottom = 22, padRight = 10;

  const hrs = pts.map((p) => p.hr);
  const hrMax = Math.max(...hrs), hrMin = Math.min(...hrs);
  const yMax = hrMax + 4, yMin = Math.max(0, hrMin - 4);
  const range = Math.max(yMax - yMin, 1);
  const mid = Math.round((yMax + yMin) / 2);

  const yLabels = [Math.round(yMax), mid, Math.round(yMin)];
  const padLeft = Math.min(56, Math.max(...yLabels.map((s) => String(s).length)) * 6 + 16);
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const tMin = pts[0].t, tMax = pts[pts.length - 1].t;
  const tRange = Math.max(tMax - tMin, 1);

  const xy = pts.map((p) => [
    padLeft + ((p.t - tMin) / tRange) * plotW,
    padTop + (1 - (p.hr - yMin) / range) * plotH,
  ]);

  const linePath = buildSmoothPath(xy);
  const baseY = padTop + plotH;
  const areaPath = `${linePath} L ${xy[xy.length - 1][0].toFixed(1)} ${baseY} L ${xy[0][0].toFixed(1)} ${baseY} Z`;
  const gid = `hr-${Math.random().toString(36).slice(2, 9)}`;

  const gridYs = [yMax, (yMax + yMin) / 2, yMin].map((v) => padTop + (1 - (v - yMin) / range) * plotH);
  const grid = gridYs
    .map(
      (y, i) => `
      <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="var(--panel-line)" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${(padLeft - 8).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" style="font-size:9.5px; font-family:var(--mono); fill:var(--muted);">${yLabels[i]}</text>`
    )
    .join("");

  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const nTicks = 4;
  const xticks = Array.from({ length: nTicks + 1 }, (_, i) => {
    const x = padLeft + (plotW * i) / nTicks;
    return `<text x="${x.toFixed(1)}" y="${height - 6}" text-anchor="${i === 0 ? "start" : i === nTicks ? "end" : "middle"}" style="font-size:9.5px; font-family:var(--mono); fill:var(--muted);">${fmtT((tRange * i) / nTicks)}</text>`;
  }).join("");

  // Marqueur au pic de FC (repère utile sans surcharger la courbe de points).
  const maxIdx = hrs.indexOf(hrMax);
  const [mx, my] = xy[maxIdx];
  const peak = `<circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.5" fill="${color}" stroke="var(--bg-elevated)" stroke-width="2"><title>Pic ${hrMax} bpm à ${fmtT(pts[maxIdx].t - tMin)}</title></circle>`;

  container.innerHTML = `
    <svg class="trend-svg" style="height:${height}px;" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.32" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${grid}
      <path d="${areaPath}" fill="url(#${gid})" stroke="none" />
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      ${peak}
      ${xticks}
    </svg>
  `;
  return true;
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

  // Au-delà d'une poignée de points, afficher toutes les étiquettes d'axe X les
  // rend illisibles : on n'en garde qu'une poignée régulièrement espacée (la
  // date exacte de chaque point reste lisible via l'infobulle du point).
  const maxXLabels = 8;
  const labelEvery = Math.max(1, Math.ceil(items.length / maxXLabels));

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
    <div class="trend-x-labels" style="padding-left:${padLeft}px; padding-right:${padRight}px;">${items.map((it, i) => `<span>${i % labelEvery === 0 || i === items.length - 1 ? it.label : ""}</span>`).join("")}</div>
  `;
}
