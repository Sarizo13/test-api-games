// Trouve un résumé en français pour un jeu (IGDB ne fournit que de l'anglais).
// Sources essayées dans l'ordre :
//   1. la description courte de Steam en français
//   2. l'introduction de l'article Wikipédia FR (retrouvé via Wikidata)
//   3. une traduction DeepL du résumé IGDB, si DEEPL_API_KEY est définie
// Si rien ne marche, on garde le résumé anglais d'IGDB.

const UA = { 'User-Agent': 'ludotheque/1.0 (https://github.com/Sarizo13/test-api-games)' };
const MAX_LENGTH = 700;

async function getJson(url, options = {}) {
  try {
    const res = await fetch(url, { ...options, headers: { ...UA, ...options.headers } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const decodeEntities = (s) => s
  .replace(/<[^>]+>/g, ' ')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** Steam renvoie l'anglais quand le jeu n'a pas de texte français : on vérifie la langue à la louche. */
export function looksFrench(text) {
  const words = ` ${text.toLowerCase()} `;
  const count = (list) => list.reduce((n, w) => n + (words.split(` ${w} `).length - 1), 0);
  return count(['le', 'la', 'les', 'des', 'et', 'un', 'une', 'du', 'dans', 'vous', 'est']) > count(['the', 'and', 'of', 'to', 'in', 'you', 'is', 'a']);
}

/** Coupe proprement à la fin d'une phrase. */
function clip(text) {
  if (text.length <= MAX_LENGTH) return text;
  const cut = text.slice(0, MAX_LENGTH);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 200 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

async function fromSteam(appId) {
  if (!appId) return null;
  const data = await getJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=french&cc=fr`);
  const text = decodeEntities(data?.[appId]?.data?.short_description ?? '');
  return text && looksFrench(text) ? { summary: clip(text), summarySource: 'steam', summaryUrl: `https://store.steampowered.com/app/${appId}` } : null;
}

const WIKIDATA = 'https://www.wikidata.org/w/api.php?format=json&origin=*';

async function frwikiTitle(qid) {
  if (!qid) return null;
  const data = await getJson(`${WIKIDATA}&action=wbgetentities&ids=${qid}&props=sitelinks&sitefilter=frwiki`);
  return data?.entities?.[qid]?.sitelinks?.frwiki?.title ?? null;
}

/** Retrouve l'élément Wikidata du jeu : par son identifiant IGDB (P5794), son article anglais, ou son nom. */
async function wikidataIds({ igdbSlug, enwikiTitle, name }) {
  const ids = [];
  if (igdbSlug) {
    const data = await getJson(`${WIKIDATA}&action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P5794=${igdbSlug}`)}`);
    ids.push(...(data?.query?.search ?? []).map((r) => r.title));
  }
  if (enwikiTitle) {
    const data = await getJson(`${WIKIDATA}&action=wbgetentities&sites=enwiki&titles=${encodeURIComponent(enwikiTitle)}&props=info`);
    ids.push(...Object.keys(data?.entities ?? {}).filter((id) => id.startsWith('Q')));
  }
  if (name) {
    const data = await getJson(`${WIKIDATA}&action=wbsearchentities&type=item&language=fr&uselang=fr&limit=7&search=${encodeURIComponent(name)}`);
    ids.push(...(data?.search ?? []).filter((r) => /jeu vidéo/i.test(r.description ?? '') && !/série|franchise/i.test(r.description ?? '')).map((r) => r.id));
  }
  return [...new Set(ids)];
}

async function fromWikipedia(game) {
  for (const qid of await wikidataIds(game)) {
    const title = await frwikiTitle(qid);
    if (!title) continue;
    const page = await getJson(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (page?.type === 'standard' && page.extract) {
      return { summary: clip(page.extract.replace(/\s+/g, ' ').trim()), summarySource: 'wikipedia', summaryUrl: page.content_urls?.desktop?.page ?? null };
    }
  }
  return null;
}

async function fromDeepl(english, key) {
  if (!key || !english) return null;
  const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const data = await getJson(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [english], target_lang: 'FR' }),
  });
  const text = data?.translations?.[0]?.text;
  return text ? { summary: clip(text), summarySource: 'deepl', summaryUrl: null } : null;
}

/**
 * @param {{ name: string, steamAppId?: number|null, igdbSlug?: string|null, enwikiTitle?: string|null, english?: string|null }} game
 * @param {{ deeplKey?: string }} [options] clé DeepL (optionnelle) ; à défaut, DEEPL_API_KEY de l'environnement Node
 * @returns {Promise<{ summary: string|null, summarySource: string|null, summaryUrl: string|null }>}
 */
export async function frenchSummary(game, { deeplKey = globalThis.process?.env?.DEEPL_API_KEY } = {}) {
  return (await fromSteam(game.steamAppId))
    ?? (await fromWikipedia(game))
    ?? (await fromDeepl(game.english, deeplKey))
    ?? { summary: game.english ?? null, summarySource: game.english ? 'igdb' : null, summaryUrl: null };
}

/** Extrait le titre de l'article anglais d'une URL Wikipédia (IGDB la fournit souvent). */
export function enwikiTitleFrom(urls) {
  for (const url of urls) {
    const m = String(url).match(/^https?:\/\/en\.wikipedia\.org\/wiki\/([^?#]+)/);
    if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ');
  }
  return null;
}
