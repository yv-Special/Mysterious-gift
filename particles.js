/**
 * Ambient cover particles (snowflakes, golden motes, or drifting petals) and
 * sparkle-burst textures, ported from src/lib/cardSnow.ts and generalised for
 * any card theme.
 */
import * as THREE from "./three.module.min.js";

const ATLAS_CELLS = 4;
const CELL_PX = 96;
const WIND_CARRY_X = 0.2;
const WIND_CARRY_Y = 0.08;

/** Four six-armed flakes side by side, white on transparent. */
function createFlakeAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = CELL_PX * ATLAS_CELLS;
  canvas.height = CELL_PX;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 3;
    const variants = [
      [0.4, [0.55, 0.78], 0.16, 0.9, 0.055],
      [0.38, [0.45], 0.2, 0.75, 0.065],
      [0.42, [0.35, 0.6, 0.82], 0.11, 1.0, 0.045],
      [0.34, [], 0, 0, 0.09],
    ];
    variants.forEach(([arm, at, branch, angle, width], c) => {
      const r = CELL_PX * arm;
      ctx.save();
      ctx.translate(CELL_PX * (c + 0.5), CELL_PX / 2);
      ctx.lineWidth = CELL_PX * width;
      for (let k = 0; k < 6; k += 1) {
        ctx.save();
        ctx.rotate((k * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -r);
        for (const t of at) {
          const b = CELL_PX * branch * (1 - t * 0.4);
          ctx.moveTo(0, -r * t);
          ctx.lineTo(Math.sin(angle) * b, -r * t - Math.cos(angle) * b);
          ctx.moveTo(0, -r * t);
          ctx.lineTo(-Math.sin(angle) * b, -r * t - Math.cos(angle) * b);
        }
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, CELL_PX * width * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Four golden sparkles / bokeh / 4-point starlets for warm celebration cards. */
function createGoldAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = CELL_PX * ATLAS_CELLS;
  canvas.height = CELL_PX;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    for (let c = 0; c < ATLAS_CELLS; c += 1) {
      const cx = CELL_PX * (c + 0.5);
      const cy = CELL_PX / 2;
      ctx.save();
      ctx.translate(cx, cy);
      if (c === 0 || c === 2) {
        // 4-point paper-gold starlet
        const r = CELL_PX * (c === 0 ? 0.42 : 0.34);
        const inner = r * 0.22;
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
        g.addColorStop(0, "rgba(255, 250, 224, 1)");
        g.addColorStop(0.55, "rgba(245, 212, 132, 0.85)");
        g.addColorStop(1, "rgba(235, 190, 96, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        for (let i = 0; i < 8; i += 1) {
          const rad = i % 2 === 0 ? r : inner;
          const a = (i * Math.PI) / 4;
          if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
          else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
      } else if (c === 1) {
        // Soft warm bokeh mote
        const r = CELL_PX * 0.34;
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
        g.addColorStop(0, "rgba(255, 248, 220, 0.95)");
        g.addColorStop(0.45, "rgba(246, 212, 136, 0.55)");
        g.addColorStop(1, "rgba(246, 212, 136, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Tiny blossom petal
        const r = CELL_PX * 0.32;
        ctx.fillStyle = "rgba(255, 236, 224, 0.88)";
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.58, r * 0.92, 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Four delicate translucent petals for floral / birthday / spring cards. */
function createPetalAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = CELL_PX * ATLAS_CELLS;
  canvas.height = CELL_PX;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const tints = [
      ["rgba(255, 238, 232, 0.95)", "rgba(244, 198, 190, 0.72)"],
      ["rgba(255, 248, 226, 0.95)", "rgba(242, 208, 136, 0.72)"],
      ["rgba(255, 228, 222, 0.92)", "rgba(232, 174, 168, 0.65)"],
      ["rgba(255, 250, 238, 0.95)", "rgba(236, 212, 162, 0.68)"],
    ];
    tints.forEach(([c0, c1], c) => {
      const cx = CELL_PX * (c + 0.5);
      const cy = CELL_PX / 2;
      const r = CELL_PX * 0.34;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(c * 0.4 - 0.5);
      const g = ctx.createRadialGradient(-r * 0.15, -r * 0.15, 2, 0, 0, r);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.bezierCurveTo(r * 0.75, -r * 0.45, r * 0.68, r * 0.55, 0, r * 0.88);
      ctx.bezierCurveTo(-r * 0.68, r * 0.55, -r * 0.75, -r * 0.45, 0, -r * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft circular sparkle texture for opening & tap bursts. */
export function createSparkleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(255, 252, 236, 1)");
    g.addColorStop(0.35, "rgba(248, 210, 118, 0.85)");
    g.addColorStop(1, "rgba(230, 175, 70, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function particleMaterial(atlas, size, color, opacity, additive) {
  const mat = new THREE.PointsMaterial({
    size,
    color: color ?? 0xffffff,
    map: atlas,
    transparent: true,
    depthWrite: false,
    opacity: opacity ?? 0.92,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aSize;\nattribute float aRot;\nattribute float aCell;\nvarying float vRot;\nvarying float vCell;",
      )
      .replace(
        "gl_PointSize = size;",
        "gl_PointSize = size * aSize;\n\tvRot = aRot;\n\tvCell = aCell;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vRot;\nvarying float vCell;")
      .replace(
        "#include <map_particle_fragment>",
        `vec2 pc = gl_PointCoord - 0.5;
float cr = cos( vRot ), sr = sin( vRot );
pc = mat2( cr, -sr, sr, cr ) * pc + 0.5;
if ( pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0 ) discard;
diffuseColor *= texture2D( map, vec2( ( pc.x + vCell ) / ${ATLAS_CELLS.toFixed(1)}, 1.0 - pc.y ) );`,
      );
  };
  mat.customProgramCacheKey = () => `card-particles-${additive ? "add" : "norm"}`;
  return mat;
}

/**
 * Ambient particles floating inside a card's artwork window, carried by pointer wind.
 * kind: "snow" | "gold" | "petals"
 */
export function createCardParticles(opts) {
  const kind = opts.kind || "snow";
  const count = opts.count ?? (kind === "gold" ? 36 : 40);
  const size = opts.size ?? (kind === "gold" ? 0.14 : 0.15);
  const z = opts.z;
  const rise = kind === "gold";
  const pos = new Float32Array(count * 3);
  const aSize = new Float32Array(count);
  const aRot = new Float32Array(count);
  const aCell = new Float32Array(count);
  const speed = new Float32Array(count);
  const phase = new Float32Array(count);
  const spin = new Float32Array(count);

  const b = opts.bounds || { xMin: 0.45, xMax: 2.15, yMin: -0.9, yMax: 1.2 };
  const spanX = Math.max(0.05, b.xMax - b.xMin);
  const spanY = Math.max(0.05, b.yMax - b.yMin);

  for (let i = 0; i < count; i += 1) {
    pos[i * 3] = b.xMin + Math.random() * spanX;
    pos[i * 3 + 1] = b.yMin + Math.random() * spanY;
    pos[i * 3 + 2] = z + Math.random() * 0.08;
    const s = Math.random();
    aSize[i] = 0.55 + s * 0.9;
    speed[i] = (rise ? 0.05 + s * 0.11 : 0.13 + s * 0.19) * (0.85 + Math.random() * 0.3);
    aCell[i] = Math.floor(Math.random() * ATLAS_CELLS);
    aRot[i] = Math.random() * Math.PI * 2;
    spin[i] = (Math.random() - 0.5) * (kind === "petals" ? 1.1 : 0.75);
    phase[i] = Math.random() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
  const rotAttr = new THREE.BufferAttribute(aRot, 1);
  geo.setAttribute("aRot", rotAttr);
  geo.setAttribute("aCell", new THREE.BufferAttribute(aCell, 1));

  const atlas =
    kind === "gold"
      ? createGoldAtlas()
      : kind === "petals"
        ? createPetalAtlas()
        : createFlakeAtlas();
  const mat = particleMaterial(
    atlas,
    size,
    opts.color,
    opts.opacity ?? (kind === "gold" ? 0.85 : 0.92),
    kind === "gold",
  );
  const points = new THREE.Points(geo, mat);
  const posAttr = geo.getAttribute("position");

  return {
    points,
    update(dt, elapsed, bounds, wind, motion) {
      if (motion <= 0) return;
      const w = bounds.xMax - bounds.xMin;
      const h = bounds.yMax - bounds.yMin;
      if (w <= 0 || h <= 0) return;
      for (let i = 0; i < count; i += 1) {
        let x = posAttr.getX(i);
        let y = posAttr.getY(i);
        const drift = Math.sin(elapsed * 0.8 + phase[i]) * (kind === "petals" ? 0.12 : 0.06);
        x += (drift + wind.x * WIND_CARRY_X) * dt * motion;
        y += ((rise ? speed[i] : -speed[i]) + wind.y * WIND_CARRY_Y) * dt * motion;
        if (x < bounds.xMin) x += w;
        else if (x > bounds.xMax) x -= w;
        if (y < bounds.yMin) {
          y = bounds.yMax;
          x = bounds.xMin + Math.random() * w;
        } else if (y > bounds.yMax) {
          y = bounds.yMin;
          x = bounds.xMin + Math.random() * w;
        }
        posAttr.setXY(i, x, y);
        aRot[i] += spin[i] * dt * motion;
      }
      posAttr.needsUpdate = true;
      rotAttr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      atlas.dispose();
    },
  };
}
