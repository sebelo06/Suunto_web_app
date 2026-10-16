// src/demo/data.js
//
// Générateur de fausses données Suunto, déterministe (PRNG à graine) et
// relatif à la date du jour : l'app a toujours l'air « vivante ». Il
// reproduit la forme exacte des réponses que consomme le frontend
// (séances, détail, séries /data, sommeil, récupération).
//
// Aucun appel réseau, aucun compte Suunto.

const DEMO_USERNAME = "demo-athlete";
const HISTORY_DAYS = 240;

// Centre des parcours (Annecy) : relief et lacs plausibles sur la carte.
const HOME = { lat: 45.8992, lng: 6.1294 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rnd, lo, hi) => lo + rnd() * (hi - lo);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}

// Encodeur d'encoded polyline (Google, précision 5) — l'inverse du décodeur
// de js/map.js.
function encodePolyline(points) {
  let prevLat = 0;
  let prevLng = 0;
  let out = "";
  const enc = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let s = "";
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - prevLat) + enc(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

// Profils par activité. `share` = poids dans le tirage, `km` = plage de
// distance, `speed` = m/s, `ascentPerKm` = D+ moyen, `hrPct` = intensité
// moyenne en % de FCmax, `cadence` = [moy, max] (pas/min ou tr/min).
const PROFILES = {
  1: { share: 5, km: [5, 16], speed: [2.7, 3.6], ascentPerKm: [8, 22], hrPct: [0.74, 0.86], cadence: [168, 186], radiusKm: 0.35 },
  11: { share: 1.4, km: [9, 22], speed: [1.15, 1.55], ascentPerKm: [45, 85], hrPct: [0.62, 0.74], cadence: [88, 104], radiusKm: 0.6 },
  2: { share: 1.6, km: [30, 85], speed: [6.2, 8.8], ascentPerKm: [8, 16], hrPct: [0.62, 0.76], cadence: [78, 92], radiusKm: 1.6 },
  10: { share: 0.8, km: [16, 38], speed: [3.6, 5.2], ascentPerKm: [25, 40], hrPct: [0.7, 0.82], cadence: [70, 84], radiusKm: 0.9 },
  0: { share: 1, km: [3, 7], speed: [1.25, 1.5], ascentPerKm: [4, 10], hrPct: [0.5, 0.6], cadence: [100, 115], radiusKm: 0.18 },
};

const ACTIVITY_LIST = Object.keys(PROFILES).map(Number);

function pickActivity(rnd) {
  const total = ACTIVITY_LIST.reduce((s, id) => s + PROFILES[id].share, 0);
  let r = rnd() * total;
  for (const id of ACTIVITY_LIST) {
    r -= PROFILES[id].share;
    if (r <= 0) return id;
  }
  return 1;
}

// Boucle fermée et irrégulière autour d'un point de départ propre à la séance.
function buildRoute(rnd, profile, targetKm) {
  const start = {
    lat: HOME.lat + between(rnd, -0.06, 0.06),
    lng: HOME.lng + between(rnd, -0.09, 0.09),
  };
  const radiusM = Math.max(120, (targetKm * 1000) / (2 * Math.PI)) * between(rnd, 0.8, 1.1);
  const stretch = between(rnd, 0.6, 1.4);
  const phase = rnd() * Math.PI * 2;
  const wobbles = [1 + Math.floor(rnd() * 3), 3 + Math.floor(rnd() * 3)].map((k) => ({ k, amp: between(rnd, 0.06, 0.18), ph: rnd() * 6.28 }));
  const steps = clamp(Math.round(targetKm * 14), 90, 900);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((start.lat * Math.PI) / 180);

  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    let r = radiusM;
    for (const w of wobbles) r *= 1 + w.amp * Math.sin(w.k * th + w.ph);
    const dx = r * Math.cos(th + phase) * stretch - radiusM * Math.cos(phase) * stretch;
    const dy = r * Math.sin(th + phase) - radiusM * Math.sin(phase);
    pts.push({ lat: start.lat + dy / mPerDegLat, lng: start.lng + dx / mPerDegLng });
  }
  pts[pts.length - 1] = { ...pts[0] }; // boucle propre

  let length = 0;
  for (let i = 1; i < pts.length; i++) length += haversine(pts[i - 1], pts[i]);
  return { points: pts, length, start };
}

function buildWorkout(index, startTime, rnd, intensityFactor) {
  const activityId = pickActivity(rnd);
  const p = PROFILES[activityId];

  const route = buildRoute(rnd, p, between(rnd, p.km[0], p.km[1]));
  const totalDistance = Math.round(route.length);
  const speed = between(rnd, p.speed[0], p.speed[1]) * (0.96 + 0.06 * intensityFactor);
  const totalTime = Math.round(totalDistance / speed);
  const totalAscent = Math.round((totalDistance / 1000) * between(rnd, p.ascentPerKm[0], p.ascentPerKm[1]));

  const userMaxHR = 189;
  const avgPct = clamp(between(rnd, p.hrPct[0], p.hrPct[1]) * (0.97 + 0.05 * intensityFactor), 0.45, 0.93);
  const workoutAvgHR = Math.round(userMaxHR * avgPct);
  const workoutMaxHR = Math.round(clamp(workoutAvgHR + between(rnd, 12, 28), workoutAvgHR + 6, userMaxHR + 2));

  const key = `demo${String(index).padStart(4, "0")}${Math.floor(rnd() * 1e6).toString(36)}`;
  const cadenceAvg = between(rnd, p.cadence[0], p.cadence[1]);

  return {
    username: DEMO_USERNAME,
    workoutKey: key,
    key,
    activityId,
    startTime,
    stopTime: startTime + totalTime * 1000,
    totalTime,
    totalDistance,
    totalAscent,
    totalDescent: Math.round(totalAscent * between(rnd, 0.95, 1.05)),
    // Suunto : startPosition.x = longitude, .y = latitude.
    startPosition: { x: route.start.lng, y: route.start.lat },
    polyline: encodePolyline(route.points),
    hrdata: { workoutAvgHR, workoutMaxHR, userMaxHR, hrmax: userMaxHR },
    cadence: { avg: cadenceAvg, max: cadenceAvg + between(rnd, 8, 20) },
    // Champs internes, retirés avant l'envoi au front.
    _route: route.points,
  };
}

// Planning d'entraînement : 4-5 séances/semaine, une semaine de décharge sur
// quatre, une coupure « blessure/rhume » de 9 jours et une reprise douce — de
// quoi donner de la matière à la charge aiguë/chronique (ACWR).
function generateWorkouts(now) {
  const rnd = mulberry32(20250917);
  const workouts = [];
  const dayMs = 86400000;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const breakStart = 62;
  const breakLen = 9;
  let idx = 0;

  for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo--) {
    const day = new Date(today.getTime() - daysAgo * dayMs);
    const weekNo = Math.floor((HISTORY_DAYS - daysAgo) / 7);
    const dow = (day.getDay() + 6) % 7; // 0 = lundi

    if (daysAgo <= breakStart && daysAgo > breakStart - breakLen) continue;
    const deload = weekNo % 4 === 3;
    const afterBreak = daysAgo <= breakStart - breakLen && daysAgo > breakStart - breakLen - 10;

    const weeklyPattern = [0.15, 0.85, 0.2, 0.75, 0.05, 0.95, 0.55][dow]; // proba par jour
    const prob = weeklyPattern * (deload ? 0.65 : 1) * (afterBreak ? 0.7 : 1);
    if (rnd() > prob) continue;

    const hour = dow >= 5 ? between(rnd, 8, 10.5) : rnd() < 0.6 ? between(rnd, 6.3, 7.6) : between(rnd, 17.5, 19.2);
    const start = new Date(day.getTime() + hour * 3600000);
    if (start.getTime() > now - 3600000) continue;

    // Progression lente + variations : facteur d'intensité ~ [0, 1].
    const progress = 1 - daysAgo / HISTORY_DAYS;
    const intensity = clamp(0.35 + progress * 0.35 + (deload ? -0.15 : 0) + (afterBreak ? -0.2 : 0) + between(rnd, -0.15, 0.2), 0, 1);
    const w = buildWorkout(idx++, start.getTime(), rnd, intensity);

    // Les sorties longues du weekend s'allongent un peu avec le temps.
    if (dow >= 5 && w.activityId !== 0) {
      w.totalDistance = Math.round(w.totalDistance * (0.95 + progress * 0.25));
      w.totalTime = Math.round(w.totalTime * (0.95 + progress * 0.25));
      w.totalAscent = Math.round(w.totalAscent * (0.95 + progress * 0.25));
    }
    workouts.push(w);
  }
  return workouts.sort((a, b) => b.startTime - a.startTime);
}

// Séries fines d'une séance : FC seconde par seconde (toutes les 2 s) avec
// échauffement, dérive cardiaque progressive, bruit et quelques pics ; et
// positions GPS avec vitesse. Les positions suivent le tracé de la séance.
function buildWorkoutData(w) {
  const rnd = mulberry32(
    [...w.workoutKey].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7)
  );
  const step = 2;
  const n = Math.max(2, Math.floor(w.totalTime / step));
  const avg = w.hrdata.workoutAvgHR;
  const maxHr = w.hrdata.workoutMaxHR;
  const drift = between(rnd, 0.02, 0.09); // dérive cardiaque sur la séance
  const intervals = rnd() < 0.3 && w.activityId === 1; // séance fractionnée

  const heartrates = [];
  let hr = avg - 25;
  for (let i = 0; i < n; i++) {
    const f = i / n;
    let target = avg * (1 + drift * (f - 0.5));
    if (f < 0.06) target = avg - 25 + (f / 0.06) * 25; // échauffement
    if (intervals && f > 0.2 && f < 0.85) target += Math.sin(f * 60) > 0 ? 14 : -10;
    hr += (target - hr) * 0.08 + between(rnd, -1.6, 1.6);
    const v = Math.round(clamp(hr, 55, maxHr));
    heartrates.push({ t: i * step, hr: v });
  }

  const pts = w._route;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1] || 1;
  const avgSpeed = w.totalDistance / w.totalTime;

  // Profil de vitesse le long de la séance : départ prudent, vagues (relief),
  // fatigue en fin de sortie, fractionné éventuel — sinon tous les km auraient
  // exactement la même allure. Les positions avancent proportionnellement à la
  // vitesse cumulée, normalisée pour finir pile sur la distance de la séance.
  const wavePh = rnd() * 6.28;
  const waveK = 3 + rnd() * 5;
  const speedFactor = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    let sf = 1 - drift * 1.4 * (f - 0.5) + 0.09 * Math.sin(f * waveK * 6.28 + wavePh) + between(rnd, -0.015, 0.015);
    if (f < 0.04) sf *= 0.85 + (f / 0.04) * 0.15;
    if (intervals && f > 0.2 && f < 0.85) sf *= Math.sin(f * 60) > 0 ? 1.18 : 0.86;
    speedFactor.push(Math.max(0.3, sf));
  }
  const sfSum = speedFactor.reduce((a, b) => a + b, 0);
  let acc = 0;

  const locations = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    acc += speedFactor[i];
    const frac = acc / sfSum;
    const d = frac * total;
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    const k = clamp((d - cum[seg]) / span, 0, 1);
    const la = pts[seg].lat + (pts[seg + 1].lat - pts[seg].lat) * k;
    const ln = pts[seg].lng + (pts[seg + 1].lng - pts[seg].lng) * k;
    locations.push({
      t: i * step,
      la,
      ln,
      s: Math.max(0, avgSpeed * (speedFactor[i] / (sfSum / n)) + between(rnd, -0.1, 0.1)),
      h: heartrates[i].hr,
    });
  }
  return { heartrates, locations };
}

// Sommeil : une entrée par nuit (+ quelques siestes), avec une semaine plus
// courte de temps en temps et une qualité corrélée à la durée.
function generateSleep(now) {
  const rnd = mulberry32(424242);
  const entries = [];
  const dayMs = 86400000;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (let daysAgo = 90; daysAgo >= 0; daysAgo--) {
    const wake = new Date(today.getTime() - (daysAgo - 1) * dayMs + between(rnd, 6.2, 7.8) * 3600000);
    if (wake.getTime() > now) continue;
    const short = rnd() < 0.18;
    const hours = clamp(between(rnd, 6.6, 8.4) - (short ? between(rnd, 0.8, 1.6) : 0), 4.5, 9.2);
    const duration = Math.round(hours * 3600);
    const bedtimeStart = new Date(wake.getTime() - duration * 1000 - between(rnd, 5, 25) * 60000);
    const quality = clamp(0.45 + (hours - 6) * 0.14 + between(rnd, -0.08, 0.08), 0.25, 0.97);
    entries.push({
      timestamp: wake.toISOString(),
      entryData: {
        isNap: false,
        duration,
        bedtimeStart: bedtimeStart.toISOString(),
        bedtimeEnd: wake.toISOString(),
        quality: Number(quality.toFixed(2)),
        deepSleepDuration: Math.round(duration * between(rnd, 0.14, 0.22)),
        remSleepDuration: Math.round(duration * between(rnd, 0.18, 0.26)),
        lightSleepDuration: Math.round(duration * between(rnd, 0.45, 0.55)),
        hrMin: Math.round(between(rnd, 43, 52) + (short ? 3 : 0)),
        avgHrv: Math.round(clamp(between(rnd, 52, 78) - (short ? 10 : 0), 28, 95)),
      },
    });
    if (rnd() < 0.07) {
      const nap = new Date(wake.getTime() + between(rnd, 6, 8) * 3600000);
      if (nap.getTime() < now) {
        entries.push({
          timestamp: nap.toISOString(),
          entryData: { isNap: true, duration: Math.round(between(rnd, 1200, 2700)), bedtimeStart: nap.toISOString(), quality: 0.5 },
        });
      }
    }
  }
  return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// Récupération : une mesure (balance 0..1) toutes les 30 min sur 3 jours,
// qui remonte la nuit et descend en journée.
function generateRecovery(now) {
  const rnd = mulberry32(9001);
  const entries = [];
  const halfHour = 30 * 60000;
  const end = Math.floor(now / halfHour) * halfHour;
  let balance = 0.62;
  for (let t = end - 3 * 86400000; t <= end; t += halfHour) {
    const h = new Date(t).getHours();
    balance += (h >= 23 || h < 6 ? 0.012 : -0.006) + between(rnd, -0.008, 0.008);
    balance = clamp(balance, 0.12, 0.98);
    entries.push({ timestamp: new Date(t).toISOString(), entryData: { balance: Number(balance.toFixed(3)) } });
  }
  return entries;
}

// Activité 24/7 : un échantillon par 15 min sur 3 jours (hr en Hz,
// energyConsumption en joules, comme l'API réelle). Pas nuls la nuit.
function generateActivity(now) {
  const rnd = mulberry32(777);
  const entries = [];
  const step = 15 * 60000;
  const end = Math.floor(now / step) * step;
  for (let t = end - 3 * 86400000; t <= end; t += step) {
    const h = new Date(t).getHours();
    const asleep = h >= 23 || h < 6;
    const walking = !asleep && rnd() < (h >= 7 && h <= 20 ? 0.55 : 0.2);
    const stepCount = walking ? Math.round(between(rnd, 40, 420)) : 0;
    const bpm = asleep ? between(rnd, 46, 56) : walking ? between(rnd, 90, 125) : between(rnd, 58, 78);
    entries.push({
      timestamp: new Date(t).toISOString(),
      entryData: {
        hr: Number((bpm / 60).toFixed(3)),
        stepCount,
        energyConsumption: Math.round((asleep ? 70 : 90 + stepCount * 1.2) * 4184 / 10),
      },
    });
  }
  return entries;
}

// Phases de sommeil de la dernière nuit : cycles léger → profond → REM.
function generateSleepStages(sleep) {
  const night = sleep.find((e) => !e.entryData.isNap);
  if (!night) return [];
  const rnd = mulberry32(31337);
  const out = [];
  let t = new Date(night.entryData.bedtimeStart).getTime();
  const end = new Date(night.entryData.bedtimeEnd).getTime();
  const cycle = ["LIGHT", "DEEP", "LIGHT", "REM"];
  for (let i = 0; t < end; i++) {
    const stage = rnd() < 0.06 ? "AWAKE" : cycle[i % cycle.length];
    const duration = Math.min(Math.round(between(rnd, 600, 2400)), Math.round((end - t) / 1000));
    out.push({ timestamp: new Date(t).toISOString(), entryData: { stage, duration } });
    t += duration * 1000;
  }
  return out;
}

let cache = null;

// Les données sont générées une fois au premier appel (par rapport à
// l'heure courante) puis gardées en mémoire pour la durée du process.
function getDemoData() {
  if (!cache) {
    const now = Date.now();
    const workouts = generateWorkouts(now);
    const sleep = generateSleep(now);
    cache = {
      workouts,
      byKey: new Map(workouts.map((w) => [w.workoutKey, w])),
      sleep,
      sleepStages: generateSleepStages(sleep),
      activity: generateActivity(now),
      recovery: generateRecovery(now),
      dataByKey: new Map(),
    };
  }
  return cache;
}

function publicWorkout(w) {
  const { _route, ...rest } = w;
  return rest;
}

function getWorkoutData(key) {
  const d = getDemoData();
  if (!d.dataByKey.has(key)) {
    const w = d.byKey.get(key);
    if (!w) return null;
    d.dataByKey.set(key, buildWorkoutData(w));
  }
  return d.dataByKey.get(key);
}

module.exports = { DEMO_USERNAME, getDemoData, getWorkoutData, publicWorkout };
