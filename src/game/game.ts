// Game orchestrator: wires core state, 3D stage, cleaning, input, audio, UI, saves and the event log.
import * as THREE from 'three';
import {
  AUTO_FINISH, EventLog, ITEMS, RUST_WEIGHT, SKINS, SaveService, buyHelper, buySkin, buyTool, collectOffline,
  completeItem, currentPrice, helperById, itemById, rustRate, sellCurrent, startNextItem, tickHelpers, toolById,
  totalHelperRate, type EventType, type GameEvent, type GameState, type SaveData,
} from '../core';
import { Sound } from '../audio/sound';
import { Ui, fmtDuration } from '../ui/ui';
import { Cleaner } from './cleaner';
import { Fx } from './fx';
import { Input } from './input';
import { makeDirt, type PreparedItem } from './itemPrep';
import { ItemFactory } from './items';
import { Stage } from './stage';

type Phase = 'loading' | 'clean' | 'finishing' | 'sold';

/** How much one brush dab removes with strength 1 on a dust-1 item (tuned by hand: sponge ≈ 9 s on the coin). */
const DAB = 0.3;
/** Visual brush radius multiplier over ToolDef.radius (feel; the sim uses the relative radius). */
const BRUSH_SCALE = 1.4;

function safeStorage(): Storage | null {
  try {
    const k = '__shine_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    return null;
  }
}

export class Game {
  private saves = new SaveService(safeStorage());
  private data!: SaveData;
  state!: GameState;
  private log!: EventLog;
  private stage!: Stage;
  private cleaner = new Cleaner();
  private fx!: Fx;
  private sound = new Sound();
  private ui!: Ui;
  private input!: Input;
  private factory = new ItemFactory();
  private item: PreparedItem | null = null;
  private dirtTex: THREE.Texture | null = null;
  private phase: Phase = 'loading';
  private last = performance.now();
  private progressTimer = 0;
  private painted = false;
  private saveTimer = 0;
  private itemStartedAt = 0;
  private beforeShot = '';
  private beforeAngles = { yaw: 0, pitch: 0 };
  private lastHit: THREE.Vector3 | null = null;
  private moveDist = 0;
  private speed = 0;
  private sessionStart = Date.now();
  private hiddenAt = 0;
  private resetting = false;
  private finishT = 0;
  private sheetOpen = false;
  /** Rolling FPS for the stats screen / tests. */
  fps = 60;
  private frames = 0;
  private fpsT = 0;
  private coinStreak = 0;
  private idleT = 0;
  private fpsLast = 0;

  constructor(private root: HTMLElement) {}

  async start() {
    const { data, isNew } = this.saves.load();
    this.data = data;
    this.state = data.state;
    this.log = new EventLog(data.events);
    this.state.stats.sessions++;
    this.logEvent('session_start', { first: isNew });

    const gl = this.root.querySelector<HTMLCanvasElement>('#gl')!;
    const fxc = this.root.querySelector<HTMLCanvasElement>('#fx')!;
    this.stage = new Stage(gl);
    this.fx = new Fx(fxc);
    this.ui = new Ui(this.root, this.uiActions(), () => this.state);
    this.input = new Input(gl, {
      enabled: () => this.phase === 'clean' && !this.sheetOpen && !this.ui.modalOpen,
      hitsItem: (x, y) => !!this.stage.pick(x, y),
      cleanStart: (x, y) => this.cleanStart(x, y),
      cleanMove: (x0, y0, x1, y1) => this.cleanMove(x0, y0, x1, y1),
      cleanEnd: () => this.cleanEnd(),
      rotate: (dx, dy) => {
        this.sound.unlock();
        this.stage.rotate(dx, dy);
      },
      rotateEnd: () => this.stage.release(),
      pinchStart: () => this.stage.stopInertia(),
      zoomBy: (f) => this.stage.setZoom(this.stage.zoom * f),
    });
    // unlock audio on the very first touch anywhere (autoplay policy)
    this.root.addEventListener('pointerdown', () => this.sound.unlock(), { capture: true });
    this.sound.setMuted(this.state.muted);
    this.sound.setTool(this.state.tool);
    this.ui.setCursorTool(this.state.tool, this.state.skin);

    const resize = () => {
      const r = this.root.getBoundingClientRect();
      this.stage.resize(r.width, r.height);
      this.fx.resize(r.width, r.height);
    };
    new ResizeObserver(resize).observe(this.root);
    resize();

    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.onHide());

    this.ui.refresh();
    await this.factory.init();

    // offline income since the last session
    let offline: { coins: number; seconds: number } | null = null;
    if (!isNew) offline = this.collectOffline(this.saves.secondsAway(data));

    // an item restored but not sold before closing → sell it now
    if (this.state.current?.done) this.sell(true);
    if (!this.state.current) this.newItem();
    await this.loadCurrent();
    requestAnimationFrame(this.frame);
    if (offline) await this.ui.showOffline(offline.coins, offline.seconds);
    this.save();
    (window as unknown as { __shine: Game }).__shine = this;
  }

  // ---------- items ----------

  private newItem() {
    const c = startNextItem(this.state);
    this.logEvent('item_start', { item: c.itemId, rarity: c.rarity, golden: c.golden, n: c.n });
  }

  private async loadCurrent() {
    const c = this.state.current!;
    const def = itemById(c.itemId);
    this.phase = 'loading';
    this.ui.setLoading(true);
    const item = await this.factory.build(def);
    const dirt = makeDirt(item.raster, def.rust, c.n * 7919 + def.price);
    this.dirtTex?.dispose();
    this.dirtTex = dirt.texture;
    item.uniforms.uMask.value = this.cleaner.texture;
    item.uniforms.uDirt.value = dirt.texture;
    item.uniforms.uGold.value = c.golden ? 1 : 0;
    item.uniforms.uSeed.value = (c.n % 17) * 1.37;
    this.cleaner.reset(item.raster, dirt.rust);
    this.stage.setItem(item);
    this.item = item;
    this.ui.setItem(def.name, c.rarity, c.golden);
    this.ui.setProgress(0);
    this.ui.setLoading(false);
    this.beforeShot = this.stage.snapshot();
    this.beforeAngles = { yaw: this.stage.yaw, pitch: this.stage.pitch };
    this.itemStartedAt = performance.now();
    this.phase = 'clean';
    // warm up upcoming models in the background
    for (const it of ITEMS) if (it.unlockAt <= this.state.restored + 8) this.factory.preload(it);
  }

  // ---------- cleaning ----------

  private dabAt(x: number, y: number, scale = 1): boolean {
    const hit = this.stage.pick(x, y);
    if (!hit) return false;
    this.lastHit = hit.local;
    this.applyDab(hit.local, scale);
    if (Math.random() < 0.6 * scale + 0.1) this.fx.stroke(this.state.tool, x, y, SKINS.find((k) => k.id === this.state.skin)!.color);
    return true;
  }

  private applyDab(p: THREE.Vector3, scale: number) {
    const tool = toolById(this.state.tool);
    const def = itemById(this.state.current!.itemId);
    const dust = (DAB * tool.strength * scale) / def.dust;
    const rust = (dust * rustRate(tool)) / RUST_WEIGHT;
    this.cleaner.dab(p.x, p.y, p.z, tool.radius * BRUSH_SCALE, dust, rust);
    this.painted = true;
  }

  private cleanStart(x: number, y: number) {
    this.sound.unlock();
    this.stage.stopInertia();
    this.dabAt(x, y);
    if (!this.state.tutorialDone) this.ui.showHint(false);
  }

  private cleanMove(x0: number, y0: number, x1: number, y1: number) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    this.moveDist += dist;
    const tool = toolById(this.state.tool);
    const itemPx = this.itemRadiusPx();
    const spacing = Math.max(5, tool.radius * BRUSH_SCALE * itemPx * 0.65);
    const steps = Math.min(6, Math.max(1, Math.ceil(dist / spacing)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.dabAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }

  private cleanEnd() {
    this.lastHit = null;
    this.fx.beam = null;
  }

  /** Screen position/radius of the item and current state — used by scripts/shots.mjs. */
  debugInfo() {
    const c = this.stage.toScreen(this.stage.pivot.position);
    return { x: c.x, y: c.y, r: this.itemRadiusPx(), phase: this.phase, progress: this.cleaner.progress, fps: this.fps, item: this.state.current?.itemId ?? null };
  }

  private itemRadiusPx(): number {
    const c = this.stage.toScreen(this.stage.pivot.position);
    const t = this.stage.toScreen(this.stage.pivot.position.clone().add(new THREE.Vector3(0, 1, 0)));
    return Math.abs(c.y - t.y);
  }

  private async finish() {
    if (this.phase !== 'clean') return;
    this.phase = 'finishing';
    this.input.cancel();
    this.fx.beam = null;
    this.sound.scrub(0);
    this.finishT = 0;
    const c = this.state.current!;
    const def = itemById(c.itemId);
    const { isNew } = completeItem(this.state);
    this.logEvent('item_done', { item: c.itemId, rarity: c.rarity, golden: c.golden, seconds: Math.round((performance.now() - this.itemStartedAt) / 100) / 10 });
    if (!this.state.tutorialDone) {
      this.state.tutorialDone = true;
      this.ui.showHint(false);
    }
    this.sound.chime(c.golden);
    this.stage.turnToAngles(this.beforeAngles.yaw, this.beforeAngles.pitch); // "after" shot from the same angle as "before"
    this.stage.setZoom(1);
    const center = this.stage.toScreen(this.stage.pivot.position);
    this.fx.sparkle(center.x, center.y, this.itemRadiusPx(), c.golden);
    this.save();
    await wait(1250);
    const after = this.stage.snapshot();
    this.ui.refresh();
    await this.ui.showFinish({ before: this.beforeShot, after, name: def.name, rarity: c.rarity, golden: c.golden, price: currentPrice(this.state), isNew });
    this.sell(false);
    if (isNew) this.ui.toast(`Новая карточка: <b>${def.name}</b>`);
    this.newItem();
    await this.loadCurrent();
    this.save();
  }

  private sell(silent: boolean) {
    const c = this.state.current;
    if (!c) return;
    const price = sellCurrent(this.state);
    this.logEvent('sell', { item: c.itemId, coins: price, rarity: c.rarity, golden: c.golden });
    if (!silent) {
      const r = this.root.getBoundingClientRect();
      this.ui.coinPop(r.width / 2, r.height * 0.42, price, true);
      for (let i = 0; i < 5; i++) setTimeout(() => this.sound.coin(i), 650 + i * 70);
    }
    this.ui.refresh();
  }

  // ---------- economy actions ----------

  private uiActions() {
    return {
      selectTool: (id: string) => {
        this.state.tool = id;
        this.sound.setTool(id);
        this.sound.click();
        this.ui.setCursorTool(id, this.state.skin);
        this.ui.refresh();
        this.save();
      },
      buyTool: (id: string) => {
        const r = buyTool(this.state, id);
        if (!r.ok) return;
        this.logEvent('buy_tool', { tool: id, cost: r.cost });
        this.sound.setTool(id);
        this.sound.chime();
        this.ui.setCursorTool(id, this.state.skin);
        this.ui.toast(`Новый инструмент: <b>${toolById(id).name}</b>`);
        this.ui.refresh();
        this.save();
      },
      buySkin: (id: string) => {
        const r = buySkin(this.state, id);
        if (!r.ok) return;
        this.logEvent('buy_skin', { skin: id, cost: r.cost });
        this.sound.coin(3);
        this.ui.setCursorTool(this.state.tool, id);
        this.ui.refresh();
        this.save();
      },
      selectSkin: (id: string) => {
        this.state.skin = id;
        this.sound.click();
        this.ui.setCursorTool(this.state.tool, id);
        this.ui.refresh();
        this.save();
      },
      buyHelper: (id: string) => {
        const r = buyHelper(this.state, id);
        if (!r.ok) return;
        this.logEvent('buy_helper', { helper: id, level: this.state.helpers[id], cost: r.cost });
        this.sound.coin(4);
        if (this.state.helpers[id] === 1) this.ui.toast(`<b>${helperById(id).name}</b> уже работает в углу`);
        this.ui.refresh();
        this.save();
      },
      toggleSound: () => {
        this.sound.unlock();
        this.state.muted = !this.state.muted;
        this.sound.setMuted(this.state.muted);
        this.ui.refresh();
        this.save();
      },
      statsData: () => this.statsData(),
      statsText: () => this.statsText(),
      resetProgress: () => {
        this.resetting = true;
        this.saves.reset();
        location.reload();
      },
      sheetChanged: (open: boolean) => {
        this.sheetOpen = open;
        if (open) this.input.cancel();
      },
    };
  }

  private statsData() {
    const s = this.state;
    const counts: [string, number][] = (['item_start', 'item_done', 'sell', 'buy_tool', 'buy_skin', 'buy_helper', 'offline_collect', 'session_start', 'session_end'] as EventType[]).map((t) => [t, this.log.count(t)]);
    const golden = Object.values(s.album).reduce((a, e) => a + e.golden, 0);
    const rows: [string, string][] = [
      ['Игрок', this.data.playerId.slice(0, 8)],
      ['Версия сохранения', String(this.data.version)],
      ['Сессий', String(s.stats.sessions)],
      ['Время в игре', fmtDuration(s.stats.playSeconds)],
      ['Восстановлено предметов', String(s.restored)],
      ['Золотых находок', String(golden)],
      ['Монет заработано', String(Math.floor(s.stats.coinsEarned))],
      ['— за предметы', String(Math.floor(s.stats.coinsFromItems))],
      ['— помощники', String(Math.floor(s.stats.coinsFromHelpers))],
      ['— офлайн', String(Math.floor(s.stats.coinsOffline))],
      ['Доход помощников', `${totalHelperRate(s.helpers).toFixed(1)} мон/с`],
      ['Инструменты', s.toolsOwned.map((t) => toolById(t).name).join(', ')],
      ['FPS', `${Math.round(this.fps)} (pixel ratio ${this.stage.renderer.getPixelRatio()})`],
    ];
    return { rows, counts, events: this.log.events };
  }

  private statsText(): string {
    const d = this.statsData();
    return JSON.stringify(
      {
        game: 'shine-shop',
        playerId: this.data.playerId,
        saveVersion: this.data.version,
        exportedAt: new Date().toISOString(),
        summary: Object.fromEntries(d.rows),
        counts: Object.fromEntries(d.counts),
        state: { coins: Math.floor(this.state.coins), restored: this.state.restored, helpers: this.state.helpers, tools: this.state.toolsOwned, skins: this.state.skinsOwned },
        events: d.events,
      },
      null,
      2,
    );
  }

  private collectOffline(seconds: number): { coins: number; seconds: number } | null {
    if (seconds < 60 || totalHelperRate(this.state.helpers) <= 0) return null;
    const coins = collectOffline(this.state, seconds);
    if (coins <= 0) return null;
    this.logEvent('offline_collect', { coins, seconds: Math.round(seconds) });
    this.ui.refresh();
    return { coins, seconds };
  }

  // ---------- lifecycle ----------

  private logEvent(type: EventType, data?: GameEvent['data']) {
    this.log.log(type, data);
  }

  private save() {
    if (this.resetting) return;
    this.data.state = this.state;
    this.data.events = this.log.events;
    this.saves.save(this.data);
  }

  private onVisibility() {
    if (document.hidden) this.onHide();
    else if (this.hiddenAt) {
      const away = (Date.now() - this.hiddenAt) / 1000;
      this.hiddenAt = 0;
      this.sessionStart = Date.now();
      this.state.stats.sessions++;
      this.logEvent('session_start', { first: false });
      this.last = performance.now();
      const off = this.collectOffline(away);
      if (off && !this.ui.modalOpen) void this.ui.showOffline(off.coins, off.seconds).then(() => this.save());
      this.save();
    }
  }

  private onHide() {
    if (this.hiddenAt || this.resetting) return;
    this.hiddenAt = Date.now();
    this.input.cancel();
    this.sound.scrub(0);
    this.logEvent('session_end', { seconds: Math.round((Date.now() - this.sessionStart) / 1000), coins: Math.floor(this.state.coins) });
    this.save();
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.state.stats.playSeconds += dt;

    // fps (real time) + adaptive pixel ratio; ignore throttled background tabs (< 20 fps)
    this.frames++;
    this.fpsT += Math.max(0, (now - (this.fpsLast || now)) / 1000);
    this.fpsLast = now;
    if (this.fpsT >= 2) {
      this.fps = this.frames / this.fpsT;
      this.frames = 0;
      this.fpsT = 0;
      if (this.fps < 50 && this.fps > 20 && !document.hidden && this.phase === 'clean') this.stage.lowerPixelRatio();
    }

    // helpers
    const pays = tickHelpers(this.state, dt);
    if (pays.length) {
      const w = this.root.querySelector('#helper-widget')!.getBoundingClientRect();
      const r = this.root.getBoundingClientRect();
      for (const p of pays) {
        this.ui.coinPop(w.left - r.left + w.width / 2, w.top - r.top + 30, p.coins);
        this.sound.coin(this.coinStreak++, 0.35);
      }
      this.ui.refresh();
    }
    this.ui.drawHelper(dt);

    // cleaning: scrub-in-place while holding, sound by finger speed, progress
    if (this.phase === 'clean') {
      if (this.input.cleaning && this.lastHit) {
        const p = this.input.pos;
        if (this.moveDist < 1) this.applyDab(this.lastHit, dt * 2.5);
        const tool = this.state.tool;
        this.fx.beam = tool === 'laser' || tool === 'washer' ? { x: p.x, y: p.y, tool, color: '#ff6b6b' } : null;
        if ((tool === 'laser' || tool === 'washer') && Math.random() < 0.5) this.fx.stroke(tool, p.x, p.y, '#ffb3a0');
      }
      const target = this.input.cleaning ? Math.min(1, this.moveDist / Math.max(dt, 1e-3) / 1400 + 0.12) : 0;
      this.speed += (target - this.speed) * Math.min(1, dt * 12);
      this.sound.scrub(this.speed < 0.02 ? 0 : this.speed);
      this.moveDist = 0;
      this.progressTimer += dt;
      if (this.painted && this.progressTimer > 0.12) {
        this.progressTimer = 0;
        this.painted = false;
        const p = this.cleaner.computeProgress();
        this.ui.setProgress(p);
        if (p >= AUTO_FINISH) void this.finish();
      }
      // stuck on the last few % → gently turn the dirtiest side to the player
      this.idleT = this.input.cleaning ? 0 : this.idleT + dt;
      if (this.idleT > 2.2 && this.cleaner.progress > 0.8) {
        this.idleT = -4;
        const d = this.cleaner.dirtiestDirection();
        if (d) this.stage.faceDirection(d);
      }
      if (!this.state.tutorialDone && this.cleaner.progress < 0.03 && !this.input.cleaning) {
        const c = this.stage.toScreen(this.stage.pivot.position);
        this.ui.showHint(true, c.x, c.y);
      } else if (!this.state.tutorialDone && this.cleaner.progress >= 0.03) this.ui.showHint(false);
    }

    if (this.phase === 'finishing' && this.item) {
      this.finishT += dt;
      if (this.finishT < 0.7) this.cleaner.fillAll(Math.min(1, dt * 1.8));
      this.item.uniforms.uShine.value = this.finishT < 0.35 ? this.finishT / 0.35 : Math.max(0.25, 1 - (this.finishT - 0.35));
      if (this.finishT < 0.75) this.ui.setProgress(Math.min(1, this.cleaner.progress + this.finishT));
      else this.ui.setProgress(1);
    } else if (this.item && this.item.uniforms.uShine.value) this.item.uniforms.uShine.value = 0;

    // cursor follows the finger / mouse
    const showCursor = this.phase === 'clean' && !this.sheetOpen && (this.input.cleaning || matchMedia('(pointer: fine)').matches);
    this.ui.setCursor(this.input.pos.x, this.input.pos.y, showCursor, this.input.cleaning);

    this.ui.refreshCoins();
    this.cleaner.flush();
    this.stage.bob += dt * 1.2;
    this.stage.update(dt);
    this.stage.render();
    this.fx.update(dt);

    this.saveTimer += dt;
    if (this.saveTimer > 5) {
      this.saveTimer = 0;
      this.save();
    }
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
