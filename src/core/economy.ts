// Pure economy formulas. No Three.js, no DOM.
import {
  BASE_CLEAN_SECONDS, GOLDEN_MUL, HELPERS, ITEMS, NO_REPEAT, OFFLINE_CAP_SECONDS, RARITIES, RUST_WEIGHT,
  TOOLS, WEAK_RUST_MUL, type HelperDef, type ItemDef, type RarityId, type ToolDef,
} from './config';

export const itemById = (id: string): ItemDef => {
  const it = ITEMS.find((i) => i.id === id);
  if (!it) throw new Error(`unknown item ${id}`);
  return it;
};
export const toolById = (id: string): ToolDef => {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown tool ${id}`);
  return t;
};
export const helperById = (id: string): HelperDef => {
  const h = HELPERS.find((x) => x.id === id);
  if (!h) throw new Error(`unknown helper ${id}`);
  return h;
};
export const rarityById = (id: RarityId) => RARITIES.find((r) => r.id === id)!;

/** Sell price of a restored item. */
export function itemPrice(item: ItemDef, rarity: RarityId, golden: boolean): number {
  return Math.round(item.price * rarityById(rarity).mul * (golden ? GOLDEN_MUL : 1));
}

/** Rarity from a uniform random number in [0,1). */
export function rollRarity(r: number): RarityId {
  let acc = 0;
  for (const rar of RARITIES) {
    acc += rar.chance;
    if (r < acc) return rar.id;
  }
  return RARITIES[RARITIES.length - 1].id;
}

/** Overall cleaning power of a tool (bigger radius and strength = faster). */
export function toolPower(tool: ToolDef): number {
  return (tool.strength * tool.radius) / 0.1;
}

/** Multiplier applied to the rust layer for this tool. */
export function rustRate(tool: ToolDef): number {
  return tool.rust ? 1 : WEAK_RUST_MUL;
}

/** Estimated seconds of active scrubbing for a player (used by sim and balancing). */
export function cleanSeconds(item: ItemDef, tool: ToolDef): number {
  const p = toolPower(tool);
  return (BASE_CLEAN_SECONDS * item.dust) / p + (BASE_CLEAN_SECONDS * item.rust * RUST_WEIGHT) / (p * rustRate(tool));
}

/** Helper income per second at a level (0 = not owned). */
export function helperRate(def: HelperDef, level: number): number {
  if (level <= 0) return 0;
  return def.baseRate * Math.pow(def.rateGrowth, level - 1);
}

/** Seconds per visual cycle — speed upgrades shorten it down to 1.5 s. */
export function helperCycle(def: HelperDef, level: number): number {
  return Math.max(1.5, def.cycle / Math.pow(1.25, Math.max(0, level - 1)));
}

/** Cost to go from `level` to `level + 1` (level 0 = buy the helper). Infinity at max. */
export function helperCost(def: HelperDef, level: number): number {
  if (level >= def.maxLevel) return Infinity;
  if (level === 0) return def.unlockCost;
  return Math.round(def.upgradeBase * Math.pow(def.upgradeGrowth, level - 1));
}

export function totalHelperRate(levels: Record<string, number>): number {
  return HELPERS.reduce((s, h) => s + helperRate(h, levels[h.id] ?? 0), 0);
}

/** Coins earned while away; time is capped at 2 hours. */
export function offlineEarnings(levels: Record<string, number>, secondsAway: number): number {
  const t = Math.max(0, Math.min(secondsAway, OFFLINE_CAP_SECONDS));
  return Math.floor(totalHelperRate(levels) * t);
}

export function unlockedItems(restored: number): ItemDef[] {
  return ITEMS.filter((i) => i.unlockAt <= restored);
}

/** Next item that will appear in the album, or null when all are unlocked. */
export function nextLockedItem(restored: number): ItemDef | null {
  return ITEMS.find((i) => i.unlockAt > restored) ?? null;
}

/** Weighted pick of the next item: newer items are more likely; the last NO_REPEAT items are skipped. */
export function pickItem(restored: number, r: number, recent: string[] = []): ItemDef {
  const all = unlockedItems(restored);
  const avoid = recent.slice(-Math.min(NO_REPEAT, all.length - 1));
  const pool = all.filter((i) => !avoid.includes(i.id));
  const weights = pool.map((_, i) => Math.pow(i + 1, 1.6));
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = r * sum;
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
