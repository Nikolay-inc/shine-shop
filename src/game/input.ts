// Gestures on the canvas: finger on item = clean, on empty space = rotate, pinch / wheel = zoom.
export interface InputHandlers {
  hitsItem(x: number, y: number): boolean;
  cleanStart(x: number, y: number): void;
  cleanMove(x0: number, y0: number, x1: number, y1: number): void;
  cleanEnd(): void;
  rotate(dx: number, dy: number): void;
  rotateEnd(): void;
  zoomBy(factor: number): void;
  pinchStart(): void;
  enabled(): boolean;
}

type Mode = 'none' | 'clean' | 'rotate' | 'pinch';

export class Input {
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: Mode = 'none';
  private pinchDist = 0;
  /** Last pointer position (for the tool cursor). */
  pos = { x: 0, y: 0 };
  cleaning = false;

  constructor(private el: HTMLElement, private h: InputHandlers) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('lostpointercapture', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent) => {
    if (!this.h.enabled()) return;
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.pos = p;
    if (this.pointers.size === 2) {
      if (this.mode === 'clean') this.h.cleanEnd();
      this.cleaning = false;
      this.mode = 'pinch';
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.h.pinchStart();
      return;
    }
    if (this.pointers.size > 2) return;
    if (this.h.hitsItem(p.x, p.y)) {
      this.mode = 'clean';
      this.cleaning = true;
      this.h.cleanStart(p.x, p.y);
    } else {
      this.mode = 'rotate';
    }
  };

  private move = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    const p = this.local(e);
    if (e.pointerType === 'mouse' || prev) this.pos = p;
    if (!prev) return;
    this.pointers.set(e.pointerId, p);
    if (this.mode === 'clean') this.h.cleanMove(prev.x, prev.y, p.x, p.y);
    else if (this.mode === 'rotate') this.h.rotate(p.x - prev.x, p.y - prev.y);
    else if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0 && d > 0) this.h.zoomBy(this.pinchDist / d);
      this.pinchDist = d;
    }
  };

  private up = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === 'clean') this.h.cleanEnd();
    if (this.mode === 'rotate') this.h.rotateEnd();
    this.cleaning = false;
    // after a pinch, wait for all fingers to lift before starting a new gesture
    this.mode = this.pointers.size && this.mode === 'pinch' ? 'pinch' : 'none';
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.h.zoomBy(Math.exp(e.deltaY * 0.0012));
  };

  cancel() {
    if (this.mode === 'clean') this.h.cleanEnd();
    this.mode = 'none';
    this.cleaning = false;
    this.pointers.clear();
  }
}
