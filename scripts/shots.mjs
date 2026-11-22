// Headless check + screenshots with the system Chrome (puppeteer-core).
// Usage: node scripts/shots.mjs [url] [outDir]
import puppeteer from 'puppeteer-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const URL_ = process.argv[2] ?? 'http://localhost:5173/';
const OUT = process.argv[3] ?? 'docs/screenshots';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function info(page) {
  return page.evaluate(() => window.__shine?.debugInfo());
}

/** Zig-zag touch strokes over the item; rotates it between passes so every side gets cleaned. */
async function cleanItem(page, { maxPasses = 30, shotAt, shotName } = {}) {
  let shot = false;
  for (let pass = 0; pass < maxPasses; pass++) {
    const d = await info(page);
    if (!d || d.phase !== 'clean') return d;
    if (shotAt && !shot && d.progress >= shotAt) {
      await page.screenshot({ path: path.join(OUT, shotName) });
      shot = true;
    }
    const r = d.r * 0.85;
    const rows = 9;
    await page.touchscreen.touchStart(d.x, d.y); // start on the item = cleaning gesture
    for (let i = 0; i <= rows; i++) {
      const y = d.y - r + (2 * r * i) / rows;
      const x0 = i % 2 ? d.x + r : d.x - r;
      const x1 = i % 2 ? d.x - r : d.x + r;
      for (let k = 0; k <= 8; k++) await page.touchscreen.touchMove(x0 + ((x1 - x0) * k) / 8, y);
    }
    await page.touchscreen.touchEnd();
    const after = await info(page);
    if (process.env.DEBUG) console.log('pass', pass, after.phase, after.progress.toFixed(3), await page.evaluate(() => [window.__shine.stage.yaw.toFixed(2), window.__shine.stage.pitch.toFixed(2)].join(' ')));
    if (after.phase !== 'clean') return after;
    if (after.progress > 0.85) {
      // pause like a player: the game turns the dirtiest side towards us
      await sleep(2700);
      continue;
    }
    // rotate the item: drag on empty space near the top-right (yaw, then tilt up / down)
    const W = page.viewport().width;
    const sx = W - 30, sy = d.y - d.r - 20;
    const tilt = pass % 4 === 1 ? 10 : pass % 4 === 3 ? -10 : 0;
    await page.touchscreen.touchStart(sx, sy);
    for (let k = 1; k <= 8; k++) await page.touchscreen.touchMove(sx - (tilt ? 0 : k * 9), sy + k * tilt);
    await page.touchscreen.touchEnd();
    await sleep(160);
  }
  return info(page);
}

async function run(vw, vh, tag, full) {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${tag}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
  await page.emulate({ viewport: { width: vw, height: vh, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  // fresh player: wipe the save before any game script runs (a reload would re-save the old state on pagehide)
  await page.evaluateOnNewDocument(() => {
    if (!sessionStorage.getItem('__shots')) {
      localStorage.clear();
      sessionStorage.setItem('__shots', '1');
    }
  });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shine?.debugInfo().phase === 'clean', { timeout: 20000 });
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, `${tag}-01-first-run.png`) });
  const t0 = Date.now();
  await cleanItem(page, { shotAt: 0.4, shotName: `${tag}-02-cleaning.png` });
  const secs = (Date.now() - t0) / 1000;
  await page.waitForSelector('#sell-btn', { visible: true, timeout: 15000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, `${tag}-03-before-after.png`) });
  const imgs = await page.$$eval('.ba img', (els) => els.map((e) => e.src));
  for (const [i, name] of ['before', 'after'].entries()) {
    await writeFile(path.join(OUT, `${tag}-${name}.jpg`), Buffer.from(imgs[i].split(',')[1], 'base64'));
  }
  await page.click('#sell-btn');
  await sleep(1500);
  const report = { tag, firstItemSeconds: Math.round(secs) };
  if (full) {
    // give coins to look at shop / helpers / album states, then a rusty item with the brush
    await page.evaluate(() => {
      const g = window.__shine;
      g.state.coins += 400;
    });
    await page.click('[data-sheet="shop"]');
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `${tag}-04-shop.png`) });
    await page.click('[data-action="buy-tool"]');
    await sleep(300);
    await page.click('#sheet-close');
    await page.click('[data-sheet="helpers"]');
    await sleep(300);
    await page.click('[data-action="buy-helper"]');
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `${tag}-05-helpers.png`) });
    await page.click('#sheet-close');
    await sleep(2500);
    await page.screenshot({ path: path.join(OUT, `${tag}-06-helper-working.png`) });
    for (let i = 0; i < 3; i++) {
      await cleanItem(page);
      await page.waitForSelector('#sell-btn', { visible: true, timeout: 15000 });
      await sleep(600);
      if (i === 2) await page.screenshot({ path: path.join(OUT, `${tag}-07-second-before-after.png`) });
      await page.click('#sell-btn');
      await sleep(1500);
    }
    await page.click('[data-sheet="album"]');
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `${tag}-08-album.png`) });
    await page.click('#sheet-close');
    await page.click('#btn-stats');
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `${tag}-09-stats.png`) });
    await page.click('#sheet-close');
    // leave the game (session_end + save), then pretend it happened 3 hours ago
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('shine-shop/save'));
      raw.lastSeen = Date.now() - 3 * 3600 * 1000;
      localStorage.setItem('shine-shop/save', JSON.stringify(raw));
      window.__shine.resetting = true; // do not overwrite on unload
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#collect-btn', { visible: true, timeout: 15000 });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, `${tag}-10-offline.png`) });
    await page.click('#collect-btn');
    await sleep(2000);
    report.fps = Math.round((await info(page)).fps);
    report.events = await page.evaluate(() => window.__shine.log.events.map((e) => e.type));
  }
  await page.close();
  return report;
}

try {
  const a = await run(375, 667, '375x667', true);
  const b = await run(430, 932, '430x932', false);
  console.log(JSON.stringify({ a: { ...a, events: undefined }, b, eventTypes: [...new Set(a.events)] }, null, 2));
  console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'console: no errors');
} finally {
  await browser.close();
}
