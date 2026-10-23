// Bandes-annonces en fond : zoom sur l'image, puis la vidéo joue SOUS l'image, qui s'ouvre en diaphragme.
//  - jeux sur Steam : bande-annonce de la boutique lue par le site (<video> + hls.js), sans interface
//  - autres jeux et consoles : YouTube

import { dbg, reduceMotion } from './util.js';

export const TRAILER_DELAY = 3600; // durée du zoom sur l'image : la vidéo n'apparaît pas avant
const START_TIMEOUT = 12000;
// YouTube affiche son bouton lecture/pause chaque fois que la lecture (re)part, puis le cache au bout de
// quelques secondes : l'image ne s'efface qu'après 2 s de vidéo ET 3,5 s réelles de lecture continue.
const REVEAL_AFTER = 2;
const REVEAL_WAIT = 3500;

// Pas de vidéo sur petit écran, en mode économie de données ou si l'utilisateur limite les animations
export const trailersAllowed = !reduceMotion && !navigator.connection?.saveData && matchMedia('(min-width: 700px)').matches;

export const hasTrailer = (g) => Boolean(g?.steamTrailer?.hls || g?.trailer?.youtubeId);

/** Bande-annonce Steam si possible, sinon YouTube. */
export function createTrailer(bg, game, options) {
  return game.steamTrailer?.hls
    ? nativeTrailer(bg, game.steamTrailer.hls, options)
    : youtubeTrailer(bg, game.trailer.youtubeId, options);
}

const SOUND_ICONS = {
  off: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zm12.6.4L18 10.8l1.4-1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4-1.4-1.4z"/></svg>',
  on: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zm11.5-1.6a6 6 0 0 1 0 9.2l-1.3-1.5a4 4 0 0 0 0-6.2zm2.6-3a10 10 0 0 1 0 15.2l-1.3-1.5a8 8 0 0 0 0-12.2z"/></svg>',
};

/** Bouton son. `toggle` coupe ou remet le son et renvoie true si le son est désormais coupé. */
function soundButton(toggle) {
  const sound = document.createElement('button');
  sound.type = 'button';
  sound.className = 'trailer-sound';
  const render = (muted) => {
    sound.innerHTML = muted ? SOUND_ICONS.off : SOUND_ICONS.on;
    sound.setAttribute('aria-label', muted ? 'Activer le son de la bande-annonce' : 'Couper le son de la bande-annonce');
  };
  render(true);
  sound.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const muted = toggle();
    if (muted != null) render(muted);
  });
  return sound;
}

/* ---------- YouTube ---------- */

let ytApi = null;

function loadYouTubeApi() {
  ytApi ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(window.YT); return; }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { ytApi = null; reject(new Error('YouTube indisponible')); };
    document.head.append(script);
  });
  return ytApi;
}

/**
 * onEnd est appelé une seule fois : fin de la vidéo, ou abandon (YouTube bloqué, vidéo refusée, trop lente).
 */
export function youtubeTrailer(bg, youtubeId, { soundParent, zoomDelay = TRAILER_DELAY, onEnd } = {}) {
  let player = null;
  let stopped = false;
  let ended = false;
  let started = false;
  let zoomDone = false;
  let watch = 0;
  let startTimer = 0;
  let revealTimer = 0;

  const layer = document.createElement('div');
  layer.className = 'trailer';
  layer.append(document.createElement('div'));
  const sound = soundButton(() => {
    if (!player) return null;
    const muted = player.isMuted();
    if (muted) { player.unMute(); player.setVolume(70); } else { player.mute(); }
    return !muted;
  });

  const conceal = () => {
    clearInterval(revealTimer);
    if (bg.classList.contains('is-faded')) dbg(`${youtubeId} image remise`);
    bg.classList.remove('is-faded', 'is-iris');
  };
  // L'image s'efface quand le zoom est fini ET que la vidéo joue depuis assez longtemps
  const reveal = () => {
    clearInterval(revealTimer);
    const from = player.getCurrentTime();
    const since = performance.now();
    revealTimer = setInterval(() => {
      if (stopped || ended) { clearInterval(revealTimer); return; }
      if (!zoomDone || player.getCurrentTime() - from < REVEAL_AFTER || performance.now() - since < REVEAL_WAIT) return;
      clearInterval(revealTimer);
      dbg(`${youtubeId} IMAGE EFFACÉE (vidéo à ${player.getCurrentTime().toFixed(1)}s)`);
      bg.classList.add('is-faded', 'is-iris');
      sound.classList.add('is-visible');
    }, 100);
  };
  const finish = () => {
    if (ended || stopped) return;
    ended = true;
    dbg(`${youtubeId} fin / abandon`);
    clearInterval(watch);
    clearTimeout(startTimer);
    conceal();
    sound.classList.remove('is-visible');
    onEnd?.();
  };

  const zoomTimer = setTimeout(() => { zoomDone = true; }, zoomDelay);
  // Petit délai avant de charger YouTube, pour ne rien lancer si on change vite de page
  const timer = setTimeout(async () => {
    let YT;
    try { YT = await loadYouTubeApi(); } catch { finish(); return; } // YouTube bloqué : on garde l'image
    if (stopped) return;
    bg.before(layer); // sous l'image : une iframe transparente serait gelée par le navigateur
    soundParent?.append(sound);
    startTimer = setTimeout(() => { if (!started) finish(); }, START_TIMEOUT);
    dbg(`${youtubeId} création du lecteur`);
    player = new YT.Player(layer.firstElementChild, {
      videoId: youtubeId,
      host: 'https://www.youtube-nocookie.com',
      playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: (e) => {
          e.target.mute();
          setTimeout(() => { if (!started && !stopped) e.target.playVideo(); }, 2500);
        },
        onStateChange: (e) => {
          dbg(`${youtubeId} état ${e.data} (vidéo à ${e.target.getCurrentTime().toFixed(1)}s)`);
          if (stopped || ended) return;
          if (e.data !== YT.PlayerState.PLAYING) {
            if (started) conceal(); // chargement ou pause : le bouton de YouTube va s'afficher
            return;
          }
          reveal();
          if (started) return;
          started = true;
          clearTimeout(startTimer);
          // L'image revient juste avant la fin, pour ne jamais montrer l'écran de fin de YouTube
          watch = setInterval(() => {
            const left = player.getDuration() - player.getCurrentTime();
            if (player.getDuration() > 0 && left < 1.5) finish();
          }, 400);
        },
        onError: (e) => { dbg(`${youtubeId} erreur ${e.data}`); finish(); },
      },
    });
  }, 400);

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(zoomTimer);
      clearTimeout(startTimer);
      clearInterval(watch);
      conceal();
      sound.remove();
      setTimeout(() => { try { player?.destroy(); } catch { /* déjà détruit */ } layer.remove(); }, 1300);
    },
    get ended() { return ended; },
  };
}

/* ---------- Steam : une vraie balise <video>, sans interface par-dessus ---------- */

const HLS_SRC = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
let hlsLib = null;

// Firefox et Chrome ne lisent pas toujours le HLS de Steam tout seuls : hls.js s'en charge (Safari le lit nativement)
function loadHls() {
  hlsLib ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HLS_SRC;
    script.onload = () => resolve(window.Hls);
    script.onerror = () => { hlsLib = null; reject(new Error('hls.js indisponible')); };
    document.head.append(script);
  });
  return hlsLib;
}

export function nativeTrailer(bg, src, { soundParent, zoomDelay = TRAILER_DELAY, onEnd } = {}) {
  let stopped = false;
  let ended = false;
  let zoomDone = false;
  let hls = null;

  const video = document.createElement('video');
  video.className = 'trailer trailer-video';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');

  const sound = soundButton(() => {
    video.muted = !video.muted;
    if (!video.muted) video.volume = 0.7;
    return video.muted;
  });

  const reveal = () => {
    if (stopped || ended || !zoomDone || video.paused || video.currentTime < 0.3 || bg.classList.contains('is-faded')) return;
    dbg(`steam IMAGE EFFACÉE (vidéo à ${video.currentTime.toFixed(1)}s)`);
    bg.classList.add('is-faded', 'is-iris');
    sound.classList.add('is-visible');
  };
  const finish = () => {
    if (ended || stopped) return;
    ended = true;
    dbg('steam fin / abandon');
    clearTimeout(startTimer);
    bg.classList.remove('is-faded', 'is-iris');
    sound.classList.remove('is-visible');
    onEnd?.();
  };

  video.addEventListener('playing', reveal);
  video.addEventListener('timeupdate', () => {
    reveal();
    if (video.duration > 0 && video.duration - video.currentTime < 1) finish(); // l'image revient juste avant la fin
  });
  video.addEventListener('error', finish);

  const zoomTimer = setTimeout(() => { zoomDone = true; reveal(); }, zoomDelay);
  const startTimer = setTimeout(() => { if (!bg.classList.contains('is-faded')) finish(); }, START_TIMEOUT + zoomDelay);

  const timer = setTimeout(async () => {
    if (stopped) return;
    bg.before(video);
    soundParent?.append(sound);
    dbg('steam chargement');
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else {
      let Hls;
      try { Hls = await loadHls(); } catch { finish(); return; }
      if (stopped) return;
      if (!Hls?.isSupported()) { finish(); return; }
      hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20 });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) { dbg(`steam erreur ${data.details}`); finish(); } });
      hls.loadSource(src);
      hls.attachMedia(video);
    }
    video.play().catch(() => { /* lecture refusée par le navigateur : on garde l'image */ });
  }, 400);

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(zoomTimer);
      clearTimeout(startTimer);
      bg.classList.remove('is-faded', 'is-iris');
      sound.remove();
      setTimeout(() => {
        hls?.destroy();
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      }, 1300);
    },
    get ended() { return ended; },
  };
}
