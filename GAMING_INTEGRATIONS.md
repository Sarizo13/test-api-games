# Comptes de jeu connectés

Asobi se connecte avec **Discord**, et s'en sert pour **retrouver les comptes de jeu** de chacun
(Steam, Xbox, PlayStation, Epic…). Seul **Steam** permet aujourd'hui d'importer une bibliothèque,
le temps de jeu et les succès ; les autres plateformes sont reconnues, et leurs jeux s'ajoutent à la main.

## Statut réel des plateformes

| Plateforme | Statut | Ce qui marche | Ce qui ne marche pas | API |
|---|---|---|---|---|
| Discord | **Implémenté, à valider en réel** | Connexion, profil, détection des comptes liés, renouvellement et révocation du jeton | — | Officielle (OAuth2) |
| Steam | **Implémenté, à valider en réel** | Vérification du compte (Discord ou Steam OpenID), import de la bibliothèque, temps de jeu, succès, synchro manuelle et automatique | Profils dont les « détails des jeux » sont privés | Officielle (Web API + OpenID) |
| PlayStation | **Partiel** : détection seulement | Identifiant PSN reconnu via Discord | Jeux, temps de jeu, trophées | Aucune API ouverte |
| Xbox | **Partiel** : détection seulement | Gamertag reconnu via Discord | Jeux, succès, Gamerscore, temps de jeu | Réservée aux partenaires |
| Epic Games | **Partiel** : détection seulement | Pseudo reconnu via Discord | Bibliothèque, temps de jeu, succès | Profil seulement |
| Nintendo | **Indisponible** | Ajout manuel des jeux | Tout import (pas de connexion Discord Nintendo) | Aucune API publique |
| Battle.net, Riot, Bungie, Roblox | **Partiel** : détection seulement | Compte reconnu via Discord | Bibliothèque | — |

« À valider en réel » : tout le code est testé (35 tests automatisés, avec des réponses Discord, Steam et
IGDB simulées), mais pas encore contre les vraies API, faute d'application Discord et de clé Steam
configurées au moment de l'écriture. Ce tableau sera mis à jour après le premier essai réel.

## Architecture

```
Navigateur ──(cookie de session HttpOnly)──► nginx (HTTPS) ──► conteneur Asobi (Node, 127.0.0.1:8095)
                                                                  │  site statique + API /api
                                                                  ├─ SQLite (server/data/asobi.sqlite)
                                                                  └─► Discord · Steam · IGDB · SteamGridDB
```

```
server/
  src/
    app.js                 routes HTTP (site + /api), anti-CSRF, limitation du débit
    auth.js                sessions, « state » OAuth/OpenID, connexion Discord
    accounts.js            comptes connectés : détection, jetons chiffrés, liaison, déconnexion
    collection.js          collection (jeux, envies, liste « à jouer »), cloisonnée par utilisateur
    metadata.js            fiches IGDB / SteamGridDB / Steam / résumés en français
    integrations/
      core/provider.js     interface commune des connecteurs et états des comptes
      core/sync.js         tâches de synchronisation, nouvelles tentatives, attente croissante
      core/normalize.js    correspondance jeu de plateforme → jeu canonique IGDB
      discord/ steam/ playstation/ xbox/ epic/ nintendo/   un connecteur par plateforme
      index.js             registre des connecteurs
    tasks.js               ménage, sauvegarde quotidienne, synchro automatique
  migrations/001_init.sql  schéma de la base
  scripts/import-legacy.mjs  reprise de l'ancienne collection (Cloudflare)
  test/                    tests (node --test)
```

### Ajouter une plateforme

1. Créer `server/src/integrations/<plateforme>/index.js` avec `defineProvider({ id, name, capabilities, … })`.
2. Déclarer **seulement** les capacités réellement disponibles (`library`, `playtime`, `achievements`, `sync`)
   et, si besoin, `enable`, `sync`, `library`, `importGames` (voir `steam/index.js`).
3. L'ajouter dans `integrations/index.js`. La page « Comptes connectés » l'affiche toute seule.

### États d'un compte

| État | Sens |
|---|---|
| `detected` | Vu dans les connexions Discord ; rien d'autre n'est supposé |
| `authorization_required` | Il faut prouver que le compte est à soi, ou rétablir une autorisation |
| `connected` | Accès vérifié (pour Steam : profil lisible), pas encore synchronisé |
| `syncing` / `synced` | Synchronisation en cours / terminée |
| `error` | Dernière tentative en échec (message affiché) |
| `unsupported` | La plateforme ne permet pas d'import |

Un compte **détecté n'est jamais affiché comme connecté** à son API tant que l'accès n'a pas été vérifié.

## Discord

- **Scopes** : `identify` (pseudo, nom, avatar) et `connections` (comptes liés). Pas d'e-mail.
- **Flux** : `/api/auth/discord/login` crée un `state` aléatoire (usage unique, 10 min) lié au navigateur par un
  cookie HttpOnly, puis redirige vers Discord. Au retour, `/api/auth/discord/callback` vérifie le `state`,
  échange le code **côté serveur** (avec le secret client), lit le profil et les connexions.
- **PKCE** : la documentation de Discord ne décrit PKCE que pour remplacer le flux implicite ; Asobi est un
  client confidentiel (secret côté serveur) : `state` + secret client, sans PKCE.
- **Jetons** : chiffrés en AES-256-GCM, renouvelés automatiquement (refresh token) avant expiration.
  Refresh refusé (accès révoqué depuis Discord) → jetons effacés, compte en `authorization_required`,
  l'utilisateur se reconnecte.
- **Limite** : Discord ne transmet aucune autorisation des plateformes liées. `verified` prouve seulement
  que la personne a relié ce compte via la plateforme elle-même. Aucun jeton tiers n'est extrait de Discord.
- Docs : <https://docs.discord.com/developers/topics/oauth2>, <https://docs.discord.com/developers/resources/user>

## Steam

- **API Web officielle**, clé `STEAM_API_KEY` gardée sur le serveur :
  `IPlayerService/GetOwnedGames` (jeux possédés + temps de jeu), `ISteamUserStats/GetPlayerAchievements`
  (succès, une requête par jeu), `ISteamUser/GetPlayerSummaries` (pseudo).
- **Propriété du compte** : soit la connexion Steam de Discord est `verified`, soit l'utilisateur passe par
  **Steam OpenID** (`/api/accounts/steam/openid/start`) : la réponse est vérifiée auprès de Steam
  (`check_authentication`), avec contrôle de l'adresse de retour, du fournisseur, de l'identifiant et des champs signés.
  Un compte Steam vérifié n'appartient qu'à un seul utilisateur d'Asobi.
- **Condition** : profil Steam avec « Détails des jeux » publics ; sinon un message explique quoi changer.
- **Règles de synchronisation** :
  - seuls les jeux rangés dans **PC** sont reliés à Steam ;
  - le **statut** n'est jamais modifié par une synchro (un jeu « Terminé » le reste) ; à l'import, un jeu déjà
    lancé arrive « En cours », sinon « Jamais joué » ;
  - un temps de jeu ou des succès **saisis à la main** ne sont jamais écrasés ;
  - un jeu absent d'une réponse Steam n'est **jamais supprimé** ;
  - les chiffres bruts de Steam sont gardés à part (`platform_games`).
- **Synchro automatique** toutes les 12 h (désactivable par compte), un compte à la fois.

## PlayStation, Xbox, Epic, Nintendo

- **PlayStation** : pas d'API ouverte aux applications tierces. `psn-api` et `PSNAWP` exigent le jeton de session
  « NPSSO » du compte, récupéré dans le navigateur : c'est un identifiant de connexion complet, qu'Asobi ne demande pas.
- **Xbox** : les services Xbox Live (succès, Gamerscore, temps de jeu) sont réservés aux partenaires Microsoft ;
  un jeton OAuth Microsoft classique n'y donne pas accès. **OpenXBL** (service tiers) pourrait être branché
  plus tard avec une inscription et une clé d'application dédiées : non activé.
- **Epic Games** : Epic Account Services ne donne que le profil, pas la bibliothèque ni le temps de jeu.
  Les méthodes qui imitent le lanceur Epic ne sont pas utilisées.
- **Nintendo** : aucune API publique de bibliothèque, et Discord ne propose pas de connexion Nintendo.
  `nxapi` passe par l'application Nintendo Switch Online avec les jetons du compte : non utilisé.
- Pour toutes : **ajout manuel assisté** (bouton « Ajouter un jeu à la main », console déjà choisie,
  recherche IGDB qui trouve aussi les jeux rétro).

## Normalisation des jeux

Un même jeu peut exister sur plusieurs plateformes : Cyberpunk 2077 sur PC (85 h via Steam) et sur PS5 (22 h)
sont deux entrées de collection reliées au **même jeu canonique** (ID IGDB), chacune avec son temps de jeu.

| Notion | Table |
|---|---|
| Jeu canonique (fiche IGDB partagée) | `games` |
| Jeu d'une plateforme ↔ jeu canonique, avec sa fiabilité | `external_games` |
| Jeu possédé / joué sur un compte, chiffres bruts de la plateforme | `platform_games` |
| Jeu de la collection, sur une console, avec les données personnelles | `collection` |

Fiabilités acceptées : `exact` (lien officiel donné par IGDB), `title` (titre strictement identique après
normalisation), `manual` (choisi par l'utilisateur). Sinon `none` : le jeu est importé avec une fiche minimale
et proposé dans **« Jeux à associer »**. Jamais de fusion sur une simple ressemblance (« Portal » ≠ « Portal 2 »).

## Sécurité

- Sessions : jeton aléatoire de 256 bits dans un cookie `HttpOnly`, `SameSite=Lax`, `Secure` (HTTPS) ;
  seule son empreinte SHA-256 est en base. Aucun jeton dans le `localStorage`.
- `state` OAuth/OpenID aléatoire, à usage unique, 10 minutes, lié au navigateur ; adresse de retour limitée
  aux pages du site.
- Anti-CSRF : toute écriture exige l'en-tête `X-Asobi: 1`, la même origine, et refuse `Sec-Fetch-Site: cross-site`.
- Jetons des fournisseurs chiffrés au repos (AES-256-GCM, clé `ENCRYPTION_KEY` ou générée dans `DATA_DIR/secret.key`).
- Clés d'API (Discord, Steam, IGDB…) uniquement côté serveur.
- Limitation du débit par adresse (connexion, lecture, écriture) et par utilisateur (synchros, découvertes).
- Cloisonnement : chaque requête est filtrée par l'utilisateur connecté ; un autre utilisateur reçoit 404.
- Politique de sécurité du contenu (CSP), `X-Frame-Options`, `nosniff`, HSTS (nginx).
- Conteneur : utilisateur non root, système de fichiers en lecture seule, aucune capacité, écoute sur 127.0.0.1.
- Aucun mot de passe tiers demandé, aucun contournement de protection d'API.

## Données stockées (RGPD)

| Donnée | Finalité | Durée |
|---|---|---|
| ID, pseudo, nom et avatar Discord | Se connecter, afficher le profil | Jusqu'à la suppression du compte |
| Sessions (empreinte du jeton, dates) | Rester connecté | 30 jours |
| Comptes de jeu détectés (plateforme, ID, pseudo, vérifié) | Proposer l'import | Jusqu'à la déconnexion du compte |
| Jetons Discord (chiffrés) | Relire les connexions Discord | Jusqu'à la déconnexion ou la suppression |
| Données Steam (jeux, temps de jeu, succès) | Remplir la collection | Jusqu'à la déconnexion du compte Steam |
| Collection, notes, avis, listes | Le service lui-même | Jusqu'à la suppression du compte |
| Historique des synchros | Diagnostic | 90 jours |

- Pas d'e-mail, pas de mot de passe, aucun traceur.
- Le profil est **privé par défaut** ; il devient visible à `/u/<pseudo>` seulement si l'utilisateur le rend public.
- **Export** complet : Profil → « Télécharger mes données » (`GET /api/me/export`).
- **Suppression** : Profil → « Supprimer mon compte » efface tout et révoque l'accès Discord.
- Sauvegardes de la base : quotidiennes, 14 jours, dans `server/data/backups`.

## Configuration

1. **Discord** : <https://discord.com/developers/applications> → *New Application* → *OAuth2* :
   copier *Client ID* et *Client Secret* ; *Redirects* : `https://asobi.sarizo.fr/api/auth/discord/callback`.
2. **Steam** : clé sur <https://steamcommunity.com/dev/apikey> (domaine : `asobi.sarizo.fr`).
3. **IGDB** : application Twitch (<https://dev.twitch.tv/console/apps>), *Client ID* et *Client Secret*.
4. Copier `.env.example` en `.env`, remplir, `chmod 600 .env`.
5. `docker compose up -d --build`, puis nginx et certbot (voir `deploy/nginx-asobi.conf`).

## Tests

```bash
cd server && npm test
```

35 tests, sans aucun appel réseau réel (Discord, Steam et IGDB simulés) : flux OAuth2 et `state`
(absent, forgé, expiré, rejoué, autre navigateur), CSRF, sessions, découverte Discord, jeton expiré / révoqué,
compte Steam déjà pris, profil Steam privé, import, correspondances (`Portal` ≠ `Portal 2`), doublons,
préservation du statut et des saisies manuelles, non-suppression, cloisonnement entre utilisateurs,
Steam OpenID trafiqué, chiffrement, nouvelles tentatives.
