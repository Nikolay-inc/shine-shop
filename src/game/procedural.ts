// Procedural fallback items (work without any downloaded models).
// Every part keeps its own 0..1 UVs; prepareItem() packs parts into one mask atlas.
import * as THREE from 'three';
import type { ItemDef, ItemShape } from '../core';

type Look = ItemDef['look'];

const LOOKS: Record<Look, { color: number; metalness: number; roughness: number }> = {
  brass: { color: 0xd4a84f, metalness: 1, roughness: 0.28 },
  copper: { color: 0xd08254, metalness: 1, roughness: 0.3 },
  silver: { color: 0xdedfe2, metalness: 1, roughness: 0.22 },
  iron: { color: 0x9a9da3, metalness: 0.95, roughness: 0.38 },
  ceramic: { color: 0xf1e9dc, metalness: 0, roughness: 0.22 },
  clay: { color: 0xc06a3e, metalness: 0, roughness: 0.62 },
  porcelain: { color: 0xf7f5f1, metalness: 0, roughness: 0.12 },
};

export function lookMaterial(look: Look, overrides: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const l = LOOKS[look];
  return new THREE.MeshStandardMaterial({ color: l.color, metalness: l.metalness, roughness: l.roughness, ...overrides });
}

/** Decorative band texture (blue pattern for porcelain / white glaze stripes for clay). */
function bandTexture(kind: 'porcelain' | 'clay' | 'ceramic'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = kind === 'clay' ? '#c06a3e' : kind === 'ceramic' ? '#f1e9dc' : '#f7f5f1';
  g.fillRect(0, 0, 256, 256);
  if (kind === 'porcelain') {
    g.fillStyle = '#2f5fa8';
    g.fillRect(0, 70, 256, 6);
    g.fillRect(0, 180, 256, 4);
    for (let i = 0; i < 8; i++) {
      const x = i * 32 + 16;
      g.beginPath();
      g.ellipse(x, 125, 9, 20, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(x + 16, 125, 4, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === 'clay') {
    g.strokeStyle = '#f0dcc0';
    g.lineWidth = 5;
    for (const y of [90, 110, 170]) {
      g.beginPath();
      for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin(x / 20) * 6);
      g.stroke();
    }
  } else {
    g.fillStyle = '#7b9cc4';
    g.fillRect(0, 40, 256, 10);
    g.fillRect(0, 200, 256, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const V = (x: number, y: number) => new THREE.Vector2(x, y);

function lathe(points: THREE.Vector2[], seg = 48) {
  return new THREE.LatheGeometry(points, seg);
}

/** BoxGeometry has 6 overlapping 0..1 faces — spread them on a 3×2 grid. */
function boxGeo(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    const col = f % 3;
    const row = Math.floor(f / 3);
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (col + 0.04 + uv.getX(i) * 0.92) / 3, (row + 0.04 + uv.getY(i) * 0.92) / 2);
    }
  }
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos?: [number, number, number], rot?: [number, number, number]) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  return m;
}

/** Profile for a closed disc-like solid of radius r and thickness t, with a rim. */
function discProfile(r: number, t: number, rim = 0.06) {
  return [V(0, -t / 2), V(r * 0.97, -t / 2), V(r, -t / 2 + t * 0.2), V(r, t / 2 - t * 0.2), V(r * 0.97, t / 2), V(r * (1 - rim), t / 2), V(r * (1 - rim) - 0.01, t / 2 - t * 0.15), V(0, t / 2 - t * 0.15)];
}

export function buildProcedural(shape: ItemShape, look: Look): THREE.Group {
  const g = new THREE.Group();
  const mat = lookMaterial(look);
  switch (shape) {
    case 'coin': {
      const body = mesh(lathe(discProfile(1, 0.16, 0.12), 64), mat);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      // embossed relief: a ring and a star on the face
      const ring = mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 64), mat, [0, 0, 0.06]);
      g.add(ring);
      const star = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
        const r = i % 2 ? 0.18 : 0.42;
        if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const sg = new THREE.ShapeGeometry(star);
      normalizeUv(sg);
      g.add(mesh(sg, mat, [0, 0, 0.078]));
      break;
    }
    case 'key': {
      g.add(mesh(new THREE.TorusGeometry(0.32, 0.09, 16, 48), mat, [0, 0.62, 0]));
      g.add(mesh(lathe([V(0, -0.75), V(0.07, -0.75), V(0.07, 0.25), V(0.11, 0.28), V(0.11, 0.34), V(0, 0.34)], 24), mat, [0, -0.05, 0]));
      g.add(mesh(boxGeo(0.34, 0.1, 0.07), mat, [0.17, -0.68, 0]));
      g.add(mesh(boxGeo(0.22, 0.09, 0.07), mat, [0.12, -0.5, 0]));
      break;
    }
    case 'cup': {
      const m = lookMaterial(look, { map: bandTexture('porcelain'), color: 0xffffff });
      g.add(mesh(lathe([V(0, -0.5), V(0.36, -0.5), V(0.4, -0.45), V(0.38, -0.4), V(0.55, -0.25), V(0.66, 0.2), V(0.7, 0.5), V(0.64, 0.5), V(0.6, 0.2), V(0.5, -0.24), V(0, -0.3)]), m));
      g.add(mesh(new THREE.TorusGeometry(0.22, 0.05, 12, 32, Math.PI * 1.3), m, [0.7, 0.05, 0], [0, 0, -Math.PI * 0.65]));
      g.add(mesh(lathe([V(0, -0.04), V(0.95, -0.03), V(1.0, 0.02), V(0.9, 0.03), V(0, 0.0)]), m, [0, -0.54, 0]));
      break;
    }
    case 'vase': {
      g.add(mesh(lathe([V(0, -1), V(0.38, -1), V(0.42, -0.92), V(0.3, -0.8), V(0.55, -0.4), V(0.62, 0), V(0.5, 0.35), V(0.24, 0.6), V(0.2, 0.8), V(0.32, 0.98), V(0.28, 1.0), V(0.16, 0.8), V(0.18, 0.6), V(0, 0.55)], 56), mat));
      break;
    }
    case 'jug': {
      const m = lookMaterial(look, { map: bandTexture(look === 'clay' ? 'clay' : 'ceramic'), color: 0xffffff });
      g.add(mesh(lathe([V(0, -0.9), V(0.45, -0.9), V(0.6, -0.6), V(0.66, -0.2), V(0.55, 0.25), V(0.35, 0.55), V(0.38, 0.85), V(0.42, 0.9), V(0.36, 0.9), V(0.3, 0.6), V(0, 0.5)], 56), m));
      g.add(mesh(new THREE.TorusGeometry(0.4, 0.07, 12, 32, Math.PI * 1.1), m, [-0.55, 0.25, 0], [0, 0, Math.PI * 0.45]));
      g.add(mesh(lathe([V(0, 0), V(0.12, 0), V(0.05, 0.28), V(0, 0.28)], 16), m, [0.42, 0.78, 0], [0, 0, -0.9]));
      break;
    }
    case 'wrench': {
      g.add(mesh(boxGeo(0.22, 1.5, 0.1), mat, [0, -0.25, 0]));
      g.add(mesh(new THREE.TorusGeometry(0.28, 0.1, 12, 32, Math.PI * 1.4), mat, [0, 0.72, 0], [0, 0, -Math.PI * 0.2]));
      g.add(mesh(lathe([V(0, -0.1), V(0.09, -0.1), V(0.09, 0.1), V(0, 0.1)], 20), mat, [0.12, 0.25, 0], [0, 0, Math.PI / 2]));
      break;
    }
    case 'kettle': {
      g.add(mesh(lathe([V(0, -0.65), V(0.62, -0.65), V(0.78, -0.35), V(0.8, 0), V(0.65, 0.3), V(0.35, 0.42), V(0, 0.42)], 56), mat));
      g.add(mesh(lathe([V(0, 0.42), V(0.32, 0.42), V(0.25, 0.55), V(0.06, 0.6), V(0.06, 0.7), V(0.1, 0.75), V(0, 0.8)], 32), mat));
      g.add(mesh(new THREE.TorusGeometry(0.5, 0.05, 10, 40, Math.PI), mat, [0, 0.42, 0]));
      g.add(mesh(lathe([V(0, 0), V(0.14, 0), V(0.05, 0.6), V(0.06, 0.62), V(0, 0.62)], 20), mat, [0.68, -0.15, 0], [0, 0, -1.0]));
      break;
    }
    case 'lantern': {
      g.add(mesh(lathe([V(0, -1), V(0.55, -1), V(0.55, -0.85), V(0.45, -0.8), V(0, -0.8)], 40), mat));
      const glass = new THREE.MeshStandardMaterial({ color: 0xfff2d6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false });
      g.add(mesh(lathe([V(0, -0.8), V(0.36, -0.8), V(0.42, -0.2), V(0.36, 0.45), V(0, 0.45)], 40), glass));
      g.add(mesh(lathe([V(0, 0.45), V(0.5, 0.45), V(0.5, 0.55), V(0.18, 0.8), V(0, 0.85)], 40), mat));
      g.add(mesh(new THREE.TorusGeometry(0.22, 0.04, 10, 32), mat, [0, 1.02, 0]));
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        g.add(mesh(boxGeo(0.05, 1.28, 0.05), mat, [Math.cos(a) * 0.45, -0.18, Math.sin(a) * 0.45]));
      }
      break;
    }
    case 'watch': {
      const body = mesh(lathe(discProfile(0.85, 0.28, 0.1), 64), mat);
      body.rotation.x = Math.PI / 2;
      g.add(body);
      const face = new THREE.MeshStandardMaterial({ color: 0xf6efe0, roughness: 0.35 });
      const dial = new THREE.CircleGeometry(0.7, 48);
      normalizeUv(dial);
      g.add(mesh(dial, face, [0, 0, 0.1]));
      g.add(mesh(boxGeo(0.04, 0.45, 0.02), mat, [0, 0.18, 0.115]));
      g.add(mesh(boxGeo(0.32, 0.04, 0.02), mat, [0.13, 0, 0.12]));
      g.add(mesh(lathe([V(0, 0), V(0.1, 0), V(0.1, 0.16), V(0, 0.16)], 20), mat, [0, 0.85, 0]));
      g.add(mesh(new THREE.TorusGeometry(0.16, 0.04, 10, 32), mat, [0, 1.12, 0]));
      break;
    }
    case 'camera': {
      g.add(mesh(boxGeo(1.6, 1.0, 0.6), mat));
      const black = new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.55, metalness: 0.2 });
      g.add(mesh(lathe([V(0, 0), V(0.38, 0), V(0.38, 0.25), V(0.32, 0.3), V(0.32, 0.5), V(0.2, 0.5), V(0, 0.45)], 40), black, [0.1, -0.05, 0.3], [Math.PI / 2, 0, 0]));
      g.add(mesh(boxGeo(0.4, 0.22, 0.3), mat, [-0.45, 0.6, 0]));
      g.add(mesh(lathe([V(0, 0), V(0.1, 0), V(0.1, 0.1), V(0, 0.12)], 16), black, [0.55, 0.5, 0]));
      break;
    }
  }
  return g;
}

/** ShapeGeometry / CircleGeometry UVs follow the shape coordinates; remap to 0..1. */
function normalizeUv(geo: THREE.BufferGeometry) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    minX = Math.min(minX, uv.getX(i));
    maxX = Math.max(maxX, uv.getX(i));
    minY = Math.min(minY, uv.getY(i));
    maxY = Math.max(maxY, uv.getY(i));
  }
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - minX) / (maxX - minX || 1), (uv.getY(i) - minY) / (maxY - minY || 1));
}
