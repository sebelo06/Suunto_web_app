// js/decoupling.js
//
// Découplage cardiaque (Pa:HR) — Horizon 3, Performance & physiologie.
//
// Mesure la dérive du rapport allure/FC entre la 1re et la 2e moitié d'un
// effort d'endurance (méthode Friel). On compare l'efficience aérobie
// EF = vitesse ÷ FC des deux moitiés : un découplage faible (< 5 %) traduit une
// bonne endurance — la FC reste stable à allure tenue. Suivi dans le temps,
// un découplage EN BAISSE = progrès de l'endurance de base.
//
// La FC vient des échantillons seconde/seconde (heartrates). Suunto ne fournit
// pas de série de vitesse : on la DÉRIVE du GPS (locations de l'endpoint /data)
// par intégration des positions successives (haversine ÷ dt), lissée pour
// amortir le bruit GPS. Les deux séries sont ré-échantillonnées à 1 Hz sur une
// fenêtre commune, les temps d'arrêt (vitesse ~ nulle) exclus pour ne pas
// gonfler artificiellement la dérive.
import { icon } from "./icons.js";
import { formatPaceValue } from "./format.js";

// Seuils d'interprétation (Friel) et garde-fous de calcul.
const MOVING_MS = 0.6;        // en dessous, on considère l'athlète à l'arrêt
const MIN_WINDOW_S = 1200;    // effort trop court (< 20 min) → non pertinent
const MIN_HALF_MOVING_S = 120; // ≥ 2 min en mouvement par moitié pour être fiable
const GOOD_MAX = 5;           // < 5 % : endurance aérobie solide
const OK_MAX = 8;             // 5–8 % : découplage modéré

const EARTH_R = 6371000; // rayon terrestre (m)

function haversine(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Ramène le champ `t` d'une série en SECONDES écoulées depuis son début, quelle
// que soit l'unité source (s ou ms) ou l'origine (relative ou epoch). Les
// heartrates arrivent déjà en secondes relatives ; les locations, appelées en
// HTTP brut, ne sont pas garanties — d'où cette normalisation défensive.
function toElapsed(times) {
  if (!times.length) return times;
  let ts = times.slice();
  const span = Math.max(...ts) - Math.min(...ts);
  if (span > 100000) ts = ts.map((t) => t / 1000); // plage > 27 h ⇒ millisecondes
  const min = Math.min(...ts);
  return ts.map((t) => t - min);
}

// Normalise les échantillons de l'endpoint /data (shape non typé : appel HTTP
// brut) vers [{ t, lat, lng, speed, hr }] triés. Suunto utilise des clés
// courtes — `la`/`ln` (position), `s` (vitesse m/s), `h` (FC), `t` (secondes
// écoulées) — mais on tolère aussi les conventions longues et le format entier
// E7 (coordonnées × 1e7) par prudence.
export function normalizeLocationSamples(locations) {
  const raw = (Array.isArray(locations) ? locations : [])
    .map((o) => {
      if (!o || typeof o !== "object") return null;
      let lat = o.lat ?? o.latitude ?? o.la ?? o.Lat ?? o.y;
      let lng = o.lng ?? o.lon ?? o.long ?? o.longitude ?? o.ln ?? o.Lng ?? o.x;
      const t = o.t ?? o.time ?? o.timestamp ?? o.ts;
      if (![lat, lng, t].every((v) => Number.isFinite(v))) return null;
      if (Math.abs(lat) > 180) lat /= 1e7; // format entier E7
      if (Math.abs(lng) > 180) lng /= 1e7;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
      const speed = Number.isFinite(o.s) ? o.s : Number.isFinite(o.speed) ? o.speed : null;
      const hr = Number.isFinite(o.h) ? o.h : Number.isFinite(o.hr) ? o.hr : null;
      return { t, lat, lng, speed, hr };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
  if (raw.length < 2) return [];
  const elapsed = toElapsed(raw.map((p) => p.t));
  return raw.map((p, i) => ({ t: elapsed[i], lat: p.lat, lng: p.lng, speed: p.speed, hr: p.hr }));
}

// Série de vitesse [{ t, speed(m/s) }] pour le découplage. On la DÉRIVE des
// positions GPS (haversine ÷ dt) plutôt que de lire le champ `s` de Suunto :
// son unité n'est pas fiable (observé ~×1000, mm/s), alors que la distance
// GPS est sans ambiguïté en mètres. Un fenêtrage minimal (distance OU durée)
// amortit le bruit ; la vitesse est datée au milieu de l'intervalle intégré.
export function buildSpeedSamples(locSamples, { minGapM = 10, minGapS = 5 } = {}) {
  const pts = normalizeLocationSamples(locSamples);
  if (pts.length < 2) return [];

  const out = [];
  let anchor = pts[0];
  let dist = 0;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const dt = cur.t - prev.t;
    if (dt <= 0) continue;
    dist += haversine(prev.lat, prev.lng, cur.lat, cur.lng);
    const span = cur.t - anchor.t;
    if (dist >= minGapM || span >= minGapS) {
      if (span > 0) out.push({ t: (anchor.t + cur.t) / 2, speed: dist / span });
      anchor = cur;
      dist = 0;
    }
  }
  return out;
}

// Ré-échantillonne une série {t, [key]} à 1 Hz sur [t0, t1] par interpolation
// linéaire. Renvoie un tableau de valeurs indexé par seconde (aligné sur t0).
function resampleSeconds(series, key, t0, t1) {
  const out = [];
  let i = 0;
  for (let t = Math.ceil(t0); t <= Math.floor(t1); t++) {
    while (i < series.length - 1 && series[i + 1].t < t) i++;
    const a = series[i];
    const b = series[Math.min(i + 1, series.length - 1)];
    let v;
    if (t <= a.t || b.t === a.t) v = a[key];
    else if (t >= b.t) v = b[key];
    else v = a[key] + (b[key] - a[key]) * ((t - a.t) / (b.t - a.t));
    out.push(v);
  }
  return out;
}

// Calcule le découplage Pa:HR à partir des échantillons FC et de la série de
// vitesse dérivée du GPS. Renvoie null si les données sont insuffisantes
// (effort trop court, pas de GPS exploitable, trop d'arrêts).
//   value   : découplage en % (positif = la FC dérive plus vite que l'allure)
//   ef1/ef2 : efficience aérobie (m/s ÷ bpm × 1000) de chaque moitié
//   h1/h2   : FC moyenne en mouvement de chaque moitié (bpm)
//   pace1/2 : allure moyenne en mouvement de chaque moitié (s/km)
export function computeDecoupling(hrSamples, speedSamples, {} = {}) {
  const hr = (hrSamples || [])
    .filter((s) => Number.isFinite(s.hr) && s.hr > 0 && Number.isFinite(s.t))
    .sort((a, b) => a.t - b.t);
  const sp = (speedSamples || [])
    .filter((s) => Number.isFinite(s.speed) && s.speed >= 0 && Number.isFinite(s.t))
    .sort((a, b) => a.t - b.t);
  if (hr.length < 2 || sp.length < 2) return null;

  // FC déjà en secondes relatives, vitesse déjà normalisée par buildSpeedSamples.
  const hrEl = toElapsed(hr.map((s) => s.t));
  const hrN = hr.map((s, i) => ({ t: hrEl[i], hr: s.hr }));

  // Fenêtre commune aux deux séries.
  const t0 = Math.max(hrN[0].t, sp[0].t);
  const t1 = Math.min(hrN[hrN.length - 1].t, sp[sp.length - 1].t);
  if (!(t1 - t0 >= MIN_WINDOW_S)) return null;

  const hrRes = resampleSeconds(hrN, "hr", t0, t1);
  const spRes = resampleSeconds(sp, "speed", t0, t1);
  const n = Math.min(hrRes.length, spRes.length);
  if (n < MIN_WINDOW_S) return null;

  const mid = Math.floor(n / 2);
  const half = { 0: { s: 0, h: 0, c: 0 }, 1: { s: 0, h: 0, c: 0 } };
  for (let k = 0; k < n; k++) {
    const speed = spRes[k];
    if (!(speed >= MOVING_MS)) continue; // on ignore les arrêts
    const bucket = k < mid ? half[0] : half[1];
    bucket.s += speed;
    bucket.h += hrRes[k];
    bucket.c += 1; // 1 s par échantillon
  }
  if (half[0].c < MIN_HALF_MOVING_S || half[1].c < MIN_HALF_MOVING_S) return null;

  const s1 = half[0].s / half[0].c, h1 = half[0].h / half[0].c;
  const s2 = half[1].s / half[1].c, h2 = half[1].h / half[1].c;
  if (!(s1 > 0 && h1 > 0 && s2 > 0 && h2 > 0)) return null;

  const ef1 = (s1 / h1) * 1000;
  const ef2 = (s2 / h2) * 1000;
  const value = ((ef1 - ef2) / ef1) * 100;

  // Au-delà de ±50 %, l'effort n'était pas un effort d'endurance stable
  // (fractionné, longue mise en route, arrêts prolongés) : le Pa:HR n'a pas de
  // sens, on préfère ne pas afficher de carte plutôt qu'un chiffre trompeur.
  if (!Number.isFinite(value) || Math.abs(value) > 50) return null;

  return {
    value,
    ef1, ef2,
    h1: Math.round(h1), h2: Math.round(h2),
    pace1: 1000 / s1, pace2: 1000 / s2,
    movingSec1: half[0].c, movingSec2: half[1].c,
  };
}

// Verdict lisible + tonalité couleur d'après le seuil de découplage.
export function interpretDecoupling(value) {
  if (value < -GOOD_MAX) return { label: "Négatif — 2e moitié plus efficiente", tone: "good" };
  if (value <= GOOD_MAX) return { label: "Endurance aérobie solide", tone: "good" };
  if (value <= OK_MAX) return { label: "Découplage modéré", tone: "ok" };
  return { label: "Dérive marquée", tone: "warn" };
}

function fmtPct(v) {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1).replace(".", ",")} %`;
}

// Carte de détail. `container` = élément hôte, `result` = sortie de
// computeDecoupling (non nulle). Style aligné sur les cartes .hr-zones.
export function renderDecouplingCard(container, result) {
  if (!container || !result) { if (container) container.innerHTML = ""; return; }
  const { value, h1, h2, pace1, pace2 } = result;
  const verdict = interpretDecoupling(value);

  // Barre de dérive : magnitude relative aux paliers (borne visuelle à 12 %).
  const mag = Math.min(Math.abs(value), 12) / 12 * 100;

  container.innerHTML = `
    <div class="hr-zones decoupling-card">
      <div class="hr-zones-header">
        <div class="hr-zones-label">Découplage cardiaque</div>
        <div class="dc-head-right">
          <span class="hr-chart-meta">Pa:HR · endurance aérobie</span>
          <button type="button" class="dc-info-btn" id="dc-info-toggle" aria-label="Comment lire ce graphe" aria-expanded="false" title="Comment lire ce graphe">${icon("info", 15)}</button>
        </div>
      </div>
      <div class="dc-info-pop" id="dc-info-pop" hidden>
        <div class="dc-info-title">Comment lire le découplage</div>
        <p>Il mesure de combien ton <b>efficience aérobie</b> (vitesse ÷ FC) se dégrade entre la
          <b>1re et la 2e moitié</b> de la séance.</p>
        <ul>
          <li><b>Positif</b> : la FC grimpe pour tenir l'allure (ou l'allure baisse à FC égale) — tu «&nbsp;décroches&nbsp;».</li>
          <li><b>≈ 0 ou négatif</b> : tu tiens (voire améliores) l'allure sans dériver.</li>
        </ul>
        <div class="dc-info-scale">
          <span><i class="tone-good"></i>&lt; ${GOOD_MAX}&nbsp;% — endurance solide</span>
          <span><i class="tone-ok"></i>${GOOD_MAX}–${OK_MAX}&nbsp;% — modéré</span>
          <span><i class="tone-warn"></i>&gt; ${OK_MAX}&nbsp;% — dérive marquée</span>
        </div>
        <p>Les deux tuiles donnent l'allure et la FC moyennes de chaque moitié (arrêts exclus).
          L'essentiel est la <b>tendance</b>&nbsp;: sur des sorties longues comparables, un découplage
          qui <b>baisse au fil des semaines = endurance de base qui progresse</b>.</p>
        <p class="dc-info-fine">N'apparaît que pour un effort continu ≥ 20 min avec GPS. Méthode Friel.</p>
      </div>
      <div class="decoupling-main">
        <div class="decoupling-value tone-${verdict.tone}">${fmtPct(value)}</div>
        <div class="decoupling-verdict">
          <div class="decoupling-verdict-label tone-${verdict.tone}">${verdict.label}</div>
          <div class="decoupling-track"><span class="decoupling-track-fill tone-${verdict.tone}" style="width:${mag.toFixed(0)}%"></span></div>
        </div>
      </div>
      <div class="decoupling-halves">
        <div class="dc-half">
          <span class="dc-half-tag">1re moitié</span>
          <span class="dc-half-vals">${formatPaceValue(pace1)} · ${h1} bpm</span>
        </div>
        <span class="dc-arrow">${icon("chevronRight", 14)}</span>
        <div class="dc-half">
          <span class="dc-half-tag">2e moitié</span>
          <span class="dc-half-vals">${formatPaceValue(pace2)} · ${h2} bpm</span>
        </div>
      </div>
      <div class="decoupling-note">
        Écart d'efficience aérobie (vitesse ÷ FC) entre les deux moitiés à effort d'endurance.
        Sous ${GOOD_MAX} % l'allure tient à FC stable&nbsp;; suivi dans le temps, un découplage en baisse = progrès.
      </div>
    </div>
  `;

  // Panneau flottant « comment lire » : ouverture au clic, fermeture au clic
  // hors du panneau ou sur Échap.
  const toggle = container.querySelector("#dc-info-toggle");
  const pop = container.querySelector("#dc-info-pop");
  if (toggle && pop) {
    const close = () => {
      pop.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onOutside, true);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const onOutside = (e) => { if (!pop.contains(e.target) && !toggle.contains(e.target)) close(); };
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop.hidden) {
        pop.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        document.addEventListener("keydown", onKey);
        document.addEventListener("click", onOutside, true);
      } else {
        close();
      }
    });
  }
}
