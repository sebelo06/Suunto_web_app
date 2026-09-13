// electron/server.js
//
// Démarre le backend Express EXISTANT (src/app.js) et lui ajoute, pour le
// mode desktop uniquement, le service des fichiers statiques du frontend.
// Tout est ainsi servi depuis une seule et même origine (http://localhost:<port>),
// ce qui élimine complètement le CORS : le web reste inchangé, on ne fait
// qu'empaqueter.
//
// Le port est choisi dynamiquement (0 = « donne-moi un port libre ») pour ne
// jamais entrer en collision avec un autre process. On patche à la volée le
// <meta name="api-base"> de index.html pour qu'il pointe sur ce port, sans
// toucher au fichier sur disque (le web continue de viser localhost:3000).

const fs = require("fs");
const path = require("path");
const express = require("express");

const ROOT = path.join(__dirname, "..");

function startServer() {
  // Active la persistance de session chiffrée (mode desktop uniquement).
  // Le web ne branche jamais d'adaptateur -> comportement inchangé.
  require("../src/stores/sessionPersistence").use(require("./persistence"));

  // On réutilise l'app Express telle quelle : middlewares, session, routes /api.
  const app = require("../src/app");

  // index.html patché : on injecte l'origine réelle du serveur embarqué dans
  // le meta api-base, pour que le frontend tape le backend en same-origin.
  app.get("/", (req, res, next) => {
    fs.readFile(path.join(ROOT, "index.html"), "utf8", (err, html) => {
      if (err) return next(err);
      const origin = `http://localhost:${req.socket.localPort}`;
      const patched = html.replace(
        /<meta name="api-base" content="[^"]*"\s*\/?>/,
        `<meta name="api-base" content="${origin}" />`
      );
      res.type("html").send(patched);
    });
  });

  // Le reste du frontend (js/, css/, images/) en statique.
  app.use(express.static(ROOT));

  return new Promise((resolve, reject) => {
    // Port 0 => l'OS attribue un port libre.
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

module.exports = { startServer };
