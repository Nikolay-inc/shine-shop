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
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private base = import.meta.env.BASE_URL;

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
          console.warn(`model ${key} failed, using procedural`, e);
          return null;
        });
      this.cache.set(key, p);
    }
    return p;
  }

  /** Geometry, mask atlas and surface raster are prepared once per item type and cached. */
  async build(def: ItemDef): Promise<PreparedItem> {
    let t = this.templates.get(def.id);
    if (!t) {
      const src = this.hasModel(def) ? await this.load(def.model!) : null;
      t = src ? prepareTemplate(src, true) : prepareTemplate(buildProcedural(def.shape, def.look), false);
      this.templates.set(def.id, t);
    }
    return instantiate(t);
  }
}
