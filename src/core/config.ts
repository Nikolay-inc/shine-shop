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
  /** Real-world size (largest dimension, cm): framing, pedestal scale, size label. */
  sizeCm: number;
  /** Procedural fallback shape (used only if the model cannot be loaded). */
  shape: ItemShape;
  /** glTF model key in public/models/manifest.json (CC0, Poly Haven). */
  model?: string;
  /** For sets (tea set, goblets): node names of the piece to show. */
  nodes?: string[];
  /** Base material look for the procedural fallback. */
  look: 'brass' | 'copper' | 'silver' | 'iron' | 'ceramic' | 'clay' | 'porcelain';
}

const TEA = 'tea_set_01_';

export const ITEMS: ItemDef[] = [
  { id: 'watch', name: 'Карманные часы', price: 6, dust: 1.0, rust: 0, unlockAt: 0, sizeCm: 8, shape: 'watch', model: 'watch', look: 'silver' },
  { id: 'compass', name: 'Морской компас', price: 7, dust: 1.0, rust: 0, unlockAt: 0, sizeCm: 15, shape: 'watch', model: 'compass', look: 'brass' },
  { id: 'magnifier', name: 'Лупа', price: 8, dust: 1.0, rust: 0, unlockAt: 0, sizeCm: 27, shape: 'key', model: 'magnifier', look: 'brass' },
  { id: 'elephant', name: 'Резной слоник', price: 9, dust: 1.1, rust: 0, unlockAt: 0, sizeCm: 11, shape: 'vase', model: 'elephant', look: 'clay' },
  { id: 'teacup', name: 'Чайная чашка', price: 12, dust: 1.1, rust: 0.1, unlockAt: 3, sizeCm: 9, shape: 'cup', model: 'teaset', nodes: [`${TEA}cup_small_01`], look: 'porcelain' },
  { id: 'pliers', name: 'Плоскогубцы', price: 16, dust: 1.0, rust: 0.45, unlockAt: 5, sizeCm: 18, shape: 'key', model: 'pliers', look: 'iron' },
  { id: 'sugarbowl', name: 'Сахарница', price: 19, dust: 1.2, rust: 0.1, unlockAt: 7, sizeCm: 11, shape: 'cup', model: 'teaset', nodes: [`${TEA}sugar_cup_01`, `${TEA}sugar_cup_01_lid`], look: 'porcelain' },
  { id: 'brassvase', name: 'Латунная вазочка', price: 23, dust: 1.2, rust: 0.35, unlockAt: 9, sizeCm: 17, shape: 'vase', model: 'brassvase', look: 'brass' },
  { id: 'hammer', name: 'Кузнечный молоток', price: 27, dust: 1.2, rust: 0.5, unlockAt: 11, sizeCm: 30, shape: 'wrench', model: 'hammer', look: 'iron' },
  { id: 'goblet', name: 'Латунный кубок', price: 32, dust: 1.3, rust: 0.4, unlockAt: 14, sizeCm: 20, shape: 'vase', model: 'goblets', nodes: ['brass_goblet_01'], look: 'brass' },
  { id: 'jug', name: 'Молочник', price: 36, dust: 1.4, rust: 0.2, unlockAt: 17, sizeCm: 28, shape: 'jug', model: 'jug', look: 'ceramic' },
  { id: 'oilcan', name: 'Маслёнка', price: 41, dust: 1.4, rust: 0.5, unlockAt: 20, sizeCm: 27, shape: 'kettle', model: 'oilcan', look: 'iron' },
  { id: 'wrench', name: 'Разводной ключ', price: 42, dust: 1.3, rust: 0.55, unlockAt: 23, sizeCm: 25, shape: 'wrench', model: 'wrench', look: 'iron' },
  { id: 'teapot', name: 'Заварочный чайник', price: 48, dust: 1.4, rust: 0.2, unlockAt: 26, sizeCm: 20, shape: 'kettle', model: 'teaset', nodes: [`${TEA}teapot_01`, `${TEA}teapot_01_lid`], look: 'porcelain' },
  { id: 'binocular', name: 'Бинокль', price: 55, dust: 1.4, rust: 0.4, unlockAt: 30, sizeCm: 20, shape: 'camera', model: 'binocular', look: 'brass' },
  { id: 'metaljug', name: 'Металлический кувшин', price: 63, dust: 1.5, rust: 0.5, unlockAt: 34, sizeCm: 29, shape: 'jug', model: 'metaljug', look: 'copper' },
  { id: 'kettle', name: 'Латунный котелок', price: 72, dust: 1.5, rust: 0.45, unlockAt: 38, sizeCm: 37, shape: 'kettle', model: 'kettle', look: 'brass' },
  { id: 'horse', name: 'Бронзовый конь', price: 82, dust: 1.5, rust: 0.5, unlockAt: 43, sizeCm: 22, shape: 'vase', model: 'horse', look: 'copper' },
  { id: 'vase', name: 'Старинная ваза', price: 94, dust: 1.6, rust: 0.2, unlockAt: 48, sizeCm: 44, shape: 'vase', model: 'vase', look: 'ceramic' },
  { id: 'lantern', name: 'Фонарь', price: 108, dust: 1.6, rust: 0.5, unlockAt: 54, sizeCm: 29, shape: 'lantern', model: 'lantern', look: 'brass' },
  { id: 'camera', name: 'Фотоаппарат', price: 124, dust: 1.7, rust: 0.45, unlockAt: 60, sizeCm: 26, shape: 'camera', model: 'camera', look: 'brass' },
  { id: 'drill', name: 'Ручная дрель', price: 142, dust: 1.7, rust: 0.55, unlockAt: 67, sizeCm: 49, shape: 'wrench', model: 'drill', look: 'iron' },
  { id: 'microscope', name: 'Микроскоп', price: 162, dust: 1.7, rust: 0.45, unlockAt: 74, sizeCm: 40, shape: 'lantern', model: 'microscope', look: 'brass' },
  { id: 'mantelclock', name: 'Каминные часы', price: 185, dust: 1.8, rust: 0.4, unlockAt: 82, sizeCm: 48, shape: 'camera', model: 'mantelclock', look: 'brass' },
  { id: 'oillamp', name: 'Керосиновая лампа', price: 212, dust: 1.8, rust: 0.5, unlockAt: 90, sizeCm: 80, shape: 'lantern', model: 'oillamp', look: 'brass' },
  { id: 'chest', name: 'Старый сундук', price: 245, dust: 1.9, rust: 0.5, unlockAt: 100, sizeCm: 96, shape: 'camera', model: 'chest', look: 'iron' },
];

/** How many recent items are not repeated when choosing the next one. */
export const NO_REPEAT = 3;

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
  { id: 'washer', name: 'Мойка высокого давления', tier: 3, cost: 600, radius: 0.15, strength: 1.9, rust: true },
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
  { id: 'bench', name: 'Верстак-автомат', unlockCost: 130, baseRate: 0.5, rateGrowth: 1.5, upgradeBase: 210, upgradeGrowth: 1.5, maxLevel: 12, cycle: 8 },
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
