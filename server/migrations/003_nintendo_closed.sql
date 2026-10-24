-- Le service d'historique de jeu Nintendo utilisé par le connecteur n'existe plus : les jetons de session
-- Nintendo gardés (chiffrés) ne servent plus à rien, on les efface. Les jeux importés restent dans les collections.
DELETE FROM provider_credentials WHERE connected_account_id IN (SELECT id FROM connected_accounts WHERE provider = 'nintendo');
UPDATE connected_accounts SET status = 'unsupported', status_message = NULL, auto_sync = 0 WHERE provider = 'nintendo';
