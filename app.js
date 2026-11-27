import { createMusic } from './music.js';

/* 手机边缘"向右滑返回"是浏览器/系统级手势，脚本取消不掉；这里挂一道历史栅栏：
 * 滑回去只会落回当前页（栅栏立刻补一格），贺卡不会被顶掉。 */
function guardSwipeBack() {
  try {
    history.pushState({ paperLetter: 'guard' }, '', location.href);
  } catch (error) {
    return;
  }
  window.addEventListener('popstate', () => {
    try {
      history.pushState({ paperLetter: 'guard' }, '', location.href);
    } catch (error) { /* ignore */ }
  });
}
guardSwipeBack();

const $ = (selector) => document.querySelector(selector);
const main = $('main');
const stage = $('#stage');
const button = $('#toggle');
const statusLine = $('#status');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let scene;
let music = { start() {} };
let open = false;
let ready = false;
let zoomed = false;
let lastTapAt = 0;
let closeTimer = 0;

const ORBIT_PER_PX = { yaw: 0.0085, pitch: 0.0065 };
const TAP_MOVE_PX = 7;
const TAP_MAX_MS = 600;

function syncToggleButton() {
  const sealed = scene?.isWrapped?.() === true;
  const waxed = sealed && scene?.isSealBroken?.() !== true;
  const label = waxed ? '拆开火漆' : sealed ? '打开信封' : open ? '合上贺卡' : '翻开贺卡';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.setAttribute('aria-expanded', String(open));
}

function setZoom(on) {
  zoomed = Boolean(on);
  const el = $('#stage');
  if (!el) return;
  el.classList.toggle('zoomed', zoomed);
  if (!zoomed) el.style.transform = '';
}

function flip() {
  if (button.disabled || !ready) return;
  clearTimeout(closeTimer);
  closeTimer = 0;
  if (zoomed) setZoom(false);
  // First tap breaks the wax and pulls the card out of its envelope.
  if (scene?.isWrapped?.()) {
    scene.unwrap();
    music.start(); // 拆火漆的这一刻就开始放歌，移动端只认这一次手势
    syncToggleButton();
    return;
  }
  open = !open;
  main.dataset.open = String(open);
  $('#letter').hidden = !open;
  syncToggleButton();
  scene?.setOpen(open);
  if (open) music.start();
}

function attachControls() {
  let down = null;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let vx = 0;
  let vy = 0;

  button.addEventListener('click', flip);

  stage.addEventListener('pointerdown', (event) => {
    const onWriting = Boolean(event.target.closest('.writing'));
    if (!event.isPrimary || event.button !== 0) return;
    if (onWriting && main.dataset.renderer !== 'webgl') return;
    const base = scene?.getOrbit ? scene.getOrbit() : { x: 0, y: 0 };
    down = {
      x0: event.clientX,
      y0: event.clientY,
      t0: performance.now(),
      moved: 0,
      baseX: base.x,
      baseY: base.y,
      onWriting,
    };
    lastX = event.clientX;
    lastY = event.clientY;
    lastT = down.t0;
    vx = 0;
    vy = 0;
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener('pointermove', (event) => {
    const now = performance.now();
    const dt = Math.max(0.004, (now - lastT) / 1000);
    const dxStep = event.clientX - lastX;
    const dyStep = event.clientY - lastY;
    vx = vx * 0.4 + (dxStep / dt) * 0.6;
    vy = vy * 0.4 + (dyStep / dt) * 0.6;
    lastX = event.clientX;
    lastY = event.clientY;
    lastT = now;

    if (down) {
      down.moved = Math.max(down.moved, Math.hypot(event.clientX - down.x0, event.clientY - down.y0));
      if (!reduced.matches && down.moved >= TAP_MOVE_PX) {
        const dx = event.clientX - down.x0;
        const dy = event.clientY - down.y0;
        scene?.setOrbit(
          down.baseX + dy * ORBIT_PER_PX.pitch,
          down.baseY + dx * ORBIT_PER_PX.yaw,
          true,
        );
      }
      if (!reduced.matches && !open) {
        scene?.setPointer(event.clientX, event.clientY, true, vx, vy);
      }
      return;
    }

    if (event.pointerType !== 'mouse' || reduced.matches || open) return;
    scene?.setPointer(event.clientX, event.clientY, true, vx, vy);
  });

  stage.addEventListener('pointerup', (event) => {
    if (!down) return;
    const heldMs = performance.now() - down.t0;
    const isTap = down.moved < TAP_MOVE_PX && heldMs < TAP_MAX_MS;
    const onWriting = down.onWriting;
    down = null;
    if (isTap) {
      if (onWriting || !ready) return;
      // While the letters are open, a double tap zooms in to read, a single tap closes.
      if (open && main.dataset.renderer === 'webgl') {
        const now = performance.now();
        if (zoomed) { setZoom(false); lastTapAt = 0; return; }
        if (now - lastTapAt < 320) {
          lastTapAt = 0;
          clearTimeout(closeTimer);
          const el = $('#stage');
          const box = el.getBoundingClientRect();
          const leftHalf = event.clientX - box.left < box.width / 2;
          // Scale about the page, then slide that page to the middle of the screen.
          const sc = 1.78;
          const fx = leftHalf ? 0.25 : 0.75;
          const tx = box.width * (0.5 - fx * sc);
          const ty = box.height * (0.5 - 0.48 * sc);
          el.style.transformOrigin = '0 0';
          el.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`;
          setZoom(true);
          return;
        }
        lastTapAt = now;
        const onCardWhenOpen = scene?.hitCard ? scene.hitCard(event.clientX, event.clientY) : true;
        if (onCardWhenOpen) {
          clearTimeout(closeTimer);
          closeTimer = setTimeout(() => { closeTimer = 0; flip(); }, 330);
        }
        return;
      }
      // Match ChristmasCard3D.tsx: clicking the card toggles open/close directly.
      const onCard = scene?.hitCard ? scene.hitCard(event.clientX, event.clientY) : true;
      if (onCard) flip();
    } else if (!reduced.matches) {
      scene?.releaseOrbit(vx, vy);
    }
    if (event.pointerType !== 'mouse' || open) {
      scene?.setPointer(0, 0, false, 0, 0);
    }
  });

  stage.addEventListener('pointercancel', () => {
    down = null;
    scene?.releaseOrbit(0, 0);
    scene?.setPointer(0, 0, false, 0, 0);
  });

  stage.addEventListener('pointerleave', () => {
    if (!down) scene?.setPointer(0, 0, false, 0, 0);
  });
}

async function load() {
  statusLine.textContent = '';
  const started = performance.now();
  const loaderText = $('#loader-text');
  const tick = setInterval(() => {
    if (!loaderText) return;
    const s = Math.round((performance.now() - started) / 1000);
    loaderText.textContent = s < 4 ? '正在装帧…' : `正在装帧… ${s}s`;
  }, 1000);
  const giveUp = setTimeout(() => {
    if (main.dataset.renderer !== 'loading') return;
    main.dataset.renderer = 'flat';
    ready = true;
    button.disabled = false;
    syncToggleButton();
    statusLine.textContent = '网速较慢，已切到平面阅读：点卡片就能翻页读信。';
  }, 38000);
  try {
    return await boot();
  } finally {
    clearInterval(tick);
  }
}

async function boot() {
  const response = await fetch('./card.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`card.json: HTTP ${response.status}`);
  const card = await response.json();
  for (const key of ['title', 'greeting', 'message', 'signature']) {
    if (typeof card?.[key] !== 'string') throw new Error(`card.json：${key} 必须是文本`);
    $(key === 'title' ? 'h1' : `#${key}`).textContent = card[key];
  }
  document.title = card.title;
  if (card.credit === false) $('#credit')?.remove();
  music = createMusic(card.music, $('#bgm'), $('#music-toggle'));
  syncToggleButton();
  attachControls();
  try {
    const { createScene } = await import('./scene.js');
    scene = await createScene($('canvas'), card);
    scene.setOpen(open);
    main.dataset.renderer = 'webgl';
    // Warm the song while the reader is still looking at the sealed envelope.
    const bgm = $('#bgm');
    if (bgm && card.music) { bgm.preload = 'auto'; bgm.load(); }
    ready = true;
    button.disabled = false;
    syncToggleButton();
    statusLine.textContent = '';
  } catch (error) {
    main.dataset.renderer = 'flat';
    ready = true;
    button.disabled = false;
    syncToggleButton();
    statusLine.textContent = '3D 未能载入，已切换为平面预览，仍可翻页。';
    console.warn('3D preview unavailable:', error);
  }
}
if (location.protocol !== 'file:') {
  load().catch((error) => {
    statusLine.textContent = `无法读取贺卡，请检查本地服务和配置。${error.message}`;
  });
}
