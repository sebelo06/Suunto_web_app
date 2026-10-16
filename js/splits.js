// js/splits.js
//
// Splits par kilomètre d'une séance : temps, allure (ou vitesse à vélo) et FC
// moyenne de chaque km. Calculés à partir des positions GPS de l'endpoint /data
// (déjà chargées pour le découplage cardiaque) — aucune donnée de plus à
// récupérer. Le dernier km, partiel, est conservé s'il fait au moins 100 m.
import { normalizeLocationSamples } from "./decoupling.js";
import { icon } from "./icons.js";
import { formatPaceValue } from "./format.js";

const EARTH_R = 6371000;
const MIN_PARTIAL_M = 100;
const CYCLING = new Set([2, 10]); // vélo, VTT : vitesse en km/h plutôt qu'allure

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

// FC moyenne sur [t0, t1] : échantillons 1 Hz de l'endpoint /data en priorité,
// à défaut la FC portée par les positions.
function avgHr(samples, t0, t1) {
  let sum = 0;
  let n = 0;
  for (const s of samples) {
    if (s.t < t0) continue;
    if (s.t > t1) break;
    sum += s.hr;
    n += 1;
  }
  return n ? sum / n : null;
}

// Renvoie [{ km, dist, time, secPerKm, hr }] ; [] si le tracé est inexploitable.
export function computeSplits(locations, hrSamples, totalDistance) {
  const pts = normalizeLocationSamples(locations);
  if (pts.length < 2) return [];

  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const gpsLen = cum[cum.length - 1];
  if (!(gpsLen > 0)) return [];

  // Le GPS brut sur-estime un peu la distance (bruit) : on recale sur la distance
  // officielle de la séance quand l'écart reste plausible, pour que les splits
  // « tombent » sur les vrais kilomètres sans dériver sur une longue sortie.
  const ratio = totalDistance > 0 ? totalDistance / gpsLen : 1;
  const scale = ratio > 0.8 && ratio < 1.25 ? ratio : 1;
  const total = gpsLen * scale;

  const hrs = (hrSamples || []).filter((s) => Number.isFinite(s?.hr) && s.hr > 0).sort((a, b) => a.t - b.t);
  const fallbackHr = pts.filter((p) => p.hr > 0).map((p) => ({ t: p.t, hr: p.hr }));
  const hrSource = hrs.length ? hrs : fallbackHr;

  // Instant de passage à chaque borne kilométrique, par interpolation linéaire.
  const bounds = [{ d: 0, t: pts[0].t }];
  let next = 1000;
  for (let i = 1; i < pts.length; i++) {
    const d0 = cum[i - 1] * scale;
    const d1 = cum[i] * scale;
    while (next <= d1 && d1 > d0) {
      bounds.push({ d: next, t: pts[i - 1].t + ((pts[i].t - pts[i - 1].t) * (next - d0)) / (d1 - d0) });
      next += 1000;
    }
  }
  bounds.push({ d: total, t: pts[pts.length - 1].t });

  const splits = [];
  for (let i = 1; i < bounds.length; i++) {
    const dist = bounds[i].d - bounds[i - 1].d;
    const time = bounds[i].t - bounds[i - 1].t;
    if (dist < MIN_PARTIAL_M || time <= 0) continue; // borne finale confondue avec la précédente
    splits.push({
      km: i,
      dist,
      time,
      secPerKm: time / (dist / 1000),
      hr: avgHr(hrSource, bounds[i - 1].t, bounds[i].t),
    });
  }
  return splits;
}

const fmtSpeed = (secPerKm) => `${(3600 / secPerKm).toFixed(1).replace(".", ",")} km/h`;

export function renderSplitsCard(container, splits, { activityId } = {}) {
  if (!container) return;
  if (splits.length < 2) { container.innerHTML = ""; return; }

  const cycling = CYCLING.has(activityId);
  const fmt = cycling ? fmtSpeed : formatPaceValue;
  const full = splits.filter((s) => s.dist >= 900); // le km partiel ne sert pas de repère
  const ref = full.length ? full : splits;
  const best = ref.reduce((a, b) => (b.secPerKm < a.secPerKm ? b : a));
  const worst = ref.reduce((a, b) => (b.secPerKm > a.secPerKm ? b : a));
  const span = Math.max(worst.secPerKm - best.secPerKm, 1);
  // Splits quasi identiques : pas de « meilleur / plus lent » à souligner.
  const flat = worst.secPerKm - best.secPerKm < Math.max(3, best.secPerKm * 0.02);

  // Barre plus longue = plus rapide ; plancher à 38 % pour qu'un km lent reste lisible.
  const width = (s) => 38 + (1 - Math.min(1, Math.max(0, (s.secPerKm - best.secPerKm) / span))) * 62;
  const hrCells = splits.some((s) => s.hr != null);

  const rows = splits
    .map((s) => {
      const partial = s.dist < 900;
      const label = partial ? `${(s.dist / 1000).toFixed(2).replace(".", ",")}` : String(s.km);
      const cls = flat || partial ? "" : s === best ? " is-best" : s === worst ? " is-worst" : "";
      return `
        <div class="split-row${cls}"${partial ? ' title="Dernier kilomètre incomplet"' : ""}>
          <span class="split-km">${label}</span>
          <span class="split-bar"><i style="width:${width(s).toFixed(1)}%"></i></span>
          <span class="split-pace">${fmt(s.secPerKm)}</span>
          ${hrCells ? `<span class="split-hr">${s.hr != null ? `${Math.round(s.hr)}<small> bpm</small>` : "—"}</span>` : ""}
        </div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="hr-zones splits">
      <div class="hr-zones-header">
        <div class="hr-zones-label">${icon("activity", 14)} Splits par kilomètre</div>
        <div class="hr-chart-meta">${flat ? `régulier · ${fmt(best.secPerKm)}` : `${cycling ? "max" : "meilleur"} ${fmt(best.secPerKm)} · ${cycling ? "min" : "plus lent"} ${fmt(worst.secPerKm)}`}</div>
      </div>
      <div class="split-list${splits.length > 24 ? " is-long" : ""}">${rows}</div>
    </div>`;
}
