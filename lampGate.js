/**
 * Pointer-lamp specular gate, ported from src/lib/lampGate.ts.
 *
 * Keeps the close hover lamp off bare matte paper so the sheet stays warm and
 * crisp while painted ink, gold foil, and raised paper-cut pieces catch a
 * sharp moving glint as the pointer sweeps across the card.
 */
import * as THREE from "./three.module.min.js";

const PAPER_ROUGH = 0.86;
const PAINT_ROUGH = 0.5;
const LAMP_DIFFUSE = 0.15;
const INK_GLOSS = 0.45;
const LAMP_SPECULAR_MAX = 0.6;

const POINT_INFO = "getPointLightInfo( pointLight, geometryPosition, directLight );";
const RE_DIRECT =
  "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
const UNROLL = "#pragma unroll_loop_start";

function gatedLights() {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const loop = chunk.indexOf("NUM_POINT_LIGHTS > 0");
  const unroll = chunk.indexOf(UNROLL, loop);
  const info = chunk.indexOf(POINT_INFO, unroll);
  const direct = chunk.indexOf(RE_DIRECT, info);
  if (loop < 0 || unroll < 0 || info < 0 || direct < 0) return chunk;
  const decl = `float lampDiffuseKeep;
\tvec3 lampDiffuseBefore;
\tvec3 lampSpecularBefore;
\t${UNROLL}`;
  const gate = `${POINT_INFO}
\t\tlampDiffuseKeep = 1.0;
\t\tif ( distance( pointLight.position, uLampView ) < 0.01 ) {
\t\t\tdirectLight.color *= lampMask;
\t\t\tlampDiffuseKeep = ${LAMP_DIFFUSE.toFixed(2)};
\t\t}
\t\tlampDiffuseBefore = reflectedLight.directDiffuse;
\t\tlampSpecularBefore = reflectedLight.directSpecular;`;
  const roll = `${RE_DIRECT}
\t\tif ( lampDiffuseKeep < 1.0 ) {
\t\t\treflectedLight.directDiffuse = mix( lampDiffuseBefore, reflectedLight.directDiffuse, lampDiffuseKeep );
\t\t\treflectedLight.directSpecular = lampSpecularBefore + min( reflectedLight.directSpecular - lampSpecularBefore, vec3( ${LAMP_SPECULAR_MAX.toFixed(2)} ) );
\t\t}`;
  return (
    chunk.slice(0, unroll) +
    decl +
    chunk.slice(unroll + UNROLL.length, info) +
    gate +
    chunk.slice(info + POINT_INFO.length, direct) +
    roll +
    chunk.slice(direct + RE_DIRECT.length)
  );
}

export function createLampGate() {
  const lampView = { value: new THREE.Vector3(1e6, 1e6, 1e6) };
  const lights = gatedLights();

  return {
    install(material, floor = 0) {
      const prev = material.onBeforeCompile;
      const prevKey = material.customProgramCacheKey.bind(material);
      const lampFloor = { value: floor };
      material.onBeforeCompile = (shader, renderer) => {
        prev.call(material, shader, renderer);
        shader.uniforms.uLampView = lampView;
        shader.uniforms.uLampFloor = lampFloor;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform vec3 uLampView;\nuniform float uLampFloor;",
          )
          .replace(
            "#include <metalnessmap_fragment>",
            `#include <metalnessmap_fragment>
float lampMask = max( uLampFloor, clamp( max( metalnessFactor * 1.6, smoothstep( ${PAPER_ROUGH.toFixed(2)}, ${PAINT_ROUGH.toFixed(2)}, roughnessFactor ) ), 0.0, 1.0 ) );
roughnessFactor = mix( roughnessFactor * ${INK_GLOSS.toFixed(2)}, roughnessFactor, smoothstep( ${PAINT_ROUGH.toFixed(2)}, ${PAPER_ROUGH.toFixed(2)}, roughnessFactor ) );`,
          )
          .replace("#include <lights_fragment_begin>", lights);
      };
      material.customProgramCacheKey = () => `${prevKey()}|lamp-gate-spec-gloss`;
      material.needsUpdate = true;
    },
    update(lamp, camera) {
      lamp.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      lampView.value
        .setFromMatrixPosition(lamp.matrixWorld)
        .applyMatrix4(camera.matrixWorldInverse);
    },
  };
}
