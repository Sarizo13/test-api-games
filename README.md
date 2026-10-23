# <img src="assets/img/logo.svg" width="32" height="32" alt=""> Asobi

Ma collection de jeux vidéo, rangée console par console, où chaque jeu devient une carte à collectionner.
Infos d'[IGDB](https://www.igdb.com), visuels de [SteamGridDB](https://www.steamgriddb.com), temps de jeu et succès de [Steam](https://store.steampowered.com).

Site : **https://sarizo13.github.io/test-api-games/** · Mode test (données fictives, rien n'est enregistré) : [`?test`](https://sarizo13.github.io/test-api-games/?test)

## Ce qu'on y trouve

- **Accueil** : statistiques (jeux, heures, note moyenne, « pile de la honte »), suggestion du jour parmi les jeux jamais joués, parties en cours, actualité IGDB (sorties récentes, à venir, « ce jour-là » il y a 5, 10, 20 ans…), graphiques et badges.
- **Consoles** : un dossier par console, rangé par famille (PlayStation, Nintendo, Xbox, Sega, rétro & arcade, PC). Une console n'apparaît que si elle contient au moins un jeu. La page d'une console joue sa bande-annonce en fond.
- **Fiche d'un jeu** : statut (jamais joué, en cours, terminé, 100 %, abandonné), coup de cœur, notes perso sur 6 aspects avec radar, temps de jeu, trophées, dates, avis, captures, bande-annonce et jeux similaires.
- **Cartes façon TCG** : la puissance d'une carte (0–100) mélange ta note, ton temps de jeu (comparé à la durée moyenne pour finir le jeu) et tes trophées, avec des bonus (terminé, 100 %, coup de cœur). Elle décide de la rareté et de l'effet holographique : commune, peu commune, rare, épique, légendaire, mythique. Un jeu jamais lancé reste **sous blister**, qu'on arrache en le commençant.
- **À jouer / Envies** : ta file d'attente (glisser pour réordonner, durée totale estimée) et les jeux que tu n'as pas encore (compte à rebours jusqu'à la sortie).
- **Découvrir** : la roulette parmi tes jeux jamais joués (filtres par durée et console), « Pour toi » (d'après ton profil) et « Découvertes » (pépites hors de tes genres habituels).
- **Profil** (à partir de 10 jeux) : ton archétype de joueur, tes traits, tes genres, consoles et époques préférés, ta meilleure main de 5 cartes, les badges, la connexion Steam et la sauvegarde.

## Comment ça marche

```
Site statique (GitHub Pages)  ──►  mini-serveur (Cloudflare Worker)  ──►  IGDB · SteamGridDB · Steam · Wikipédia
                                         │
                                         ▼
                                  la collection (Cloudflare KV)
```

- Lire la collection est public ; la modifier demande le mot de passe (`ADMIN_PASSWORD`), retenu sur l'appareil après la première connexion.
- Les clés d'API ne sont **jamais** dans le code : ce sont des *secrets* du Worker.
- Une GitHub Action copie la collection chaque nuit dans `data/backup.json` : l'historique Git garde toutes les versions.

## Mise en route

### 1. Accès IGDB (gratuit)

1. Un compte [Twitch](https://www.twitch.tv) avec la **double authentification activée**.
2. [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) → **Register Your Application** (*OAuth Redirect URLs* : `http://localhost`, *Category* : `Website Integration`, *Client Type* : `Confidential`).
3. **Manage** → copier le **Client ID**, puis **New Secret** → copier le **Client Secret**.

### 2. Le mini-serveur

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

Puis *Cloudflare → Workers & Pages → ludotheque → Settings → Variables and Secrets*, type *Secret* :

| Nom | Valeur | |
|---|---|---|
| `IGDB_CLIENT_ID` | Client ID Twitch | obligatoire |
| `IGDB_CLIENT_SECRET` | Client Secret Twitch | obligatoire |
| `ADMIN_PASSWORD` | le mot de passe à taper sur le site pour modifier | obligatoire |
| `SGDB_API_KEY` | clé SteamGridDB (*Preferences → API*) : jaquettes, bandeaux et logos plus beaux | conseillé |
| `STEAM_API_KEY` | clé Steam ([steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)) : temps de jeu, succès, import | facultatif |
| `DEEPL_API_KEY` | clé DeepL gratuite : traduit les résumés introuvables en français | facultatif |

Pour Steam, ton profil doit être public, *détails des jeux* compris (*Steam → Profil → Modifier → Paramètres de confidentialité*). Steam ne concerne que les jeux rangés dans **PC**.

### 3. GitHub Pages

*Settings → Pages → Source* : **GitHub Actions**. Le site se déploie à chaque push sur `main`.

## Résumés en français

IGDB ne donne ses résumés qu'en anglais. À l'ajout d'un jeu, le mini-serveur cherche dans l'ordre : la description française de **Steam**, l'introduction de l'article **Wikipédia** français (via Wikidata), une traduction **DeepL** si la clé existe, et à défaut le résumé anglais. La source est indiquée sous le résumé.

## Bandes-annonces

Le bandeau zoome pendant ~3,5 s, puis l'image s'ouvre comme un diaphragme sur la bande-annonce (muette, un bouton active le son). Jeux Steam : la vidéo de la boutique, lue directement ([hls.js](https://github.com/video-dev/hls.js)). Autres jeux et consoles : YouTube. Le crayon sur la page d'une console permet de changer sa bande-annonce. Pas de vidéo sur petit écran, en économie de données ou si les animations sont réduites. `?debug` dans l'adresse affiche les événements des vidéos.

## En local

```bash
npx --yes serve .
```

puis ouvrir l'adresse affichée avec `?test` à la fin pour travailler sur `data/test-games.json`. Le mini-serveur accepte aussi `http://localhost:8765` (variable `ALLOWED_ORIGINS` de `worker/wrangler.toml`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `assets/css/app.css` | La page et son style |
| `assets/js/main.js` | Navigation, barre latérale, recherche |
| `assets/js/views/` | Une page par fichier : accueil, consoles, fiche, listes, découvrir, profil |
| `assets/js/card.js` | Les cartes : puissance, rareté, effet holographique |
| `assets/js/taste.js`, `badges.js` | Le profil de joueur et les badges |
| `assets/js/state.js` | Les données et les appels au mini-serveur |
| `assets/platforms.js` | Les consoles (nom, famille, couleur, année, bande-annonce), partagées avec le mini-serveur |
| `worker/` | Le mini-serveur Cloudflare (collection, recherche, actualité, suggestions, Steam) |
| `scripts/lib/` | Résumés en français, genres, bandes-annonces : utilisés par le mini-serveur |
| `data/test-games.json` | Les données du mode test |
| `.github/workflows/` | Déploiement du site et sauvegarde quotidienne |
