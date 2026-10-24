// Interface commune des connecteurs de plateformes de jeu.
//
// Un connecteur est un objet :
//   id, name, kind ('identity' | 'gaming'), official (API officielle ?), discordTypes (types de connexion Discord reconnus)
//   capabilities : { identify, library, playtime, achievements, sync } — ce qui est RÉELLEMENT pris en charge
//   limitations  : texte affiché à l'utilisateur quand une fonction n'est pas disponible
//   enabled(config) : le connecteur est-il configuré sur ce serveur ? (clé d'API présente…)
//   onDetected(connection)  : état initial d'un compte détecté via Discord ({ provider, id, name, verified })
//   enable(ctx, account)    : vérifie que l'import est possible et passe le compte en « connected »
//   sync(ctx, account, job)          : synchronisation (si capabilities.sync)
//   library(ctx, account)            : jeux de la plateforme pas encore dans la collection (si capabilities.library)
//   importGames(ctx, account, ids, job) : ajout de jeux choisis à la collection
//   experimental : connecteur non officiel (API privée d'une application), qui peut cesser de marcher
//   link         : liaison directe par copier-coller ({ type, start, finish }), quand Discord ne suffit pas
//   revoke(ctx, account, cred) : ferme la session côté plateforme à la déconnexion

/** États possibles d'un compte connecté. */
export const ACCOUNT_STATUS = {
  DETECTED: 'detected',                      // vu via Discord, rien d'autre
  AUTHORIZATION_REQUIRED: 'authorization_required', // il faut prouver la propriété du compte ou autoriser l'accès
  CONNECTED: 'connected',                    // accès vérifié, pas encore synchronisé
  SYNCING: 'syncing',
  SYNCED: 'synced',
  ERROR: 'error',
  UNSUPPORTED: 'unsupported',                // la plateforme ne permet pas d'import (pas d'API utilisable)
};

export const NO_CAPABILITIES = { identify: false, library: false, playtime: false, achievements: false, sync: false };

export function defineProvider(def) {
  return {
    kind: 'gaming',
    official: true,
    discordTypes: [],
    limitations: null,
    enabled: () => true,
    onDetected: () => ({ status: ACCOUNT_STATUS.UNSUPPORTED, message: def.limitations ?? null }),
    ...def,
    capabilities: { ...NO_CAPABILITIES, ...def.capabilities },
  };
}

/** Description publique d'un connecteur (envoyée au site). */
export const describe = (p, config) => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  official: p.official,
  experimental: Boolean(p.experimental),
  link: p.link?.type ?? null,
  enabled: p.enabled(config),
  capabilities: p.capabilities,
  limitations: p.limitations,
  manualImport: p.manualImport ?? null,
});
