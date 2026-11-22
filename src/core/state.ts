// Game state and pure actions (mutate state, return what happened). No Three.js, no DOM.
import { GOLDEN_EVERY, HELPERS, ITEMS, SKINS, TOOLS, type RarityId } from './config';
import {
  helperById, helperCost, helperCycle, helperRate, itemById, itemPrice, nextLockedItem,
  offlineEarnings, pickItem, rollRarity, toolById,
} from './economy';
import { nextRandom } from './rng';

export interface CurrentItem {
  itemId: string;
  rarity: RarityId;
  golden: boolean;
  /** Sequential number of this item (1-based). */
  n: number;
  done: boolean;
}

export interface AlbumEntry {
  count: number;
  best: RarityId;
  golden: number;
}

export interface Stats {
  coinsEarned: number;
  coinsFromItems: number;
  coinsFromHelpers: number;
  coinsOffline: number;
  playSeconds: number;
  sessions: number;
}

export interface GameState {
  coins: number;
  restored: number;
  toolsOwned: string[];
  tool: string;
  skinsOwned: string[];
  skin: string;
  helpers: Record<string, number>;
  helperProgress: Record<string, number>;
  album: Record<string, AlbumEntry>;
  /** Position in the current golden bag and the slot holding the golden find. */
  bag: { pos: number; golden: number };
  rng: number;
  current: CurrentItem | null;
  lastItem?: string;
  muted: boolean;
  tutorialDone: boolean;
  stats: Stats;
}

export function createState(seed: number): GameState {
  const s: GameState = {
    coins: 0,
    restored: 0,
    toolsOwned: [TOOLS[0].id],
    tool: TOOLS[0].id,
    skinsOwned: [SKINS[0].id],
    skin: SKINS[0].id,
    helpers: Object.fromEntries(HELPERS.map((h) => [h.id, 0])),
    helperProgress: Object.fromEntries(HELPERS.map((h) => [h.id, 0])),
    album: {},
    bag: { pos: 0, golden: 0 },
    rng: seed >>> 0,
    current: null,
    muted: false,
    tutorialDone: false,
    stats: { coinsEarned: 0, coinsFromItems: 0, coinsFromHelpers: 0, coinsOffline: 0, playSeconds: 0, sessions: 0 },
  };
  s.bag.golden = newGoldenSlot(s, true);
  return s;
}

/** Golden slot within a bag of GOLDEN_EVERY. The very first bag never makes item #1 golden. */
function newGoldenSlot(s: GameState, first = false): number {
  const lo = first ? 3 : 0;
  return lo + Math.floor(nextRandom(s) * (GOLDEN_EVERY - lo));
}

/** Draws the next value from the golden bag (exactly 1 golden per GOLDEN_EVERY items). */
export function drawGolden(s: GameState): boolean {
  const golden = s.bag.pos === s.bag.golden;
  s.bag.pos++;
  if (s.bag.pos >= GOLDEN_EVERY) {
    s.bag.pos = 0;
    s.bag.golden = newGoldenSlot(s);
  }
  return golden;
}

export function startNextItem(s: GameState): CurrentItem {
  const item = pickItem(s.restored, nextRandom(s), s.lastItem);
  const first = s.restored === 0;
  const rarity = first ? 'common' : rollRarity(nextRandom(s));
  const golden = drawGolden(s);
  s.current = { itemId: item.id, rarity, golden, n: s.restored + 1, done: false };
  s.lastItem = item.id;
  return s.current;
}

/** Marks the current item restored and adds it to the album. Returns true if it is a new album card. */
export function completeItem(s: GameState): { isNew: boolean } {
  const c = s.current;
  if (!c || c.done) return { isNew: false };
  c.done = true;
  s.restored++;
  const order: RarityId[] = ['common', 'rare', 'epic'];
  const e = s.album[c.itemId];
  const isNew = !e;
  if (!e) s.album[c.itemId] = { count: 1, best: c.rarity, golden: c.golden ? 1 : 0 };
  else {
    e.count++;
    if (order.indexOf(c.rarity) > order.indexOf(e.best)) e.best = c.rarity;
    if (c.golden) e.golden++;
  }
  return { isNew };
}

export function currentPrice(s: GameState): number {
  const c = s.current;
  if (!c) return 0;
  return itemPrice(itemById(c.itemId), c.rarity, c.golden);
}

export function sellCurrent(s: GameState): number {
  const c = s.current;
  if (!c || !c.done) return 0;
  const price = currentPrice(s);
  earn(s, price, 'items');
  s.current = null;
  return price;
}

function earn(s: GameState, amount: number, src: 'items' | 'helpers' | 'offline') {
  s.coins += amount;
  s.stats.coinsEarned += amount;
  if (src === 'items') s.stats.coinsFromItems += amount;
  if (src === 'helpers') s.stats.coinsFromHelpers += amount;
  if (src === 'offline') s.stats.coinsOffline += amount;
}

export type BuyResult = { ok: true; cost: number } | { ok: false; reason: 'owned' | 'coins' | 'locked' | 'max' };

/** Tools are bought in order (губка → щётка → мойка → лазер). Buying selects it. */
export function buyTool(s: GameState, id: string): BuyResult {
  const t = toolById(id);
  if (s.toolsOwned.includes(id)) return { ok: false, reason: 'owned' };
  const prev = TOOLS.find((x) => x.tier === t.tier - 1);
  if (prev && !s.toolsOwned.includes(prev.id)) return { ok: false, reason: 'locked' };
  if (s.coins < t.cost) return { ok: false, reason: 'coins' };
  s.coins -= t.cost;
  s.toolsOwned.push(id);
  s.tool = id;
  return { ok: true, cost: t.cost };
}

export function buySkin(s: GameState, id: string): BuyResult {
  const sk = SKINS.find((x) => x.id === id);
  if (!sk) throw new Error(`unknown skin ${id}`);
  if (s.skinsOwned.includes(id)) return { ok: false, reason: 'owned' };
  if (s.coins < sk.cost) return { ok: false, reason: 'coins' };
  s.coins -= sk.cost;
  s.skinsOwned.push(id);
  s.skin = id;
  return { ok: true, cost: sk.cost };
}

/** Buys a helper (level 0 → 1) or upgrades its speed. */
export function buyHelper(s: GameState, id: string): BuyResult {
  const def = helperById(id);
  const lvl = s.helpers[id] ?? 0;
  const cost = helperCost(def, lvl);
  if (!isFinite(cost)) return { ok: false, reason: 'max' };
  if (s.coins < cost) return { ok: false, reason: 'coins' };
  s.coins -= cost;
  s.helpers[id] = lvl + 1;
  return { ok: true, cost };
}

/** Advances helper work cycles; returns payouts (one per finished cycle) for visuals. */
export function tickHelpers(s: GameState, dt: number): { id: string; coins: number }[] {
  const out: { id: string; coins: number }[] = [];
  for (const def of HELPERS) {
    const lvl = s.helpers[def.id] ?? 0;
    if (lvl <= 0) continue;
    const cycle = helperCycle(def, lvl);
    let p = (s.helperProgress[def.id] ?? 0) + dt;
    while (p >= cycle) {
      p -= cycle;
      const coins = Math.max(1, Math.round(helperRate(def, lvl) * cycle));
      earn(s, coins, 'helpers');
      out.push({ id: def.id, coins });
    }
    s.helperProgress[def.id] = p;
  }
  return out;
}

export function collectOffline(s: GameState, secondsAway: number): number {
  const coins = offlineEarnings(s.helpers, secondsAway);
  if (coins > 0) earn(s, coins, 'offline');
  return coins;
}

export interface Goal {
  kind: 'tool' | 'helper' | 'album';
  title: string;
  have: number;
  need: number;
}

/** The nearest goals shown at the top: next tool (coins) and next album item (restored count). */
export function goals(s: GameState): Goal[] {
  const out: Goal[] = [];
  const nextTool = TOOLS.find((t) => !s.toolsOwned.includes(t.id));
  if (nextTool) out.push({ kind: 'tool', title: nextTool.name, have: Math.min(s.coins, nextTool.cost), need: nextTool.cost });
  else {
    const h = HELPERS.map((d) => ({ d, c: helperCost(d, s.helpers[d.id] ?? 0) })).filter((x) => isFinite(x.c)).sort((a, b) => a.c - b.c)[0];
    if (h) out.push({ kind: 'helper', title: h.d.name, have: Math.min(s.coins, h.c), need: h.c });
  }
  const next = nextLockedItem(s.restored);
  if (next) out.push({ kind: 'album', title: next.name, have: s.restored, need: next.unlockAt });
  return out;
}

export function albumCount(s: GameState): { have: number; total: number } {
  return { have: Object.keys(s.album).length, total: ITEMS.length };
}
