/**
 * Cover / panel bowing, ported from the project engine (src/lib/cardBend.ts)
 * to plain JS: bends a BoxGeometry-spread panel whose local x runs
 * -width/2 (spine) .. width/2 (free edge), rotating around the spine.
 */

/**
 * Snapshot pristine positions/normals of a posed geometry for later bowing.
 * Marks the attributes dynamic, as the engine does.
 */
export function captureBendBuffers(geo) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  pos.setUsage && pos.setUsage(THREE_DYNAMIC);
  nor.setUsage && nor.setUsage(THREE_DYNAMIC);
  return {
    basePositions: new Float32Array(pos.array),
    baseNormals: new Float32Array(nor.array),
  };
}

/**
 * Bend a panel geometry whose local x runs -width/2..width/2 (BoxGeometry
 * default; the panel's spine side is at -width/2):
 *   th = bend * (x + width/2) / width
 *   x' = sin(th)/k - sin(th)*z;  z' = (1 - cos(th))/k + cos(th)*z
 * Normals rotate by th around the local y axis. bend ~ 0 restores the base.
 */
export function applyBow(geo, width, bend, buffers) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const pa = pos.array;
  const na = nor.array;
  const { basePositions, baseNormals } = buffers;

  if (Math.abs(bend) < 5e-4) {
    let dirty = false;
    for (let i = 0; i < pa.length; i += 1) {
      if (pa[i] !== basePositions[i]) {
        pa[i] = basePositions[i];
        dirty = true;
      }
      na[i] = baseNormals[i];
    }
    if (dirty) {
      pos.needsUpdate = true;
      nor.needsUpdate = true;
      geo.computeBoundingSphere();
    }
    return;
  }

  const k = bend / width;
  const half = width / 2;
  const count = pa.length / 3;
  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const x0 = basePositions[i3];
    const y0 = basePositions[i3 + 1];
    const z0 = basePositions[i3 + 2];
    const th = k * (x0 + half);
    const s = Math.sin(th);
    const c = Math.cos(th);
    pa[i3] = s / k - s * z0 - half;
    pa[i3 + 1] = y0;
    pa[i3 + 2] = (1 - c) / k + c * z0;

    const nx = baseNormals[i3];
    const ny = baseNormals[i3 + 1];
    const nz = baseNormals[i3 + 2];
    na[i3] = nx * c - nz * s;
    na[i3 + 1] = ny;
    na[i3 + 2] = nx * s + nz * c;
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
  geo.computeBoundingSphere();
}

const THREE_DYNAMIC = 35048; // THREE.DynamicDrawUsage
