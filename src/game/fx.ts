// 2D overlay effects drawn on a canvas above WebGL: tool particles, finish sparkles, laser beam / water jet.

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: 'bubble' | 'dust' | 'drop' | 'spark' | 'star';
}

export class Fx {
  private ctx: CanvasRenderingContext2D;
  private ps: Particle[] = [];
  private dpr = 1;
  private w = 1;
  private h = 1;
  /** Beam/jet target while cleaning with laser/washer. */
  beam: { x: number; y: number; tool: string; color: string } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  get count() {
    return this.ps.length;
  }

  /** Particles for one brush dab of `tool` at (x, y). */
  stroke(tool: string, x: number, y: number, color: string) {
    if (this.ps.length > 220) return;
    const r = Math.random;
    switch (tool) {
      case 'sponge':
        if (r() < 0.5) this.add({ x: x + (r() - 0.5) * 30, y: y + (r() - 0.5) * 30, vx: (r() - 0.5) * 20, vy: -10 - r() * 25, life: 0, max: 0.9 + r() * 0.6, size: 3 + r() * 6, color: 'rgba(255,255,255,0.8)', kind: 'bubble' });
        break;
      case 'brush':
        this.add({ x, y, vx: (r() - 0.5) * 120, vy: -20 - r() * 60, life: 0, max: 0.6 + r() * 0.4, size: 2 + r() * 3, color: r() < 0.5 ? '#8c7a62' : '#a0623a', kind: 'dust' });
        break;
      case 'washer':
        for (let i = 0; i < 2; i++) this.add({ x, y, vx: (r() - 0.5) * 260, vy: -60 - r() * 120, life: 0, max: 0.5 + r() * 0.3, size: 1.5 + r() * 2.5, color: 'rgba(180,220,255,0.9)', kind: 'drop' });
        break;
      case 'laser':
        this.add({ x, y, vx: (r() - 0.5) * 200, vy: (r() - 0.5) * 200, life: 0, max: 0.25 + r() * 0.25, size: 1 + r() * 2, color, kind: 'spark' });
        break;
    }
  }

  /** Finish burst around (x, y). */
  sparkle(x: number, y: number, radius: number, golden: boolean) {
    const n = golden ? 70 : 42;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = radius * (0.3 + Math.random() * 0.9);
      this.add({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        vx: Math.cos(a) * (20 + Math.random() * 60),
        vy: Math.sin(a) * (20 + Math.random() * 60) - 20,
        life: -Math.random() * 0.5,
        max: 0.8 + Math.random() * 0.9,
        size: 5 + Math.random() * 9,
        color: golden ? '#ffd84d' : Math.random() < 0.5 ? '#fff6dc' : '#ffd9a0',
        kind: 'star',
      });
    }
  }

  private add(p: Particle) {
    this.ps.push(p);
  }

  update(dt: number) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.beam) this.drawBeam(this.beam);
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.ps.splice(i, 1);
        continue;
      }
      if (p.life < 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'drop' || p.kind === 'dust') p.vy += 400 * dt;
      if (p.kind === 'bubble') p.vx *= 0.98;
      const t = p.life / p.max;
      const a = p.kind === 'star' ? Math.sin(Math.PI * t) : 1 - t;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.kind === 'bubble') {
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha *= 0.25;
        ctx.fill();
      } else if (p.kind === 'star') {
        star(ctx, p.x, p.y, p.size * (0.6 + 0.4 * Math.sin(Math.PI * t)));
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawBeam(b: NonNullable<Fx['beam']>) {
    const ctx = this.ctx;
    if (b.tool === 'laser') {
      const sx = this.w * 0.92, sy = this.h * 0.08;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,60,60,0.25)';
      ctx.lineWidth = 9;
      line(ctx, sx, sy, b.x, b.y);
      ctx.strokeStyle = 'rgba(255,170,170,0.95)';
      ctx.lineWidth = 2;
      line(ctx, sx, sy, b.x, b.y);
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 22);
      g.addColorStop(0, 'rgba(255,240,220,0.95)');
      g.addColorStop(0.3, 'rgba(255,90,60,0.6)');
      g.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x - 22, b.y - 22, 44, 44);
    } else if (b.tool === 'washer') {
      const sx = this.w * 0.95, sy = this.h * 0.95;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = `rgba(190,225,255,${0.25 + i * 0.15})`;
        ctx.lineWidth = 6 - i * 2;
        line(ctx, sx, sy, b.x + (Math.random() - 0.5) * 4, b.y + (Math.random() - 0.5) * 4);
      }
    }
  }
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 ? r * 0.28 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
