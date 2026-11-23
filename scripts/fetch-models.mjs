// Downloads CC0 models from Poly Haven (public API), compresses them
// (meshopt geometry + WebP 1k textures) into public/models/*.glb and writes
// public/models/manifest.json. Usage: npm run models
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache', 'polyhaven');
const OUT = path.join(ROOT, 'public', 'models');

// key -> Poly Haven asset id (keys are referenced by `model` in src/core/config.ts).
// Sets (tea set, goblets) are one file; config picks a node from it.
export const MODELS = {
  watch: 'pocket_watch',
  compass: 'seadogs_compass',
  magnifier: 'magnifying_glass_01',
  elephant: 'carved_wooden_elephant',
  teaset: 'tea_set_01',
  pliers: 'pliers',
  brassvase: 'brass_vase_04',
  hammer: 'cross_pein_hammer',
  goblets: 'brass_goblets',
  jug: 'jug_01',
  oilcan: 'small_oil_can_01',
  wrench: 'adjustable_wrench',
  binocular: 'vintage_binocular',
  metaljug: 'metal_jug',
  kettle: 'brass_pot_02',
  horse: 'horse_statue_01',
  vase: 'antique_ceramic_vase_01',
  lantern: 'Lantern_01',
  camera: 'Camera_01',
  drill: 'vintage_hand_drill',
  microscope: 'vintage_microscope',
  mantelclock: 'mantel_clock_01',
  oillamp: 'vintage_oil_lamp',
  chest: 'treasure_chest',
};
/** Sets whose pieces are picked by node name: keep nodes separate (no join/flatten). */
const KEEP_NODES = new Set(['teaset', 'goblets']);
/** Target triangle budget per model (mobile-friendly). */
const MAX_POLYS = 15000;

const UA = { 'User-Agent': 'shine-shop-prototype-model-fetcher' };

async function download(url, dest) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

await mkdir(OUT, { recursive: true });
const manifest = { source: 'https://polyhaven.com (CC0)', models: {} };
const bin = path.join(ROOT, 'node_modules', '.bin', 'gltf-transform');

for (const [key, id] of Object.entries(MODELS)) {
  const out = path.join(OUT, `${key}.glb`);
  if (!existsSync(out)) {
    const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: UA })).json();
    const info = await (await fetch(`https://api.polyhaven.com/info/${id}`, { headers: UA })).json();
    const ratio = Math.min(1, MAX_POLYS / (info.polycount || MAX_POLYS)).toFixed(3);
    const g = files.gltf['1k'].gltf;
    const dir = path.join(CACHE, id); // each download in its own folder
    await rm(dir, { recursive: true, force: true });
    const main = path.join(dir, path.basename(new URL(g.url).pathname));
    await download(g.url, main);
    for (const [rel, f] of Object.entries(g.include)) await download(f.url, path.join(dir, rel));
    const keep = KEEP_NODES.has(key) ? ['--join', 'false', '--flatten', 'false'] : [];
    execFileSync(bin, ['optimize', main, out, ...keep,
      '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
      '--simplify-ratio', ratio, '--simplify-error', '0.001'], { stdio: 'ignore' });
  }
  const size = (await stat(out)).size;
  const meta = await (await fetch(`https://api.polyhaven.com/info/${id}`, { headers: UA })).json();
  // real-world size in cm (Poly Haven dimensions are millimetres)
  const dims = (meta.dimensions ?? []).map((v) => Math.round(v / 10));
  manifest.models[key] = { file: `${key}.glb`, polyhaven: id, url: `https://polyhaven.com/a/${id}`, bytes: size, dimsCm: dims };
  console.log(`${key.padEnd(8)} ${id.padEnd(20)} ${(size / 1024).toFixed(0)} KB`);
}
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest written');
