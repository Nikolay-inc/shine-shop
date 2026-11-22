import { describe, expect, it } from 'vitest';
import { EventLog, MAX_EVENTS, SAVE_KEY, SAVE_VERSION, SaveService, uuid, type KV } from '../src/core';

class MemKV implements KV {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe('SaveService', () => {
  it('creates a new save with UUID playerId on first launch', () => {
    const svc = new SaveService(new MemKV(), () => 1000);
    const { data, isNew } = svc.load();
    expect(isNew).toBe(true);
    expect(data.version).toBe(SAVE_VERSION);
    expect(data.playerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('round-trips state and keeps playerId', () => {
    const kv = new MemKV();
    let now = 1000;
    const svc = new SaveService(kv, () => now);
    const { data } = svc.load();
    data.state.coins = 123;
    svc.save(data);
    now = 61000;
    const again = svc.load();
    expect(again.isNew).toBe(false);
    expect(again.data.state.coins).toBe(123);
    expect(again.data.playerId).toBe(data.playerId);
    expect(svc.secondsAway(again.data)).toBe(60);
  });
  it('stores exit time on save', () => {
    const kv = new MemKV();
    const svc = new SaveService(kv, () => 5555);
    const { data } = svc.load();
    svc.save(data);
    expect(JSON.parse(kv.getItem(SAVE_KEY)!).lastSeen).toBe(5555);
  });
  it('survives corrupted or future saves', () => {
    const kv = new MemKV();
    kv.setItem(SAVE_KEY, '{not json');
    expect(new SaveService(kv).load().isNew).toBe(true);
    kv.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION + 5, state: {} }));
    expect(new SaveService(kv).load().isNew).toBe(true);
  });
  it('fills fields missing in old saves', () => {
    const kv = new MemKV();
    kv.setItem(SAVE_KEY, JSON.stringify({ version: 1, playerId: 'p', lastSeen: 1, state: { coins: 5, helpers: { bench: 2 } } }));
    const { data } = new SaveService(kv).load();
    expect(data.state.coins).toBe(5);
    expect(data.state.helpers).toEqual({ bench: 2, polisher: 0 });
    expect(data.state.toolsOwned).toEqual(['sponge']);
    expect(data.events).toEqual([]);
  });
  it('works without storage', () => {
    const svc = new SaveService(null);
    const { data } = svc.load();
    expect(() => svc.save(data)).not.toThrow();
  });
  it('uuid is unique', () => {
    expect(new Set(Array.from({ length: 100 }, uuid)).size).toBe(100);
  });
});

describe('EventLog', () => {
  it('logs typed events with time and caps size', () => {
    let t = 0;
    const log = new EventLog([], () => ++t);
    log.log('item_start', { item: 'coin' });
    log.log('sell', { coins: 6 });
    expect(log.events[0]).toEqual({ t: 1, type: 'item_start', data: { item: 'coin' } });
    expect(log.count('sell')).toBe(1);
    for (let i = 0; i < MAX_EVENTS + 50; i++) log.log('item_done');
    expect(log.events).toHaveLength(MAX_EVENTS);
  });
});
