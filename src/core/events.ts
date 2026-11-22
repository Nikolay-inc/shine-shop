// Event log for analytics / the "Статистика" screen.
export type EventType =
  | 'item_start' | 'item_done' | 'sell' | 'buy_tool' | 'buy_skin' | 'buy_helper'
  | 'offline_collect' | 'session_start' | 'session_end';

export interface GameEvent {
  t: number; // epoch ms
  type: EventType;
  data?: Record<string, string | number | boolean>;
}

export const MAX_EVENTS = 400;

export class EventLog {
  events: GameEvent[];
  constructor(initial: GameEvent[] = [], private now: () => number = Date.now) {
    this.events = initial.slice(-MAX_EVENTS);
  }
  log(type: EventType, data?: GameEvent['data']): GameEvent {
    const e: GameEvent = { t: this.now(), type, ...(data ? { data } : {}) };
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    return e;
  }
  count(type: EventType): number {
    return this.events.filter((e) => e.type === type).length;
  }
}
