// Turns any Object3D (procedural or glTF) into a cleanable item:
//  - bakes transforms, normalizes to a unit bounding sphere centred at the origin
//  - builds `maskUv` (non-overlapping atlas of the model's UV sets) for the cleaning mask
//  - rasterizes surface positions into the mask grid (for the 3D brush, dirt generation and progress)
//  - marks texels that cannot be seen from outside (hidden/inner surfaces) so they never block 100%
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { createDirtUniforms, patchMaterial, type DirtUniforms } from './dirtMaterial';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Mask / raster resolution (the mask is a 512² canvas texture). */
export const MASK = 512;
/** Low-res grid used for the progress %. */
export const LOW = 128;
const GRID_MIN = -1.05;
const GRID_CELL = 0.1;
const GRID_DIM = Math.ceil((2 * -GRID_MIN) / GRID_CELL);
export const GRID = { min: GRID_MIN, cell: GRID_CELL, dim: GRID_DIM };

export interface Raster {
  size: number;
  /** Item-space position per texel (xyz). */
  pos: Float32Array;
  /** 0 = empty, 1 = visible surface, 2 = hidden surface. */
  covered: Uint8Array;
  /** Spatial hash (CSR): texels per grid cell, for the 3D brush. */
  cellStart: Int32Array;
  cellItems: Int32Array;
  /** One representative texel per LOW² block (-1 = none), only visible ones count for progress. */
  low: Int32Array;
  /** Surface normal of each low-res representative (xyz), for "turn the dirty side to the player". */
  lowNrm: Float32Array;
  lowCount: number;
  /** Number of visible surface texels (progress is computed over all of them). */
  visibleCount: number;
}

export interface ItemTemplate {
  geos: { geo: THREE.BufferGeometry; mat: THREE.Material }[];
  raster: Raster;
  /** Largest bounding-box dimension in source units (metres for Poly Haven models). */
  sizeUnits: number;
  /** Bounding sphere radius in source units. */
  radiusUnits: number;
  /** Bounding box in normalized item space (for resting the item on the pedestal). */
  box: THREE.Box3;
}

export interface PreparedItem {
  root: THREE.Group;
  meshes: THREE.Mesh[];
  uniforms: DirtUniforms;
  raster: Raster;
  box: THREE.Box3;
}

function toFloat(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, itemSize: number): THREE.BufferAttribute {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) {
    out[i * itemSize] = attr.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attr.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attr.getZ(i);
    if (itemSize > 3) out[i * itemSize + 3] = attr.getW(i);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

/**
 * Heavy one-time preparation (cached per item type).
 * @param groupByTexture glTF: meshes sharing a texture share a UV space → one atlas cell per texture.
 *                       Procedural: every mesh has its own 0..1 UVs → one cell per mesh.
 */
export function prepareTemplate(src: THREE.Object3D, groupByTexture: boolean, renderer?: THREE.WebGLRenderer): ItemTemplate {
  src.updateMatrixWorld(true);
  const srcInv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const geo = m.geometry.clone();
    // dequantize (glTF meshopt/quantization) so transforms can be baked safely
    for (const name of ['position', 'normal', 'uv'] as const) {
      const a = geo.getAttribute(name);
      if (a) geo.setAttribute(name, toFloat(a as THREE.BufferAttribute, a.itemSize));
    }
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(srcInv, m.matrixWorld));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (!geo.getAttribute('uv')) sphericalUv(geo);
    if (mats.length > 1 && geo.groups.length) {
      for (const g of geo.groups) {
        const sub = geo.clone();
        sub.clearGroups();
        const idx = sub.getIndex();
        if (idx) sub.setIndex(Array.from(idx.array).slice(g.start, g.start + g.count));
        parts.push({ geo: sub, mat: mats[g.materialIndex ?? 0] });
      }
      geo.dispose();
    } else parts.push({ geo, mat: mats[0] });
  });

  // normalize: centre + unit bounding sphere
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox!);
  }
  const center = box.getCenter(new THREE.Vector3());
  const boxSize = box.getSize(new THREE.Vector3());
  const sizeUnits = Math.max(boxSize.x, boxSize.y, boxSize.z);
  let r = 0;
  const v = new THREE.Vector3();
  for (const p of parts) {
    const pos = p.geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) r = Math.max(r, v.fromBufferAttribute(pos, i).distanceTo(center));
  }
  const scale = 1 / (r || 1);
  const norm = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
  const nbox = new THREE.Box3();
  for (const p of parts) {
    p.geo.applyMatrix4(norm);
    p.geo.computeBoundingBox();
    p.geo.computeBoundingSphere();
    nbox.union(p.geo.boundingBox!);
  }

  // atlas cells
  const keyOf = (p: (typeof parts)[number], i: number) => {
    if (!groupByTexture) return `m${i}`;
    const s = p.mat as THREE.MeshStandardMaterial;
    return s.map?.uuid ?? s.normalMap?.uuid ?? p.mat.uuid;
  };
  const keys = [...new Set(parts.map(keyOf))];
  const cols = Math.ceil(Math.sqrt(keys.length));
  const rows = Math.ceil(keys.length / cols);
  // sparse UV usage (a piece of a set uses scattered bits of a shared texture) → repack its UV islands densely
  for (const key of keys) {
    const members = parts.filter((p, i) => keyOf(p, i) === key);
    if (uvCoverage(members.map((m) => m.geo)) < 0.3) repackIslands(members.map((m) => m.geo));
  }
  const pad = 0.01;
  // UV extent of each group: a piece of a set may use only a corner of the shared texture → stretch it to the cell
  const ext = keys.map(() => ({ u0: 1, v0: 1, u1: 0, v1: 0 }));
  parts.forEach((p, i) => {
    const e = ext[keys.indexOf(keyOf(p, i))];
    const uv = p.geo.getAttribute('uvPacked') ?? p.geo.getAttribute('uv');
    for (let j = 0; j < uv.count; j++) {
      const u = THREE.MathUtils.clamp(uv.getX(j), 0, 1);
      const w = THREE.MathUtils.clamp(uv.getY(j), 0, 1);
      e.u0 = Math.min(e.u0, u); e.u1 = Math.max(e.u1, u);
      e.v0 = Math.min(e.v0, w); e.v1 = Math.max(e.v1, w);
    }
  });
  parts.forEach((p, i) => {
    const k = keys.indexOf(keyOf(p, i));
    const cx = k % cols;
    const cy = Math.floor(k / cols);
    const e = ext[k];
    const su = 1 / Math.max(1e-4, e.u1 - e.u0);
    const sv = 1 / Math.max(1e-4, e.v1 - e.v0);
    const uv = p.geo.getAttribute('uvPacked') ?? p.geo.getAttribute('uv');
    const out = new Float32Array(uv.count * 2);
    for (let j = 0; j < uv.count; j++) {
      const u = (THREE.MathUtils.clamp(uv.getX(j), 0, 1) - e.u0) * su;
      const w = (THREE.MathUtils.clamp(uv.getY(j), 0, 1) - e.v0) * sv;
      out[j * 2] = (cx + pad + u * (1 - 2 * pad)) / cols;
      out[j * 2 + 1] = (cy + pad + w * (1 - 2 * pad)) / rows;
    }
    p.geo.setAttribute('maskUv', new THREE.BufferAttribute(out, 2));
    p.geo.deleteAttribute('uvPacked');
    p.geo.computeBoundsTree();
  });

  return { geos: parts, raster: buildRaster(parts, renderer), sizeUnits, radiusUnits: r, box: nbox };
}

/** Cheap per-item instance: fresh materials + uniforms over the cached geometry. */
export function instantiate(t: ItemTemplate): PreparedItem {
  const uniforms = createDirtUniforms();
  const root = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const matCache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  for (const p of t.geos) {
    let mat = matCache.get(p.mat);
    if (!mat) {
      mat = patchMaterial(p.mat, uniforms);
      matCache.set(p.mat, mat);
    }
    const mesh = new THREE.Mesh(p.geo, mat);
    mesh.castShadow = !mat.transparent;
    mesh.receiveShadow = true;
    mesh.renderOrder = mat.transparent ? 2 : 0;
    root.add(mesh);
    meshes.push(mesh);
  }
  return { root, meshes, uniforms, raster: t.raster, box: t.box };
}

/** Sum of triangle areas in UV space (1 = the whole unit square). */
function uvCoverage(geos: THREE.BufferGeometry[]): number {
  let area = 0;
  for (const g of geos) {
    const uv = g.getAttribute('uv');
    const idx = g.getIndex();
    const n = idx ? idx.count : uv.count;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      area += Math.abs((uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getX(c) - uv.getX(a)) * (uv.getY(b) - uv.getY(a))) / 2;
    }
  }
  return area;
}

/**
 * Finds UV islands (triangles connected through shared UV coordinates), scales them up uniformly and
 * shelf-packs them into the unit square. The result goes to a temporary `uvPacked` attribute used only to
 * build the mask atlas; the model's own `uv` (for its textures) is untouched.
 */
function repackIslands(geos: THREE.BufferGeometry[]) {
  // union-find over (geo, vertex) using quantized UV keys
  const offs: number[] = [];
  let total = 0;
  for (const g of geos) {
    offs.push(total);
    total += g.getAttribute('uv').count;
  }
  const parent = new Int32Array(total).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const byKey = new Map<string, number>();
  geos.forEach((g, gi) => {
    const uv = g.getAttribute('uv');
    const pos = g.getAttribute('position');
    for (let v = 0; v < uv.count; v++) {
      // same UV *and* same position = the same surface point split across vertices
      const k = `${Math.round(uv.getX(v) * 1e5)},${Math.round(uv.getY(v) * 1e5)},${Math.round(pos.getX(v) * 1e4)},${Math.round(pos.getY(v) * 1e4)},${Math.round(pos.getZ(v) * 1e4)}`;
      const prev = byKey.get(k);
      if (prev !== undefined) unite(prev, offs[gi] + v);
      else byKey.set(k, offs[gi] + v);
    }
    const idx = g.getIndex();
    const n = idx ? idx.count : uv.count;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      unite(offs[gi] + a, offs[gi] + b);
      unite(offs[gi] + a, offs[gi] + c);
    }
  });
  // island bounding boxes
  const isl = new Map<number, { u0: number; v0: number; u1: number; v1: number; x: number; y: number }>();
  geos.forEach((g, gi) => {
    const uv = g.getAttribute('uv');
    for (let v = 0; v < uv.count; v++) {
      const r = find(offs[gi] + v);
      let e = isl.get(r);
      if (!e) isl.set(r, (e = { u0: Infinity, v0: Infinity, u1: -Infinity, v1: -Infinity, x: 0, y: 0 }));
      e.u0 = Math.min(e.u0, uv.getX(v)); e.u1 = Math.max(e.u1, uv.getX(v));
      e.v0 = Math.min(e.v0, uv.getY(v)); e.v1 = Math.max(e.v1, uv.getY(v));
    }
  });
  const list = [...isl.values()];
  const area = list.reduce((a, e) => a + (e.u1 - e.u0) * (e.v1 - e.v0), 0) || 1;
  const gap = 3 / MASK;
  let scale = Math.sqrt(0.62 / area);
  list.sort((a, b) => b.v1 - b.v0 - (a.v1 - a.v0));
  // shelf packing; shrink until everything fits
  for (let attempt = 0; attempt < 30; attempt++) {
    let x = 0, y = 0, shelf = 0, ok = true;
    for (const e of list) {
      const w = (e.u1 - e.u0) * scale, h = (e.v1 - e.v0) * scale;
      if (x + w > 1) {
        x = 0;
        y += shelf + gap;
        shelf = 0;
      }
      if (y + h > 1 || w > 1) {
        ok = false;
        break;
      }
      e.x = x;
      e.y = y;
      x += w + gap;
      shelf = Math.max(shelf, h);
    }
    if (ok) break;
    scale *= 0.93;
  }
  geos.forEach((g, gi) => {
    const uv = g.getAttribute('uv');
    const out = new Float32Array(uv.count * 2);
    for (let v = 0; v < uv.count; v++) {
      const e = isl.get(find(offs[gi] + v))!;
      out[v * 2] = e.x + (uv.getX(v) - e.u0) * scale;
      out[v * 2 + 1] = e.y + (uv.getY(v) - e.v0) * scale;
    }
    g.setAttribute('uvPacked', new THREE.BufferAttribute(out, 2));
  });
}

function sphericalUv(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    uv[i * 2] = 0.5 + Math.atan2(v.z, v.x) / (2 * Math.PI);
    uv[i * 2 + 1] = 0.5 + Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) / Math.PI;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function isGlassMat(m: THREE.Material) {
  const s = m as THREE.MeshPhysicalMaterial;
  return (s.transmission ?? 0) > 0 || (m.transparent && m.opacity < 0.95) || /glass/i.test(m.name);
}

/** Rasterizes all triangles in maskUv space into MASK² texels with item-space positions and normals. */
function buildRaster(parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[], renderer?: THREE.WebGLRenderer): Raster {
  const S = MASK;
  const N = S * S;
  const pos = new Float32Array(N * 3);
  const nrm = new Float32Array(N * 3);
  const covered = new Uint8Array(N);
  for (const { geo: g } of parts) {
    const P = g.getAttribute('position');
    const Nn = g.getAttribute('normal');
    const U = g.getAttribute('maskUv');
    const idx = g.getIndex();
    const triCount = idx ? idx.count / 3 : P.count / 3;
    for (let t = 0; t < triCount; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const ax = U.getX(a) * S, ay = U.getY(a) * S;
      const bx = U.getX(b) * S, by = U.getY(b) * S;
      const cx = U.getX(c) * S, cy = U.getY(c) * S;
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy)));
      const write = (x: number, y: number, l1: number, l2: number, l3: number) => {
        const k = y * S + x;
        covered[k] = 1;
        pos[k * 3] = P.getX(a) * l1 + P.getX(b) * l2 + P.getX(c) * l3;
        pos[k * 3 + 1] = P.getY(a) * l1 + P.getY(b) * l2 + P.getY(c) * l3;
        pos[k * 3 + 2] = P.getZ(a) * l1 + P.getZ(b) * l2 + P.getZ(c) * l3;
        nrm[k * 3] = Nn.getX(a) * l1 + Nn.getX(b) * l2 + Nn.getX(c) * l3;
        nrm[k * 3 + 1] = Nn.getY(a) * l1 + Nn.getY(b) * l2 + Nn.getY(c) * l3;
        nrm[k * 3 + 2] = Nn.getZ(a) * l1 + Nn.getZ(b) * l2 + Nn.getZ(c) * l3;
      };
      let wrote = false;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
          const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -0.002 || l2 < -0.002 || l3 < -0.002) continue;
          write(x, y, l1, l2, l3);
          wrote = true;
        }
      }
      if (!wrote) {
        // triangle smaller than a texel: mark the texel under its centroid
        const x = Math.min(S - 1, Math.max(0, Math.floor((ax + bx + cx) / 3)));
        const y = Math.min(S - 1, Math.max(0, Math.floor((ay + by + cy) / 3)));
        if (!covered[y * S + x]) write(x, y, 1 / 3, 1 / 3, 1 / 3);
      }
    }
  }

  // visibility: which texels can be seen from outside (GPU id-render from many directions)
  const visible = renderer ? gpuVisibility(parts, renderer) : covered.slice();
  for (let k = 0; k < N; k++) if (covered[k] && !visible[k]) covered[k] = 2;

  // low-res representatives (first visible texel per LOW² block) + their normals
  const B = S / LOW;
  const low = new Int32Array(LOW * LOW).fill(-1);
  const lowNrm = new Float32Array(LOW * LOW * 3);
  let lowCount = 0;
  for (let by = 0; by < LOW; by++) {
    for (let bx = 0; bx < LOW; bx++) {
      let rep = -1;
      for (let yy = 0; yy < B && rep < 0; yy++) for (let xx = 0; xx < B && rep < 0; xx++) {
        const k = (by * B + yy) * S + bx * B + xx;
        if (covered[k] === 1) rep = k;
      }
      if (rep < 0) continue;
      const b = by * LOW + bx;
      low[b] = rep;
      lowCount++;
      const l = Math.hypot(nrm[rep * 3], nrm[rep * 3 + 1], nrm[rep * 3 + 2]) || 1;
      lowNrm[b * 3] = nrm[rep * 3] / l;
      lowNrm[b * 3 + 1] = nrm[rep * 3 + 1] / l;
      lowNrm[b * 3 + 2] = nrm[rep * 3 + 2] / l;
    }
  }
  let visibleCount = 0;
  for (let k = 0; k < N; k++) if (covered[k] === 1) visibleCount++;

  // spatial hash for the brush
  const cells = GRID_DIM * GRID_DIM * GRID_DIM;
  const count = new Int32Array(cells + 1);
  const cellOf = (k: number) => {
    const cx = Math.min(GRID_DIM - 1, Math.max(0, Math.floor((pos[k * 3] - GRID_MIN) / GRID_CELL)));
    const cy = Math.min(GRID_DIM - 1, Math.max(0, Math.floor((pos[k * 3 + 1] - GRID_MIN) / GRID_CELL)));
    const cz = Math.min(GRID_DIM - 1, Math.max(0, Math.floor((pos[k * 3 + 2] - GRID_MIN) / GRID_CELL)));
    return (cz * GRID_DIM + cy) * GRID_DIM + cx;
  };
  let total = 0;
  for (let k = 0; k < N; k++) if (covered[k]) {
    count[cellOf(k) + 1]++;
    total++;
  }
  for (let i = 0; i < cells; i++) count[i + 1] += count[i];
  const cellStart = count.slice();
  const fill = count.slice(0, cells);
  const cellItems = new Int32Array(total);
  for (let k = 0; k < N; k++) if (covered[k]) cellItems[fill[cellOf(k)]++] = k;
  return { size: S, pos, covered, cellStart, cellItems, low, lowNrm, lowCount, visibleCount };
}

/**
 * Renders the item from 40 directions with a shader that writes the mask texel index of every pixel.
 * A texel is visible if it shows up in any view. Glass is see-through: a second pass without it.
 * Result is dilated by 2 texels in mask space to cover sampling gaps.
 */
function gpuVisibility(parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[], renderer: THREE.WebGLRenderer): Uint8Array {
  const S = MASK;
  const RES = 256;
  const vis = new Uint8Array(S * S);
  const rt = new THREE.WebGLRenderTarget(RES, RES, { depthBuffer: true });
  const idMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    toneMapped: false,
    vertexShader: 'attribute vec2 maskUv; varying vec2 vUv; void main() { vUv = maskUv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec2 vUv;
      void main() {
        vec2 t = floor(clamp(vUv, 0.0, 0.99999) * ${S}.0);
        gl_FragColor = vec4(mod(t.x, 256.0) / 255.0, mod(t.y, 256.0) / 255.0, (floor(t.x / 256.0) + 2.0 * floor(t.y / 256.0) + 1.0) / 255.0, 1.0);
      }`,
  });
  const all = new THREE.Scene();
  const opaque = new THREE.Scene();
  let hasGlass = false;
  for (const p of parts) {
    all.add(new THREE.Mesh(p.geo, idMat));
    if (isGlassMat(p.mat)) hasGlass = true;
    else opaque.add(new THREE.Mesh(p.geo, idMat));
  }
  const cam = new THREE.OrthographicCamera(-1.05, 1.05, 1.05, -1.05, 0.1, 10);
  const buf = new Uint8Array(RES * RES * 4);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 0);
  const n = 40;
  for (let i = 0; i < n; i++) {
    // fibonacci sphere directions
    const y = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    const dir = new THREE.Vector3(Math.cos(phi) * rr, y, Math.sin(phi) * rr);
    cam.position.copy(dir).multiplyScalar(3);
    cam.up.set(0, Math.abs(y) > 0.95 ? 0 : 1, Math.abs(y) > 0.95 ? 1 : 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    for (const scene of hasGlass ? [all, opaque] : [all]) {
      renderer.setRenderTarget(rt);
      renderer.clear(true, true, false);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, RES, RES, buf);
      for (let p = 0; p < RES * RES; p++) {
        const b = buf[p * 4 + 2];
        if (!b) continue;
        const hi = b - 1;
        const x = buf[p * 4] + 256 * (hi & 1);
        const yy = buf[p * 4 + 1] + 256 * ((hi >> 1) & 1);
        vis[yy * S + x] = 1;
      }
    }
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.shadowMap.autoUpdate = prevShadow;
  rt.dispose();
  idMat.dispose();
  // dilate 2 texels (sampling gaps between view pixels)
  for (let it = 0; it < 2; it++) {
    const src = vis.slice();
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const k = y * S + x;
      if (!src[k] && (src[k - 1] || src[k + 1] || src[k - S] || src[k + S])) vis[k] = 1;
    }
  }
  return vis;
}

// ---------- dirt generation (per item instance) ----------

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}
function fbm(x: number, y: number, z: number): number {
  return noise3(x, y, z) * 0.55 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.15;
}

export interface DirtMap {
  texture: THREE.DataTexture;
  /** Rust amount per mask texel (0..1). */
  rust: Float32Array;
}

/** Dust over the whole surface and rust on `rustShare` of it (exact share via quantile). */
export function makeDirt(raster: Raster, rustShare: number, seed: number): DirtMap {
  const S = raster.size;
  const N = S * S;
  const so = (seed % 1000) * 0.37;
  const rustAt = (k: number) => fbm(raster.pos[k * 3] * 2.4 + so, raster.pos[k * 3 + 1] * 2.4 + 7.1, raster.pos[k * 3 + 2] * 2.4 - so);
  // threshold from the low-res sample (fast, statistically the same)
  const vals: number[] = [];
  for (let i = 0; i < raster.low.length; i++) if (raster.low[i] >= 0) vals.push(rustAt(raster.low[i]));
  vals.sort((a, b) => a - b);
  const th = rustShare > 0 && vals.length ? vals[Math.floor(vals.length * (1 - Math.min(rustShare, 0.98)))] : Infinity;
  const rust = new Float32Array(N);
  const data = new Uint8Array(N * 4);
  for (let k = 0; k < N; k++) {
    if (!raster.covered[k]) continue;
    data[k * 4 + 3] = 255;
    // hidden surfaces get dirt too (looks right if the ray test was conservative); they are only excluded from progress
    const r = rustShare > 0 ? THREE.MathUtils.smoothstep(rustAt(k), th - 0.015, th + 0.05) : 0;
    rust[k] = r;
    const dust = 0.82 + 0.18 * fbm(raster.pos[k * 3] * 5 - so, raster.pos[k * 3 + 1] * 5, raster.pos[k * 3 + 2] * 5 + 3);
    data[k * 4] = Math.round(dust * 255);
    data[k * 4 + 1] = Math.round(r * 255);
    data[k * 4 + 2] = 255;
  }
  dilate(data, S, 2);
  const texture = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, rust };
}

/** Grows covered texels into empty neighbours so bilinear sampling near UV seams stays consistent. */
function dilate(data: Uint8Array, S: number, iterations: number) {
  for (let it = 0; it < iterations; it++) {
    const src = data.slice();
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const k = (y * S + x) * 4;
        if (src[k + 3]) continue;
        let n = 0, r = 0, g = 0;
        if (x > 0 && src[k - 1]) { n++; r += src[k - 4]; g += src[k - 3]; }
        if (x < S - 1 && src[k + 7]) { n++; r += src[k + 4]; g += src[k + 5]; }
        if (y > 0 && src[k - S * 4 + 3]) { n++; r += src[k - S * 4]; g += src[k - S * 4 + 1]; }
        if (y < S - 1 && src[k + S * 4 + 3]) { n++; r += src[k + S * 4]; g += src[k + S * 4 + 1]; }
        if (n) {
          data[k] = r / n;
          data[k + 1] = g / n;
          data[k + 3] = 255;
        }
      }
    }
  }
}
