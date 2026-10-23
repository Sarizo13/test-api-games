# 🎮 Ludothèque

Ma collection de jeux vidéo, rangée par plateforme, avec les infos d'[IGDB](https://www.igdb.com) et les visuels de [SteamGridDB](https://www.steamgriddb.com).
Le tout est hébergé gratuitement sur GitHub : le site sur **GitHub Pages**, et le « backend » dans une **GitHub Action**.

## Comment ça marche

```
Site (GitHub Pages)
  │  tu tapes un nom ──► mini-serveur (Cloudflare Worker) ──► propositions IGDB
  │  tu choisis + « Ajouter »  ──► mini-serveur ──► lance la GitHub Action
  ▼
GitHub Action « Ajouter un jeu »
  │  infos IGDB · visuels SteamGridDB · résumé en français (Steam, Wikipédia)
  ▼
data/games.json commité + redéploiement ──► le jeu apparaît sur le site (~1 min)
```

Les clés d'API ne sont **jamais** dans le code : elles vivent dans les *secrets* du dépôt et du Worker.
L'ajout est protégé par un mot de passe (retenu sur ton appareil après la première fois).
Sans le mini-serveur, le site retombe sur l'ancien mode : une issue GitHub pré-remplie, sans propositions.

### Résumés en français

IGDB ne donne ses résumés qu'en anglais. Le script cherche donc, dans l'ordre :
1. la description française de **Steam** ;
2. l'introduction de l'article **Wikipédia** en français (retrouvé via Wikidata) ;
3. une traduction **DeepL** du résumé IGDB, si le secret `DEEPL_API_KEY` existe (compte gratuit sur deepl.com, optionnel) ;
4. à défaut, le résumé anglais d'IGDB.

La source est indiquée sous le résumé sur la fiche du jeu. Pour retraduire les jeux déjà présents : `node scripts/refresh-summaries.mjs`.

### Bandes-annonces

Le fond du carrousel et de la fiche zoome pendant environ 3,5 s, puis la bande-annonce apparaît en fondu (sans le son ; un bouton permet de l'activer). Pendant la vidéo, le carrousel attend. Pas de vidéo sur petit écran, en mode économie de données ou si les animations sont réduites.

- **Jeux sur Steam** : la bande-annonce de la boutique Steam est lue directement par le site (balise `<video>` + [hls.js](https://github.com/video-dev/hls.js) pour Firefox et Chrome). Aucune interface par-dessus.
- **Autres jeux** : bande-annonce YouTube trouvée par IGDB. Certains navigateurs (Firefox notamment) peuvent afficher une fraction de seconde le bouton lecture/pause de YouTube à l'apparition.

Pour ajouter les bandes-annonces aux jeux déjà présents : `node scripts/refresh-steam.mjs` (Steam, sans clé) et *Actions → Mettre à jour depuis IGDB → Run workflow* (YouTube).

Mode diagnostic : ajouter `?debug` à l'adresse du site affiche les événements des bandes-annonces en direct.

## Mise en route

### 1. Les secrets

*Settings → Secrets and variables → Actions → New repository secret* :

| Nom | Valeur |
|---|---|
| `SGDB_API_KEY` | Clé SteamGridDB (*Preferences → API* sur steamgriddb.com) |
| `IGDB_CLIENT_ID` | Client ID de ton application Twitch |
| `IGDB_CLIENT_SECRET` | Client Secret de ton application Twitch |

Sans les secrets IGDB, l'ajout marche quand même : seulement le nom, la date de sortie et les visuels (pas de résumé, genres ni studio).

### 2. Obtenir l'accès IGDB (gratuit)

1. Avoir un compte [Twitch](https://www.twitch.tv) avec la **double authentification activée** (obligatoire pour créer une application).
2. Aller sur [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → **Register Your Application**.
   - *Name* : ce que tu veux (unique sur Twitch), ex. `ludotheque-sarizo`
   - *OAuth Redirect URLs* : `http://localhost`
   - *Category* : `Website Integration`
   - *Client Type* : `Confidential`
3. Ouvrir l'application (**Manage**) : copier le **Client ID**, puis cliquer sur **New Secret** et copier le **Client Secret**.
4. Les coller dans les secrets `IGDB_CLIENT_ID` et `IGDB_CLIENT_SECRET`.

### 3. GitHub Pages

*Settings → Pages → Build and deployment → Source* : **GitHub Actions**.
Le site se déploie à chaque push sur `main` et après chaque ajout de jeu.

> Sur un compte GitHub gratuit, Pages n'est disponible que pour les dépôts **publics**.

### 4. Le mini-serveur (propositions + ajout sans passer par GitHub)

C'est un Cloudflare Worker gratuit, dans le dossier `worker/`.

1. **Jeton GitHub** : [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - *Repository access* : *Only select repositories* → `test-api-games`
   - *Permissions → Repository permissions → Actions* : **Read and write**
2. **Déploiement** (compte Cloudflare gratuit) :

   ```bash
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```

3. **Secrets du Worker** (*Cloudflare → Workers & Pages → ludotheque → Settings → Variables and Secrets*, type *Secret*) :

   | Nom | Valeur |
   |---|---|
   | `IGDB_CLIENT_ID` | comme pour GitHub |
   | `IGDB_CLIENT_SECRET` | comme pour GitHub |
   | `GITHUB_TOKEN` | le jeton de l'étape 1 |
   | `ADMIN_PASSWORD` | le mot de passe que tu taperas sur le site pour ajouter un jeu |

4. Mettre l'adresse du Worker (`https://ludotheque.<ton-compte>.workers.dev`) dans `CONFIG.api` en haut de `assets/app.js`.

## Ajouter un jeu

- **Depuis le site** : bouton *Ajouter un jeu* (ou tape un nom dans la recherche → *Ajouter « … »*), choisis le jeu dans les propositions, la plateforme, puis *Ajouter*. Le jeu apparaît environ une minute plus tard (la carte « Ajout en cours… » se met à jour toute seule).
- **Depuis GitHub** : *Actions → Ajouter un jeu → Run workflow*, ou une issue avec le formulaire *Ajouter un jeu*.
- **En local** :

  ```bash
  SGDB_API_KEY=… IGDB_CLIENT_ID=… IGDB_CLIENT_SECRET=… node scripts/add-game.mjs "Hollow Knight" --platform switch
  ```

  Options : `--igdb <id>` pour forcer le jeu quand la recherche se trompe, `--dry-run` pour tester sans écrire, `--force` pour remplacer un doublon.

Pour **retirer** ou corriger un jeu, modifie directement `data/games.json` (bouton crayon sur GitHub).

## Lancer le site en local

```bash
python -m http.server 8000
```

puis ouvrir http://localhost:8000.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `assets/` | Le site (HTML, CSS et JavaScript sans dépendance) |
| `assets/platforms.js` | Liste des plateformes : nom, couleur, alias. Partagée par le site et le script |
| `data/games.json` | La collection |
| `scripts/add-game.mjs` | Cherche un jeu sur IGDB + SteamGridDB et l'ajoute à la collection |
| `scripts/lib/summary-fr.mjs` | Trouve un résumé en français (Steam, Wikipédia, DeepL) |
| `scripts/refresh-summaries.mjs` | Retraduit les résumés des jeux déjà présents |
| `worker/` | Le mini-serveur Cloudflare : propositions et ajout direct |
| `.github/workflows/add-game.yml` | L'Action qui fait l'ajout depuis une issue |
| `.github/workflows/deploy.yml` | Le déploiement sur GitHub Pages |
| `.github/ISSUE_TEMPLATE/add-game.yml` | Le formulaire d'ajout |

La collection de départ est une démo : vide `data/games.json` (`[]`) pour repartir de zéro.
