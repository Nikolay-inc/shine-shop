// Simulation of the first 30 minutes of play: when the player gets each tool and helper.
// npm run sim            — timeline for one seed + summary over many seeds
// npm run sim -- --check — exit 1 if pacing target fails (new purchase every 1–3 min in first 15 min)
import {
  HELPERS, ITEM_OVERHEAD_SECONDS, TOOLS, buyHelper, buyTool, cleanSeconds, completeItem, createState,
  helperCost, itemById, sellCurrent, startNextItem, tickHelpers, toolById, totalHelperRate, type GameState,
} from '../src/core';

const DURATION = 30 * 60;
const TARGET_WINDOW = 15 * 60;
const MIN_GAP = 60;
const MAX_GAP = 180;

interface Purchase {
  t: number;
  what: string;
  cost: number;
  kind: 'tool' | 'helper';
}

interface Option {
  what: string;
  kind: 'tool' | 'helper';
  cost: number;
  buy: () => boolean;
}

function options(s: GameState): Option[] {
  const out: Option[] = [];
  const nextTool = TOOLS.find((t) => !s.toolsOwned.includes(t.id));
  if (nextTool) out.push({ what: nextTool.name, kind: 'tool', cost: nextTool.cost, buy: () => buyTool(s, nextTool.id).ok });
  for (const h of HELPERS) {
    const lvl = s.helpers[h.id] ?? 0;
    const cost = helperCost(h, lvl);
    if (!isFinite(cost)) continue;
    out.push({ what: lvl === 0 ? h.name : `${h.name} ур.${lvl + 1}`, kind: 'helper', cost, buy: () => buyHelper(s, h.id).ok });
  }
  return out.sort((a, b) => a.cost - b.cost);
}

export function simulate(seed: number) {
  const s = createState(seed);
  const purchases: Purchase[] = [];
  let t = 0;
  let items = 0;
  let golden = 0;
  while (t < DURATION) {
    const cur = startNextItem(s);
    if (cur.golden) golden++;
    const dur = cleanSeconds(itemById(cur.itemId), toolById(s.tool)) + ITEM_OVERHEAD_SECONDS;
    // helpers work while the player cleans
    for (let left = dur; left > 0; left -= 1) tickHelpers(s, Math.min(1, left));
    t += dur;
    completeItem(s);
    sellCurrent(s);
    items++;
    // greedy: buy the cheapest available upgrade while affordable
    for (;;) {
      const opt = options(s)[0];
      if (!opt || opt.cost > s.coins || !opt.buy()) break;
      purchases.push({ t, what: opt.what, cost: opt.cost, kind: opt.kind });
    }
  }
  return { purchases, items, golden, state: s };
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function gapsIn(purchases: Purchase[], window: number): number[] {
  const times = [0, ...purchases.filter((p) => p.t <= window).map((p) => p.t)];
  const gaps = times.slice(1).map((x, i) => x - times[i]);
  const lastT = times[times.length - 1];
  if (window - lastT > 0) gaps.push(window - lastT); // open gap until the end of the window
  return gaps;
}

function meetsTarget(purchases: Purchase[]): { ok: boolean; gaps: number[]; mean: number } {
  const gaps = gapsIn(purchases, TARGET_WINDOW);
  const closed = gaps.slice(0, -1);
  const mean = closed.reduce((a, b) => a + b, 0) / Math.max(1, closed.length);
  // no wait longer than 3 min, and on average one purchase per 1–3 min
  const ok = gaps.every((g) => g <= MAX_GAP) && mean >= MIN_GAP && mean <= MAX_GAP;
  return { ok, gaps, mean };
}

const isMain = process.argv[1]?.endsWith('sim.ts');
if (isMain) {
  const check = process.argv.includes('--check');
  const seed = 42;
  const run = simulate(seed);
  console.log(`\nShine Shop — симуляция первых 30 минут (seed ${seed})\n`);
  console.log(' время  | покупка                      |  цена | доход помощников');
  console.log('--------+------------------------------+-------+-----------------');
  const s2 = createState(seed);
  for (const p of run.purchases) {
    // recompute helper rate after this purchase for display
    if (p.kind === 'helper') {
      const h = HELPERS.find((x) => p.what.startsWith(x.name))!;
      s2.helpers[h.id] = (s2.helpers[h.id] ?? 0) + 1;
    }
    console.log(` ${mmss(p.t)}  | ${p.what.padEnd(28)} | ${String(p.cost).padStart(5)} | ${totalHelperRate(s2.helpers).toFixed(1)} мон/с`);
  }
  const first = (name: string) => run.purchases.find((p) => p.what === name);
  console.log('\nКогда игрок получает:');
  for (const tool of TOOLS.slice(1)) console.log(`  ${tool.name.padEnd(26)} ${first(tool.name) ? mmss(first(tool.name)!.t) : 'позже 30:00'}`);
  for (const h of HELPERS) console.log(`  ${h.name.padEnd(26)} ${first(h.name) ? mmss(first(h.name)!.t) : 'позже 30:00'}`);
  const { ok, gaps, mean } = meetsTarget(run.purchases);
  const in15 = run.purchases.filter((p) => p.t <= TARGET_WINDOW).length;
  console.log(`\nПредметов восстановлено: ${run.items}, золотых находок: ${run.golden}`);
  console.log(`Монет в конце: ${Math.floor(run.state.coins)}, доход помощников: ${totalHelperRate(run.state.helpers).toFixed(1)} мон/с`);
  console.log(`Первые 15 минут: ${in15} покупок, интервалы (с): ${gaps.map((g) => Math.round(g)).join(', ')}`);
  console.log(`Средний интервал: ${Math.round(mean)} с, максимальный: ${Math.round(Math.max(...gaps))} с`);
  console.log(`Цель «покупка каждые 1–3 мин»: ${ok ? 'ВЫПОЛНЕНА' : 'НЕ ВЫПОЛНЕНА'}`);

  // robustness over many seeds (rarity / golden luck changes income)
  const N = 200;
  let pass = 0;
  let maxGapWorst = 0;
  for (let i = 0; i < N; i++) {
    const r = meetsTarget(simulate(1000 + i).purchases);
    if (r.ok) pass++;
    maxGapWorst = Math.max(maxGapWorst, ...r.gaps);
  }
  console.log(`По ${N} сидам: цель выполнена в ${pass}/${N}, худший интервал ${Math.round(maxGapWorst)} с\n`);
  if (check && (!ok || pass / N < 0.9)) {
    console.error('Pacing check failed');
    process.exit(1);
  }
}
