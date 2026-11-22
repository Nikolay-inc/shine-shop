// Game balance data. Pure data, no Three.js / DOM — shared by the game, tests and `npm run sim`.

export type ItemShape = 'coin' | 'key' | 'cup' | 'vase' | 'jug' | 'wrench' | 'kettle' | 'lantern' | 'watch' | 'camera';

export interface ItemDef {
  id: string;
  name: string;
  /** Base sell price in coins (before rarity). */
  price: number;
  /** Dust thickness: 1 = baseline. More dust = more passes needed. */
  dust: number;
  /** Share of the surface covered by rust/tarnish (0..1). Needs tool tier 2+. */
  rust: number;
  /** Item becomes available after this many restored items. */
  unlockAt: number;
  /** Procedural fallback shape (always available without downloaded models). */
  shape: ItemShape;
  /** Optional glTF model key in public/models/manifest.json. */
  model?: string;
  /** Base material look for the procedural shape. */
  look: 'brass' | 'copper' | 'silver' | 'iron' | 'ceramic' | 'clay' | 'porcelain';
}

export const ITEMS: ItemDef[] = [
  { id: 'coin', name: 'Старая монета', price: 6, dust: 1.0, rust: 0.0, unlockAt: 0, shape: 'coin', look: 'copper' },
  { id: 'cup', name: 'Фарфоровая чашка', price: 10, dust: 1.1, rust: 0.0, unlockAt: 2, shape: 'cup', look: 'porcelain' },
  { id: 'key', name: 'Амбарный ключ', price: 15, dust: 1.0, rust: 0.4, unlockAt: 4, shape: 'key', look: 'iron' },
  { id: 'vase', name: 'Медная ваза', price: 22, dust: 1.2, rust: 0.3, unlockAt: 7, shape: 'vase', look: 'copper' },
  { id: 'clayjug', name: 'Глиняный кувшин', price: 30, dust: 1.4, rust: 0.2, unlockAt: 11, shape: 'jug', look: 'clay' },
  { id: 'wrench', name: 'Разводной ключ', price: 42, dust: 1.3, rust: 0.55, unlockAt: 15, shape: 'wrench', model: 'wrench', look: 'iron' },
  { id: 'jug', name: 'Молочник', price: 55, dust: 1.4, rust: 0.25, unlockAt: 20, shape: 'jug', model: 'jug', look: 'ceramic' },
  { id: 'kettle', name: 'Латунный чайник', price: 75, dust: 1.5, rust: 0.45, unlockAt: 26, shape: 'kettle', model: 'kettle', look: 'brass' },
  { id: 'lantern', name: 'Фонарь', price: 100, dust: 1.6, rust: 0.5, unlockAt: 33, shape: 'lantern', model: 'lantern', look: 'brass' },
  { id: 'watch', name: 'Карманные часы', price: 140, dust: 1.6, rust: 0.55, unlockAt: 41, shape: 'watch', model: 'watch', look: 'silver' },
  { id: 'camera', name: 'Фотоаппарат', price: 200, dust: 1.8, rust: 0.5, unlockAt: 50, shape: 'camera', model: 'camera', look: 'brass' },
];

export interface ToolDef {
  id: string;
  name: string;
  tier: number;
  cost: number;
  /** Brush radius relative to an item normalized to radius 1. */
  radius: number;
  /** Cleaning strength per pass. */
  strength: number;
  /** Removes rust at full speed (tier 2+). Weak tools scrub rust at WEAK_RUST_MUL. */
  rust: boolean;
}

export const TOOLS: ToolDef[] = [
  { id: 'sponge', name: 'Губка', tier: 1, cost: 0, radius: 0.1, strength: 1.0, rust: false },
  { id: 'brush', name: 'Щётка', tier: 2, cost: 55, radius: 0.1, strength: 1.5, rust: true },
  { id: 'washer', name: 'Мойка высокого давления', tier: 3, cost: 650, radius: 0.15, strength: 1.9, rust: true },
  { id: 'laser', name: 'Лазер', tier: 4, cost: 3200, radius: 0.13, strength: 2.9, rust: true },
];

/** How fast a tool without rust ability scrubs the rust layer (relative). */
export const WEAK_RUST_MUL = 0.12;

export interface SkinDef {
  id: string;
  name: string;
  cost: number;
  /** Tint for the tool cursor and stroke particles. */
  color: string;
  accent: string;
}

export const SKINS: SkinDef[] = [
  { id: 'classic', name: 'Классика', cost: 0, color: '#f4c27a', accent: '#8a5a2b' },
  { id: 'mint', name: 'Мята', cost: 300, color: '#8fe3c8', accent: '#2f7f6a' },
  { id: 'gold', name: 'Золото', cost: 2000, color: '#ffd84d', accent: '#a8740f' },
];

export interface HelperDef {
  id: string;
  name: string;
  unlockCost: number;
  /** Coins per second at level 1. */
  baseRate: number;
  /** Rate multiplier per upgrade level. */
  rateGrowth: number;
  /** Cost of the first upgrade (level 1 -> 2). */
  upgradeBase: number;
  upgradeGrowth: number;
  maxLevel: number;
  /** Seconds per visual cleaning cycle at level 1 (payout = rate * cycle). */
  cycle: number;
}

export const HELPERS: HelperDef[] = [
  { id: 'bench', name: 'Верстак-автомат', unlockCost: 130, baseRate: 0.5, rateGrowth: 1.5, upgradeBase: 210, upgradeGrowth: 1.55, maxLevel: 12, cycle: 8 },
  { id: 'polisher', name: 'Робот-полировщик', unlockCost: 1000, baseRate: 3, rateGrowth: 1.45, upgradeBase: 1400, upgradeGrowth: 1.6, maxLevel: 12, cycle: 6 },
];

export type RarityId = 'common' | 'rare' | 'epic';

export interface RarityDef {
  id: RarityId;
  name: string;
  chance: number;
  mul: number;
  color: string;
}

export const RARITIES: RarityDef[] = [
  { id: 'common', name: 'Обычный', chance: 0.72, mul: 1, color: '#c9b8a0' },
  { id: 'rare', name: 'Редкий', chance: 0.2, mul: 1.5, color: '#6fb6ff' },
  { id: 'epic', name: 'Эпический', chance: 0.08, mul: 2.5, color: '#c58cff' },
];

/** One in GOLDEN_EVERY items is a golden find (shuffled bag: exactly 1 per block). */
export const GOLDEN_EVERY = 20;
export const GOLDEN_MUL = 5;

/** Offline income is capped at this many seconds. */
export const OFFLINE_CAP_SECONDS = 2 * 60 * 60;

/** Progress at which the item auto-finishes. */
export const AUTO_FINISH = 0.97;

/** Seconds a typical player needs to clean a baseline item (dust 1) with the sponge. Used by sim. */
export const BASE_CLEAN_SECONDS = 9;
/** Extra seconds per item: finish animation, before/after, sell tap. Used by sim. */
export const ITEM_OVERHEAD_SECONDS = 5;
/** Rust is a bit more work than dust per area. */
export const RUST_WEIGHT = 1.2;
