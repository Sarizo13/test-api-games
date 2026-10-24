-- Connecteurs non officiels (PlayStation, Xbox, Epic, Nintendo) : jeux d'une plateforme reliés à la collection.

-- Identifiant interne de la plateforme, retrouvé une fois pour toutes (accountId PSN, XUID Xbox…), en JSON
ALTER TABLE connected_accounts ADD COLUMN external_data TEXT;

-- Données brutes : console d'Asobi, visuel, première partie et progression, quand la plateforme les donne
ALTER TABLE platform_games ADD COLUMN platform TEXT;
ALTER TABLE platform_games ADD COLUMN image_url TEXT;
ALTER TABLE platform_games ADD COLUMN first_played_at TEXT;
ALTER TABLE platform_games ADD COLUMN achievements_percent INTEGER;  -- quand la plateforme ne donne qu'un pourcentage

-- Secret d'une liaison par copier-coller (vérificateur PKCE Nintendo), chiffré, valable 10 minutes comme le « state »
ALTER TABLE oauth_states ADD COLUMN secret TEXT;

-- Jeu de la collection ↔ jeu d'un compte de plateforme (Steam garde sa colonne steam_app_id).
-- Supprimer le jeu ou déconnecter le compte efface le lien, jamais le jeu.
CREATE TABLE collection_links (
  user_id              INTEGER NOT NULL,
  collection_id        TEXT NOT NULL,
  connected_account_id INTEGER NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  external_game_id     TEXT NOT NULL,
  PRIMARY KEY (connected_account_id, external_game_id),
  FOREIGN KEY (user_id, collection_id) REFERENCES collection(user_id, id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX collection_links_entry ON collection_links(user_id, collection_id);
