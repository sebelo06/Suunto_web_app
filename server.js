// server.js
//
// Point d'entrée : charge la config (.env en dev), puis démarre le
// serveur HTTP. Toute la logique applicative vit dans src/.
require("dotenv").config();

const config = require("./src/config");
const app = require("./src/app");

app.listen(config.PORT, () => console.log(`Serveur démarré sur http://localhost:${config.PORT}`));
