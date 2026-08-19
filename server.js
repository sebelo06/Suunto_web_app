// server.js
//
// Petit backend Express qui encapsule "suunto-api-wrapper" côté serveur.
// Le mot de passe Suunto de l'utilisateur ne transite JAMAIS vers le
// frontend : on ne renvoie au client qu'un cookie de session applicatif,
// et c'est le backend qui garde le SuuntoClient (avec son sessionKey)
// en mémoire, associé à cette session.

const express = require("express");
const session = require("express-session");
const cors = require("cors");
const { SuuntoClient } = require("suunto-api-wrapper");

const app = express();
app.use(express.json());

// Autorise le frontend (servi sur un autre port) à appeler ce backend
// et à envoyer le cookie de session.
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5500",
    credentials: true,
  })
);

// Session applicative (cookie httpOnly). En prod, remplace le store
// mémoire par un store persistant (Redis, etc.) et mets secure: true
// derrière HTTPS.
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-moi-en-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  })
);

// Table en mémoire : sessionId -> instance SuuntoClient authentifiée.
// (À remplacer par un mécanisme plus robuste si tu scales sur
// plusieurs instances du serveur : Redis, etc.)
const clients = new Map();

// Certains endpoints Suunto renvoient un tableau brut, d'autres une
// enveloppe { error, payload, metadata }. On gère les deux cas ici
// plutôt que de supposer un format unique.
function unwrap(response) {
  return Array.isArray(response) ? response : (response?.payload ?? response);
}

function requireSuuntoClient(req, res, next) {
  const client = clients.get(req.session.id);
  if (!client) {
    return res.status(401).json({ error: "Non authentifié. Appelle /api/login d'abord." });
  }
  req.suunto = client;
  next();
}

// Pour les routes qui n'ont pas besoin du client Suunto (ex: snap-to-road)
// mais qu'on veut quand même réserver aux utilisateurs connectés, pour ne
// pas laisser n'importe qui consommer le quota de la clé ORS.
function requireSession(req, res, next) {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: "Non authentifié. Appelle /api/login d'abord." });
  }
  next();
}

// --- Auth -------------------------------------------------------------

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email et password requis" });
  }

  try {
    const suunto = await SuuntoClient.login({ email, password });
    clients.set(req.session.id, suunto);
    // Force express-session à considérer la session comme "initialisée"
    // pour qu'il renvoie bien le cookie au navigateur (sinon, avec
    // saveUninitialized: false, aucun cookie n'est émis et chaque
    // requête suivante repart avec une session vide -> 401).
    req.session.authenticated = true;
    res.json({ ok: true });
  } catch (err) {
    console.error("Login Suunto échoué:", err.message);
    res.status(401).json({ error: "Identifiants invalides ou API Suunto indisponible" });
  }
});

app.post("/api/logout", (req, res) => {
  clients.delete(req.session.id);
  req.session.destroy(() => res.json({ ok: true }));
});

// --- Données ------------------------------------------------------------

app.get("/api/workouts", requireSuuntoClient, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const offset = Number(req.query.offset) || 0;
    const workouts = await req.suunto.workouts.own({ limit, offset });
    res.json(unwrap(workouts));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération des séances" });
  }
});

app.get("/api/workouts/:username/:key", requireSuuntoClient, async (req, res) => {
  try {
    const { username, key } = req.params;
    const detail = await req.suunto.workouts.byKey(username, key);
    res.json(unwrap(detail));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération du détail de la séance" });
  }
});

app.get("/api/wellness/sleep", requireSuuntoClient, async (req, res) => {
  try {
    const sleep = await req.suunto.wellness.sleep({ since: 0 });
    res.json(unwrap(sleep));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération du sommeil" });
  }
});

app.get("/api/wellness/recovery", requireSuuntoClient, async (req, res) => {
  try {
    const recovery = await req.suunto.wellness.recovery();
    res.json(unwrap(recovery));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Erreur lors de la récupération de la récupération" });
  }
});

// --- Snap-to-road (OpenRouteService) -------------------------------------
//
// Clé gratuite à créer sur https://openrouteservice.org/dev/#/signup puis
// à exposer en variable d'env ORS_API_KEY. Passe par le backend (plutôt
// qu'un appel direct depuis le navigateur) pour ne jamais exposer la clé
// côté client et pour réserver l'usage aux utilisateurs connectés.
const ORS_API_KEY = process.env.ORS_API_KEY;

app.post("/api/route/snap", requireSession, async (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));
