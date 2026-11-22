// HTML/CSS interface over the canvas: HUD, goals, helper widget, sheets (shop, helpers, album, stats), modals.
import {
  HELPERS, ITEMS, RARITIES, SKINS, TOOLS, albumCount, goals, helperCost, helperCycle, helperRate,
  rarityById, totalHelperRate, type GameEvent, type GameState, type RarityId,
} from '../core';
import { ICONS, toolIcon } from './icons';

export interface UiActions {
  selectTool(id: string): void;
  buyTool(id: string): void;
  buySkin(id: string): void;
  selectSkin(id: string): void;
  buyHelper(id: string): void;
  toggleSound(): void;
  statsText(): string;
  statsData(): { rows: [string, string][]; counts: [string, number][]; events: GameEvent[] };
  resetProgress(): void;
  sheetChanged(open: boolean): void;
}

type SheetKind = 'shop' | 'helpers' | 'album' | 'stats';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export const fmt = (n: number) => {
  n = Math.floor(n);
  if (n < 10000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e5 ? 1 : 0)}K`;
  return `${(n / 1e6).toFixed(1)}M`;
};

const fmtRate = (r: number) => (r < 10 ? r.toFixed(1) : fmt(r));

export function fmtDuration(sec: number): string {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h} ч ${m} мин`;
  if (m) return `${m} мин ${s} с`;
  return `${s} с`;
}

export class Ui {
  private sheet: SheetKind | null = null;
  private sheetStamp = '';
  private helperCanvas!: HTMLCanvasElement;
  private helperT = 0;
  private coinsShown = 0;
  private modalResolve: (() => void) | null = null;

  constructor(private root: HTMLElement, private a: UiActions, private getState: () => GameState) {
    this.build();
  }

  private build() {
    this.root.insertAdjacentHTML(
      'beforeend',
      `
      <div id="hud">
        <header class="top">
          <div class="pill coins" id="coins-pill"><span class="ico">${ICONS.coin}</span><b id="coins">0</b><small id="rate"></small></div>
          <div class="top-actions">
            <button class="icon-btn" id="btn-sound" aria-label="Звук"></button>
            <button class="icon-btn" id="btn-stats" aria-label="Статистика">${ICONS.stats}</button>
          </div>
        </header>
        <div id="goals"></div>
        <button id="helper-widget" aria-label="Помощники">
          <canvas width="128" height="96"></canvas>
          <div class="hw-text"><b id="hw-title"></b><small id="hw-sub"></small></div>
          <div class="bar"><i id="hw-bar"></i></div>
        </button>
        <div id="item-info">
          <div class="item-line"><span id="item-name"></span><span id="item-badge" class="badge"></span></div>
          <div class="progress"><i id="progress-fill"></i><span id="progress-text">0%</span></div>
        </div>
        <div id="tools"></div>
        <nav id="nav">
          <button data-sheet="shop">${ICONS.shop}<span>Магазин</span></button>
          <button data-sheet="helpers">${ICONS.helper}<span>Помощники</span></button>
          <button data-sheet="album">${ICONS.album}<span>Коллекция</span><em id="album-count"></em></button>
        </nav>
      </div>
      <div id="cursor"></div>
      <div id="hint" class="hidden"><div class="hand">${ICONS.hand}</div><div class="trail"></div></div>
      <div id="sheet-backdrop" class="hidden"></div>
      <section id="sheet" class="hidden" role="dialog" aria-modal="true">
        <div class="sheet-head"><h2 id="sheet-title"></h2><button class="icon-btn" id="sheet-close" aria-label="Закрыть">${ICONS.close}</button></div>
        <div id="sheet-body"></div>
      </section>
      <div id="modal" class="hidden"><div class="modal-card" id="modal-card"></div></div>
      <div id="toasts"></div>
      <div id="loading" class="hidden"><div class="spinner"></div></div>
    `,
    );
    this.helperCanvas = $<HTMLCanvasElement>('#helper-widget canvas', this.root);
    $('#btn-sound', this.root).addEventListener('click', () => this.a.toggleSound());
    $('#btn-stats', this.root).addEventListener('click', () => this.openSheet('stats'));
    $('#helper-widget', this.root).addEventListener('click', () => this.openSheet('helpers'));
    $('#sheet-close', this.root).addEventListener('click', () => this.closeSheet());
    $('#sheet-backdrop', this.root).addEventListener('click', () => this.closeSheet());
    this.root.querySelectorAll<HTMLButtonElement>('#nav button').forEach((b) => b.addEventListener('click', () => this.openSheet(b.dataset.sheet as SheetKind)));
    $('#tools', this.root).addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]');
      if (!b) return;
      const s = this.getState();
      if (s.toolsOwned.includes(b.dataset.tool!)) this.a.selectTool(b.dataset.tool!);
      else this.openSheet('shop');
    });
    $('#sheet-body', this.root).addEventListener('click', (e) => this.onSheetClick(e));
  }

  get sheetOpen() {
    return this.sheet !== null;
  }

  get modalOpen() {
    return !$('#modal', this.root).classList.contains('hidden');
  }

  // ---------- HUD ----------

  refresh() {
    const s = this.getState();
    this.coinsShown = s.coins;
    $('#coins', this.root).textContent = fmt(s.coins);
    const rate = totalHelperRate(s.helpers);
    $('#rate', this.root).textContent = rate > 0 ? `+${fmtRate(rate)}/с` : '';
    $('#btn-sound', this.root).innerHTML = s.muted ? ICONS.soundOff : ICONS.soundOn;
    $('#btn-sound', this.root).classList.toggle('off', s.muted);
    const ac = albumCount(s);
    $('#album-count', this.root).textContent = `${ac.have}/${ac.total}`;

    // goals: next tool (or helper) + next album item
    $('#goals', this.root).innerHTML = goals(s)
      .map((g) => {
        const pct = Math.min(100, (g.have / g.need) * 100);
        const icon = g.kind === 'tool' ? toolIcon(TOOLS.find((t) => t.name === g.title)!.id, '#f4c27a', '#8a5a2b') : g.kind === 'helper' ? ICONS.helper : ICONS.album;
        const val = g.kind === 'album' ? `${g.have}/${g.need}` : `${fmt(g.have)}/${fmt(g.need)}`;
        return `<div class="goal ${pct >= 100 ? 'ready' : ''}" data-kind="${g.kind}"><span class="gi">${icon}</span><div class="gt"><span>${g.title}</span><div class="bar"><i style="width:${pct}%"></i></div></div><b>${val}</b></div>`;
      })
      .join('');
    this.root.querySelectorAll<HTMLElement>('.goal').forEach((el) =>
      el.addEventListener('click', () => this.openSheet(el.dataset.kind === 'album' ? 'album' : el.dataset.kind === 'helper' ? 'helpers' : 'shop')),
    );

    // tool palette: owned tools + the next one locked
    const skin = SKINS.find((k) => k.id === s.skin)!;
    const next = TOOLS.find((t) => !s.toolsOwned.includes(t.id));
    $('#tools', this.root).innerHTML = TOOLS.filter((t) => s.toolsOwned.includes(t.id) || t === next)
      .map((t) => {
        const owned = s.toolsOwned.includes(t.id);
        const afford = !owned && s.coins >= t.cost;
        return `<button data-tool="${t.id}" class="tool ${s.tool === t.id ? 'active' : ''} ${owned ? '' : 'locked'} ${afford ? 'afford' : ''}" aria-label="${t.name}">
          ${toolIcon(t.id, owned ? skin.color : '#b9a68f', owned ? skin.accent : '#6e5a45')}
          ${owned ? '' : `<span class="price">${ICONS.coin}${fmt(t.cost)}</span>`}
        </button>`;
      })
      .join('');

    // helper widget text
    const owned = HELPERS.filter((h) => (s.helpers[h.id] ?? 0) > 0);
    const hw = $('#helper-widget', this.root);
    hw.classList.toggle('locked', owned.length === 0);
    if (owned.length) {
      const top = owned[owned.length - 1];
      $('#hw-title', this.root).textContent = owned.length > 1 ? `${owned.length} помощника` : `${top.name.split('-')[0]} ур.${s.helpers[top.id]}`;
      $('#hw-sub', this.root).textContent = `+${fmtRate(totalHelperRate(s.helpers))}/с`;
    } else {
      const h = HELPERS[0];
      $('#hw-title', this.root).textContent = 'Верстак';
      $('#hw-sub', this.root).innerHTML = `${ICONS.coin}${fmt(h.unlockCost)}`;
    }
    hw.classList.toggle('afford', owned.length === 0 && s.coins >= HELPERS[0].unlockCost);

    // badge on nav when something is affordable
    const canShop = (next && s.coins >= next.cost) || SKINS.some((k) => !s.skinsOwned.includes(k.id) && s.coins >= k.cost);
    const canHelp = HELPERS.some((h) => s.coins >= helperCost(h, s.helpers[h.id] ?? 0));
    $('[data-sheet="shop"]', this.root).classList.toggle('dot', !!canShop);
    $('[data-sheet="helpers"]', this.root).classList.toggle('dot', canHelp);

    if (this.sheet) this.renderSheet(false);
  }

  /** Cheap per-frame update for the coin counter only. */
  refreshCoins() {
    const s = this.getState();
    if (Math.floor(s.coins) !== Math.floor(this.coinsShown)) {
      this.coinsShown = s.coins;
      $('#coins', this.root).textContent = fmt(s.coins);
    }
  }

  setItem(name: string, rarity: RarityId, golden: boolean) {
    $('#item-name', this.root).textContent = name;
    const b = $('#item-badge', this.root);
    const r = rarityById(rarity);
    b.textContent = golden ? '✦ Золотая находка' : r.name;
    b.style.background = golden ? 'linear-gradient(90deg,#ffd84d,#ffb627)' : r.color;
    b.classList.toggle('hidden', !golden && rarity === 'common');
    $('#item-info', this.root).classList.toggle('golden', golden);
  }

  setProgress(p: number) {
    const pct = Math.min(100, Math.floor(p * 100));
    $('#progress-fill', this.root).style.width = `${pct}%`;
    $('#progress-text', this.root).textContent = `${pct}%`;
  }

  setLoading(on: boolean) {
    $('#loading', this.root).classList.toggle('hidden', !on);
  }

  // ---------- tool cursor & hint ----------

  setCursor(x: number, y: number, visible: boolean, active: boolean) {
    const c = $('#cursor', this.root);
    c.style.transform = `translate(${x}px, ${y}px) rotate(${active ? -18 : -8}deg) scale(${active ? 1.08 : 1})`;
    c.classList.toggle('visible', visible);
  }

  setCursorTool(id: string, skinId: string) {
    const sk = SKINS.find((k) => k.id === skinId)!;
    $('#cursor', this.root).innerHTML = toolIcon(id, sk.color, sk.accent);
  }

  showHint(on: boolean, x = 0, y = 0) {
    const h = $('#hint', this.root);
    h.classList.toggle('hidden', !on);
    if (on) h.style.transform = `translate(${x}px, ${y}px)`;
  }

  // ---------- helper widget animation ----------

  drawHelper(dt: number) {
    const s = this.getState();
    this.helperT += dt;
    const c = this.helperCanvas;
    const g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const owned = HELPERS.filter((h) => (s.helpers[h.id] ?? 0) > 0);
    const def = owned[owned.length - 1] ?? HELPERS[0];
    const lvl = s.helpers[def.id] ?? 0;
    const cycle = helperCycle(def, Math.max(1, lvl));
    const p = lvl ? (s.helperProgress[def.id] ?? 0) / cycle : 0;
    $('#hw-bar', this.root).style.width = `${Math.min(100, p * 100)}%`;
    // bench
    g.fillStyle = '#6b4329';
    g.fillRect(8, 74, W - 16, 10);
    g.fillRect(16, 84, 8, 12);
    g.fillRect(W - 24, 84, 8, 12);
    // item on the bench gets cleaner with progress
    const ix = W / 2 + 8, iy = 56;
    g.fillStyle = lvl ? '#e0b45a' : '#7d6a55';
    g.beginPath();
    g.ellipse(ix, iy, 18, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(90,70,50,${lvl ? 0.85 * (1 - p) : 0.6})`;
    g.beginPath();
    g.ellipse(ix, iy, 18, 18, 0, 0, Math.PI * 2);
    g.fill();
    if (lvl && p > 0.85) {
      g.fillStyle = '#fff6dc';
      star(g, ix + 10, iy - 12, 6 * Math.sin(((p - 0.85) / 0.15) * Math.PI));
    }
    // robotic arm sweeping over the item
    const swing = lvl ? Math.sin(this.helperT * (6 / cycle) * Math.PI) * 0.6 : 0.2;
    const bx = 22, by = 72;
    const a1 = -1.1 + swing * 0.25;
    const jx = bx + Math.cos(a1) * 34, jy = by + Math.sin(a1) * 34;
    const a2 = 0.35 + swing;
    const ex = jx + Math.cos(a2) * 30, ey = jy + Math.sin(a2) * 30;
    g.strokeStyle = lvl ? (def.id === 'polisher' ? '#7fb3d5' : '#f0a640') : '#8f7c66';
    g.lineCap = 'round';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(jx, jy);
    g.lineTo(ex, ey);
    g.stroke();
    g.fillStyle = '#3b2616';
    g.beginPath();
    g.arc(jx, jy, 4, 0, Math.PI * 2);
    g.arc(bx, by, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = lvl ? '#fff' : '#b9a68f';
    g.fillRect(ex - 6, ey - 2, 12, 6);
  }

  // ---------- floating texts & toasts ----------

  coinPop(x: number, y: number, amount: number, big = false) {
    const el = document.createElement('div');
    el.className = `coin-pop ${big ? 'big' : ''}`;
    el.innerHTML = `${ICONS.coin}+${fmt(amount)}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.root.appendChild(el);
    const target = $('#coins-pill', this.root).getBoundingClientRect();
    const rootR = this.root.getBoundingClientRect();
    const dx = target.left - rootR.left + 30 - x;
    const dy = target.top - rootR.top + 16 - y;
    el.animate(
      [
        { transform: 'translate(-50%,-50%) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%,-120%) scale(1.1)', opacity: 1, offset: 0.25 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.6)`, opacity: 0.2 },
      ],
      { duration: big ? 1100 : 900, easing: 'cubic-bezier(.4,0,.2,1)' },
    ).onfinish = () => el.remove();
    setTimeout(() => {
      const pill = $('#coins-pill', this.root);
      pill.classList.remove('bump');
      void pill.offsetWidth;
      pill.classList.add('bump');
    }, big ? 1000 : 820);
  }

  toast(html: string) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    $('#toasts', this.root).appendChild(el);
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2700);
  }

  // ---------- modals ----------

  private openModal(html: string, cls = ''): HTMLElement {
    const m = $('#modal', this.root);
    const card = $('#modal-card', this.root);
    card.className = `modal-card ${cls}`;
    card.innerHTML = html;
    m.classList.remove('hidden');
    return card;
  }

  closeModal() {
    $('#modal', this.root).classList.add('hidden');
    const r = this.modalResolve;
    this.modalResolve = null;
    r?.();
  }

  /** "До/после" card with price; resolves when the player taps "Продать". */
  showFinish(opts: { before: string; after: string; name: string; rarity: RarityId; golden: boolean; price: number; isNew: boolean }): Promise<void> {
    const r = rarityById(opts.rarity);
    const card = this.openModal(
      `
      <div class="finish-title">${opts.golden ? '✦ Золотая находка! ✦' : 'Как новенькая!'}</div>
      <div class="finish-name">${opts.name} <span class="badge" style="background:${opts.golden ? 'linear-gradient(90deg,#ffd84d,#ffb627)' : r.color}">${opts.golden ? '×5' : r.name}</span></div>
      <div class="ba">
        <figure><img src="${opts.before}" alt="до"/><figcaption>До</figcaption></figure>
        <div class="ba-arrow">→</div>
        <figure><img src="${opts.after}" alt="после"/><figcaption>После</figcaption></figure>
      </div>
      ${opts.isNew ? `<div class="new-card">${ICONS.album} Новая карточка в альбоме!</div>` : ''}
      <button class="btn primary big" id="sell-btn">Продать <span class="ico">${ICONS.coin}</span>${fmt(opts.price)}</button>
    `,
      `finish ${opts.golden ? 'golden' : ''}`,
    );
    return new Promise((resolve) => {
      this.modalResolve = resolve;
      $('#sell-btn', card).addEventListener('click', () => this.closeModal(), { once: true });
    });
  }

  showOffline(coins: number, seconds: number): Promise<void> {
    const card = this.openModal(
      `
      <div class="offline-ico">${ICONS.helper}</div>
      <div class="finish-title">Пока тебя не было</div>
      <div class="offline-sum"><span class="ico">${ICONS.coin}</span>+${fmt(coins)} монет</div>
      <p class="muted">Помощники работали ${fmtDuration(Math.min(seconds, 7200))}${seconds > 7200 ? ' (максимум 2 часа)' : ''}</p>
      <button class="btn primary big" id="collect-btn">Забрать</button>
    `,
      'offline',
    );
    return new Promise((resolve) => {
      this.modalResolve = resolve;
      $('#collect-btn', card).addEventListener('click', () => this.closeModal(), { once: true });
    });
  }

  // ---------- sheets ----------

  openSheet(kind: SheetKind) {
    this.sheet = kind;
    this.sheetStamp = '';
    $('#sheet', this.root).classList.remove('hidden');
    $('#sheet-backdrop', this.root).classList.remove('hidden');
    $('#sheet', this.root).dataset.kind = kind;
    this.renderSheet(true);
    this.a.sheetChanged(true);
  }

  closeSheet() {
    this.sheet = null;
    $('#sheet', this.root).classList.add('hidden');
    $('#sheet-backdrop', this.root).classList.add('hidden');
    this.a.sheetChanged(false);
  }

  private renderSheet(force: boolean) {
    const s = this.getState();
    const kind = this.sheet!;
    // re-render only when something relevant changed (avoids flicker while helpers earn)
    const stamp = JSON.stringify([kind, Math.floor(s.coins), s.toolsOwned, s.tool, s.skin, s.skinsOwned, s.helpers, s.album, kind === 'stats' ? s.stats.playSeconds | 0 : 0]);
    if (!force && stamp === this.sheetStamp) return;
    // keep stats static while open (it is a snapshot; copy button reads fresh data)
    if (!force && kind === 'stats') return;
    this.sheetStamp = stamp;
    const titles: Record<SheetKind, string> = { shop: 'Магазин', helpers: 'Помощники', album: 'Коллекция', stats: 'Статистика' };
    $('#sheet-title', this.root).textContent = titles[kind];
    const body = $('#sheet-body', this.root);
    const scroll = body.scrollTop;
    body.innerHTML = kind === 'shop' ? this.shopHtml(s) : kind === 'helpers' ? this.helpersHtml(s) : kind === 'album' ? this.albumHtml(s) : this.statsHtml();
    body.scrollTop = scroll;
  }

  private priceBtn(cost: number, coins: number, action: string, id: string, label = '') {
    const ok = coins >= cost;
    return `<button class="btn buy ${ok ? 'primary' : 'disabled'}" data-action="${action}" data-id="${id}" ${ok ? '' : 'aria-disabled="true"'}>${label}<span class="ico">${ICONS.coin}</span>${fmt(cost)}</button>`;
  }

  private shopHtml(s: GameState): string {
    const skin = SKINS.find((k) => k.id === s.skin)!;
    const tools = TOOLS.map((t, i) => {
      const owned = s.toolsOwned.includes(t.id);
      const prevOwned = i === 0 || s.toolsOwned.includes(TOOLS[i - 1].id);
      const action = owned
        ? s.tool === t.id
          ? '<span class="tag">В руке</span>'
          : `<button class="btn" data-action="select-tool" data-id="${t.id}">Взять</button>`
        : prevOwned
          ? this.priceBtn(t.cost, s.coins, 'buy-tool', t.id)
          : `<span class="tag muted">${ICONS.lock} сначала ${TOOLS[i - 1].name.toLowerCase()}</span>`;
      const layers = t.rust ? 'пыль + ржавчина' : 'только пыль (ржавчину — еле-еле)';
      return `<div class="card row ${owned ? 'owned' : ''}">
        <div class="card-ico">${toolIcon(t.id, owned ? skin.color : '#c8b49c', owned ? skin.accent : '#6e5a45')}</div>
        <div class="card-main"><b>${t.name}</b><small>Ур. ${t.tier} · радиус ${Math.round(t.radius * 100)} · сила ${t.strength}</small><small>${layers}</small></div>
        <div class="card-act">${action}</div>
      </div>`;
    }).join('');
    const skins = SKINS.map((k) => {
      const owned = s.skinsOwned.includes(k.id);
      const act = owned
        ? s.skin === k.id
          ? '<span class="tag">Выбран</span>'
          : `<button class="btn" data-action="select-skin" data-id="${k.id}">Выбрать</button>`
        : this.priceBtn(k.cost, s.coins, 'buy-skin', k.id);
      return `<div class="card skin ${s.skin === k.id ? 'owned' : ''}"><div class="card-ico">${toolIcon(s.tool, k.color, k.accent)}</div><b>${k.name}</b>${act}</div>`;
    }).join('');
    return `<h3>Инструменты</h3>${tools}<h3>Скины инструментов</h3><div class="skins">${skins}</div>`;
  }

  private helpersHtml(s: GameState): string {
    return HELPERS.map((h) => {
      const lvl = s.helpers[h.id] ?? 0;
      const cost = helperCost(h, lvl);
      const rate = helperRate(h, lvl);
      const nextRate = helperRate(h, lvl + 1);
      const act = !isFinite(cost) ? '<span class="tag">Макс.</span>' : this.priceBtn(cost, s.coins, 'buy-helper', h.id, lvl ? 'Быстрее ' : 'Купить ');
      return `<div class="card row ${lvl ? 'owned' : ''}">
        <div class="card-ico helper-ico ${h.id}">${ICONS.helper}</div>
        <div class="card-main"><b>${h.name}${lvl ? ` · ур.${lvl}` : ''}</b>
          <small>${lvl ? `Сейчас +${fmtRate(rate)}/с · цикл ${helperCycle(h, lvl).toFixed(1)} с` : 'Сам чистит предметы и приносит монеты'}</small>
          ${isFinite(cost) ? `<small>Дальше: +${fmtRate(nextRate)}/с</small>` : ''}</div>
        <div class="card-act">${act}</div>
      </div>`;
    }).join('') + `<p class="muted center">Помощники работают и без тебя — до 2 часов.</p>`;
  }

  private albumHtml(s: GameState): string {
    const ac = albumCount(s);
    const cards = ITEMS.map((it) => {
      const e = s.album[it.id];
      if (!e) {
        const left = Math.max(0, it.unlockAt - s.restored);
        return `<div class="acard locked"><div class="acard-ico">${ICONS.lock}</div><b>???</b><small>${left > 0 ? `через ${left} предм.` : 'уже в очереди'}</small></div>`;
      }
      const r = rarityById(e.best);
      return `<div class="acard" style="--rc:${r.color}"><div class="acard-ico">${ICONS.sparkle}</div><b>${it.name}</b>
        <small>×${e.count} · лучшая: <span style="color:${r.color}">${r.name.toLowerCase()}</span></small>
        ${e.golden ? `<small class="gold">✦ золотых: ${e.golden}</small>` : ''}</div>`;
    }).join('');
    const legend = RARITIES.map((r) => `<span><i style="background:${r.color}"></i>${r.name} ×${r.mul}</span>`).join('') + '<span><i style="background:#ffd84d"></i>Золотая ×5 (1 из 20)</span>';
    return `<div class="album-head"><b>${ac.have} / ${ac.total}</b> карточек · восстановлено предметов: ${s.restored}</div><div class="legend">${legend}</div><div class="album">${cards}</div>`;
  }

  private statsHtml(): string {
    const d = this.a.statsData();
    const rows = d.rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    const counts = d.counts.map(([k, v]) => `<span class="chip">${k}: <b>${v}</b></span>`).join('');
    const ev = d.events
      .slice(-25)
      .reverse()
      .map((e) => {
        const t = new Date(e.t);
        const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
        const data = e.data ? Object.entries(e.data).map(([k, v]) => `${k}=${v}`).join(' ') : '';
        return `<li><code>${hh}</code> <b>${e.type}</b> <span>${data}</span></li>`;
      })
      .join('');
    return `<table class="stats">${rows}</table><div class="chips">${counts}</div>
      <button class="btn primary wide" data-action="copy-stats">Скопировать</button>
      <h3>Последние события</h3><ul class="events">${ev}</ul>
      <button class="btn danger wide" data-action="reset">Сбросить прогресс</button>`;
  }

  private onSheetClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const id = b.dataset.id!;
    switch (b.dataset.action) {
      case 'buy-tool':
        this.a.buyTool(id);
        break;
      case 'select-tool':
        this.a.selectTool(id);
        break;
      case 'buy-skin':
        this.a.buySkin(id);
        break;
      case 'select-skin':
        this.a.selectSkin(id);
        break;
      case 'buy-helper':
        this.a.buyHelper(id);
        break;
      case 'copy-stats':
        void copyText(this.a.statsText()).then((ok) => {
          b.textContent = ok ? 'Скопировано ✓' : 'Не удалось скопировать';
          setTimeout(() => (b.textContent = 'Скопировать'), 1600);
        });
        break;
      case 'reset':
        if (confirm('Сбросить весь прогресс?')) this.a.resetProgress();
        break;
    }
  }
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 ? r * 0.3 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.fill();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

