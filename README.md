# Backend de suivi Suunto (exemple)

Encapsule `suunto-api-wrapper` côté serveur pour éviter d'exposer les
identifiants Suunto et les problèmes de CORS au frontend.

## Installation

```bash
npm install
```

## Lancement

```bash
npm start
# ou en mode watch
npm run dev
```

Le serveur écoute sur `http://localhost:3000` par défaut (variable `PORT`).

## Endpoints

| Méthode | Route                    | Description                              |
| ------- | ------------------------ | ----------------------------------------- |
| POST    | `/api/login`             | `{ email, password }` → crée la session   |
| POST    | `/api/logout`            | Détruit la session                        |
| GET     | `/api/workouts?limit=20` | Dernières séances de l'utilisateur connecté |
| GET     | `/api/wellness/sleep`    | Données de sommeil                        |
| GET     | `/api/wellness/recovery` | Récupération / stress                     |
| POST    | `/api/route/snap`        | `{ points: [{lat,lng}] }` → aligne l'itinéraire sur les chemins (OpenRouteService) |

Toutes les routes `/api/*` (sauf login) nécessitent le cookie de session
renvoyé par `/api/login` — le frontend doit envoyer les requêtes avec
`credentials: "include"` (fetch) ou `withCredentials: true` (axios).

### Snap-to-road

`/api/route/snap` s'appuie sur l'API [OpenRouteService](https://openrouteservice.org/dev/#/signup)
(gratuite, ~2000 requêtes/jour). Crée un compte, récupère ta clé, puis :

```bash
export ORS_API_KEY="ta-clé-ors"
```

Sans cette variable, le bouton "Aligner sur les chemins" de l'éditeur
d'itinéraire renvoie une erreur explicite plutôt que de planter.

## Points à adapter avant la prod

- **`SESSION_SECRET`** : définis une vraie valeur secrète en variable d'env.
- **Store de session** : le store mémoire par défaut d'`express-session`
  ne convient pas en prod (fuite mémoire, pas de partage entre instances).
  Utilise `connect-redis` ou équivalent.
- **HTTPS** : indispensable pour que les cookies `secure` fonctionnent et
  pour protéger le mot de passe envoyé à `/api/login`.
- **Rate limiting** : ajoute un middleware (`express-rate-limit`) pour ne
  pas abuser de l'API non officielle de Suunto.
- **Persistance du `sessionKey`** : si tu redémarres le serveur, tous les
  utilisateurs sont déconnectés (le `Map` est en mémoire). Envisage de
  stocker le `sessionKey` Suunto chiffré en base si besoin de persistance.
