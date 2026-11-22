// Cleaning mask: a 512² canvas texture (R = dust removed, G = rust removed) sampled by the dirt shader.
// The brush is 3D: every surface texel within the tool radius of the touched point gets cleaned, so UV seams,
// fragmented UV islands and nooks next to the touched surface behave naturally on any model.
// Progress % is computed on a 128² low-res grid of the mask.
import * as THREE from 'three';
import { GRID, type Raster } from './itemPrep';

export class Cleaner {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private dust = new Float32Array(0);
  private rustC = new Float32Array(0);
  private raster: Raster | null = null;
  private rust: Float32Array | null = null;
  private dirty = false;
  progress = 0;

  constructor(readonly size = 512) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(size, size);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.flipY = false; // canvas row y ↔ mask v (same layout as the raster)
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
  }

  reset(raster: Raster, rust: Float32Array) {
    this.raster = raster;
    this.rust = rust;
    const N = this.size * this.size;
    this.dust = new Float32Array(N);
    this.rustC = new Float32Array(N);
    const d = this.img.data;
    for (let i = 0; i < N; i++) {
      d[i * 4] = 0;
      d[i * 4 + 1] = 0;
      d[i * 4 + 2] = 0;
      d[i * 4 + 3] = 255;
    }
    this.progress = 0;
    this.dirty = true;
    this.flush();
  }

  /** One brush dab at item-space point (x, y, z): removes `dust` / `rust` (0..1) at the centre. Hot path — no closures. */
  dab(x: number, y: number, z: number, radius: number, dust: number, rust: number) {
    const r = this.raster;
    if (!r) return;
    const D = this.dust, G = this.rustC, img = this.img.data, pos = r.pos, start = r.cellStart, items = r.cellItems;
    const { min, cell, dim } = GRID;
    const lo = (v: number) => Math.min(dim - 1, Math.max(0, Math.floor((v - radius - min) / cell)));
    const hi = (v: number) => Math.min(dim - 1, Math.max(0, Math.floor((v + radius - min) / cell)));
    const r2 = radius * radius;
    const x0 = lo(x), x1 = hi(x), y0 = lo(y), y1 = hi(y), z0 = lo(z), z1 = hi(z);
    for (let cz = z0; cz <= z1; cz++) for (let cy = y0; cy <= y1; cy++) {
      const row = (cz * dim + cy) * dim;
      const end = start[row + x1 + 1];
      for (let i = start[row + x0]; i < end; i++) {
        const k = items[i];
        const k3 = k * 3;
        const dx = pos[k3] - x, dy = pos[k3 + 1] - y, dz = pos[k3 + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r2) continue;
        const t = 1 - d2 / r2;
        const f = t < 0.5 ? t * 2 : 1; // soft edge, flat centre
        const nd = D[k] + dust * f;
        const ng = G[k] + rust * f;
        D[k] = nd > 1 ? 1 : nd;
        G[k] = ng > 1 ? 1 : ng;
        img[k * 4] = (D[k] * 255) | 0;
        img[k * 4 + 1] = (G[k] * 255) | 0;
      }
    }
    this.dirty = true;
  }

  /** Adds `amount` everywhere (auto-finish sweep). */
  fillAll(amount: number) {
    const D = this.dust, G = this.rustC, img = this.img.data;
    for (let k = 0; k < D.length; k++) {
      D[k] = Math.min(1, D[k] + amount);
      G[k] = Math.min(1, G[k] + amount);
      img[k * 4] = (D[k] * 255) | 0;
      img[k * 4 + 1] = (G[k] * 255) | 0;
    }
    this.dirty = true;
  }

  /** Copies the mask into the canvas and uploads it, once per frame at most. */
  flush() {
    if (!this.dirty) return;
    this.ctx.putImageData(this.img, 0, 0);
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  /** Item-space direction (unit) towards the largest remaining dirty area, or null if clean. */
  dirtiestDirection(): THREE.Vector3 | null {
    const r = this.raster;
    const rust = this.rust;
    if (!r || !rust) return null;
    const dirs: THREE.Vector3[] = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) dirs.push(new THREE.Vector3(x, y, z).normalize());
    const score = new Float32Array(dirs.length);
    const p = new THREE.Vector3();
    for (let i = 0; i < r.low.length; i++) {
      const k = r.low[i];
      if (k < 0) continue;
      const dirt = 1 - Math.min(1, this.dust[k] / 0.8) * (1 - rust[k] * (1 - Math.min(1, this.rustC[k] / 0.8)));
      if (dirt < 0.05) continue;
      p.set(r.lowNrm[i * 3], r.lowNrm[i * 3 + 1], r.lowNrm[i * 3 + 2]);
      for (let j = 0; j < dirs.length; j++) if (p.dot(dirs[j]) > 0.5) score[j] += dirt;
    }
    let best = -1;
    for (let j = 0; j < dirs.length; j++) if (score[j] > 0 && (best < 0 || score[j] > score[best])) best = j;
    return best < 0 ? null : dirs[best];
  }

  /** Cleanliness 0..1 over the visible surface, sampled on the 128² low-res grid. */
  computeProgress(): number {
    const r = this.raster;
    const rust = this.rust;
    if (!r || !rust || !r.lowCount) return 0;
    let sum = 0;
    for (let i = 0; i < r.low.length; i++) {
      const k = r.low[i];
      if (k < 0) continue;
      const dustC = Math.min(1, this.dust[k] / 0.8);
      const rustC = Math.min(1, this.rustC[k] / 0.8);
      sum += dustC * (1 - rust[k] * (1 - rustC));
    }
    this.progress = sum / r.lowCount;
    return this.progress;
  }
}
