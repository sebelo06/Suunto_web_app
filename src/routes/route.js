// src/routes/route.js
//
// Snap-to-road (alignement d'un tracé sur les vrais chemins) via BRouter,
// un routeur OSM public, gratuit et SANS clé. Aucune configuration requise.
//
// BRouter renvoie l'altitude et le dénivelé dans la même réponse, donc l'export
// GPX n'a plus besoin d'un second appel à un service d'altitude.
const express = require("express");
const { requireSession } = require("../middleware/auth");

const router = express.Router();

// Associe chaque activité proposée dans l'UI à un profil de routage BRouter.
// Le profil change radicalement les chemins choisis (sentiers en rando, routes
// rapides à vélo) : un traileur ne veut pas être routé sur la départementale.
const BROUTER_PROFILE_BY_ACTIVITY = {
  hiking: "hiking-mountain",
  walking: "trekking",
  running: "hiking-mountain",
  "cycling-road": "fastbike",
  "cycling-mountain": "mtb",
};
const DEFAULT_ACTIVITY = "hiking";

function brouterProfileFor(activityType) {
  return BROUTER_PROFILE_BY_ACTIVITY[activityType] || BROUTER_PROFILE_BY_ACTIVITY[DEFAULT_ACTIVITY];
}

async function snapViaBrouter(points, activityType) {
  const profile = brouterProfileFor(activityType);
  const lonlats = points.map((p) => `${p.lng},${p.lat}`).join("|");
  const url = new URL("https://brouter.de/brouter");
  url.searchParams.set("lonlats", lonlats);
  url.searchParams.set("profile", profile);
  url.searchParams.set("alternativeidx", "0");
  url.searchParams.set("format", "geojson");

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const details = (await res.text().catch(() => "")).trim();
    if (/target.*island|position not mapped|no.*route/i.test(details)) {
      throw new Error("Aucun chemin trouvé près de l'un de tes points. Rapproche-le d'une route ou d'un sentier.");
    }
    throw new Error(`Service d'alignement (BRouter) indisponible : ${res.status}`);
  }

  const data = await res.json().catch(() => ({}));
  const feature = data.features?.[0];
  const coords = feature?.geometry?.coordinates || [];
  // BRouter renvoie [lon, lat, ele].
  const snapped = coords
    .filter((c) => Array.isArray(c) && c.length >= 2)
    .map(([lng, lat, ele]) => ({
      lat,
      lng,
      ...(Number.isFinite(ele) ? { ele } : {}),
    }));
  if (snapped.length < 2) {
    throw new Error("Aucun chemin trouvé près de l'un de tes points.");
  }

  // BRouter expose ses métriques en chaînes dans les propriétés du feature.
  const props = feature?.properties || {};
  const asNumber = (key) => {
    const raw = props[key];
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  return {
    points: snapped,
    provider: "brouter",
    profile,
    stats: {
      distanceMeters: asNumber("track-length"),
      durationSeconds: asNumber("total-time"),
      ascentMeters: asNumber("filtered ascend"),
      // BRouter ne fournit que la montée ; on laisse la descente vide plutôt
      // que d'inventer une valeur.
      descentMeters: null,
    },
  };
}

router.post("/snap", requireSession, async (req, res) => {
  const points = Array.isArray(req.body.points) ? req.body.points : [];
  if (points.length < 2) {
    return res.status(400).json({ error: "Il faut au moins 2 points à aligner." });
  }

  try {
    const result = await snapViaBrouter(points, req.body.activityType);
    res.json(result);
  } catch (err) {
    console.error("Alignement via BRouter en échec:", err.message);
    res.status(502).json({ error: err.message || "L'alignement sur les chemins a échoué." });
  }
});

module.exports = router;
