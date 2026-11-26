/**
 * Living-card movers runtime + cover UV-warp shader, ported from
 * src/lib/live/movers.ts and src/lib/live/moverShader.ts.
 *
 * Warps colour, normal, metalness and roughness maps together around pixel
 * pivots so smoke, candle flames, branches and ribbons sway continuously, lean
 * with pointer-sweep wind, greet on landing, and react to taps with springs.
 */
import * as THREE from "./three.module.min.js";
import { CARD_W, CARD_H } from "./layout.js";

export const MAX_MOVERS = 8;

const DEFAULT_SOFT = 0.45;
const SWING_W = 9;
const SWING_ZETA = 0.22;
const JIGGLE_W = 14;
const JIGGLE_ZETA = 0.2;
const PEAK_GAIN = 1 / 0.75;
const WIND_LEAN = 0.8;
const TWITCH_LEN = 0.32;

/** Default living spec for the bundled winter-moonlight cover. */
export const DEFAULT_WINTER_LIVE = {
  movers: {
    smoke: {
      pivot: [362, 548],
      tip: [374, 462],
      width: 26,
      soft: 0.5,
      sway: [2.2, 0.28],
      kick: 10,
      wind: 0.8,
    },
    treeL: {
      pivot: [272, 690],
      tip: [272, 455],
      width: 72,
      soft: 0.4,
      sway: [0.6, 0.16],
      kick: 4,
      wind: 0.5,
    },
    treeR: {
      pivot: [690, 750],
      tip: [690, 555],
      width: 68,
      soft: 0.4,
      sway: [0.6, 0.16],
      kick: 4,
      wind: 0.5,
    },
  },
  taps: [],
  glowTap: [418, 640, 60],
  greet: ["treeL", "treeR"],
};

function nextTwitchIn(m, rng) {
  if (!m.twitch) return Infinity;
  const [, min, max] = m.twitch;
  return min + rng() * (max - min);
}

export function createLiveRuntime(spec, rng = Math.random) {
  const movers = {};
  const specs = (spec && spec.movers) || {};
  for (const [name, m] of Object.entries(specs)) {
    movers[name] = {
      angle: 0,
      idle: 0,
      scaleY: 1,
      swing: 0,
      swingV: 0,
      squash: 0,
      squashV: 0,
      twitchAt: -1,
      nextTwitch: nextTwitchIn(m, rng),
      phase: rng() * Math.PI * 2,
    };
  }
  return { time: 0, movers, specs, rng };
}

export function kickMovers(rt, names, strength = 1) {
  if (!rt || !names) return;
  for (const name of names) {
    const m = rt.specs[name];
    const s = rt.movers[name];
    if (!m || !s) continue;
    const react = m.react || "spring";
    if (react === "twitch") {
      s.twitchAt = 0;
    } else if (react === "jiggle") {
      s.squashV += (m.kick ?? 10) * 0.01 * JIGGLE_W * PEAK_GAIN * strength;
    } else {
      const dir = s.swingV < 0 ? -1 : 1;
      s.swingV += dir * (m.kick ?? 10) * SWING_W * PEAK_GAIN * strength;
    }
  }
}

function idleOf(m, s, t) {
  let angle = 0;
  let scale = 1;
  if (m.sway) angle += m.sway[0] * Math.sin(Math.PI * 2 * m.sway[1] * t + s.phase);
  if (m.flicker) {
    angle += m.flicker * 20 * (0.6 * Math.sin(11 * t + s.phase) + 0.4 * Math.sin(23.7 * t));
    scale *= 1 + m.flicker * 0.5 * (0.5 + 0.5 * Math.sin(15.3 * t + s.phase));
  }
  if (m.breathe) {
    scale *= 1 + m.breathe[0] * Math.sin(Math.PI * 2 * m.breathe[1] * t + s.phase);
  }
  return { angle, scale };
}

function twitchEnvelope(tau) {
  if (tau < 0.16) return Math.sin((Math.PI * tau) / 0.16);
  if (tau < TWITCH_LEN) return 0.7 * Math.sin((Math.PI * (tau - 0.16)) / 0.16);
  return 0;
}

export function stepLive(rt, dt, wind) {
  rt.time += dt;
  const t = rt.time;
  for (const [name, s] of Object.entries(rt.movers)) {
    const m = rt.specs[name];

    const lean = (m.wind ?? 0) * wind * (m.kick ?? 10) * WIND_LEAN;
    const acc = SWING_W * SWING_W * (lean - s.swing) - 2 * SWING_ZETA * SWING_W * s.swingV;
    s.swingV += acc * dt;
    s.swing += s.swingV * dt;

    const jAcc = -JIGGLE_W * JIGGLE_W * s.squash - 2 * JIGGLE_ZETA * JIGGLE_W * s.squashV;
    s.squashV += jAcc * dt;
    s.squash += s.squashV * dt;

    let twitch = 0;
    if (m.twitch) {
      s.nextTwitch -= dt;
      if (s.nextTwitch <= 0 && s.twitchAt < 0) s.twitchAt = 0;
      if (s.twitchAt >= 0) {
        s.twitchAt += dt;
        twitch = m.twitch[0] * twitchEnvelope(s.twitchAt);
        if (s.twitchAt > TWITCH_LEN) {
          s.twitchAt = -1;
          s.nextTwitch = nextTwitchIn(m, rt.rng);
        }
      }
    }

    const idle = idleOf(m, s, t);
    s.idle = idle.angle;
    s.angle = idle.angle + s.swing + twitch;
    s.scaleY = idle.scale * (1 - s.squash);
  }
}

export function packMoverUniforms(spec, rt) {
  const specs = (spec && spec.movers) || {};
  const names = Object.keys(specs).slice(0, MAX_MOVERS);
  const pivot = new Array(MAX_MOVERS * 4).fill(0);
  const geo = new Array(MAX_MOVERS * 4).fill(0);
  const pose = new Array(MAX_MOVERS * 4).fill(0);
  names.forEach((name, i) => {
    const m = specs[name];
    const capsule = Boolean(m.tip);
    pivot.splice(i * 4, 4, m.pivot[0], m.pivot[1], m.soft ?? DEFAULT_SOFT, capsule ? 1 : 0);
    const g =
      capsule && m.tip
        ? [m.tip[0], m.tip[1], m.width ?? 20, 0]
        : [...(m.area || [m.pivot[0], m.pivot[1], 20, 20])];
    geo.splice(i * 4, 4, ...g);
    const s = rt && rt.movers[name];
    pose.splice(i * 4, 4, ((s ? s.angle : 0) * Math.PI) / 180, s ? s.scaleY : 1, 0, 0);
  });
  return { count: names.length, pivot, geo, pose };
}

function inOval(x, y, area) {
  const [cx, cy, rx, ry] = area;
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

export function resolveLiveTap(spec, x, y) {
  if (!spec) return { kind: "open" };
  if (spec.glowTap) {
    const [gx, gy, r] = spec.glowTap;
    if (Math.hypot(x - gx, y - gy) <= r) return { kind: "glow" };
  }
  const tap = (spec.taps || []).find((t) => inOval(x, y, t.area));
  return tap ? { kind: "tap", tap } : { kind: "open" };
}

export function coverLocalToPx(local, w, h) {
  return {
    x: ((local.x + CARD_W / 2) / CARD_W) * w,
    y: (0.5 - local.y / CARD_H) * h,
  };
}

export function coverPxToLocal(px, w, h) {
  return {
    x: (px[0] / w) * CARD_W - CARD_W / 2,
    y: (0.5 - px[1] / h) * CARD_H,
  };
}

const GLSL = `
#define GC_MAX ${MAX_MOVERS}
uniform int uMvCount;
uniform vec2 uCoverPx;
uniform vec4 uMvPivot[GC_MAX];
uniform vec4 uMvGeo[GC_MAX];
uniform vec4 uMvPose[GC_MAX];

vec2 gcWarp(vec2 uv) {
  vec2 p = vec2(uv.x, 1.0 - uv.y) * uCoverPx;
  for (int i = 0; i < GC_MAX; i++) {
    if (i >= uMvCount) break;
    vec4 pv = uMvPivot[i];
    vec4 g = uMvGeo[i];
    vec4 pose = uMvPose[i];
    float d;
    if (pv.w < 0.5) {
      d = length((p - g.xy) / g.zw);
    } else {
      vec2 ab = g.xy - pv.xy;
      float h = clamp(dot(p - pv.xy, ab) / dot(ab, ab), 0.0, 1.0);
      d = length(p - pv.xy - ab * h) / g.z;
    }
    float w = 1.0 - smoothstep(1.0 - pv.z, 1.0, d);
    if (w <= 0.0) continue;
    float s = mix(1.0, pose.y, w);
    vec2 q = p - pv.xy;
    q = vec2(q.x * sqrt(s), q.y / s);
    float a = -pose.x * w;
    float c = cos(a);
    float sn = sin(a);
    p = pv.xy + vec2(c * q.x - sn * q.y, sn * q.x + c * q.y);
  }
  return vec2(p.x / uCoverPx.x, 1.0 - p.y / uCoverPx.y);
}
`;

const MAIN_PATCH = `void main() {
#ifdef USE_MAP
  vec2 gcUv = gcWarp(vMapUv);
  #define vMapUv gcUv
  #define vNormalMapUv gcUv
  #define vMetalnessMapUv gcUv
  #define vRoughnessMapUv gcUv
#endif
`;

const vec4s = () => Array.from({ length: MAX_MOVERS }, () => new THREE.Vector4());

export function installMoverShader(material, coverW, coverH) {
  const uniforms = {
    uMvCount: { value: 0 },
    uCoverPx: { value: new THREE.Vector2(coverW, coverH) },
    uMvPivot: { value: vec4s() },
    uMvGeo: { value: vec4s() },
    uMvPose: { value: vec4s() },
  };
  let names = [];

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GLSL}`)
      .replace("void main() {", MAIN_PATCH);
  };
  material.customProgramCacheKey = () => "card-cover-movers";
  material.needsUpdate = true;

  const fill = (target, flat) => target.forEach((v, i) => v.fromArray(flat, i * 4));

  return {
    setSize(w, h) {
      uniforms.uCoverPx.value.set(w, h);
    },
    setMovers(u) {
      uniforms.uMvCount.value = u.count;
      fill(uniforms.uMvPivot.value, u.pivot);
      fill(uniforms.uMvGeo.value, u.geo);
      fill(uniforms.uMvPose.value, u.pose);
      names = [];
    },
    writePose(rt) {
      if (names.length === 0) names = Object.keys(rt.movers).slice(0, MAX_MOVERS);
      names.forEach((name, i) => {
        const s = rt.movers[name];
        uniforms.uMvPose.value[i].set((s.angle * Math.PI) / 180, s.scaleY, 0, 0);
      });
    },
  };
}
