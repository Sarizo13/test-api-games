# 🎮 Ludothèque

Ma collection de jeux vidéo, rangée par plateforme, avec les infos d'[IGDB](https://www.igdb.com) et les visuels de [SteamGridDB](https://www.steamgriddb.com).
Le tout est hébergé gratuitement sur GitHub : le site sur **GitHub Pages**, et le « backend » dans une **GitHub Action**.

## Comment ça marche

```
Bouton « Ajouter un jeu » ──► issue GitHub pré-remplie ──► GitHub Action
                                                             │  cherche le jeu sur IGDB (infos)
                                                             │  et SteamGridDB (jaquette, hero, logo)
                                                             ▼
                              site mis à jour ◄── data/games.json commité + redéploiement
```

Les clés d'API ne sont **jamais** dans le code : elles vivent dans les *secrets* du dépôt et seule l'Action les utilise.
Seules les issues ouvertes par le propriétaire du dépôt déclenchent un ajout.

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

## Ajouter un jeu

- **Depuis le site** : bouton *Ajouter un jeu* → une issue pré-remplie s'ouvre → *Create*. Le jeu apparaît environ une minute plus tard (la carte « Ajout en cours… » se met à jour toute seule).
- **Depuis GitHub** : *Actions → Ajouter un jeu → Run workflow*.
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
| `.github/workflows/add-game.yml` | L'Action qui fait l'ajout depuis une issue |
| `.github/workflows/deploy.yml` | Le déploiement sur GitHub Pages |
| `.github/ISSUE_TEMPLATE/add-game.yml` | Le formulaire d'ajout |

La collection de départ est une démo : vide `data/games.json` (`[]`) pour repartir de zéro.
