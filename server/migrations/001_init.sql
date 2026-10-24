-- Asobi : schéma initial (multi-comptes, connexion Discord, comptes de jeu connectés).
-- Les données des plateformes (Steam…) et les données personnelles (statut, notes, avis) sont séparées :
-- une synchronisation ne touche jamais aux secondes.

-- ---------- Comptes et sessions ----------

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  discord_id     TEXT NOT NULL UNIQUE,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- identifiant public (/u/<username>)
  display_name   TEXT,
  avatar_url     TEXT,
  profile_public INTEGER NOT NULL DEFAULT 0,            -- privé par défaut
  settings       TEXT NOT NULL DEFAULT '{}',            -- JSON : prénom affiché, bandes-annonces des consoles
  playlist       TEXT NOT NULL DEFAULT '[]',            -- JSON : identifiants de la liste « à jouer », dans l'ordre
  created_at     TEXT NOT NULL,
  last_login_at  TEXT
);

-- Le jeton de session n'est jamais stocké en clair : seulement son empreinte SHA-256
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Paramètres « state » des redirections OAuth / OpenID (valables 10 minutes, à usage unique)
CREATE TABLE oauth_states (
  state_hash   TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  purpose      TEXT NOT NULL,            -- login | link
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  browser_hash TEXT NOT NULL,            -- lie le « state » au navigateur qui a lancé la connexion
  next         TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

-- ---------- Comptes de jeu connectés ----------

CREATE TABLE connected_accounts (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,       -- discord | steam | playstation | xbox | epicgames | …
  external_user_id  TEXT NOT NULL,
  external_username TEXT,
  verified          INTEGER NOT NULL DEFAULT 0,  -- propriété du compte prouvée (Discord « verified », Steam OpenID…)
  detected_via      TEXT,                -- discord | openid | login
  status            TEXT NOT NULL,       -- detected | authorization_required | connected | syncing | synced | error | unsupported
  status_message    TEXT,
  auto_sync         INTEGER NOT NULL DEFAULT 1,
  games_count       INTEGER NOT NULL DEFAULT 0,
  connected_at      TEXT NOT NULL,
  last_sync_at      TEXT,
  UNIQUE (user_id, provider, external_user_id)
);
-- Un compte vérifié n'appartient qu'à un seul utilisateur d'Asobi
CREATE UNIQUE INDEX connected_accounts_owner ON connected_accounts(provider, external_user_id) WHERE verified = 1;

-- Jetons des fournisseurs, chiffrés (AES-256-GCM), jamais envoyés au navigateur
CREATE TABLE provider_credentials (
  connected_account_id    INTEGER PRIMARY KEY REFERENCES connected_accounts(id) ON DELETE CASCADE,
  encrypted_token         TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  scope                   TEXT,
  expires_at              TEXT
);

-- ---------- Jeux ----------

-- Jeu canonique (fiche IGDB enrichie : visuels, résumé en français, bande-annonce…), partagé entre utilisateurs
CREATE TABLE games (
  igdb_id    INTEGER PRIMARY KEY,
  meta       TEXT NOT NULL,              -- JSON
  updated_at TEXT NOT NULL
);

-- Jeu d'une collection : un jeu sur une console, avec les données personnelles de son propriétaire
CREATE TABLE collection (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id               TEXT NOT NULL,        -- « elden-ring-ps5 », unique par utilisateur
  igdb_id          INTEGER REFERENCES games(igdb_id),
  platform         TEXT NOT NULL,
  steam_app_id     INTEGER,              -- lien avec la bibliothèque Steam (jeux rangés dans PC seulement)
  meta             TEXT,                 -- JSON, seulement pour un jeu pas encore associé à IGDB
  match_status     TEXT NOT NULL DEFAULT 'matched',   -- matched | unmatched (à associer à la main)
  status           TEXT NOT NULL DEFAULT 'backlog',
  favorite         INTEGER NOT NULL DEFAULT 0,
  ratings          TEXT NOT NULL DEFAULT '{}',
  review           TEXT NOT NULL DEFAULT '',
  playtime_minutes INTEGER,
  playtime_source  TEXT,                 -- manual | steam
  achievements     TEXT,                 -- JSON { unlocked, total, percent, source }
  started_at       TEXT,
  finished_at      TEXT,
  last_played_at   TEXT,
  added_at         TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE UNIQUE INDEX collection_game_platform ON collection(user_id, igdb_id, platform) WHERE igdb_id IS NOT NULL;
CREATE UNIQUE INDEX collection_steam_app ON collection(user_id, steam_app_id) WHERE steam_app_id IS NOT NULL;

CREATE TABLE wishlist (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  igdb_id  INTEGER NOT NULL,
  item     TEXT NOT NULL,                -- JSON (nom, jaquette, date de sortie, consoles…)
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, igdb_id)
);

-- Correspondance d'un jeu d'une plateforme avec le jeu canonique, et sa fiabilité
CREATE TABLE external_games (
  provider         TEXT NOT NULL,
  external_game_id TEXT NOT NULL,
  name             TEXT,
  igdb_id          INTEGER,              -- NULL : aucune correspondance fiable
  confidence       TEXT NOT NULL,        -- exact (lien officiel IGDB) | title (titre identique) | none
  checked_at       TEXT NOT NULL,
  PRIMARY KEY (provider, external_game_id)
);

-- Données brutes d'une plateforme pour un compte : temps de jeu et succès, tels que la plateforme les donne
CREATE TABLE platform_games (
  connected_account_id  INTEGER NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  external_game_id      TEXT NOT NULL,
  name                  TEXT,
  playtime_minutes      INTEGER,
  last_played_at        TEXT,
  achievements_unlocked INTEGER,
  achievements_total    INTEGER,
  first_seen_at         TEXT NOT NULL,
  last_seen_at          TEXT NOT NULL,   -- dernière fois que la plateforme l'a renvoyé (jamais supprimé automatiquement)
  PRIMARY KEY (connected_account_id, external_game_id)
);

-- ---------- Synchronisations ----------

CREATE TABLE sync_jobs (
  id                   INTEGER PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connected_account_id INTEGER REFERENCES connected_accounts(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL,
  kind                 TEXT NOT NULL,    -- sync | import | discover
  status               TEXT NOT NULL,    -- queued | running | done | error
  progress             INTEGER NOT NULL DEFAULT 0,
  total                INTEGER NOT NULL DEFAULT 0,
  stats                TEXT,             -- JSON
  error                TEXT,
  started_at           TEXT NOT NULL,
  finished_at          TEXT
);
CREATE INDEX sync_jobs_account ON sync_jobs(connected_account_id, started_at);

-- ---------- Cache des réponses IGDB ----------

CREATE TABLE cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
