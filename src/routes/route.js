// src/routes/route.js
//
// Snap-to-road (OpenRouteService)
//
// Clé gratuite à créer sur https://openrouteservice.org/dev/#/signup puis
// à exposer en variable d'env ORS_API_KEY. Passe par le backend (plutôt
// qu'un appel direct depuis le navigateur) pour ne jamais exposer la clé
// côté client et pour réserver l'usage aux utilisateurs connectés.
const express = require("express");
const { requireSession } = require("../middleware/auth");
const { ORS_API_KEY } = require("../config");

const router = express.Router();

router.post("/snap", requireSession, async (req, res) => {
  if (!ORS_API_KEY) {
    return res.status(501).json({ error: "Snap-to-road non configuré : ORS_API_KEY manquante côté serveur." });
  }

  const points = Array.isArray(req.body.points) ? req.body.points : [];
  if (points.length < 2) {
    return res.status(400).json({ error: "Il faut au moins 2 points à aligner." });
  }

  try {
    const orsRes = await fetch("https://api.openrouteservice.org/v2/directions/foot-hiking/geojson", {
      method: "POST",
      headers: {
        Authorization: ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // ORS attend des coordonnées [lng, lat], l'inverse de nos points.
        coordinates: points.map((p) => [p.lng, p.lat]),
      }),
    });

    const data = await orsRes.json();
    if (!orsRes.ok) {
      console.error("ORS a refusé la requête:", data);
      return res.status(502).json({ error: data?.error?.message || "L'alignement sur les chemins a échoué." });
    }

    const coords = data.features?.[0]?.geometry?.coordinates || [];
    const snapped = coords.map(([lng, lat]) => ({ lat, lng }));
    res.json({ points: snapped });
  } catch (err) {
    console.error("Erreur d'appel à OpenRouteService:", err);
    res.status(502).json({ error: "Service d'alignement sur les chemins indisponible." });
  }
});

module.exports = router;
