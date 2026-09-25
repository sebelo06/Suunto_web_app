# Suivi Suunto

Backend Express qui encapsule `suunto-api-wrapper` côté serveur pour éviter
d'exposer les identifiants Suunto et les problèmes de CORS au frontend, et
frontend statique (HTML/CSS/JS, modules ES natifs, sans build step).

## Arborescence

```
server.js            Point d'entrée backend (charge .env, démarre l'app)
src/
  config.js           Lecture/validation des variables d'environnement
  app.js               Assemblage Express (sécurité, CORS, session, routes)
  stores/clientStore.js  Store des sessions Suunto (interface get/set/delete)
  middleware/auth.js     Garde-fous requireSuuntoClient / requireSession
  routes/                Un fichier par groupe d'endpoints (auth, workouts, wellness, route)
  utils/unwrap.js        Normalisation des réponses API Suunto

index.html            Squelette de la page (charge css/styles.css et js/main.js)
css/styles.css         Tous les styles
js/                    Un module par responsabilité (api, auth, workouts,
                        wellness, evolution, route-editor, overview-map, map,
                        theme, charts, icons, format, config, state, dom)
```

## Installation

```bash
npm install
cp .env.example .env   # puis renseigne SESSION_SECRET, etc.
```

## Lancement

```bash
npm start
# ou en mode watch
npm run dev
```

Le serveur backend écoute sur `http://localhost:3000` par défaut (variable
`PORT`). Sert le frontend séparément (ex: `npx http-server -p 5500` ou
l'extension Live Server) — édite `<meta name="api-base">` dans `index.html`
si le backend tourne ailleurs qu'en local.

## Endpoints

| Méthode | Route                    | Description                              |
| ------- | ------------------------ | ----------------------------------------- |
| POST    | `/api/login`             | `{ email, password }` → crée la session   |
| POST    | `/api/logout`            | Détruit la session                        |
| GET     | `/api/workouts?limit=20` | Dernières séances de l'utilisateur connecté |
| GET     | `/api/wellness/sleep`    | Données de sommeil                        |
| GET     | `/api/wellness/recovery` | Récupération / stress                     |
| POST    | `/api/route/snap`        | `{ points: [{lat,lng}], activityType }` → aligne l'itinéraire sur les chemins (BRouter) |

Toutes les routes `/api/*` (sauf login) nécessitent le cookie de session
renvoyé par `/api/login` — le frontend doit envoyer les requêtes avec
`credentials: "include"` (fetch) ou `withCredentials: true` (axios).

### Snap-to-road

`/api/route/snap` s'appuie sur [BRouter](https://brouter.de/) (routeur OSM
public, gratuit et **sans clé**) : aucune configuration n'est nécessaire. Le
profil de routage est choisi selon `activityType` (randonnée, marche, trail,
vélo route, VTT), et l'altitude et le dénivelé (D+) sont renvoyés dans la même
réponse — l'export GPX n'a donc pas besoin d'un service d'altitude séparé.

## Sécurité en place

- **`SESSION_SECRET`** : le serveur refuse de démarrer en `NODE_ENV=production`
  si cette variable est absente ou laissée à sa valeur par défaut (voir
  `src/config.js`).
- **Headers de sécurité** (`helmet`) et **rate limiting** (`express-rate-limit`,
  strict sur `/api/login`, plus large sur le reste de `/api/*`) déjà en place
  dans `src/app.js`.
- **Store de session** : `src/stores/clientStore.js` expose une interface
  `get/set/delete` avec une implémentation mémoire par défaut (ne survit pas
  à un redémarrage, pas partagée entre plusieurs instances). Pour scaler
  horizontalement, fournis une implémentation Redis (`connect-redis`/`ioredis`)
  respectant la même interface.

## Points à adapter avant la prod

- **HTTPS** : indispensable pour que les cookies `secure` fonctionnent et
  pour protéger le mot de passe envoyé à `/api/login`.
- **Persistance du `sessionKey`** : si tu redémarres le serveur, tous les
  utilisateurs sont déconnectés (store mémoire par défaut). Voir ci-dessus
  pour brancher un store persistant.
