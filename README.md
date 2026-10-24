# <img src="assets/img/logo.svg" width="32" height="32" alt=""> Asobi

Ta collection de jeux vidéo, rangée console par console, où chaque jeu devient une carte à collectionner.
Connexion avec Discord, import Steam, infos d'[IGDB](https://www.igdb.com) et visuels de [SteamGridDB](https://www.steamgriddb.com).

Site : **https://asobi.sarizo.fr**

## Ce qu'on y trouve

- **Comptes** : chacun se connecte avec Discord et a sa propre collection, privée par défaut, publiable à `/u/<pseudo>`.
- **Comptes de jeu** : Discord retrouve tes comptes Steam, Xbox, PlayStation, Epic… Steam importe ta bibliothèque, ton temps de jeu et tes succès, puis se synchronise tout seul. Détails et limites : [GAMING_INTEGRATIONS.md](GAMING_INTEGRATIONS.md).
- **Accueil** : statistiques, suggestion du jour parmi les jeux jamais joués, parties en cours, actualité IGDB, graphiques, badges.
- **Consoles** : un dossier par console (seulement celles qui ont des jeux), avec le logo du constructeur ; la page d'une console montre sa photo et joue sa bande-annonce.
- **Fiche d'un jeu** : statut, coup de cœur, notes sur 6 aspects avec radar, temps de jeu, trophées, dates, avis, captures, bande-annonce, jeux similaires.
- **Cartes façon TCG** : la puissance (0–100) mélange ta note, ton temps de jeu et tes trophées ; elle décide de la rareté et de l'effet holographique. Un jeu jamais lancé reste **sous blister**.
- **À jouer / Envies**, **Découvrir** (roulette, « Pour toi », « Découvertes »), **Profil** de joueur à partir de 10 jeux.

## Comment ça marche

```
Navigateur ──► nginx (HTTPS, asobi.sarizo.fr) ──► conteneur Asobi : Node.js sans dépendance
                                                     ├─ le site (index.html, assets/)
                                                     ├─ l'API (/api) : comptes, collections, synchros
                                                     ├─ SQLite (server/data/asobi.sqlite, sauvegardée chaque nuit)
                                                     └─► Discord · Steam · IGDB · SteamGridDB · Wikipédia
```

Les clés d'API et les jetons ne quittent jamais le serveur. La session est un cookie `HttpOnly`.

## Installation sur le serveur

```bash
git clone https://github.com/Sarizo13/test-api-games ~/asobi && cd ~/asobi
cp .env.example .env && chmod 600 .env     # puis remplir les clés (voir le fichier)
mkdir -p server/data
docker compose up -d --build
```

Puis, en root : la configuration nginx de `deploy/nginx-asobi.conf` et `certbot --nginx -d asobi.sarizo.fr`.
Application Discord, clé Steam, IGDB : voir [GAMING_INTEGRATIONS.md](GAMING_INTEGRATIONS.md#configuration).

Mise à jour : `git pull && docker compose up -d --build`.

## Développement

```bash
cd server
npm test                       # 35 tests, sans appel réseau réel
PUBLIC_URL=http://localhost:8095 npm start
```

puis <http://localhost:8095>. Données de test : <http://localhost:8095/?dev-test> (réservé au développement, aucun lien du site n'y mène). Node 22.13 ou plus (SQLite intégré).

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `assets/css/app.css`, `assets/js/` | Le site (navigation, pages, cartes, profil, comptes connectés) |
| `assets/platforms.js` | Les consoles, partagées avec le serveur |
| `server/src/` | Le serveur : routes, sessions, collections, connecteurs (`integrations/`) |
| `server/migrations/` | Schéma de la base |
| `server/test/` | Tests |
| `scripts/lib/` | Résumés en français, genres, bandes-annonces (utilisés par le serveur) |
| `data/test-games.json` | Les données de test (`?dev-test`) |
| `Dockerfile`, `docker-compose.yml`, `deploy/` | Déploiement |
