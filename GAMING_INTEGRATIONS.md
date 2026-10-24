# Comptes de jeu connectés

Asobi se connecte avec **Discord**, et s'en sert pour **retrouver les comptes de jeu** de chacun
(Steam, Xbox, PlayStation, Epic…). **Steam** passe par son API officielle ; **PlayStation, Xbox, Epic et
Nintendo** n'ouvrent pas leurs données aux sites tiers : Asobi utilise des **connecteurs non officiels**
(les mêmes méthodes que des projets libres connus), signalés comme tels dans l'interface.

## Statut réel des plateformes

| Plateforme | Statut | Ce qui marche | Ce qui ne marche pas | Accès |
|---|---|---|---|---|
| Discord | **Implémenté, à valider en réel** | Connexion, profil, détection des comptes liés, renouvellement et révocation du jeton | — | Officiel (OAuth2) |
| Steam | **Implémenté** ; clé vérifiée en réel, import par l'interface à valider | Vérification du compte (Discord ou Steam OpenID), bibliothèque, temps de jeu, succès, synchro manuelle et automatique | Profils dont les « détails des jeux » sont privés | Officiel (Web API + OpenID) |
| PlayStation | **Expérimental, non officiel — à valider en réel** | Jeux PS4/PS5 joués, temps de jeu, première et dernière partie, progression des trophées, synchro | Profils privés, jeux jamais lancés, PS3/Vita | API privée de l'application PlayStation, jeton NPSSO **du serveur** |
| Xbox | **Expérimental, non officiel — à valider en réel** | Historique de jeu, minutes jouées, succès, dernière partie, synchro | Profils privés ; quota horaire d'OpenXBL | Service tiers OpenXBL, clé **du serveur** |
| Epic Games | **Expérimental, non officiel — à valider en réel** | Jeux possédés, temps de jeu, synchro | Succès ; la session peut expirer (recoller un code) | API privée du lanceur Epic, code collé par le joueur |
| Nintendo | **Expérimental, non officiel — à valider en réel** | Historique Switch et Switch 2 : minutes, première et dernière partie, synchro | Succès (la Switch n'en a pas) | API privée de « My Nintendo », lien collé par le joueur |
| Battle.net, Riot, Bungie, Roblox | **Partiel** : détection seulement | Compte reconnu via Discord | Bibliothèque | — |

« À valider en réel » : le code est couvert par 49 tests automatisés (toutes les plateformes simulées), mais
n'a pas encore tourné contre les vraies API avec un vrai compte. Les connecteurs non officiels peuvent
**cesser de marcher sans prévenir** si la plateforme change son API : le compte passe alors en erreur avec un
message clair, et rien n'est perdu dans la collection.

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
      core/normalize.js    correspondance jeu Steam → jeu canonique IGDB
      core/library.js      moteur commun PlayStation / Xbox / Epic / Nintendo (bibliothèque, import, synchro)
      core/credentials.js  jetons chiffrés des plateformes
      discord/ steam/ playstation/ xbox/ epic/ nintendo/   un connecteur par plateforme
      index.js             registre des connecteurs
    tasks.js               ménage, sauvegarde quotidienne, synchro automatique
  migrations/              schéma de la base (001 : base, 002 : liens jeux ↔ plateformes)
  test/                    tests (node --test)
```

### Ajouter une plateforme

1. Créer `server/src/integrations/<plateforme>/index.js` :
   - plateforme avec bibliothèque : `libraryProvider({ id, name, fetchLibrary, … })` (voir `xbox/index.js`) ;
     `fetchLibrary` renvoie `{ id, name, platform, playtimeMinutes, firstPlayedAt, lastPlayedAt, achievements, image }`
     et le moteur commun fait le reste (import, correspondances, synchro, règles de préservation) ;
   - liaison directe par copier-coller : ajouter `link: { type, start, finish }` (voir `epic/` et `nintendo/`) ;
   - détection seule : `defineProvider({ … })`.
2. Déclarer **seulement** les capacités réellement disponibles (`library`, `playtime`, `achievements`, `sync`),
   et `experimental: true` pour une API non officielle.
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

## Connecteurs non officiels

Règles communes (moteur `core/library.js`, mêmes garanties que Steam) :

- **Preuve de propriété** : PlayStation et Xbox exigent un compte **vérifié par Discord** ; Epic et Nintendo
  sont reliés par une connexion du joueur lui-même chez la plateforme. Un compte vérifié n'appartient qu'à un
  utilisateur d'Asobi.
- **Correspondance** : titre strictement identique sur IGDB (fiabilité `title`, symboles ™ ® © ignorés),
  sinon le jeu est gardé « à associer ». Un jeu déjà dans la collection sur la même console est **relié**,
  pas dupliqué.
- **Synchro** : met à jour temps de jeu, dernière partie et succès ; ne touche jamais au statut, à une saisie
  manuelle, ni à une valeur venue d'une autre plateforme ; ne supprime rien.
- Liens jeu ↔ compte dans `collection_links` ; données brutes dans `platform_games`. Déconnecter un compte
  efface ses jetons, ses données brutes et ses liens, **pas les jeux**.

### PlayStation (comme psn-api / PSNAWP)

- Le **propriétaire du serveur** met son jeton NPSSO dans `PSN_NPSSO` (se connecter sur playstation.com puis
  ouvrir <https://ca.account.sony.com/api/v1/ssocookie>). Il dure environ deux mois. Les jetons qui en
  découlent restent **en mémoire** ; aucun joueur ne donne d'identifiant PlayStation.
- Asobi retrouve l'`accountId` depuis l'ID en ligne donné par Discord, puis lit les **données publiques** :
  `gamelist/v2/users/{id}/titles` (temps de jeu, dates) et `trophy/v1/users/{id}/trophyTitles`.
- Le joueur doit rendre « Jeux » et « Trophées » visibles par **tout le monde** (Confidentialité PlayStation).

### Xbox (service OpenXBL)

- Le propriétaire du serveur crée une clé sur <https://xbl.io> (`OPENXBL_API_KEY`). OpenXBL relaie Xbox Live.
- Asobi retrouve le XUID depuis le Gamertag donné par Discord, puis lit `player/titleHistory/{xuid}`
  (jeux, succès, dernière partie) et `player/stats` (`MinutesPlayed`, par lots de 25).
- L'historique de jeu du joueur doit être public. L'offre gratuite d'OpenXBL limite les requêtes par heure.

### Epic Games (comme Legendary / Heroic)

- Le joueur se connecte sur epicgames.com ; la page affiche un `authorizationCode` à usage unique qu'il colle
  dans Asobi. Asobi l'échange contre une session du lanceur Epic (identifiants **publics** du lanceur,
  remplaçables par `EPIC_CLIENT_ID` / `EPIC_CLIENT_SECRET`), jetons chiffrés en base.
- Lus : bibliothèque (`library/api/public/items`, sans contenus Unreal ni extensions), titres et visuels
  (catalogue, mis en cache 30 jours), temps de jeu (`playtime/account/{id}/all`). Pas de succès.
- Si la session expire, le compte passe en « reconnexion nécessaire ». La déconnexion **ferme la session Epic**.

### Nintendo (comme nxapi / Switch Game Play History)

- Le joueur se connecte sur accounts.nintendo.com (lien généré par Asobi, avec **PKCE** et `state` lié au
  navigateur), puis copie l'adresse du bouton « Choisir cette personne » (`npf5c38e31cd085304b://auth#…`)
  et la colle dans Asobi. Le jeton de session obtenu (≈ 2 ans) est chiffré en base.
- Lu : `mypage-api…/users/me/play_histories` (jeux, minutes, première et dernière partie). Seuls l'identifiant
  et le pseudo du compte Nintendo sont gardés (ni e-mail, ni date de naissance).
- Nintendo n'autorise pas officiellement cet usage : ses conditions d'utilisation peuvent l'interdire.

Pour toutes, l'**ajout manuel** reste possible (bouton « Ajouter un jeu à la main », console déjà choisie).

## Normalisation des jeux

Un même jeu peut exister sur plusieurs plateformes : Cyberpunk 2077 sur PC (85 h via Steam) et sur PS5 (22 h)
sont deux entrées de collection reliées au **même jeu canonique** (ID IGDB), chacune avec son temps de jeu.

| Notion | Table |
|---|---|
| Jeu canonique (fiche IGDB partagée) | `games` |
| Jeu d'une plateforme ↔ jeu canonique, avec sa fiabilité | `external_games` |
| Jeu possédé / joué sur un compte, chiffres bruts de la plateforme | `platform_games` |
| Jeu de la collection ↔ jeu d'un compte (hors Steam) | `collection_links` |
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
- Aucun mot de passe tiers demandé à Asobi : Epic et Nintendo se connectent sur leur propre site.
- Connecteurs non officiels : identifiants de leurs applications publiques, aucun contournement de captcha
  ni de protection anti-robot ; les jetons du serveur (NPSSO, OpenXBL) restent côté serveur.

## Données stockées (RGPD)

| Donnée | Finalité | Durée |
|---|---|---|
| ID, pseudo, nom et avatar Discord | Se connecter, afficher le profil | Jusqu'à la suppression du compte |
| Sessions (empreinte du jeton, dates) | Rester connecté | 30 jours |
| Comptes de jeu détectés (plateforme, ID, pseudo, vérifié) | Proposer l'import | Jusqu'à la déconnexion du compte |
| Jetons Discord (chiffrés) | Relire les connexions Discord | Jusqu'à la déconnexion ou la suppression |
| Données des plateformes (jeux, temps de jeu, succès, dates) | Remplir la collection | Jusqu'à la déconnexion du compte |
| Jetons Epic et Nintendo (chiffrés) | Relire la bibliothèque | Jusqu'à la déconnexion (session Epic fermée) |
| ID interne PSN / XUID Xbox | Éviter de les rechercher à chaque synchro | Jusqu'à la déconnexion du compte |
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
   **PlayStation** (facultatif) : `PSN_NPSSO`. **Xbox** (facultatif) : `OPENXBL_API_KEY`.
   Epic et Nintendo n'ont besoin d'aucune clé.
3. **IGDB** : application Twitch (<https://dev.twitch.tv/console/apps>), *Client ID* et *Client Secret*.
4. Copier `.env.example` en `.env`, remplir, `chmod 600 .env`.
5. `docker compose up -d --build`, puis nginx et certbot (voir `deploy/nginx-asobi.conf`).

## Tests

```bash
cd server && npm test
```

49 tests, sans aucun appel réseau réel (Discord, Steam, IGDB, PlayStation, OpenXBL, Epic et Nintendo simulés) :
flux OAuth2 et `state` (absent, forgé, expiré, rejoué, autre navigateur), CSRF, sessions, découverte Discord,
jeton expiré / révoqué, compte déjà pris, profils privés (Steam, PlayStation), serveur non configuré,
NPSSO expiré, import, correspondances (`Portal` ≠ `Portal 2`, `Bloodborne™` = `Bloodborne`), doublons et
liaison à un jeu déjà présent, préservation du statut et des saisies manuelles, non-suppression, code Epic
invalide ou rejoué, session Epic expirée puis fermée à la déconnexion, PKCE Nintendo, lien Nintendo collé depuis
un autre navigateur ou rejoué, aucun e-mail Nintendo gardé, export RGPD sans jeton, cloisonnement entre
utilisateurs, Steam OpenID trafiqué, chiffrement, nouvelles tentatives.
