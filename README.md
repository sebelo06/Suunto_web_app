# Suivi Suunto — application desktop

Application de bureau (Electron) pour suivre ses données Suunto : séances,
sommeil, récupération, évolution des métriques, et éditeur d'itinéraire avec
snap-to-road et export GPX.

Tout tourne **en local sur ta machine** : la fenêtre Electron embarque un
backend Express qui encapsule `suunto-api-wrapper` et sert le frontend
(HTML/CSS/JS, modules ES natifs, sans build step). Le backend et le frontend
partagent la **même origine** (`http://localhost:<port>`, port choisi
dynamiquement) — il n'y a donc ni CORS, ni configuration réseau, ni serveur
distant à gérer. Tes identifiants Suunto ne quittent jamais ta machine.

## Installation

Prérequis : [Node.js](https://nodejs.org/) ≥ 18.

```bash
npm install
```

## Lancement

```bash
npm run desktop
```

Une fenêtre native s'ouvre. Au premier lancement, connecte-toi avec ton
email / mot de passe Suunto. La connexion est ensuite **mémorisée de façon
chiffrée** (voir ci-dessous) : les fois suivantes, l'app rouvre déjà connectée.

## Mode démo (sans compte Suunto)

Pour explorer l'app avec des **données fictives** (≈ 8 mois de séances, sommeil,
récupération, tracés GPS, courbes FC), sans connexion :

```bash
npm run desktop:demo   # fenêtre Electron
npm run start:demo     # backend seul (avec dev.sh front pour le front)
```

Le backend remplace alors l'API Suunto par `src/demo/` (données générées de façon
déterministe, relatives à la date du jour) et saute l'écran de connexion. Rien
n'est écrit dans le Keychain. Le mode normal est inchangé.

## Créer un installeur

Le packaging est géré par [electron-builder](https://www.electron.build/). Les
artefacts sont générés dans `dist/`.

```bash
npm run dist          # installeur pour la plateforme courante
# ou par cible :
npm run dist:mac      # .dmg (macOS)
npm run dist:win      # installeur NSIS (Windows)
npm run dist:linux    # AppImage (Linux)
npm run pack          # build "unpacked" (dossier .app, sans installeur — pour tester)
```

- **macOS** : produit un `.dmg`. Le build n'est **pas signé ni notarisé** (pas
  de certificat Apple configuré) ; au premier lancement, ouvre l'app via
  clic droit → « Ouvrir » pour passer Gatekeeper. Pour distribuer largement,
  ajoute un « Developer ID » et la notarisation (voir la doc electron-builder).
- **Icône** : par défaut l'icône Electron est utilisée. Pour personnaliser,
  dépose une image ≥ 512×512 dans `build/icon.png` (macOS/Linux) et/ou
  `build/icon.ico` (Windows) — electron-builder la reprend automatiquement.
- On package uniquement le nécessaire (`electron/`, `src/`, `js/`, `css/`,
  `images/`, `index.html`, `server.js`) plus les dépendances de production ;
  voir le champ `build.files` de `package.json`.

### Publier une version (GitHub Releases)

Le workflow `.github/workflows/release.yml` construit l'installeur Windows
(`.exe`), macOS (`.dmg`) et Linux (`.AppImage`) sur GitHub Actions et les
attache à une Release dès qu'un tag `v*` est poussé :

```bash
npm version patch        # 1.0.0 → 1.0.1 : commit + tag
git push --follow-tags
```

Les installeurs apparaissent dans l'onglet *Releases* du dépôt. Les builds ne
sont pas signés : Windows affiche SmartScreen (« Informations complémentaires →
Exécuter quand même »), et macOS demande clic droit → « Ouvrir » (ou
`xattr -cr "/Applications/Suivi Suunto.app"` si l'app est dite « endommagée »).

## Connexion et confidentialité

- Le **mot de passe n'est jamais stocké**. Au login, il sert une seule fois à
  obtenir un `sessionKey` (jeton bearer révocable côté Suunto) auprès de l'API.
- Ce `sessionKey` est persisté dans le dossier `userData` de l'app, **chiffré
  au repos** via `safeStorage` d'Electron (adossé au Keychain macOS / DPAPI
  Windows / libsecret Linux) — voir `electron/persistence.js`.
- Au démarrage, si un credential valide existe, l'app réhydrate la session sans
  redemander le mot de passe (voir la route `/session` dans `src/routes/auth.js`).
- « Se déconnecter » efface le credential persisté.

## Architecture

Le mode desktop **réutilise le backend Express tel quel** et se contente de
l'empaqueter dans une fenêtre Electron.

```
electron/
  main.js              Process principal : démarre le serveur puis ouvre la fenêtre
  server.js            Démarre src/app.js + sert le frontend statique (same-origin)
  persistence.js       Persistance chiffrée du credential (safeStorage)

server.js              Point d'entrée standalone du backend (hors Electron)
src/
  config.js            Lecture/validation des variables d'environnement
  app.js               Assemblage Express (sécurité, session, routes)
  stores/
    clientStore.js         Store mémoire des sessions Suunto (get/set/delete)
    sessionPersistence.js  Seam de persistance (no-op par défaut, branché en desktop)
  middleware/auth.js   Garde-fous requireSuuntoClient / requireSession
  routes/              Un fichier par groupe d'endpoints (auth, workouts, wellness, guides, route)
  utils/unwrap.js      Normalisation des réponses API Suunto
  demo/                Données fictives du mode démo (SUUNTO_DEMO=1)

index.html             Squelette de la page (charge css/styles.css et js/main.js)
css/styles.css         Tous les styles
js/                    Un module par responsabilité (api, auth, workouts,
                       wellness, evolution, route-editor, overview-map, map,
                       theme, charts, icons, format, config, state, dom)
```

En desktop, `electron/server.js` écoute sur un port libre (`0`), injecte à la
volée l'origine réelle dans le `<meta name="api-base">` de `index.html`, et
sert `js/`, `css/`, `images/` en statique. Le frontend appelle donc l'API en
same-origin, sans configuration.

## Endpoints internes

Le backend expose ces routes, consommées par le frontend (le cookie de session
est géré automatiquement en same-origin) :

| Méthode | Route                    | Description                                 |
| ------- | ------------------------ | ------------------------------------------- |
| POST    | `/api/login`             | `{ email, password }` → ouvre la session    |
| POST    | `/api/logout`            | Détruit la session et le credential persisté |
| GET     | `/api/session`           | Indique si l'app est déjà authentifiée      |
| GET     | `/api/workouts?limit=20` | Dernières séances                           |
| GET     | `/api/wellness/sleep`    | Données de sommeil                          |
| GET     | `/api/wellness/recovery` | Récupération / stress                       |
| GET     | `/api/wellness/activity` | Activité 24/7 (pas, énergie) ; `?since=<ms>`, 7 jours par défaut |
| GET     | `/api/wellness/sleepstages` | Phases de sommeil ; `?since=<ms>`        |
| POST    | `/api/guides`            | `{ guide, icon, guideId? }` → crée ou remplace un Guide SuuntoPlus sur le compte |
| POST    | `/api/route/snap`        | `{ points: [{lat,lng}], activityType }` → aligne l'itinéraire sur les chemins (BRouter) |

### Snap-to-road

`/api/route/snap` s'appuie sur [BRouter](https://brouter.de/) (routeur OSM
public, gratuit et **sans clé**) : aucune configuration n'est nécessaire. Le
profil de routage est choisi selon `activityType` (randonnée, marche, trail,
vélo route, VTT), et l'altitude et le dénivelé (D+) sont renvoyés dans la même
réponse — l'export GPX n'a donc pas besoin d'un service d'altitude séparé.

### Planifier une séance

L'onglet **Planifier** permet de construire une séance (échauffement,
répétitions, cibles de FC par zone), de voir son effet estimé sur la charge
(ACWR) et de l'envoyer sur la montre sous forme de **Guide SuuntoPlus**
(`POST /api/guides`, synchronisé via l'app mobile). Il propose aussi un modèle
adapté à ta forme du jour, et exporte le guide en `.zip` ou en texte.
La logique pure (modèles, validation, génération du guide, ZIP) est dans
`js/workout-plan.js` et `js/guide-export.js`, testée sans navigateur.

## Fond de carte

Les cartes utilisent les tuiles OpenStreetMap (sans clé). Le mode sombre est
obtenu par un filtre CSS appliqué aux tuiles.

## Développement

- `npm run dev` — lance le backend seul en watch (`node --watch server.js`) sur
  `http://localhost:3000`, utile pour itérer sur l'API sans relancer Electron.
- `npm test` — lance les tests unitaires du planificateur (`test/`, `node --test`).
- Le frontend n'a pas d'étape de build : édite `js/`, `css/`, `index.html` et
  recharge la fenêtre (`Cmd/Ctrl+R`).
- Posture de sécurité de la fenêtre : `nodeIntegration: false` et
  `contextIsolation: true` — le renderer n'a aucun accès Node. Les liens
  externes s'ouvrent dans le navigateur système.
