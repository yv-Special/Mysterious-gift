/**
 * Standalone Three.js greeting-card scene (the "3d-card-master" template).
 *
 * Ports the project's full living-card studio engine into a self-contained,
 * zero-CDN ES module:
 *   - Layered paper-cut cover with real thickness backings and cast shadows
 *   - Baked cold-press cotton relief + metallic gold foil (./art/baked/)
 *   - Pointer Lamp + LampGate shader (glints on foil/ink/pieces, never washes paper)
 *   - Living movers UV-warp shader (sway, flicker, breathe, twitch, pointer wind,
 *     landing greet, and interactive hotspot taps with spring physics)
 *   - Generalized glow (flickering candle/window light that flares on tap) and
 *     ambient particles (snowflakes, gold motes, or petals carried by pointer wind)
 *   - Golden sparkle bursts on card open and hotspot taps
 *   - Free drag-to-orbit with inertia coasting + lifted-piece release impulse
 *   - Real left-hinged opening with paper bowing and mobile-safe framing
 *
 * All imports are relative (same-origin). No remote requests, no repo paths.
 */
import * as THREE from "./three.module.min.js";
import {
  CARD_W,
  CARD_H,
  CARD_THICKNESS,
  SHEET_W,
  SHEET_H,
  SHEET_THICKNESS,
  BEND_SEGMENTS,
  OPEN_MAX,
  LAYER_BACKING_DEPTH,
  layerZ,
  layerFrame,
} from "./layout.js";
import { captureBendBuffers, applyBow } from "./bend.js";
import {
  stepHinge,
  stepSpring,
  LAYOUT_SPRING,
  LAYOUT_BEND_AMP,
  HINGE_SPRING_REDUCED,
} from "./motion.js";
import {
  STUDIO_BG_HEX,
  createInsidePageCanvas,
  stampMotif,
  createInsideRightBaseCanvas,
  createBlankSheetCanvas,
  createBackCanvas,
  createSnowfallCanvas,
  createSnowMaskCanvas,
  createCardShadowTexture,
  buildPaperNormalTile,
  CARD_SHADOW_PAD_X,
  CARD_SHADOW_PAD_Y,
  CARD_SHADOW_OFFSET,
} from "./surfaces.js";
import { createLampGate } from "./lampGate.js";
import {
  DEFAULT_WINTER_LIVE,
  createLiveRuntime,
  kickMovers,
  stepLive,
  packMoverUniforms,
  resolveLiveTap,
  coverLocalToPx,
  coverPxToLocal,
  installMoverShader,
} from "./live.js";
import { createCardParticles, createSparkleTexture } from "./particles.js";
import { drawFlakeLines, drawTwoPageLetter, loadCardFonts } from "./slotText.js";

/* ── Constants mirrored from the engine ── */

const CAMERA_FOV = 30;
/** Match src/lib/cardStage.ts framing on full-viewport stage with bottom dock. */
const FIT_HEIGHT = 0.66;
const FIT_WIDTH_CLOSED = 0.74;
const FIT_WIDTH_OPEN = 0.94;
const DOCK_RESERVE = 0.08;
const MOBILE_ASPECT_FLOOR = 0.46;

const LAYER_BACKING_TONE = new THREE.Color(0.74, 0.7, 0.64);
const LIFT_SEGMENTS = 16;
const BOW_AMP = LAYOUT_BEND_AMP;

const ORBIT_LIMIT = { yaw: 1.15, pitch: 0.6 };
const ORBIT_PER_PX = { yaw: 0.0065, pitch: 0.005 };
const COAST_DAMPING = 5;

/** Default winter-moonlight atmosphere when layout omits glow/particles/live. */
const DEFAULT_WINTER = {
  snowArea: [218, 140, 504, 655],
  glow: { at: [418, 640], color: "#ffd27a", size: 0.5, intensity: 0.68, flicker: true },
  particles: { kind: "snow", area: [218, 140, 504, 655], count: 40, size: 0.15 },
};

/* ── Studio background, tone-mapped back onto the page colour ── */

function neutralToneMap(c) {
  const start = 0.8 - 0.04;
  const desat = 0.15;
  const x = Math.min(c[0], c[1], c[2]);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  const shifted = c.map((v) => v - offset);
  const peak = Math.max(...shifted);
  if (peak < start) return shifted;
  const d = 1 - start;
  const newPeak = 1 - (d * d) / (peak + d - start);
  const g = 1 - 1 / (desat * (peak - newPeak) + 1);
  return shifted.map((v) => {
    const scaled = (v * newPeak) / peak;
    return scaled + (newPeak - scaled) * g;
  });
}

function studioBackgroundColor() {
  const target = new THREE.Color(STUDIO_BG_HEX);
  const want = [target.r, target.g, target.b];
  let guess = [...want];
  for (let i = 0; i < 40; i += 1) {
    const out = neutralToneMap(guess);
    guess = guess.map((g, k) => Math.max(0, g + (want[k] - out[k]) * 1.5));
  }
  return new THREE.Color(guess[0], guess[1], guess[2]);
}

/* ── Camera framing ── */

function distanceFor(size, fraction, halfFovTan) {
  return size / (fraction * 2 * halfFovTan);
}

function fitStage(cardW, cardH, fovDeg, aspect) {
  const tanV = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const aspectClosed = aspect < 1 ? Math.max(aspect, MOBILE_ASPECT_FLOOR) : aspect;
  const aspectOpen = Math.max(aspect, MOBILE_ASPECT_FLOOR);
  return {
    closedZ: Math.max(
      distanceFor(cardH, FIT_HEIGHT, tanV),
      distanceFor(cardW, FIT_WIDTH_CLOSED, tanV * aspectClosed),
    ),
    openZ: Math.max(
      distanceFor(cardH, FIT_HEIGHT, tanV),
      distanceFor(cardW * 2, FIT_WIDTH_OPEN, tanV * aspectOpen),
    ),
    camYPerZ: -(DOCK_RESERVE / 2) * 2 * tanV,
  };
}

/* ── Asset loading (same-origin, relative) ── */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

async function loadJSON(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Failed to load ${src}: ${res.status}`);
  return res.json();
}

function makeTexture(source, anisotropy, isColor = true) {
  const tex = new THREE.Texture(source);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function surfaceTextures(normalImg, surfaceImg, anisotropy) {
  return {
    normal: makeTexture(normalImg, anisotropy, false),
    surface: makeTexture(surfaceImg, anisotropy, false),
  };
}

function putSurface(mat, s) {
  mat.normalMap = s.normal;
  mat.normalScale.set(1, 1);
  mat.roughnessMap = s.surface;
  mat.metalnessMap = s.surface;
  mat.roughness = 1;
  mat.metalness = 1;
}

function parseColor(value, fallback) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return new THREE.Color(value).getHex();
  return fallback;
}

/* ── The scene ── */

export async function createScene(canvas, card) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new Error("createScene: a canvas element is required");
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = null;
  renderer.setClearAlpha(0);

  /* Studio environment + lights. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(createRoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.25;

  scene.add(new THREE.AmbientLight(0xfff9f8, 0.72));
  scene.add(new THREE.HemisphereLight(0xfffaf6, 0xd8c8c0, 0.30));
  const key = new THREE.DirectionalLight(0xfff8f0, 1.18);
  key.position.set(6.8, 4.8, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0006;
  scene.add(key);
  const keyTarget = new THREE.Object3D();
  scene.add(keyTarget);
  key.target = keyTarget;
  const rim = new THREE.DirectionalLight(0xdce8ff, 0.55);
  rim.position.set(-5.5, -2.0, 2.8);
  scene.add(rim);

  /* Card body: three bendable boxes + pointer lamp + LampGate. */
  const outer = new THREE.Group();
  const center = new THREE.Group();
  outer.add(center);
  scene.add(outer);

  const lampGate = createLampGate();
  // Pointer lamp moves across the card face so foil & relief glint sharply.
  const hoverLamp = new THREE.PointLight(0xfff6e5, 0, 1.9, 1.4);
  hoverLamp.position.set(CARD_W / 2, 0, 0.55);
  center.add(hoverLamp);

  const paperNormalTex = makeTexture(
    pixelsToCanvas(buildPaperNormalTile(512, 24)),
    maxAnisotropy,
    false,
  );
  paperNormalTex.wrapS = THREE.RepeatWrapping;
  paperNormalTex.wrapT = THREE.RepeatWrapping;
  paperNormalTex.repeat.set(3.5, 3.5 * (CARD_H / CARD_W));

  const edge = new THREE.MeshPhysicalMaterial({
    color: 0xe6ddd1,
    roughness: 0.9,
    metalness: 0,
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  const cover = new THREE.MeshStandardMaterial({
    roughness: 0.6,
    metalness: 0.55,
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(1, 1),
  });
  const insideLeft = new THREE.MeshPhysicalMaterial({
    roughness: 0.86,
    metalness: 0.01,
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  insideLeft.color = new THREE.Color(0xffffff);
  const insideRightBase = new THREE.MeshPhysicalMaterial({
    roughness: 0.86,
    metalness: 0.01,
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.9, 0.9),
  });
  const insideRightSheet = new THREE.MeshPhysicalMaterial({
    roughness: 0.82,
    metalness: 0.01,
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });
  const back = new THREE.MeshStandardMaterial({
    roughness: 0.88,
    metalness: 0.01,
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.9, 0.9),
  });

  // Order matters: moverShader replaces onBeforeCompile; lampGate chains onto it.
  const moverShader = installMoverShader(cover, 940, 1316);
  for (const m of [edge, cover, insideLeft, insideRightBase, insideRightSheet, back]) {
    lampGate.install(m);
  }

  const rightGeo = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_THICKNESS, BEND_SEGMENTS, 1, 1);
  const rightMesh = new THREE.Mesh(rightGeo, [edge, edge, edge, edge, insideRightBase, back]);
  rightMesh.position.set(CARD_W / 2, 0, 0);
  rightMesh.castShadow = true;
  rightMesh.receiveShadow = true;
  center.add(rightMesh);

  const sheetGeo = new THREE.BoxGeometry(SHEET_W, SHEET_H, SHEET_THICKNESS, BEND_SEGMENTS, 1, 1);
  const sheetMesh = new THREE.Mesh(sheetGeo, [edge, edge, edge, edge, insideRightSheet, edge]);
  sheetMesh.position.set(CARD_W / 2, 0, CARD_THICKNESS * 0.5 + 0.005);
  sheetMesh.castShadow = true;
  sheetMesh.receiveShadow = true;
  center.add(sheetMesh);

  const frontPivot = new THREE.Group();
  frontPivot.position.set(0, 0, CARD_THICKNESS * 0.5 + 0.026);
  center.add(frontPivot);

  const frontGeo = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_THICKNESS, BEND_SEGMENTS, 1, 1);
  const coverMesh = new THREE.Mesh(frontGeo, [edge, edge, edge, edge, cover, insideLeft]);
  coverMesh.position.set(CARD_W / 2, 0, CARD_THICKNESS * 0.5);
  coverMesh.castShadow = true;
  coverMesh.receiveShadow = true;
  frontPivot.add(coverMesh);

  /* Contact shadow on the studio sweep. */
  const shadowTex = makeTexture(createCardShadowTexture(), maxAnisotropy);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
  });
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W * CARD_SHADOW_PAD_X, CARD_H * CARD_SHADOW_PAD_Y),
    shadowMat,
  );
  shadowPlane.position.set(CARD_SHADOW_OFFSET.x, CARD_SHADOW_OFFSET.y, CARD_SHADOW_OFFSET.z);
  outer.add(shadowPlane);

  /* ── Outer envelope ─────────────────────────────────────────────────────
   * The card arrives sealed inside an envelope. Tapping it breaks the wax,
   * the envelope drops away and the card slides out of the top. The envelope
   * lives in `outer` so it inherits the same float and drag-orbit as the card.
   */
  const ENV_RATIO = 1342 / 1000; // portrait envelope-back art
  const ENV_W = CARD_W * 1.07;
  const ENV_H = ENV_W * ENV_RATIO;
  const ENV_SEAL = [0.5, 0.447]; // wax seal, normalised on the flap tip
  const SEAL_SIZE = ENV_W * 0.205;
  const FLAP_STRIP = 0.553;      // the flap art strip, as a share of the envelope height
  const FLAP_H = ENV_H * FLAP_STRIP;
  const FLAP_OPEN = 1.42; // the old lid only half-lifts while it dissolves into the open art
  // Open state art: the pocket with its lid already standing up, cut from the
  // reference photo (body 1000x1342, lid 1000x543 stacked above it).
  const OPEN_ASPECT = 1885 / 1000;
  const OPEN_H = ENV_W * OPEN_ASPECT;

  const envelopeGroup = new THREE.Group();
  envelopeGroup.position.set(0, 0, CARD_THICKNESS + 0.12);
  envelopeGroup.rotation.set(-0.045, 0.075, 0.012);
  outer.add(envelopeGroup);

  const envMat = new THREE.MeshStandardMaterial({
    map: makeTexture(await loadImage("./env-base.webp"), maxAnisotropy),
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.3, 0.3),
    transparent: true,
    roughness: 0.88,
    metalness: 0.02,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
  });
  const envMesh = new THREE.Mesh(new THREE.PlaneGeometry(ENV_W, ENV_H), envMat);
  envMesh.renderOrder = 20;
  envelopeGroup.add(envMesh);

  /* The opened pocket: same body, lid standing up. Its body is punched out
   * where the paper sits, so the card behind shows through the slot. */
  const envOpenMat = new THREE.MeshStandardMaterial({
    map: makeTexture(await loadImage("./env-open-body.webp"), maxAnisotropy),
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.3, 0.3),
    transparent: true,
    opacity: 0,
    roughness: 0.88,
    metalness: 0.02,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
  });
  const envOpenMesh = new THREE.Mesh(new THREE.PlaneGeometry(ENV_W, ENV_H), envOpenMat);
  envOpenMesh.position.set(0, 0, 0.002);
  envOpenMesh.renderOrder = 20.5;
  envOpenMesh.visible = false;
  envelopeGroup.add(envOpenMesh);

  /* The lid stands up from the same hinge, but it lives *behind* the card:
   * the card slides out in front of it, exactly like paper does. */
  const LID_H = ENV_W * (554 / 1000);
  const envLidMat = new THREE.MeshStandardMaterial({
    map: makeTexture(await loadImage("./env-open-lid.webp"), maxAnisotropy),
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.3, 0.3),
    transparent: true,
    opacity: 0,
    roughness: 0.88,
    metalness: 0.02,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true,
  });
  // 立盖挂在"信封上沿"的枢轴上：抽卡时整片向后翻倒（像真信封把盖子折到背后），
  // 这样卡片升起时不会和立盖轮廓叠在一起，看上去就不穿模了。
  const envLidPivot = new THREE.Group();
  envLidPivot.position.set(0, ENV_H / 2, -0.22);
  envLidPivot.rotation.x = 0;
  envelopeGroup.add(envLidPivot);

  const envLid = new THREE.Mesh(new THREE.PlaneGeometry(ENV_W, LID_H), envLidMat);
  envLid.position.set(0, LID_H / 2, 0);
  envLid.renderOrder = -2;          // behind the card, which renders at 0
  envLid.visible = false;
  envLidPivot.add(envLid);

  // Cream backing so the envelope still reads as paper when it tilts.
  const envBackMat = new THREE.MeshStandardMaterial({
    color: 0xf7eee8,
    roughness: 0.94,
    metalness: 0,
    transparent: true,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
  });
  // Cream backing for the lower body only: it stops below the slot's tip, so the
  // opening really looks through to the card and never at a flat cream wall.
  const ENV_BACK_TOP = 0.55;
  const ENV_BACK_BOTTOM = -ENV_H * 0.497;
  const envBack = new THREE.Mesh(
    new THREE.PlaneGeometry(ENV_W * 0.994, ENV_BACK_TOP - ENV_BACK_BOTTOM),
    envBackMat,
  );
  envBack.position.y = (ENV_BACK_TOP + ENV_BACK_BOTTOM) / 2;
  envBack.position.z = -0.012;
  envBack.renderOrder = 19;
  envelopeGroup.add(envBack);

  // Wax seal: its own piece so it can be clicked off before anything else moves.
  const sealMat = new THREE.MeshStandardMaterial({
    map: makeTexture(await loadImage("./seal.webp"), maxAnisotropy),
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.35, 0.35),
    transparent: true,
    roughness: 0.62,
    metalness: 0.08,
    depthTest: false,
    depthWrite: false,
  });
  const sealMesh = new THREE.Mesh(new THREE.PlaneGeometry(SEAL_SIZE, SEAL_SIZE), sealMat);
  sealMesh.position.set(
    (ENV_SEAL[0] - 0.5) * ENV_W,
    (0.5 - ENV_SEAL[1]) * ENV_H,
    0.03,
  );
  sealMesh.renderOrder = 22;
  envelopeGroup.add(sealMesh);

  // Warm bloom that flares over the wax when the seal breaks.
  const sealGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeTexture(makeGlowCanvas(), maxAnisotropy),
      color: 0xffce8a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sealGlow.position.set(
    (ENV_SEAL[0] - 0.5) * ENV_W,
    (0.5 - ENV_SEAL[1]) * ENV_H,
    0.06,
  );
  sealGlow.scale.set(0.62, 0.62, 1);
  envelopeGroup.add(sealGlow);

  /* Top flap: its own hinged piece so it can really turn over, the way paper
   * does. Two faces — the cream art outside, the navy-and-gold liner inside. */
  const flapGroup = new THREE.Group();
  flapGroup.position.set(0, ENV_H / 2, 0.004);
  envelopeGroup.add(flapGroup);

  const flapFrontMat = new THREE.MeshStandardMaterial({
    map: makeTexture(await loadImage("./env-flap.webp"), maxAnisotropy),
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.3, 0.3),
    transparent: true,
    roughness: 0.88,
    metalness: 0.02,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
  });
  const flapFront = new THREE.Mesh(new THREE.PlaneGeometry(ENV_W, FLAP_H), flapFrontMat);
  flapFront.position.y = -FLAP_H / 2;
  flapFront.renderOrder = 21;
  flapGroup.add(flapFront);

  const flapBackMat = new THREE.MeshStandardMaterial({
    map: makeTexture(await loadImage("./env-liner.webp"), maxAnisotropy),
    normalMap: paperNormalTex,
    normalScale: new THREE.Vector2(0.25, 0.25),
    transparent: true,
    roughness: 0.9,
    metalness: 0.05,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false,
  });
  const flapBack = new THREE.Mesh(new THREE.PlaneGeometry(ENV_W, FLAP_H), flapBackMat);
  flapBack.position.y = -FLAP_H / 2;
  flapBack.position.z = -0.003;
  flapBack.rotation.y = Math.PI; // face the room once the flap has turned over
  flapBack.renderOrder = 20.4;
  flapBack.visible = false; // the liner is baked into the new open art
  flapGroup.add(flapFront);
  flapGroup.add(flapBack); // kept for geometry, never drawn

    const CARD_STOW = 0.8;  // shrunk, so it sits neatly inside the sleeve
  const CARD_STOW_Y = ENV_H / 2 - (CARD_H * CARD_STOW) / 2 - 0.02; // its top edge at the flap hinge
  center.position.y = CARD_STOW_Y;
  center.scale.setScalar(CARD_STOW);

  /* Load layout.json + art + optional baked relief maps. */
  const layout = await loadJSON("./layout.json");
  const coverW = (layout.size && layout.size[0]) || 940;
  const coverH = (layout.size && layout.size[1]) || 1316;
  moverShader.setSize(coverW, coverH);

  const winterEffects = layout.winterEffects !== false;
  let bakedByName = null;
  if (layout.baked !== false) {
    try {
      const manifest = await loadJSON("./bk-manifest.json");
      bakedByName = new Map(manifest.entries.map((e) => [e.name, e]));
    } catch {
      bakedByName = null;
    }
  }
  const baked = (name) => {
    const entry = bakedByName && bakedByName.get(name);
    if (!entry) return Promise.resolve(null);
    return loadImage(`./bk-${entry.normal}`).then((normal) =>
      loadImage(`./bk-${entry.surface}`).then((surface) => ({ normal, surface })),
    );
  };

  const baseImg = await loadImage(layout.base);
  const coverReliefImgs = await baked("base");
  const itemImages = await Promise.all(
    (layout.items || []).map(async (it) => {
      const img = await loadImage(it.src);
      const reliefImgs = await baked(`layer-${it.id}`);
      return { spec: it, img, reliefImgs };
    }),
  );

  let coverReliefOwned = [];
  cover.map = makeTexture(baseImg, maxAnisotropy);
  if (coverReliefImgs) {
    const s = surfaceTextures(coverReliefImgs.normal, coverReliefImgs.surface, maxAnisotropy);
    putSurface(cover, s);
    // Foil on the cover reflects the studio softbox rather than dim dark bronze
    // (mirrors src/lib/card/elementMeshes.ts FOIL_ENV_INTENSITY).
    cover.envMap = envRT.texture;
    cover.envMapIntensity = 0.65;
    coverReliefOwned = [s.normal, s.surface];
  } else {
    cover.metalness = 0.02;
    cover.roughness = 0.84;
  }
  cover.needsUpdate = true;

  /* Inside pages + back motif. */
  const motifImg =
    layout.motifs && layout.motifs[0] ? await loadImage(layout.motifs[0].src) : null;
  const backLine =
    layout.backLine !== undefined
      ? layout.backLine
      : winterEffects
        ? "Warm Wishes · Christmas Card"
        : (card && card.title) || "Warm Wishes";
  /* Both inside pages carry handwriting now: salutation + first half on the
   * left page, the rest + signature on the right. */
  await loadCardFonts(card);
  const leftCanvas = createInsidePageCanvas({ spine: "right" });
  const rightCanvas = createInsidePageCanvas({ spine: "left" });
  if (motifImg) stampMotif(leftCanvas, motifImg, [0.5, 0.088], 0.125, 0.92);
  if (motifImg) stampMotif(rightCanvas, motifImg, [0.5, 0.921], 0.115, 0.92);
  drawTwoPageLetter(leftCanvas, rightCanvas, card);
  drawFlakeLines(leftCanvas, { cy: 0.088, flakeW: 0.125, left: "Hand held", right: "heart given" });
  drawFlakeLines(rightCanvas, { cy: 0.921, flakeW: 0.115, left: "vows spoken", right: "love sealed" });
  insideLeft.map = makeTexture(leftCanvas, maxAnisotropy);

  if (motifImg) {
    const first = layout.motifs[0];
    const backMotif = layout.motifs[1] || first;
    const backMotifImg =
      layout.motifs[1] && layout.motifs[1].src !== first.src
        ? await loadImage(layout.motifs[1].src)
        : motifImg;
    back.map = makeTexture(
      createBackCanvas(
        baseImg,
        {
          at: backMotif.at || [0.5, 0.72],
          width: backMotif.width ?? 0.14,
          turn: backMotif.turn,
          crop: backMotifImg,
        },
        backLine,
      ),
      maxAnisotropy,
    );
  } else {
    back.map = makeTexture(createBackCanvas(null, null, backLine), maxAnisotropy);
  }
  insideLeft.needsUpdate = true;

  insideRightBase.map = makeTexture(rightCanvas, maxAnisotropy);
  insideRightBase.needsUpdate = true;
  back.needsUpdate = true;
  // The single right-hand insert sheet is retired: both pages are painted now.
  if (sheetMesh) sheetMesh.visible = false;

  /* Raised paper-cut pieces: each with its own relief, foil, and LampGate floor=1. */
  const lifted = itemImages.map((item, idx) => {
    const f = layerFrame(item.spec.box, item.img.width, item.img.height);
    const geo = new THREE.PlaneGeometry(f.w, f.h, LIFT_SEGMENTS, 1);
    geo.translate(f.cx, f.cy, layerZ(item.spec.lift));
    const map = makeTexture(item.img, maxAnisotropy);
    let mat;
    const owned = [];
    if (item.reliefImgs) {
      const relief = surfaceTextures(item.reliefImgs.normal, item.reliefImgs.surface, maxAnisotropy);
      mat = new THREE.MeshStandardMaterial({
        map,
        normalMap: relief.normal,
        metalnessMap: relief.surface,
        roughnessMap: relief.surface,
        metalness: 1,
        roughness: 1,
        envMap: envRT.texture,
        envMapIntensity: 0.92,
        alphaTest: 0.5,
      });
      owned.push(relief.normal, relief.surface);
    } else {
      mat = new THREE.MeshStandardMaterial({
        map,
        roughness: 0.8,
        metalness: 0,
        alphaTest: 0.5,
      });
    }
    lampGate.install(mat, 1);
    const backingMat = new THREE.MeshStandardMaterial({
      map,
      color: LAYER_BACKING_TONE,
      roughness: 0.9,
      alphaTest: 0.5,
    });
    owned.push(backingMat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const backing = new THREE.Mesh(geo, backingMat);
    backing.position.z = -LAYER_BACKING_DEPTH;
    backing.castShadow = true;
    mesh.add(backing);
    coverMesh.add(mesh);
    return {
      mesh,
      baseZ: item.spec.lift,
      bob: item.spec.bob || 0,
      phase: idx * 1.3,
      impulse: 0,
      geometry: geo,
      material: mat,
      texture: map,
      owned,
      bend: captureBendBuffers(geo),
    };
  });

  /* Living-card spec: explicit layout.live, or bundled winter-moonlight default. */
  const liveSpec =
    layout.live !== undefined ? layout.live : winterEffects ? DEFAULT_WINTER_LIVE : null;
  const liveRt = liveSpec ? createLiveRuntime(liveSpec) : null;
  if (liveSpec) {
    moverShader.setMovers(packMoverUniforms(liveSpec, liveRt));
  }

  /* Ambient particles: explicit layout.particles, or winter snow default. */
  const particleSpec =
    layout.particles !== undefined
      ? layout.particles
      : winterEffects
        ? DEFAULT_WINTER.particles
        : null;
  let snowfallTex = null;
  let snowfallMat = null;
  let snowfallMesh = null;
  let cardParticles = null;
  let particleBounds = { xMin: 0.45, xMax: 2.15, yMin: -0.9, yMax: 1.2 };

  if (particleSpec) {
    const area = particleSpec.area || [160, 120, coverW - 320, coverH - 360];
    particleBounds = {
      xMin: (area[0] / coverW) * CARD_W,
      xMax: ((area[0] + area[2]) / coverW) * CARD_W,
      yMax: (0.5 - area[1] / coverH) * CARD_H,
      yMin: (0.5 - (area[1] + area[3]) / coverH) * CARD_H,
    };
    cardParticles = createCardParticles({
      kind: particleSpec.kind || "snow",
      count: particleSpec.count,
      size: particleSpec.size,
      color: particleSpec.color !== undefined ? parseColor(particleSpec.color, 0xffffff) : undefined,
      opacity: particleSpec.opacity,
      z: CARD_THICKNESS + 0.04,
      bounds: particleBounds,
    });
    frontPivot.add(cardParticles.points);

    // Parallax snowfall plane behind the glass for winter snow themes.
    if ((particleSpec.kind || "snow") === "snow" && winterEffects) {
      snowfallTex = makeTexture(createSnowfallCanvas(), maxAnisotropy, false);
      snowfallTex.wrapS = THREE.RepeatWrapping;
      snowfallTex.wrapT = THREE.RepeatWrapping;
      snowfallMat = new THREE.MeshBasicMaterial({
        map: snowfallTex,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      snowfallMesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), snowfallMat);
      snowfallMesh.position.set(CARD_W / 2, 0, CARD_THICKNESS + 0.003);
      frontPivot.add(snowfallMesh);
      if (layout.cover) {
        try {
          const coverComposite = await loadImage(layout.cover);
          snowfallMat.alphaMap = makeTexture(
            createSnowMaskCanvas(coverComposite, area),
            maxAnisotropy,
            false,
          );
          snowfallMat.needsUpdate = true;
        } catch {
          // Optional composite cover.
        }
      }
    }
  }

  /* Warm glow (candle flame / cottage window / lantern): explicit or winter default. */
  const glowSpec =
    layout.glow !== undefined ? layout.glow : winterEffects ? DEFAULT_WINTER.glow : null;
  let glowSprite = null;
  let glowSpriteMat = null;
  let glowLight = null;
  let glowBaseIntensity = 0.65;
  let glowFlicker = true;
  if (glowSpec && Array.isArray(glowSpec.at)) {
    const glowHex = parseColor(glowSpec.color, 0xffd27a);
    glowBaseIntensity = glowSpec.intensity ?? 0.68;
    glowFlicker = glowSpec.flicker !== false;
    glowSpriteMat = new THREE.SpriteMaterial({
      map: makeTexture(makeGlowCanvas(), maxAnisotropy),
      color: glowHex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    glowSprite = new THREE.Sprite(glowSpriteMat);
    const gx = (glowSpec.at[0] / coverW) * CARD_W;
    const gy = (0.5 - glowSpec.at[1] / coverH) * CARD_H;
    glowSprite.position.set(gx, gy, CARD_THICKNESS + 0.045);
    const gs = (glowSpec.size ?? 0.5) * 1.05;
    glowSprite.scale.set(gs, gs, 1);
    frontPivot.add(glowSprite);
    glowLight = new THREE.PointLight(glowHex, glowBaseIntensity, 1.45);
    glowLight.position.set(gx, gy, CARD_THICKNESS + 0.35);
    frontPivot.add(glowLight);
  }

  /* Golden sparkle burst (fires on card open and live hotspot taps). */
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = reducedMotion ? 0 : 1;
  const hingeParams = reducedMotion ? HINGE_SPRING_REDUCED : undefined;

  const burstCount = reducedMotion ? 24 : 110;
  const burstPositions = new Float32Array(burstCount * 3);
  const burstVelocities = new Float32Array(burstCount * 3);
  const burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute("position", new THREE.BufferAttribute(burstPositions, 3));
  const sparkleTex = createSparkleTexture();
  const burstMat = new THREE.PointsMaterial({
    size: 0.17,
    color: 0xe6ac3c,
    map: sparkleTex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const burstParticles = new THREE.Points(burstGeo, burstMat);
  scene.add(burstParticles);

  let burstTimer = 0;
  function triggerBurst(origin) {
    if (reducedMotion) return;
    burstTimer = origin ? 1.05 : 1.5;
    const posAttr = burstGeo.getAttribute("position");
    const spread = origin ? 0.08 : 1;
    for (let i = 0; i < burstCount; i += 1) {
      posAttr.setXYZ(
        i,
        (origin ? origin.x : 0) + (Math.random() - 0.5) * 0.5 * spread,
        (origin ? origin.y : 0) + (Math.random() - 0.5) * 2.4 * spread,
        (origin ? origin.z : 0.35) + Math.random() * 0.3 * spread,
      );
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.8 + Math.random() * 2.1) * (origin ? 0.42 : 1);
      burstVelocities[i * 3] = Math.cos(angle) * speed;
      burstVelocities[i * 3 + 1] = Math.sin(angle) * speed * 0.75 + 0.4;
      burstVelocities[i * 3 + 2] = (Math.random() - 0.15) * 1.5;
    }
    posAttr.needsUpdate = true;
  }

  /* Camera + framing. */
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  let stage = fitStage(CARD_W, CARD_H, CAMERA_FOV, 1);
  const raycaster = new THREE.Raycaster();
  const rayNdc = new THREE.Vector2();

  /* Bend buffers for the panels. */
  const bends = {
    cover: captureBendBuffers(frontGeo),
    right: captureBendBuffers(rightGeo),
    sheet: captureBendBuffers(sheetGeo),
  };

  /* Interaction & animation state. */
  let openTarget = 0;
  let hinge = { x: 0, v: 0 };
  let layoutSpring = { x: 0, v: 0 };
  let tiltX = 0;
  let tiltY = 0;
  let orbitX = 0;
  let orbitY = 0;
  let orbitVX = 0;
  let orbitVY = 0;
  let dragging = false;
  let hoverX = 0;
  let hoverY = 0;
  let pointerOver = false;
  let lampWanted = 0;
  let wind = 0;
  const sweepWind = { x: 0, y: 0 };
  let glowFlare = 0;
  let releasedImpulse = 0;
  let greeted = false;
  let disposed = false;
  let rafId = 0;
  let elapsed = 0;
  let lastT = performance.now();
  let lastAngle = Number.NaN;
  let lastBend = Number.NaN;

  /* Envelope state: sealed until the first tap, then a 1.2 s pull-out. */
  let wrapped = true;
  let wrapT = 0;
  const WRAP_DUR = 1.55;
  /* The flap turns over before anything else moves. */
  let flapT = 0;
  let openHold = 0;   // beat of stillness once the lid is fully up
  const FLAP_DUR = 0.66;
  /* Wax step: tap 1 peels the seal off, tap 2 opens the envelope. */
  let sealBroken = false;
  let sealT = 0;
  const SEAL_DUR = 0.62;

  function applyTilt(x, y) {
    const nx = Math.min(1, Math.max(-1, Number.isFinite(x) ? x : 0));
    const ny = Math.min(1, Math.max(-1, Number.isFinite(y) ? y : 0));
    tiltX = ny * 0.6;
    tiltY = nx * 0.9;
  }

  function raycastCard(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    rayNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(2 * ((clientY - rect.top) / rect.height)) + 1,
    );
    raycaster.setFromCamera(rayNdc, camera);
    return raycaster.intersectObjects([coverMesh, sheetMesh, rightMesh], false).length > 0;
  }

  function raycastCover(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    rayNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(2 * ((clientY - rect.top) / rect.height)) + 1,
    );
    raycaster.setFromCamera(rayNdc, camera);
    const hits = raycaster.intersectObject(coverMesh, false);
    const hit = hits.find((h) => h.face);
    if (!hit) return null;
    return {
      point: hit.point,
      local: coverMesh.worldToLocal(hit.point.clone()),
    };
  }

  function pageRectVars() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const v = new THREE.Vector3();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [cx, cy] of [
      [-CARD_W / 2, CARD_H / 2],
      [CARD_W / 2, CARD_H / 2],
      [CARD_W / 2, -CARD_H / 2],
      [-CARD_W / 2, -CARD_H / 2],
    ]) {
      v.set(cx, cy, 0);
      rightMesh.localToWorld(v);
      v.project(camera);
      const px = ((v.x + 1) / 2) * canvas.clientWidth;
      const py = ((1 - v.y) / 2) * canvas.clientHeight;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    const style = parent.style;
    style.setProperty("--page-x", `${Math.round(minX)}px`);
    style.setProperty("--page-y", `${Math.round(minY)}px`);
    style.setProperty("--page-w", `${Math.round(maxX - minX)}px`);
    style.setProperty("--page-h", `${Math.round(maxY - minY)}px`);
  }

  function resize() {
    const parent = canvas.parentElement;
    const w = Math.max(
      1,
      (parent ? parent.clientWidth : 0) || canvas.clientWidth || window.innerWidth,
    );
    const h = Math.max(
      1,
      (parent ? parent.clientHeight : 0) || canvas.clientHeight || window.innerHeight,
    );
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    stage = fitStage(CARD_W, CARD_H, CAMERA_FOV, w / h);
    camera.updateProjectionMatrix();
  }

  function layoutCard(dt) {
    const wasStill = hinge.v === 0 && layoutSpring.v === 0;
    hinge = stepHinge(hinge, openTarget * OPEN_MAX, dt, hingeParams);
    layoutSpring = stepSpring(layoutSpring, openTarget > 0.5 ? 1 : 0, LAYOUT_SPRING, dt);
    const angle = hinge.x;
    const progress = THREE.MathUtils.clamp(angle / OPEN_MAX, 0, 1);

    const bowMix = Math.sin(Math.min(Math.PI, angle / OPEN_MAX) * Math.PI);
    const bend = BOW_AMP * bowMix;
    if (wasStill && bend === 0 && lastBend === 0 && angle === lastAngle) return progress;
    lastBend = bend;
    lastAngle = angle;

    frontPivot.rotation.y = -angle;
    applyBow(frontGeo, CARD_W, bend, bends.cover);
    for (const lm of lifted) applyBow(lm.geometry, CARD_W, bend, lm.bend);
    applyBow(rightGeo, CARD_W, bend * 0.35, bends.right);
    applyBow(sheetGeo, SHEET_W, bend * 0.35, bends.sheet);

    const shade = 1 - 0.45 * bowMix;
    insideLeft.color.setRGB(1, 1, 1).multiplyScalar(shade);
    insideRightBase.color.setRGB(1, 1, 1).multiplyScalar(1 - 0.28 * (1 - shade));

    center.position.x = (-CARD_W / 2) * (1 - layoutSpring.x);

    const footLeft = Math.min(0, CARD_W * Math.cos(angle));
    const footW = CARD_W - footLeft;
    shadowPlane.position.x =
      center.position.x + (footLeft + CARD_W) / 2 + CARD_SHADOW_OFFSET.x;
    shadowPlane.scale.set(
      (footW + CARD_W * (CARD_SHADOW_PAD_X - 1)) / (CARD_W * CARD_SHADOW_PAD_X),
      1,
      1,
    );
    return progress;
  }

  function frame(now) {
    if (disposed) return;
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    elapsed += dt;

    // Gentle landing greeting once the cover is on screen.
    if (!greeted && !reducedMotion && elapsed > 0.45 && liveSpec && liveRt) {
      greeted = true;
      if (liveSpec.greet && liveSpec.greet.length) {
        kickMovers(liveRt, liveSpec.greet, 0.75);
      }
    }

    /* Wax seal peels off on the first tap; the sleeve drops on the second. */
    if (sealBroken && sealT < 1) sealT = Math.min(1, sealT + dt / SEAL_DUR);
    if (wrapped === false && wrapT < 1) {
      /* Beat of stillness once the lid is fully up, then the card rises. */
      if (flapT >= 1) openHold += dt;
      if (flapT >= 1 && openHold > 0.62) wrapT = Math.min(1, wrapT + dt / WRAP_DUR);
    }
    if (wrapped === false && flapT < 1) flapT = Math.min(1, flapT + dt / FLAP_DUR);
    if (envelopeGroup) {
      const st = sealT;
      sealMesh.visible = st < 0.999;
      sealMesh.position.z = 0.03 + st * 0.85;
      sealMesh.scale.setScalar(1 + st * 0.25);
      sealMesh.rotation.z = st * 0.42;

      const ft = flapT <= 0 ? 0 : flapT < 0.5 ? 2 * flapT * flapT : 1 - Math.pow(-2 * flapT + 2, 2) / 2;
      flapGroup.rotation.x = FLAP_OPEN * ft;
      flapGroup.visible = ft < 0.58;
      /* Cross-fade into the photographed open pocket: the sealed face and its
       * lid dissolve while the standing lid rises into place. */
      const openIn = THREE.MathUtils.smoothstep(ft, 0.40, 0.86);
      const openEase = openIn;
      const k = wrapped ? 0 : wrapT;
      const cardRise = 1 - Math.pow(1 - k, 3);
      const envDrop = Math.pow(k, 1.5);
      center.position.y = CARD_STOW_Y * (1 - cardRise);
      center.scale.setScalar(CARD_STOW + (1 - CARD_STOW) * cardRise);
      envelopeGroup.position.y = -6.2 * envDrop;
      const fade = 1 - THREE.MathUtils.smoothstep(k, 0.60, 0.92);
      const backFade = 1 - THREE.MathUtils.smoothstep(k, 0.52, 0.84);
      // The lid sits behind the card once it is pulled out, so it leaves first.
      const flapFade = 1 - THREE.MathUtils.smoothstep(k, 0.12, 0.34);
      envMat.opacity = fade * (1 - THREE.MathUtils.smoothstep(ft, 0.38, 0.80));
      envBackMat.opacity = backFade;
      // the old lid leaves early, so the two lids never overlap on screen
      flapFrontMat.opacity = flapFade * (1 - Math.min(1, ft * 2.2));
      flapBackMat.opacity = 0;
      envOpenMat.opacity = fade * openEase;
      envOpenMesh.visible = envOpenMat.opacity > 0.004;
      envOpenMesh.position.y = -0.16 * (1 - ft);
      const lidFall = THREE.MathUtils.smoothstep(k, 0.0, 0.34);   // 抽卡开始 → 立盖向后翻倒
      envLidPivot.rotation.x = -1.55 * lidFall;
      envLidMat.opacity = openEase * (1 - THREE.MathUtils.smoothstep(k, 0.30, 0.52));
      envLid.visible = envLidMat.opacity > 0.004;
      sealMat.opacity = (1 - Math.pow(st, 1.5)) * fade;
      envelopeGroup.visible = fade > 0.004;

      const flash = st > 0 && st < 0.45 ? Math.pow(1 - st / 0.45, 1.2) : 0;
      sealGlow.material.opacity = flash * 0.95;
      const pulse = 1 + flash * 0.9;
      sealGlow.scale.set(0.95 * pulse, 0.95 * pulse, 1);
    }

    const progress = layoutCard(dt);
    const openFade = 1 - Math.min(1, progress * 1.4);

    // Inertia coasting after a drag release.
    if (!dragging && (orbitVX !== 0 || orbitVY !== 0)) {
      const decay = Math.exp(-COAST_DAMPING * dt);
      const step = (1 - decay) / COAST_DAMPING;
      orbitY = THREE.MathUtils.clamp(
        orbitY + orbitVX * ORBIT_PER_PX.yaw * step,
        -ORBIT_LIMIT.yaw,
        ORBIT_LIMIT.yaw,
      );
      orbitX = THREE.MathUtils.clamp(
        orbitX + orbitVY * ORBIT_PER_PX.pitch * step,
        -ORBIT_LIMIT.pitch,
        ORBIT_LIMIT.pitch,
      );
      orbitVX *= decay;
      orbitVY *= decay;
      if (Math.hypot(orbitVX, orbitVY) < 5) {
        orbitVX = 0;
        orbitVY = 0;
      }
    }

    // Wind & flare decay smoothly.
    const windDecay = Math.exp(-dt * 4.5);
    wind *= windDecay;
    sweepWind.x *= windDecay;
    sweepWind.y *= windDecay;
    glowFlare = Math.max(0, glowFlare - dt * 1.25);

    // Subtle floating breath while closed; rock-steady while open for reading.
    const floatFactor = openFade * motion;
    const floatY = Math.sin(elapsed * 1.15) * 0.016 * floatFactor;
    const floatRotZ = Math.sin(elapsed * 0.8) * 0.004 * floatFactor;
    const baseRotX = 0.012 * openFade;
    const baseRotY = -0.035 * openFade;

    const targetRotX = baseRotX + tiltX + orbitX + hoverY * 0.06 * openFade;
    const targetRotY = baseRotY + tiltY + orbitY + hoverX * 0.08 * openFade;
    const ease = 1 - Math.exp(-dt * 8);
    outer.position.y += (floatY - outer.position.y) * ease;
    outer.rotation.x += (targetRotX - outer.rotation.x) * ease;
    outer.rotation.y += (targetRotY - outer.rotation.y) * ease;
    outer.rotation.z += (floatRotZ - outer.rotation.z) * ease;

    // Key light target drifts slightly with pointer so paper relief shimmers.
    keyTarget.position.x = THREE.MathUtils.lerp(
      keyTarget.position.x,
      (hoverX + orbitY * 0.4) * 1.2,
      1 - Math.exp(-dt * 4),
    );
    keyTarget.position.y = THREE.MathUtils.lerp(
      keyTarget.position.y,
      (-hoverY - orbitX * 0.4) * 0.9,
      1 - Math.exp(-dt * 4),
    );

    // Pointer lamp eases in/out and updates its view-space gate uniform.
    const targetLamp = pointerOver && progress < 0.4 && !wrapped ? lampWanted : 0;
    hoverLamp.intensity = THREE.MathUtils.lerp(
      hoverLamp.intensity,
      targetLamp,
      1 - Math.exp(-dt * 8),
    );

    // Camera dollies between the closed and open framings, lifting slightly above the dock.
    // While the flap stands up the framing pulls back and lifts, so the whole
    // open envelope plus the raised lid stay inside the frame.
    const flapLift =
      envelopeGroup && !wrapped
        ? (flapT * flapT * (3 - 2 * flapT)) * (1 - (wrapT * wrapT * (3 - 2 * wrapT)))
        : 0;
    const zTarget =
      THREE.MathUtils.lerp(stage.closedZ, stage.openZ, layoutSpring.x) + 1.30 * flapLift;
    camera.position.x = 0;
    camera.position.z += (zTarget - camera.position.z) * Math.min(1, dt * 8);
    camera.position.y =
      stage.camYPerZ * camera.position.z + 1.16 * flapLift;

    // Living movers on the cover.
    if (liveRt && !reducedMotion && progress < 0.95) {
      stepLive(liveRt, dt * motion, wind);
      moverShader.writePose(liveRt);
    }

    // Candle / window glow: organic flicker + tap flare.
    if (glowLight && glowSprite && glowSpriteMat) {
      const flick =
        reducedMotion || !glowFlicker
          ? 1
          : 1 +
            Math.sin(elapsed * 5.2) * 0.07 +
            Math.sin(elapsed * 13.7) * 0.04 +
            Math.sin(elapsed * 1.9) * 0.05;
      const flare = 1 + glowFlare * 1.6;
      const reveal = wrapped ? 0 : Math.min(1, wrapT * 2.5);
      glowLight.intensity = glowBaseIntensity * flick * flare * (0.15 + 0.85 * openFade) * reveal;
      glowSprite.visible = progress < 0.7 && !wrapped;
      glowSpriteMat.opacity = Math.min(1, 0.68 * flick * flare * (0.2 + 0.8 * openFade)) * (wrapped ? 0 : 1);
    }

    // Ambient particles (snow / gold motes / petals), carried by pointer wind.
    if (cardParticles) {
      cardParticles.points.visible = progress < 0.9;
      cardParticles.points.material.opacity =
        (particleSpec.opacity ?? (particleSpec.kind === "gold" ? 0.85 : 0.92)) * openFade;
      cardParticles.update(dt, elapsed, particleBounds, sweepWind, motion);
    }
    if (snowfallMat && snowfallMesh && snowfallTex) {
      snowfallMat.opacity = 0.9 * openFade;
      snowfallMesh.visible = progress < 0.9;
      if (!reducedMotion) snowfallTex.offset.y = (snowfallTex.offset.y - dt * 0.02) % 1;
    }

    // Raised paper-cut pieces bob + react to drag/tap impulse.
    const impulse = releasedImpulse;
    releasedImpulse = Math.max(0, releasedImpulse - dt * 1.8);
    if (!reducedMotion) {
      for (const lm of lifted) {
        lm.impulse = Math.max(lm.impulse, impulse * 0.6);
        const bob = Math.sin(elapsed * 2.1 + lm.phase) * (lm.bob + lm.impulse * 0.015);
        lm.mesh.position.z = bob;
        lm.impulse = Math.max(0, lm.impulse - dt * 2.4);
      }
    }

    // Golden sparkle burst.
    if (burstTimer > 0) {
      burstTimer = Math.max(0, burstTimer - dt);
      const bAttr = burstGeo.getAttribute("position");
      for (let i = 0; i < burstCount; i += 1) {
        const bx = bAttr.getX(i) + burstVelocities[i * 3] * dt;
        const by = bAttr.getY(i) + burstVelocities[i * 3 + 1] * dt;
        const bz = bAttr.getZ(i) + burstVelocities[i * 3 + 2] * dt;
        burstVelocities[i * 3 + 1] -= 0.75 * dt;
        bAttr.setXYZ(i, bx, by, bz);
      }
      bAttr.needsUpdate = true;
      burstMat.opacity = Math.min(0.95, burstTimer / 1.05);
    } else {
      burstMat.opacity = 0;
    }

    lampGate.update(hoverLamp, camera);
    renderer.render(scene, camera);
    pageRectVars();
    rafId = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  const resizeObserver =
    canvas.parentElement && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(resize)
      : null;
  if (resizeObserver && canvas.parentElement) resizeObserver.observe(canvas.parentElement);

  const warmTarget = new THREE.WebGLRenderTarget(1, 1);
  const prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(warmTarget);
  const compiled = renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(prevRT);
  await compiled;

    camera.position.set(0, stage.camYPerZ * stage.closedZ, stage.closedZ);
  rafId = requestAnimationFrame((t) => {
    lastT = t;
    frame(t);
  });

  return {
    /** Open (true) or close (false) the cover; it hinges left, spring-driven. */
    setOpen(open) {
      const next = open ? 1 : 0;
      if (next === 1 && openTarget === 0) {
        triggerBurst();
        orbitX = 0;
        orbitY = 0;
        orbitVX = 0;
        orbitVY = 0;
      }
      openTarget = next;
    },
    /** Normalized tilt, each -1..1: x yaws the card, y pitches it. */
    setTilt(x, y) {
      applyTilt(x, y);
    },
    /** True while the card is still sealed in its envelope. */
    isWrapped() {
      return wrapped;
    },
    /** True once the wax is off but the envelope is still closed. */
    isSealBroken() {
      return sealBroken;
    },
    /**
     * Tap 1: peel the wax seal away (does not open the envelope).
     * Tap 2: drop the sleeve and let the card rise out.
     */
    unwrap() {
      const p = new THREE.Vector3(
        (ENV_SEAL[0] - 0.5) * ENV_W,
        (0.5 - ENV_SEAL[1]) * ENV_H,
        0.1,
      );
      envelopeGroup.localToWorld(p);
      if (!sealBroken) {
        sealBroken = true;
        triggerBurst(p);
        return;
      }
      if (!wrapped) return;
      wrapped = false;
      triggerBurst(p);
    },
    /** Feed pointer hover + sweep velocity (px/s) for Pointer Lamp & wind. */
    setPointer(clientX, clientY, over, vxPx = 0, vyPx = 0) {
      pointerOver = Boolean(over) && !wrapped;
      if (!pointerOver) {
        hoverX = 0;
        hoverY = 0;
        lampWanted = 0;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        hoverX = THREE.MathUtils.clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
        hoverY = THREE.MathUtils.clamp(((clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      }
      if (Number.isFinite(vxPx)) {
        wind = THREE.MathUtils.clamp(wind + vxPx * 0.0011, -1, 1);
        sweepWind.x = THREE.MathUtils.clamp(sweepWind.x + vxPx * 0.005, -4, 4);
      }
      if (Number.isFinite(vyPx)) {
        sweepWind.y = THREE.MathUtils.clamp(sweepWind.y - vyPx * 0.005, -4, 4);
      }
      const hit = raycastCover(clientX, clientY);
      if (hit) {
        // Place the pointer lamp just above the card surface where the cursor points.
        const inCenter = center.worldToLocal(hit.point.clone());
        hoverLamp.position.set(inCenter.x, inCenter.y, CARD_THICKNESS + 0.52);
        lampWanted = 1.65;
      } else {
        lampWanted = 0;
      }
    },
    /** Free drag-orbit: delta pixels from drag start relative to base orbit. */
    setOrbit(rotX, rotY, isDragging = true) {
      if (wrapped) return;
      dragging = Boolean(isDragging);
      orbitX = THREE.MathUtils.clamp(Number.isFinite(rotX) ? rotX : 0, -ORBIT_LIMIT.pitch, ORBIT_LIMIT.pitch);
      orbitY = THREE.MathUtils.clamp(Number.isFinite(rotY) ? rotY : 0, -ORBIT_LIMIT.yaw, ORBIT_LIMIT.yaw);
      if (dragging) {
        orbitVX = 0;
        orbitVY = 0;
      }
    },
    /** Return current orbit radians so the host can drag smoothly from it. */
    getOrbit() {
      return { x: orbitX, y: orbitY };
    },
    /** Release drag with pointer velocity (px/s) for inertia coasting + jiggle. */
    releaseOrbit(vxPx = 0, vyPx = 0) {
      dragging = false;
      orbitVX = THREE.MathUtils.clamp(Number.isFinite(vxPx) ? vxPx : 0, -1800, 1800);
      orbitVY = THREE.MathUtils.clamp(Number.isFinite(vyPx) ? vyPx : 0, -1800, 1800);
      releasedImpulse = Math.max(
        releasedImpulse,
        THREE.MathUtils.clamp(Math.hypot(orbitVX, orbitVY) / 1400, 0, 0.7),
      );
    },
    /** True when the pointer lands on the card (cover or inside pages). */
    hitCard(clientX, clientY) {
      if (wrapped) return true;
      return raycastCard(clientX, clientY);
    },
    /**
     * Test a quick tap against live cover hotspots (candle glow, bells, flowers).
     * Returns true when a hotspot handled the tap (stay closed & play reaction);
     * returns false when the host should flip the card.
     */
    tapAt(clientX, clientY) {
      if (openTarget > 0.5 || !liveSpec || !liveRt) return false;
      const hit = raycastCover(clientX, clientY);
      if (!hit) return false;
      const px = coverLocalToPx(hit.local, coverW, coverH);
      const res = resolveLiveTap(liveSpec, px.x, px.y);
      if (res.kind === "glow") {
        glowFlare = 1;
        if (liveSpec.glowKick) kickMovers(liveRt, liveSpec.glowKick, 1.15);
        releasedImpulse = Math.max(releasedImpulse, 0.45);
        triggerBurst(hit.point);
        return true;
      }
      if (res.kind === "tap") {
        if (res.tap.kick) kickMovers(liveRt, res.tap.kick, 1.1);
        if (res.tap.lift) releasedImpulse = Math.max(releasedImpulse, 0.55);
        if (res.tap.sparkle) {
          const loc = coverPxToLocal(res.tap.sparkle, coverW, coverH);
          const pt = coverMesh.localToWorld(new THREE.Vector3(loc.x, loc.y, CARD_THICKNESS + 0.06));
          triggerBurst(pt);
        } else {
          triggerBurst(hit.point);
        }
        return true;
      }
      return false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      if (resizeObserver) resizeObserver.disconnect();
      for (const lm of lifted) {
        lm.mesh.removeFromParent();
        lm.geometry.dispose();
        lm.texture.dispose();
        lm.material.dispose();
        for (const o of lm.owned) o.dispose();
      }
      for (const t of coverReliefOwned) t.dispose();
      frontGeo.dispose();
      rightGeo.dispose();
      sheetGeo.dispose();
      if (cardParticles) cardParticles.dispose();
      if (snowfallMesh && snowfallMat && snowfallTex) {
        snowfallMesh.geometry.dispose();
        snowfallMat.alphaMap && snowfallMat.alphaMap.dispose();
        snowfallMat.dispose();
        snowfallTex.dispose();
      }
      if (glowSpriteMat) {
        glowSpriteMat.map && glowSpriteMat.map.dispose();
        glowSpriteMat.dispose();
      }
      if (glowLight) glowLight.dispose();
      burstGeo.dispose();
      burstMat.dispose();
      sparkleTex.dispose();
      hoverLamp.dispose();
      shadowPlane.geometry.dispose();
      shadowMat.dispose();
      for (const m of [edge, cover, insideLeft, insideRightBase, insideRightSheet, back]) {
        m.dispose();
      }
      paperNormalTex.dispose();
      shadowTex.dispose();
      cover.map && cover.map.dispose();
      insideLeft.map && insideLeft.map.dispose();
      insideRightBase.map && insideRightBase.map.dispose();
      back.map && back.map.dispose();
      insideRightSheet.map && insideRightSheet.map.dispose();
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      outer.removeFromParent();
      const parent = canvas.parentElement;
      if (parent) {
        for (const k of ["--page-x", "--page-y", "--page-w", "--page-h"]) {
          parent.style.removeProperty(k);
        }
      }
    },
  };
}

/* ── Helpers that need DOM or pixels ── */

function pixelsToCanvas(pixels) {
  const size = Math.round(Math.sqrt(pixels.length / 4));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.putImageData(new ImageData(pixels, size, size), 0, 0);
  return canvas;
}

function makeGlowCanvas() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2 - 4);
    g.addColorStop(0, "rgba(255, 245, 200, 0.95)");
    g.addColorStop(0.28, "rgba(255, 208, 110, 0.55)");
    g.addColorStop(0.62, "rgba(255, 180, 75, 0.16)");
    g.addColorStop(1, "rgba(255, 180, 75, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

/** RoomEnvironment for PMREM, inlined from three's addon (no remote imports). */
function createRoomEnvironment() {
  const envScene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  geometry.deleteAttribute("uv");
  const roomMaterial = new THREE.MeshStandardMaterial({ side: THREE.BackSide });
  const boxMaterial = new THREE.MeshStandardMaterial();
  const mainLight = new THREE.PointLight(0xffffff, 900, 28, 2);
  mainLight.position.set(0.418, 16.199, 0.3);
  envScene.add(mainLight);
  const room = new THREE.Mesh(geometry, roomMaterial);
  room.position.set(-0.757, 13.219, 0.717);
  room.scale.set(31.713, 28.305, 28.591);
  envScene.add(room);
  const boxes = [
    [-10.906, 2.009, 1.846, 0, -0.195, 2.328, 7.905, 4.651],
    [-5.607, -0.754, -0.758, 0, 0.994, 1.97, 1.534, 3.955],
    [6.167, 0.857, 7.803, 0, 0.561, 3.927, 6.285, 3.687],
    [-2.017, 0.018, 6.124, 0, 0.333, 2.002, 4.566, 2.062],
    [2.291, -0.756, -2.621, 0, -0.286, 1.546, 1.552, 1.496],
    [-2.193, -0.369, -5.547, 0, 0.516, 3.875, 3.482, 2.982],
  ];
  for (const b of boxes) {
    const box = new THREE.Mesh(geometry, boxMaterial);
    box.position.set(b[0], b[1], b[2]);
    box.rotation.set(b[3], b[4], 0);
    box.scale.set(b[5], b[6], b[7]);
    envScene.add(box);
  }
  const lights = [
    [-16.116, 14.37, 8.208, 0.1, 2.428, 2.739, 50],
    [-16.109, 18.021, -8.207, 0.1, 2.425, 2.751, 50],
    [14.904, 12.198, -1.832, 0.15, 4.265, 6.331, 17],
    [-0.462, 8.89, 14.52, 4.38, 5.441, 0.088, 43],
    [3.235, 11.486, -12.541, 2.5, 2.0, 0.1, 20],
    [0, 20, 0, 1, 0.1, 1, 100],
  ];
  for (const l of lights) {
    const light = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    light.material.color.setScalar(l[6]);
    light.position.set(l[0], l[1], l[2]);
    light.scale.set(l[3], l[4], l[5]);
    envScene.add(light);
  }
  // Warm front studio softbox + gentle bounce panel facing the card (+Z) so
  // vertical metallic gold foil reflects warm champagne highlights instead of
  // the dark lower room wall (replaces studio.ts RectAreaLight without addons).
  const softboxes = [
    [-4.2, 4.8, 13.8, 11.0, 8.0, 0.2, 0xfff8ec, 6.5],
    [3.8, 1.4, 14.2, 10.0, 7.5, 0.2, 0xfffaf2, 3.2],
  ];
  for (const s of softboxes) {
    const panel = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(s[6]).multiplyScalar(s[7]) }),
    );
    panel.position.set(s[0], s[1], s[2]);
    panel.scale.set(s[3], s[4], s[5]);
    envScene.add(panel);
  }
  return envScene;
}

void studioBackgroundColor;
