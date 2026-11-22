import { describe, expect, it } from 'vitest';
import { simulate } from '../scripts/sim';

describe('sim: first 30 minutes', () => {
  it('gets every tool and a helper; the brush within 3 minutes', () => {
    const { purchases } = simulate(42);
    const at = (name: string) => purchases.find((p) => p.what === name)?.t ?? Infinity;
    expect(at('Щётка')).toBeLessThan(180);
    expect(at('Верстак-автомат')).toBeLessThan(6 * 60);
    expect(at('Мойка высокого давления')).toBeLessThan(15 * 60);
    expect(at('Лазер')).toBeLessThan(30 * 60);
  });
  it('no wait longer than 3 minutes between purchases in the first 15 minutes', () => {
    for (let seed = 0; seed < 30; seed++) {
      const times = [0, ...simulate(seed).purchases.filter((p) => p.t <= 900).map((p) => p.t), 900];
      const gaps = times.slice(1).map((t, i) => t - times[i]);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(180);
    }
  });
});
