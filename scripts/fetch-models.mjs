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

// key -> Poly Haven asset id (key must match an item in src/core/config.ts)
export const MODELS = {
  wrench: 'adjustable_wrench',
  jug: 'jug_01',
  kettle: 'brass_pot_02',
  lantern: 'Lantern_01',
  watch: 'pocket_watch',
  camera: 'Camera_01',
};

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
    const g = files.gltf['1k'].gltf;
    const dir = path.join(CACHE, id); // each download in its own folder
    await rm(dir, { recursive: true, force: true });
    const main = path.join(dir, path.basename(new URL(g.url).pathname));
    await download(g.url, main);
    for (const [rel, f] of Object.entries(g.include)) await download(f.url, path.join(dir, rel));
    execFileSync(bin, ['optimize', main, out,
      '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
      '--simplify-ratio', '0.5', '--simplify-error', '0.002'], { stdio: 'inherit' });
  }
  const size = (await stat(out)).size;
  manifest.models[key] = { file: `${key}.glb`, polyhaven: id, url: `https://polyhaven.com/a/${id}`, bytes: size };
  console.log(`${key.padEnd(8)} ${id.padEnd(20)} ${(size / 1024).toFixed(0)} KB`);
}
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest written');
