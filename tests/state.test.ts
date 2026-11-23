import { describe, expect, it } from 'vitest';
import {
  GOLDEN_EVERY, itemById, buyHelper, buySkin, buyTool, collectOffline, completeItem, createState, currentPrice, drawGolden,
  goals, helperById, helperCycle, sellCurrent, startNextItem, tickHelpers,
} from '../src/core';

describe('golden bag', () => {
  it('gives exactly one golden find per 20 items', () => {
    const s = createState(7);
    for (let block = 0; block < 50; block++) {
      let n = 0;
      for (let i = 0; i < GOLDEN_EVERY; i++) if (drawGolden(s)) n++;
      expect(n).toBe(1);
    }
  });
  it('first item is never golden, common and a starter item', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = createState(seed);
      const c = startNextItem(s);
      expect(c.golden).toBe(false);
      expect(itemById(c.itemId).unlockAt).toBe(0);
      expect(c.rarity).toBe('common');
    }
  });
  it('does not show the same item again within 3 items', () => {
    const s = createState(5);
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      seen.push(startNextItem(s).itemId);
      completeItem(s);
      sellCurrent(s);
    }
    for (let i = 3; i < seen.length; i++) expect(seen.slice(i - 3, i)).not.toContain(seen[i]);
  });
});

describe('item loop', () => {
  it('complete → album → sell → coins', () => {
    const s = createState(1);
    startNextItem(s);
    expect(sellCurrent(s)).toBe(0); // not restored yet
    expect(completeItem(s).isNew).toBe(true);
    const price = currentPrice(s);
    expect(sellCurrent(s)).toBe(price);
    expect(s.coins).toBe(price);
    expect(s.restored).toBe(1);
    expect(s.album[s.recent[0]].count).toBe(1);
    expect(s.current).toBeNull();
  });
});

describe('album', () => {
  it('keeps the best rarity and counts golden finds', () => {
    const s = createState(3);
    for (const [rarity, golden] of [['common', false], ['epic', true], ['rare', false]] as const) {
      s.current = { itemId: 'watch', rarity, golden, n: 1, done: false };
      completeItem(s);
      sellCurrent(s);
    }
    expect(s.album.watch).toEqual({ count: 3, best: 'epic', golden: 1 });
  });
});

describe('shop', () => {
  it('tools are bought in order and need coins', () => {
    const s = createState(1);
    expect(buyTool(s, 'washer')).toEqual({ ok: false, reason: 'locked' });
    expect(buyTool(s, 'brush')).toEqual({ ok: false, reason: 'coins' });
    s.coins = 1000;
    expect(buyTool(s, 'brush').ok).toBe(true);
    expect(s.tool).toBe('brush');
    expect(buyTool(s, 'brush')).toEqual({ ok: false, reason: 'owned' });
    expect(buyTool(s, 'washer').ok).toBe(true);
    expect(s.coins).toBe(1000 - 55 - 600);
  });
  it('skins cost coins', () => {
    const s = createState(1);
    s.coins = 300;
    expect(buySkin(s, 'mint').ok).toBe(true);
    expect(s.skin).toBe('mint');
    expect(buySkin(s, 'gold')).toEqual({ ok: false, reason: 'coins' });
  });
  it('helpers: buy, upgrade, pay per cycle', () => {
    const s = createState(1);
    s.coins = 10000;
    expect(buyHelper(s, 'bench').ok).toBe(true);
    expect(s.helpers.bench).toBe(1);
    const cycle = helperCycle(helperById('bench'), 1);
    expect(tickHelpers(s, cycle * 0.5)).toHaveLength(0);
    const before = s.coins;
    const pay = tickHelpers(s, cycle * 0.5 + 0.001);
    expect(pay).toHaveLength(1);
    expect(s.coins).toBe(before + pay[0].coins);
    expect(buyHelper(s, 'bench').ok).toBe(true);
    expect(s.helpers.bench).toBe(2);
  });
  it('offline collect adds coins and stats', () => {
    const s = createState(1);
    s.helpers.bench = 2;
    const got = collectOffline(s, 3 * 3600);
    expect(got).toBeGreaterThan(0);
    expect(s.coins).toBe(got);
    expect(s.stats.coinsOffline).toBe(got);
  });
});

describe('goals', () => {
  it('always show the next tool and the next album item', () => {
    const s = createState(1);
    const g = goals(s);
    expect(g.map((x) => x.kind)).toEqual(['tool', 'album']);
    expect(g[0].title).toBe('Щётка');
    s.toolsOwned = ['sponge', 'brush', 'washer', 'laser'];
    s.restored = 999;
    expect(goals(s)[0].kind).toBe('helper');
  });
});
