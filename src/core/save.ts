// SaveService: versioned save in key-value storage, stable playerId (UUID), exit time for offline income.
import { createState, type GameState } from './state';
import type { GameEvent } from './events';
import { randomSeed } from './rng';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'shine-shop/save';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface SaveData {
  version: number;
  playerId: string;
  /** Epoch ms when the game was last seen running (for offline income). */
  lastSeen: number;
  createdAt: number;
  state: GameState;
  events: GameEvent[];
}

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Fills fields added in later builds so old saves keep working. */
function normalize(state: GameState): GameState {
  const fresh = createState(state.rng ?? randomSeed());
  return {
    ...fresh,
    ...state,
    helpers: { ...fresh.helpers, ...state.helpers },
    helperProgress: { ...fresh.helperProgress, ...state.helperProgress },
    stats: { ...fresh.stats, ...state.stats },
  };
}

export class SaveService {
  constructor(private kv: KV | null, private now: () => number = Date.now, private key = SAVE_KEY) {}

  /** Returns the existing save or a new one. `isNew` = first launch. */
  load(): { data: SaveData; isNew: boolean } {
    const raw = this.read();
    if (raw) {
      try {
        const d = JSON.parse(raw) as Partial<SaveData>;
        const migrated = this.migrate(d);
        if (migrated) return { data: migrated, isNew: false };
      } catch {
        /* corrupted save → start over */
      }
    }
    const t = this.now();
    return {
      data: { version: SAVE_VERSION, playerId: uuid(), lastSeen: t, createdAt: t, state: createState(randomSeed()), events: [] },
      isNew: true,
    };
  }

  private migrate(d: Partial<SaveData>): SaveData | null {
    if (!d || typeof d !== 'object' || !d.state || typeof d.version !== 'number') return null;
    if (d.version > SAVE_VERSION) return null; // save from a newer build
    // v1 is the first format; future migrations go here: if (d.version < 2) { ... }
    return {
      version: SAVE_VERSION,
      playerId: typeof d.playerId === 'string' && d.playerId ? d.playerId : uuid(),
      lastSeen: typeof d.lastSeen === 'number' ? d.lastSeen : this.now(),
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : this.now(),
      state: normalize(d.state as GameState),
      events: Array.isArray(d.events) ? d.events : [],
    };
  }

  /** Writes the save and stamps lastSeen = now. */
  save(data: SaveData): void {
    data.lastSeen = this.now();
    data.version = SAVE_VERSION;
    try {
      this.kv?.setItem(this.key, JSON.stringify(data));
    } catch {
      /* storage full or blocked — keep playing */
    }
  }

  /** Seconds since the last save, for offline income. */
  secondsAway(data: SaveData): number {
    return Math.max(0, (this.now() - data.lastSeen) / 1000);
  }

  reset(): void {
    try {
      this.kv?.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }

  private read(): string | null {
    try {
      return this.kv?.getItem(this.key) ?? null;
    } catch {
      return null;
    }
  }
}
