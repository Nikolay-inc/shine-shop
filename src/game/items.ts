// Builds cleanable items: glTF from public/models (if listed in manifest.json) or procedural fallback.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ItemDef } from '../core';
import { buildProcedural } from './procedural';
import { instantiate, prepareTemplate, type ItemTemplate, type PreparedItem } from './itemPrep';

interface Manifest {
  models: Record<string, { file: string; polyhaven?: string; url?: string }>;
}

export class ItemFactory {
  private manifest: Manifest['models'] = {};
  private cache = new Map<string, Promise<THREE.Object3D | null>>();
  private templates = new Map<string, ItemTemplate>();
  private sizes = new Map<string, { sizeCm: number; radiusCm: number }>();
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private base = import.meta.env.BASE_URL;
  private renderer?: THREE.WebGLRenderer;

  /** The renderer is used once per item type to find which surfaces are visible from outside. */
  setRenderer(r: THREE.WebGLRenderer) {
    this.renderer = r;
  }

  async init(): Promise<void> {
    try {
      const res = await fetch(`${this.base}models/manifest.json`, { cache: 'no-cache' });
      if (res.ok) this.manifest = ((await res.json()) as Manifest).models ?? {};
    } catch {
      this.manifest = {};
    }
  }

  get modelKeys(): string[] {
    return Object.keys(this.manifest);
  }

  hasModel(def: ItemDef): boolean {
    return !!def.model && !!this.manifest[def.model];
  }

  /** Starts loading a model in the background (no-op for procedural items). */
  preload(def: ItemDef) {
    if (this.hasModel(def)) void this.load(def.model!);
  }

  private load(key: string): Promise<THREE.Object3D | null> {
    let p = this.cache.get(key);
    if (!p) {
      p = this.loader
        .loadAsync(`${this.base}models/${this.manifest[key].file}`)
        .then((g) => g.scene)
        .catch((e) => {
          console.warn(`model ${key} failed, using procedural for now`, e);
          this.cache.delete(key); // retry next time instead of sticking to the fallback
          return null;
        });
      this.cache.set(key, p);
    }
    return p;
  }

  /**
   * Geometry, mask atlas and surface raster are prepared once per item type and cached.
   * Returns the item plus its real size in cm (from the model, metres → cm; fallback: config).
   */
  async build(def: ItemDef): Promise<{ item: PreparedItem; sizeCm: number; radiusCm: number }> {
    let t = this.templates.get(def.id);
    const sizeCm = def.sizeCm;
    if (!t) {
      const loaded = this.hasModel(def) ? await this.load(def.model!) : null;
      const src = loaded && def.nodes ? pickNodes(loaded, def.nodes) : loaded;
      t = src ? prepareTemplate(src, true, this.renderer) : prepareTemplate(buildProcedural(def.shape, def.look), false, this.renderer);
      // cache only the intended look: a fallback after a failed download must not stick
      if (src || !this.hasModel(def)) this.templates.set(def.id, t);
      // Poly Haven models are real-world scale (metres); the procedural fallback uses the config size
      const cm = src ? t.sizeUnits * 100 : def.sizeCm;
      this.sizes.set(def.id, { sizeCm: Math.max(1, Math.round(cm)), radiusCm: (cm * t.radiusUnits) / (t.sizeUnits || 1) });
    }
    const sz = this.sizes.get(def.id) ?? { sizeCm, radiusCm: sizeCm * 0.6 };
    return { item: instantiate(t), ...sz };
  }
}

/** One piece of a set (e.g. the teapot + its lid from the tea set), keeping world transforms. */
function pickNodes(scene: THREE.Object3D, names: string[]): THREE.Object3D | null {
  scene.updateMatrixWorld(true);
  const g = new THREE.Group();
  for (const name of names) {
    const o = scene.getObjectByName(name);
    if (!o) continue;
    const c = o.clone(true);
    c.matrixAutoUpdate = false;
    c.matrix.copy(o.matrixWorld);
    g.add(c);
  }
  return g.children.length ? g : null;
}
