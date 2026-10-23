// Bandes-annonces de la boutique Steam. Contrairement à YouTube, ce sont de simples flux vidéo (HLS)
// que le site lit lui-même : aucune interface par-dessus, et un vrai fondu depuis l'image.
// L'API de la boutique est publique (pas de clé) et autorise la lecture depuis un autre site (CORS).

import { trailerRank } from './igdb.mjs';

/** Meilleure bande-annonce Steam du jeu, ou null. */
export async function steamTrailer(appId) {
  if (!appId) return null;
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=movies`);
    if (!res.ok) return null;
    const movies = (await res.json())?.[appId]?.data?.movies ?? [];
    const best = movies
      .filter((m) => m.hls_h264)
      .sort((a, b) => trailerRank(a.name) - trailerRank(b.name) || Number(b.highlight) - Number(a.highlight))[0];
    return best ? { hls: best.hls_h264, name: best.name ?? null } : null;
  } catch {
    return null;
  }
}
