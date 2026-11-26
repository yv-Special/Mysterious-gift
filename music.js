/**
 * Optional background music for the card.
 *
 * card.json may name a file inside the card's own music/ folder, e.g.
 * "music": "./music/bgm.mp3". Anything else (remote URLs, other folders,
 * path traversal) is ignored so the card stays fully local. Browsers only
 * allow sound after a user gesture, so playback starts on the first open.
 */

const LOCAL_MUSIC = /^(?:\.\/)?(?:music\/)?[^/\\]+\.(?:mp3|m4a|ogg|wav)$/i;
const TARGET_VOLUME = 0.6;
const FADE_MS = 1200;

export function isLocalMusic(src) {
  return typeof src === 'string' && LOCAL_MUSIC.test(src) && !src.includes('..');
}

function syncButton(button, muted) {
  button.setAttribute('aria-pressed', String(muted));
  button.setAttribute('aria-label', muted ? '播放背景音乐' : '静音背景音乐');
  button.setAttribute('title', muted ? '播放音乐' : '静音');
}

function fadeIn(audio) {
  const start = performance.now();
  audio.volume = 0;
  const step = (now) => {
    // Frame timestamps can predate `start`; a negative volume would throw.
    const t = Math.min(1, Math.max(0, (now - start) / FADE_MS));
    audio.volume = TARGET_VOLUME * t;
    if (t < 1 && !audio.paused) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Wire the <audio> element and mute button. Returns { start }, where start()
 * is safe to call on every open: it only begins playback the first time.
 */
export function createMusic(src, audio, button) {
  const noop = { start() {} };
  if (src === undefined) return noop;
  if (!isLocalMusic(src)) {
    console.warn('card.json music ignored: use a local file such as ./bgm.mp3 (mp3, m4a, ogg, wav)');
    return noop;
  }

  let started = false;
  let muted = false;
  let resumeOnShow = false;

  const play = () => {
    audio.play().then(() => fadeIn(audio)).catch((error) => {
      console.warn('Background music could not play:', error);
    });
  };

  audio.src = src;
  audio.loop = true;
  button.hidden = false;
  syncButton(button, muted);

  button.addEventListener('click', () => {
    muted = !muted;
    syncButton(button, muted);
    if (muted) {
      audio.pause();
    } else {
      started = true;
      play();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resumeOnShow = !audio.paused;
      audio.pause();
    } else if (resumeOnShow && !muted) {
      play();
    }
  });

  return {
    start() {
      if (started || muted) return;
      started = true;
      play();
    },
  };
}
