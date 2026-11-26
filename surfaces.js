/**
 * Canvas-drawn card surfaces, ported from the project engine
 * (src/lib/cardTextures.ts + studio.ts) to plain JS: paper grain, the
 * inside pages, the snowfall parallax layer and its night-sky mask, and
 * the studio contact shadow. Everything drawn here feeds THREE textures.
 */

const TEX_W = 940;
const TEX_H = 1316;

/** Paper tints for winter-moonlight (src/lib/templates.ts). */
export const PAPER_TINT = "#f3ede3";
export const INSIDE_TINT = "#fbf8f2";
/** Studio backdrop, matched to the page (--bg-canvas / STUDIO_BG_HEX). */
export const STUDIO_BG_HEX = "#fbfaf9";

function addPaperGrain(ctx, width, height, baseColor) {
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, width, height);

  const grad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.45,
    width * 0.12,
    width * 0.5,
    height * 0.5,
    width * 0.85,
  );
  grad.addColorStop(0, "rgba(255,255,255,0.24)");
  grad.addColorStop(1, "rgba(175,158,142,0.14)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const dots = Math.round((12000 * width * height) / (TEX_W * TEX_H));
  for (let i = 0; i < dots; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const r = 0.7 + rand() * 1.6;
    ctx.fillStyle =
      rand() > 0.48 ? "rgba(255,255,255,0.3)" : "rgba(130,112,94,0.075)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A sticker sits on the page: a soft contact shadow under it. */
function withContactShadow(ctx, on, draw) {
  if (!on) {
    draw();
    return;
  }
  ctx.save();
  ctx.shadowColor = "rgba(84, 66, 48, 0.32)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetX = 1.5;
  ctx.shadowOffsetY = 3;
  draw();
  ctx.restore();
}

/**
 * The inside-left page: grain, a spine gradient, a soft-feathered motif
 * crop (the engine's createInsideLeftCanvas, motifs from layout.json).
 */
export function createInsideLeftCanvas(coverImg, motif) {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  addPaperGrain(ctx, TEX_W, TEX_H, PAPER_TINT);

  const spine = ctx.createLinearGradient(TEX_W - 44, 0, TEX_W, 0);
  spine.addColorStop(0, "rgba(0,0,0,0)");
  spine.addColorStop(1, "rgba(90,75,60,0.16)");
  ctx.fillStyle = spine;
  ctx.fillRect(TEX_W - 44, 0, 44, TEX_H);

  if (coverImg && motif) {
    const dw = TEX_W * motif.width;
    const dh = (motif.crop.height / motif.crop.width) * dw;
    ctx.save();
    ctx.translate(TEX_W * motif.at[0], TEX_H * motif.at[1]);
    if (motif.turn) ctx.rotate((motif.turn * Math.PI) / 180);
    withContactShadow(ctx, true, () =>
      ctx.drawImage(motif.crop, -dw / 2, -dh / 2, dw, dh),
    );
    ctx.restore();
  }
  return canvas;
}

/** The inside-right base page: grain and a spine gradient on the left edge. */
export function createInsideRightBaseCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  addPaperGrain(ctx, TEX_W, TEX_H, PAPER_TINT);
  const spine = ctx.createLinearGradient(0, 0, 48, 0);
  spine.addColorStop(0, "rgba(90,75,60,0.16)");
  spine.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spine;
  ctx.fillRect(0, 0, 48, TEX_H);
  return canvas;
}

/** The blank insert sheet: grain, inside tint, a hairline frame (2x crisp for 3D ink). */
export function createBlankSheetCanvas() {
  const w = 1170;
  const h = 1695;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  addPaperGrain(ctx, w, h, INSIDE_TINT);
  ctx.strokeStyle = "rgba(150, 134, 118, 0.14)";
  ctx.lineWidth = 3;
  ctx.strokeRect(27, 27, w - 54, h - 54);
  return canvas;
}

/** The card back: grain, a soft motif, the closing line. */
export function createBackCanvas(coverImg, motif, backLine = "Warm Wishes") {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  addPaperGrain(ctx, TEX_W, TEX_H, PAPER_TINT);

  if (coverImg && motif) {
    const dw = TEX_W * motif.width;
    const dh = (motif.crop.height / motif.crop.width) * dw;
    const cx = TEX_W * motif.at[0];
    const cy = TEX_H * motif.at[1];
    ctx.drawImage(motif.crop, cx - dw / 2, cy - dh / 2, dw, dh);
  }

  if (backLine) {
    ctx.fillStyle = "rgba(110, 96, 84, 0.55)";
    ctx.font = "italic 24px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(backLine, TEX_W / 2, TEX_H - 120);
  }
  return canvas;
}

/* ── Snowfall parallax layer (bubbbly's snowfall(), #5) ── */

/** Parallax snowfall canvas, white-on-transparent, for a plane above the cover. */
export function createSnowfallCanvas(w = 470, h = 658, time = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(w, h);
  const dst = img.data;

  const hash12 = (x, y) => {
    const px = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return px - Math.floor(px);
  };

  const cellsBase = 70;
  for (let k = 0; k < 3; k += 1) {
    const cells = cellsBase - k * 18;
    const cellW = w / cells;
    const cellH = h / (cells * 0.72);
    for (let cy = 0; cy < Math.ceil(cells * 0.72) + 1; cy += 1) {
      for (let cx = 0; cx < cells + 1; cx += 1) {
        const rx = hash12(cx + 5.3 + k * 31.7, cy + 9.1 - k);
        const ry = hash12(cx + 9.1 - k, cy + 5.3 + k * 17.3);
        const r = (0.07 + 0.07 * hash12(cx + 2.9, cy + k)) * (1 + k * 0.25) * cellW;
        const drift = Math.sin(cy * 0.21 + k * 2 + time * 0.6) * 0.45 * cellW;
        const ox = (rx - 0.5) * 0.55 * cellW + drift;
        const oy = (ry - 0.5) * 0.55 * cellH - time * (0.02 + k * 0.008) * cellH;
        const px = cx * cellW + ox;
        const py = ((cy * cellH + oy) % (h + cellH)) - cellH * 0.5;

        for (
          let y = Math.max(0, Math.floor(py - r));
          y < Math.min(h, Math.ceil(py + r));
          y += 1
        ) {
          for (
            let x = Math.max(0, Math.floor(px - r));
            x < Math.min(w, Math.ceil(px + r));
            x += 1
          ) {
            const d = Math.hypot(x - px, y - py);
            if (d > r) continue;
            const soft = Math.min(1, (r - d) / (r * 0.65));
            const idx = (y * w + x) * 4;
            const add = soft * (0.5 - k * 0.12);
            dst[idx] = Math.min(255, dst[idx] + add * 255);
            dst[idx + 1] = Math.min(255, dst[idx + 1] + add * 255);
            dst[idx + 2] = Math.min(255, dst[idx + 2] + add * 255);
            dst[idx + 3] = Math.max(dst[idx + 3], Math.round(Math.min(1, add * 1.4) * 255));
          }
        }
      }
    }
  }

  // Snow is white everywhere; alpha alone carries the flakes.
  for (let i = 0; i < dst.length; i += 4) {
    dst[i] = 255;
    dst[i + 1] = 255;
    dst[i + 2] = 255;
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Static alpha mask (read from G) keeping the snowfall "behind the glass":
 * inside the snow area, and only over dark night-sky pixels.
 */
export function createSnowMaskCanvas(coverImg, snowArea) {
  const w = 470;
  const h = 658;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.drawImage(coverImg, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const [ax, ay, aw, ah] = snowArea;
  const x0 = (ax / TEX_W) * w;
  const x1 = ((ax + aw) / TEX_W) * w;
  const y0 = (ay / TEX_H) * h;
  const y1 = ((ay + ah) / TEX_H) * h;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const night = b - r > 0.08 && lum < 0.55;
      const v = inside && night ? 255 : 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Feather the edge so flakes fade at the window frame.
  const soft = document.createElement("canvas");
  soft.width = w;
  soft.height = h;
  const sCtx = soft.getContext("2d");
  if (!sCtx) return canvas;
  sCtx.filter = "blur(1.5px)";
  sCtx.drawImage(canvas, 0, 0);
  return soft;
}

/* ── Studio contact shadow (src/lib/studio.ts) ── */

export const CARD_SHADOW_PAD_X = 1.5;
export const CARD_SHADOW_PAD_Y = 1.35;
export const CARD_SHADOW_OFFSET = { x: 0.06, y: -0.1, z: -0.12 };

/** Card-shaped studio shadow: a tight contact core plus a wide soft falloff. */
export function createCardShadowTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const rw = size / CARD_SHADOW_PAD_X;
    const rh = size / CARD_SHADOW_PAD_Y;
    const rx = (size - rw) / 2;
    const ry = (size - rh) / 2;
    ctx.fillStyle = "rgba(48, 36, 28, 1)";
    ctx.filter = "blur(34px)";
    ctx.globalAlpha = 0.3;
    ctx.fillRect(rx + 6, ry + 14, rw, rh);
    ctx.filter = "blur(9px)";
    ctx.globalAlpha = 0.6;
    ctx.fillRect(rx + 3, ry + 5, rw - 2, rh - 2);
  }
  return canvas;
}

/**
 * Tileable cold-press paper normal map for the plain sheets, ported from
 * reliefCore.paperNormalTilePixels (size 512, 24 bumps).
 */
export function buildPaperNormalTile(size = 512, bumps = 24) {
  const cell = size / bumps;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      height[y * size + x] = coldPress(x, y, cell, bumps);
    }
  }
  return heightToNormal(height, size, size, 1.6, true);
}

/* ── reliefCore, the parts the standalone scene needs ── */

function hash2(ix, iy) {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x, y, period = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const wrap = (v) => (period > 0 ? ((v % period) + period) % period : v);
  const x0 = wrap(ix);
  const x1 = wrap(ix + 1);
  const y0 = wrap(iy);
  const y1 = wrap(iy + 1);
  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function coldPress(x, y, cell, period = 0) {
  const big = valueNoise(x / cell, y / cell, period);
  const small = valueNoise(x / (cell * 0.5) + 19.7, y / (cell * 0.5) + 7.3, period * 2);
  return smoothstep(0.18, 0.88, big * 0.68 + small * 0.32);
}

function heightToNormal(height, w, h, strength, tile) {
  const out = new Uint8ClampedArray(w * h * 4);
  const at = (x, y) => {
    const cx = tile ? (x + w) % w : Math.min(w - 1, Math.max(0, x));
    const cy = tile ? (y + h) % h : Math.min(h - 1, Math.max(0, y));
    return height[cy * w + cx];
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * strength;
      // Canvas rows run top-down while texture v runs bottom-up: flip y.
      const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y * w + x) * 4;
      out[o] = (nx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}
