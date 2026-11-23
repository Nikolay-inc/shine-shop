import { describe, expect, it } from 'vitest';
import {
  GOLDEN_EVERY, GOLDEN_MUL, HELPERS, ITEMS, OFFLINE_CAP_SECONDS, TOOLS, cleanSeconds, helperById, helperCost,
  helperCycle, helperRate, itemById, itemPrice, nextLockedItem, offlineEarnings, pickItem, rollRarity, rustRate,
  toolById, unlockedItems,
} from '../src/core';

describe('prices', () => {
  it('depend on item and rarity', () => {
    const coin = itemById('watch');
    expect(itemPrice(coin, 'common', false)).toBe(coin.price);
    expect(itemPrice(coin, 'rare', false)).toBe(Math.round(coin.price * 1.5));
    expect(itemPrice(coin, 'epic', false)).toBe(Math.round(coin.price * 2.5));
    expect(itemPrice(itemById('chest'), 'common', false)).toBeGreaterThan(itemPrice(coin, 'epic', false));
  });
  it('golden find is x5', () => {
    const vase = itemById('brassvase');
    expect(itemPrice(vase, 'common', true)).toBe(vase.price * GOLDEN_MUL);
    expect(itemPrice(vase, 'rare', true)).toBe(Math.round(vase.price * 1.5 * GOLDEN_MUL));
  });
  it('items get more valuable as they unlock later', () => {
    for (let i = 1; i < ITEMS.length; i++) {
      expect(ITEMS[i].price).toBeGreaterThan(ITEMS[i - 1].price);
      expect(ITEMS[i].unlockAt).toBeGreaterThanOrEqual(ITEMS[i - 1].unlockAt);
    }
  });
});

describe('rarity', () => {
  it('maps uniform numbers to chances', () => {
    expect(rollRarity(0)).toBe('common');
    expect(rollRarity(0.71)).toBe('common');
    expect(rollRarity(0.75)).toBe('rare');
    expect(rollRarity(0.95)).toBe('epic');
    expect(rollRarity(0.9999)).toBe('epic');
  });
});

describe('tools', () => {
  it('go sponge → brush → washer → laser with rising cost and power', () => {
    expect(TOOLS.map((t) => t.id)).toEqual(['sponge', 'brush', 'washer', 'laser']);
    for (let i = 1; i < TOOLS.length; i++) {
      expect(TOOLS[i].cost).toBeGreaterThan(TOOLS[i - 1].cost);
      expect(TOOLS[i].tier).toBe(TOOLS[i - 1].tier + 1);
    }
  });
  it('only tier 2+ removes rust at full speed', () => {
    expect(rustRate(toolById('sponge'))).toBeLessThan(0.2);
    for (const t of TOOLS.filter((x) => x.tier >= 2)) expect(rustRate(t)).toBe(1);
  });
  it('rusty items are much slower with the sponge', () => {
    const key = itemById('pliers');
    expect(cleanSeconds(key, toolById('sponge'))).toBeGreaterThan(3 * cleanSeconds(key, toolById('brush')));
    // and every better tool is faster
    const lantern = itemById('lantern');
    const times = TOOLS.map((t) => cleanSeconds(lantern, t));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThan(times[i - 1]);
  });
});

describe('helpers', () => {
  const bench = helperById('bench');
  it('earn nothing until bought, more with each level', () => {
    expect(helperRate(bench, 0)).toBe(0);
    expect(helperRate(bench, 1)).toBe(bench.baseRate);
    expect(helperRate(bench, 3)).toBeGreaterThan(helperRate(bench, 2));
  });
  it('speed upgrades shorten the work cycle down to a floor', () => {
    expect(helperCycle(bench, 2)).toBeLessThan(helperCycle(bench, 1));
    expect(helperCycle(bench, 99)).toBe(1.5);
  });
  it('costs grow and stop at max level', () => {
    for (const h of HELPERS) {
      expect(helperCost(h, 0)).toBe(h.unlockCost);
      expect(helperCost(h, 3)).toBeGreaterThan(helperCost(h, 2));
      expect(helperCost(h, h.maxLevel)).toBe(Infinity);
    }
  });
});

describe('offline income', () => {
  it('is rate × time', () => {
    expect(offlineEarnings({ bench: 1 }, 100)).toBe(Math.floor(helperRate(helperById('bench'), 1) * 100));
  });
  it('is capped at 2 hours', () => {
    const lv = { bench: 3, polisher: 1 };
    expect(OFFLINE_CAP_SECONDS).toBe(7200);
    expect(offlineEarnings(lv, 10 * 3600)).toBe(offlineEarnings(lv, 7200));
    expect(offlineEarnings(lv, 3600)).toBeLessThan(offlineEarnings(lv, 7200));
  });
  it('is zero without helpers or for negative time', () => {
    expect(offlineEarnings({}, 5000)).toBe(0);
    expect(offlineEarnings({ bench: 2 }, -50)).toBe(0);
  });
});

describe('item pool', () => {
  it('starts with several items and unlocks new ones over time', () => {
    expect(unlockedItems(0).length).toBeGreaterThanOrEqual(4);
    expect(unlockedItems(1000)).toHaveLength(ITEMS.length);
    expect(nextLockedItem(0)?.id).toBe('teacup');
    expect(nextLockedItem(1000)).toBeNull();
    expect(ITEMS.length).toBeGreaterThanOrEqual(20);
  });
  it('never repeats the last 3 items', () => {
    const recent = ['watch', 'compass', 'magnifier'];
    for (let r = 0; r < 1; r += 0.02) expect(recent).not.toContain(pickItem(0, r, recent).id);
  });
  it('every item has a model, a real size and a unique id', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const it of ITEMS) {
      expect(it.model).toBeTruthy();
      expect(it.sizeCm).toBeGreaterThan(0);
    }
  });
  it('GOLDEN_EVERY is 20', () => expect(GOLDEN_EVERY).toBe(20));
});
