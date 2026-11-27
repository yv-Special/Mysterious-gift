/**
 * Inside-right sheet slot layout & handwriting text renderer, ported verbatim
 * from src/lib/card/slots.ts, src/lib/card/slotText.ts, and src/lib/card/textCanvas.ts.
 *
 * Draws the three fixed slots (greeting, body, signature) directly onto the
 * 3D insert sheet mesh so typography sits on the paper surface, bends with the
 * page, and turns seamlessly in 3D perspective when dragged.
 */

export const SLOTS = {
  greeting: {
    box: { x0: 0.08, y0: 0.048, x1: 0.92, y1: 0.132 },
    align: "left",
    multiline: false,
    prefix: "Dear ",
    suffix: ",",
    placeholder: "name",
  },
  body: {
    box: { x0: 0.07, y0: 0.152, x1: 0.93, y1: 0.858 },
    align: "left",
    multiline: true,
    prefix: "",
    suffix: "",
    placeholder: "Your letter",
  },
  signature: {
    box: { x0: 0.28, y0: 0.868, x1: 0.92, y1: 0.952 },
    align: "right",
    multiline: false,
    prefix: "— ",
    suffix: "",
    placeholder: "your name",
  },
};

export const SLOT_MIN_SCALE = 0.40;
const SCALE_STEP = 0.05;
export const SLOT_LINE_HEIGHT = 1.34;

export const SLOT_FONT_FRACTION = {
  greeting: 0.058,
  body: 0.05,
  signature: 0.052,
};

export const INK_COLORS = {
  black: "#231d19",
  red: "#a8322c",
  gold: "#c9a24a",
};

const SLOT_HAND =
  '"Bradley Hand", Noteworthy, "Hannotate SC", "HanziPen SC", "Kaiti SC", "Caveat", "Segoe Print", "Comic Sans MS", cursive';
const SLOT_SERIF = 'Georgia, "Songti SC", "STSong", serif';

/** Choose font stack matching src/lib/card/textCanvas.ts (defaults to repo "English" / hand-en). */
export function slotFontFamily(font) {
  const mode = font || "hand-en";
  if (mode === "serif") return SLOT_SERIF;
  if (mode === "hand-zh") return `"Long Cang", ${SLOT_HAND}`;
  return SLOT_HAND;
}

/**
 * Strip duplicate prefix/suffix so both "Lan" and "Dear Lan," render cleanly
 * ("Dear Lan,"), while full Chinese salutations ("亲爱的 Lan，") stay intact
 * without an awkward "Dear 亲爱的 Lan，,".
 */
export function formatSlotParts(slot, raw) {
  const spec = SLOTS[slot];
  const text = (raw || "").trim();
  if (!text) return null;
  if (slot === "greeting") {
    // If sender already wrote a Chinese salutation (e.g. "亲爱的 Lan，"), keep as-is.
    if (/^(亲爱的|致|给|敬爱的)/.test(text)) {
      return { prefix: "", core: text, suffix: "" };
    }
    const core = text.replace(/^\s*dear\b\s*/i, "").replace(/[\s,，]+$/, "");
    return { prefix: spec.prefix, core, suffix: spec.suffix };
  }
  if (slot === "signature") {
    const core = text.replace(/^\s*[—–-]+\s*/, "").trimEnd();
    return { prefix: spec.prefix, core, suffix: spec.suffix };
  }
  return { prefix: "", core: text, suffix: "" };
}

function tokens(paragraph) {
  return paragraph.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+/g) || [];
}

function splitLong(word, maxEm, measure) {
  const parts = [];
  let cur = "";
  for (const ch of word) {
    if (cur && measure(cur + ch) > maxEm) {
      parts.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function wrapParagraph(paragraph, maxEm, measure) {
  const lines = [];
  let cur = "";
  for (const tok of tokens(paragraph)) {
    if (/^\s+$/.test(tok)) {
      if (cur) cur += tok;
      continue;
    }
    const pieces = measure(tok) > maxEm ? splitLong(tok, maxEm, measure) : [tok];
    for (const piece of pieces) {
      if (cur && measure((cur + piece).trimEnd()) > maxEm) {
        lines.push(cur.trimEnd());
        cur = piece;
      } else {
        cur += piece;
      }
    }
  }
  lines.push(cur.trimEnd());
  return lines;
}

function wrapText(text, maxEm, measure) {
  const lines = text.split(/\r?\n/).flatMap((p) => wrapParagraph(p, maxEm, measure));
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const BLANK_LINE_RATIO = 0.55;

function linesHeight(lines, lineH) {
  let total = 0;
  for (const line of lines) {
    total += line === "" ? lineH * BLANK_LINE_RATIO : lineH;
  }
  return total;
}

export function layoutSlotText(text, slot, { measure, faceAspect }) {
  const { box, multiline } = SLOTS[slot];
  const boxW = (box.x1 - box.x0) * faceAspect;
  const boxH = box.y1 - box.y0;
  let last = null;
  for (let scale = 1; scale >= SLOT_MIN_SCALE - 1e-9; scale -= SCALE_STEP) {
    const fontScale = Math.round(scale * 100) / 100;
    const fontH = SLOT_FONT_FRACTION[slot] * fontScale;
    const maxEm = boxW / fontH;
    const lines = multiline ? wrapText(text, maxEm, measure) : [text.replace(/\r?\n/g, " ")];
    const widest = Math.max(0, ...lines.map(measure));
    const totalH = linesHeight(lines, fontH * SLOT_LINE_HEIGHT);
    const fits = widest <= maxEm + 1e-9 && totalH <= boxH + 1e-9;
    last = { lines, fontScale, overflow: !fits };
    if (fits) return last;
  }
  return { ...last, fontScale: SLOT_MIN_SCALE };
}

/** Preload bundled web fonts needed for the chosen mode before canvas draw. */
export async function loadCardFonts(card) {
  if (typeof document === "undefined" || !document.fonts) return;
  const mode = card?.font || "hand-en";
  const sample = `${card?.greeting || ""}${card?.message || ""}${card?.signature || ""}Dear ,—`;
  const loads = [document.fonts.load('500 64px "Caveat"', sample), document.fonts.load('400 64px "Great Vibes"', "Our love Grows stronger With every Passing year")];
  if (mode === "hand-zh") {
    loads.push(document.fonts.load('500 64px "Long Cang"', sample));
  }
  try {
    await Promise.all(loads);
  } catch {
    /* fallback faces handle offline/blocked cases gracefully */
  }
}

/**
 * Draw the three slots (greeting, body, signature) onto the inside-right sheet canvas
 * using the website's exact proportions, ink colour, auto-fit scaling, and handwriting.
 */
export async function drawCardSlotsOnSheet(canvas, card) {
  if (!card) return;
  await loadCardFonts(card);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const faceAspect = w / h;
  const inkKey = card.ink && INK_COLORS[card.ink] ? card.ink : "black";
  const color = INK_COLORS[inkKey];
  const mode = card.font || "hand-en";
  const family = slotFontFamily(mode);

  const entries = [
    ["greeting", card.greeting],
    ["body", card.message],
    ["signature", card.signature],
  ];

  const REF_PX = 96;
  ctx.save();
  for (const [slot, raw] of entries) {
    const parts = formatSlotParts(slot, raw);
    if (!parts) continue;
    const fullText = parts.prefix + parts.core + parts.suffix;
    const spec = SLOTS[slot];
    const { box, align, multiline } = spec;

    // Measure in em units at REF_PX
    ctx.font = `500 ${REF_PX}px ${family}`;
    const layout = layoutSlotText(fullText, slot, {
      measure: (line) => ctx.measureText(line).width / REF_PX,
      faceAspect,
    });

    const bx = box.x0 * w;
    const by = box.y0 * h;
    const bw = (box.x1 - box.x0) * w;
    const bh = (box.y1 - box.y0) * h;

    const px = SLOT_FONT_FRACTION[slot] * h * layout.fontScale;
    const lineH = px * SLOT_LINE_HEIGHT;
    ctx.font = `500 ${px}px ${family}`;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";

    const drawInk = (str, x, y) => {
      if (!str) return;
      if (mode === "hand-zh") {
        // Slight ink weight so Long Cang's fine hairlines read crisply at card size.
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.6, px * 0.014);
        ctx.lineJoin = "round";
        ctx.strokeText(str, x, y);
      }
      ctx.fillText(str, x, y);
    };

    if (multiline) {
      ctx.textAlign = align;
      const x = align === "left" ? bx : bx + bw;
      let y = by;
      for (const line of layout.lines) {
        if (line === "") {
          y += lineH * BLANK_LINE_RATIO;
        } else {
          drawInk(line, x, y + lineH * 0.5);
          y += lineH;
        }
      }
    } else {
      const top = by + (bh - lineH) / 2;
      ctx.textAlign = align;
      const x = align === "left" ? bx : bx + bw;
      drawInk(layout.lines[0], x, top + lineH / 2);
    }
  }
  ctx.restore();
}

/* ── Two-page letter ──────────────────────────────────────────────────────
 * The letter is split at a paragraph break and laid on both inside pages.
 * Both pages share one body font size (the largest that fits the tighter
 * page), so the spread reads as a single piece of writing.
 */
export const PAGE_BOXES = {
  left: {
    greeting: { box: { x0: 0.10, y0: 0.128, x1: 0.90, y1: 0.206 }, align: "left" },
    body: { box: { x0: 0.082, y0: 0.228, x1: 0.918, y1: 0.906 }, align: "left" },
  },
  right: {
    body: { box: { x0: 0.082, y0: 0.084, x1: 0.918, y1: 0.816 }, align: "left" },
    signature: { box: { x0: 0.26, y0: 0.836, x1: 0.90, y1: 0.888 }, align: "right" },
  },
};

const BODY_FRACTION = 0.066;   // of page height, before fitting
const PAGE_MIN_SCALE = 0.40;
const PAGE_MAX_SCALE = 2.40;   // the letter may grow past 1.0 to fill the pages
const PAGE_LINE_HEIGHT = 1.40;
const PAGE_SCALE_STEP = 0.02;

/** Split the letter at a paragraph break into [leftPageText, rightPageText]. */
export function splitForPages(message) {
  const paras = String(message || "").split(/\r?\n/);
  if (paras.length < 3) return [message, ""];
  const total = message.replace(/\s/g, "").length;
  let acc = 0;
  let cut = 1;
  for (let i = 0; i < paras.length - 1; i += 1) {
    acc += paras[i].replace(/\s/g, "").length;
    cut = i + 1;
    if (acc >= total * 0.47) break;
  }
  return [paras.slice(0, cut).join("\n"), paras.slice(cut).join("\n")];
}

function bodyMetrics(text, side, scale, measure, faceAspect) {
  const { box } = PAGE_BOXES[side].body;
  const fontH = BODY_FRACTION * scale;
  const maxEm = ((box.x1 - box.x0) * faceAspect) / fontH;
  const lines = wrapText(text, maxEm, measure);
  const widest = Math.max(0, ...lines.map(measure));
  const totalH = linesHeight(lines, fontH * PAGE_LINE_HEIGHT);
  return { lines, widest, totalH, fits: widest <= maxEm + 1e-9 && totalH <= box.y1 - box.y0 + 1e-9 };
}

function drawBlock(ctx, { lines, align, box }, w, h, px, lineH, color, strokeInk, family) {
  const bx = box.x0 * w;
  const by = box.y0 * h;
  const bw = (box.x1 - box.x0) * w;
  const bh = (box.y1 - box.y0) * h;
  ctx.font = `500 ${px}px ${family}`;
  ctx.textAlign = align;
  const x = align === "left" ? bx : bx + bw;
  const single = lines.length === 1;
  let y = single ? by + (bh - lineH) / 2 : by;
  for (const line of lines) {
    if (line === "") { y += lineH * BLANK_LINE_RATIO; continue; }
    const yy = single ? y + lineH / 2 : y + lineH * 0.5;
    if (strokeInk) ctx.strokeText(line, x, yy);
    ctx.fillText(line, x, yy);
    y += lineH;
  }
}

/** Elegant script motto flanking each snowflake ornament. */
export function drawFlakeLines(canvas, { cy, flakeW, left, right, color = "rgba(40, 68, 116, 0.92)" }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const half = w * flakeW * 0.5;
  const gap = w * 0.026;
  const avail = cx - half - gap - w * 0.048;
  let px = h * 0.040;
  const setFont = () => { ctx.font = `400 ${px}px "Great Vibes", "Segoe Script", cursive`; };
  setFont();
  const widest = Math.max(ctx.measureText(left).width, ctx.measureText(right).width);
  if (widest > avail) { px *= avail / widest; setFont(); }
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  setFont();
  ctx.textAlign = "right";
  ctx.fillText(left, cx - half - gap, h * cy);
  ctx.textAlign = "left";
  ctx.fillText(right, cx + half + gap, h * cy);
  ctx.restore();
}

/** Paint both inside pages of the open card. */
export function drawTwoPageLetter(leftCanvas, rightCanvas, card) {
  if (!leftCanvas || !rightCanvas || !card) return;
  const ctxL = leftCanvas.getContext("2d");
  const ctxR = rightCanvas.getContext("2d");
  if (!ctxL || !ctxR) return;

  const inkKey = card.ink && INK_COLORS[card.ink] ? card.ink : "black";
  const color = INK_COLORS[inkKey];
  const family = slotFontFamily(card.font);
  const strokeInk = (card.font || "") === "hand-zh";
  const REF_PX = 96;

  const [leftText, rightText] = splitForPages(card.message);
  ctxL.font = `500 ${REF_PX}px ${family}`;
  const measure = (line) => ctxL.measureText(line).width / REF_PX;
  const aspect = leftCanvas.width / leftCanvas.height;

  // One shared scale: the biggest body size that fits BOTH pages. Search
  // upward too, so a short letter fills the page instead of using 1.0.
  const probe = (s) => {
    const l = bodyMetrics(leftText, "left", s, measure, aspect);
    const r = bodyMetrics(rightText, "right", s, measure, aspect);
    return l.fits && r.fits ? { l, r } : null;
  };
  let scale = PAGE_MAX_SCALE;
  let found = probe(scale);
  if (!found) {
    let lo = PAGE_MIN_SCALE;
    let hi = PAGE_MAX_SCALE;
    for (let i = 0; i < 18; i += 1) {
      const mid = Math.round(((lo + hi) / 2) / PAGE_SCALE_STEP) * PAGE_SCALE_STEP;
      if (!(mid > lo && mid < hi)) break;
      if (probe(mid)) lo = mid; else hi = mid;
    }
    scale = Math.max(PAGE_MIN_SCALE, Math.floor(lo / PAGE_SCALE_STEP) * PAGE_SCALE_STEP);
    found = probe(scale);
  }
  const L = found ? found.l : bodyMetrics(leftText, "left", scale, measure, aspect);
  const R = found ? found.r : bodyMetrics(rightText, "right", scale, measure, aspect);

  const bodyPx = BODY_FRACTION * scale * leftCanvas.height;
  const bodyLH = bodyPx * PAGE_LINE_HEIGHT;

  const paint = (ctx, canvas, side, body, extra) => {
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(1.2, bodyPx * 0.032);
    ctx.lineJoin = "round";
    drawBlock(ctx, { lines: body.lines, align: PAGE_BOXES[side].body.align, box: PAGE_BOXES[side].body.box }, w, h, bodyPx, bodyLH, color, strokeInk, family);
    if (extra) {
      const px = extra.px;
      ctx.lineWidth = Math.max(0.6, px * 0.014);
      drawBlock(ctx, extra.spec, w, h, px, px * PAGE_LINE_HEIGHT, color, strokeInk, family);
    }
    ctx.restore();
  };

  // Left page: salutation (a touch larger than the body) + first half.
  const greetParts = formatSlotParts("greeting", card.greeting);
  const greetPx = bodyPx * 1.22;
  const greetLine = greetParts
    ? [greetParts.prefix + greetParts.core + greetParts.suffix]
    : [];
  paint(ctxL, leftCanvas, "left", L, {
    px: greetPx,
    spec: { lines: greetLine, align: PAGE_BOXES.left.greeting.align, box: PAGE_BOXES.left.greeting.box },
  });

  // Right page: second half + signature.
  const sigParts = formatSlotParts("signature", card.signature);
  const sigPx = bodyPx * 1.0;
  const sigLine = sigParts ? [sigParts.prefix + sigParts.core + sigParts.suffix] : [];
  const bodyTop = PAGE_BOXES.right.body.box.y0;
  const sigTop = Math.min(bodyTop + (R.totalH || 0) + 0.028, 0.848);
  const sigBox = { x0: 0.26, y0: sigTop, x1: 0.90, y1: Math.min(sigTop + 0.052, 0.900) };
  paint(ctxR, rightCanvas, "right", R, {
    px: sigPx,
    spec: { lines: sigLine, align: PAGE_BOXES.right.signature.align, box: sigBox },
  });
}
