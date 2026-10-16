// src/routes/guides.js
//
// Envoi d'un Guide SuuntoPlus vers le compte Suunto (il arrive ensuite sur la
// montre à la prochaine synchro de l'app mobile). Le zip est construit par
// suunto-api-wrapper à partir du guide.json et de l'icône PNG 300×300.
const express = require("express");
const { requireSuuntoClient } = require("../middleware/auth");
const { unwrap } = require("../utils/unwrap");

const router = express.Router();

const MAX_ICON_BYTES = 200 * 1024;

function parseBody(body) {
  const { guide, icon, guideId } = body || {};
  if (!guide || typeof guide !== "object" || guide.type !== "sequence" || !Array.isArray(guide.steps)) {
    return { error: "Guide invalide." };
  }
  if (typeof icon !== "string" || !icon) return { error: "Icône manquante." };
  const iconBytes = Buffer.from(icon, "base64");
  if (!iconBytes.length || iconBytes.length > MAX_ICON_BYTES) return { error: "Icône invalide." };
  if (guideId !== undefined && typeof guideId !== "string") return { error: "Identifiant de guide invalide." };
  return { guide, iconBytes: new Uint8Array(iconBytes), guideId };
}

// Crée le guide, ou le remplace si `guideId` (renvoyé par un envoi précédent)
// est fourni et existe encore ; s'il a été supprimé côté Suunto (404), on le
// recrée.
router.post("/", requireSuuntoClient, async (req, res) => {
  const parsed = parseBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { guide, iconBytes, guideId } = parsed;

  try {
    let result;
    let updated = false;
    if (guideId) {
      try {
        result = await req.suunto.guides.update(guideId, guide, iconBytes);
        updated = true;
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
    if (!result) result = await req.suunto.guides.create(guide, iconBytes);
    const saved = unwrap(result);
    res.json({ id: saved.id, name: saved.name, updated });
  } catch (err) {
    console.error(err);
    if (err.status === 409) {
      return res.status(409).json({ error: "Ce guide existe déjà sur le compte Suunto (même identifiant externe)." });
    }
    res.status(502).json({ error: "Erreur lors de l'envoi du guide vers Suunto" });
  }
});

module.exports = router;
