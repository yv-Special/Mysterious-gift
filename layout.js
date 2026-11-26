/**
 * Shared card dimensions and layout math, ported from the project engine
 * (src/lib/cardConstants.ts) so the standalone scene renders at the same
 * physical size as the app. All values in three.js world units.
 */

/** Card width (portrait 5:7 ≈ 2.6 : 3.64). */
export const CARD_W = 2.6;
export const CARD_H = 3.64;
export const CARD_THICKNESS = 0.022;

/** The insert sheet glued inside the right panel. */
export const SHEET_W = CARD_W * 0.84;
export const SHEET_H = CARD_H * 0.87;
export const SHEET_THICKNESS = 0.008;

/** Cover artwork size in pixels (layout.json "size"). */
export const COVER_PX_W = 940;
export const COVER_PX_H = 1316;

/** Segments across each panel so the CPU bow can curve it. */
export const BEND_SEGMENTS = 24;

/** Max cover opening angle (rad): the cover opens to the LEFT. */
export const OPEN_MAX = Math.PI * 0.94;

/** Paper-cut piece's cut-edge backing depth. */
export const LAYER_BACKING_DEPTH = 0.0028;

/** How far each paper-cut layer sits above the cover's face (geometry z). */
export function layerZ(lift) {
  return CARD_THICKNESS / 2 + lift;
}

/**
 * Map a layout box [x, y, w] in 940x1316 cover pixels to the cover panel's
 * local frame: x -CARD_W/2 (spine) .. CARD_W/2 (free edge), y CARD_H/2 top.
 * Height follows the image's aspect ratio, as in the engine.
 */
export function layerFrame(box, imgW, imgH, pxW, pxH) {
  const w = pxW === undefined ? COVER_PX_W : pxW;
  const h = pxH === undefined ? COVER_PX_H : pxH;
  const bx = box[0];
  const by = box[1];
  const bw = box[2];
  const bh = (bw * imgH) / imgW;
  return {
    w: (bw / w) * CARD_W,
    h: (bh / h) * CARD_H,
    cx: ((bx + bw / 2) / w) * CARD_W - CARD_W / 2,
    cy: (0.5 - (by + bh / 2) / h) * CARD_H,
  };
}
