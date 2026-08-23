// src/app.js
//
// Assemble l'application Express : middlewares transverses (sécurité,
// CORS, parsing, session, rate limiting) puis montage des routes.
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const config = require("./config");
const authRoutes = require("./routes/auth");
const workoutsRoutes = require("./routes/workouts");
const wellnessRoutes = require("./routes/wellness");
const routeRoutes = require("./routes/route");

const app = express();

// API pure consommée en cross-origin par le frontend : pas besoin de la
// CSP par défaut de helmet pensée pour du HTML servi par ce process.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(express.json());

// Autorise le frontend (servi sur un autre port) à appeler ce backend
// et à envoyer le cookie de session.
app.use(
  cors({
    origin: config.FRONTEND_ORIGIN,
    credentials: true,
  })
);

// Session applicative (cookie httpOnly). En prod, remplace le store
// mémoire par un store persistant (Redis, etc.) et mets secure: true
// derrière HTTPS.
app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  })
);

// Garde-fou général contre l'abus de l'API (en plus du rate limit dédié
// au login, plus strict, défini dans routes/auth.js).
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use("/api", authRoutes);
app.use("/api/workouts", workoutsRoutes);
app.use("/api/wellness", wellnessRoutes);
app.use("/api/route", routeRoutes);

module.exports = app;
