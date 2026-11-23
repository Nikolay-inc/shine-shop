// Three.js stage: workshop backdrop, pedestal, warm light with soft shadows, the item pivot, picking.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PreparedItem } from './itemPrep';

export interface Hit {
  /** Hit point in item space (unit-sphere coordinates). */
  local: THREE.Vector3;
  point: THREE.Vector3;
}

const PEDESTAL_TOP = 0;
const ITEM_LIFT = 1.06; // initial centre height of the unit-sphere item (it then rests on the pedestal)
/** Real-world references (cm) that convey the item's true size. */
const PEDESTAL_RADIUS_CM = 18;
const PLANK_CM = 14;
const corner = new THREE.Vector3();

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 9 / 16, 0.1, 60);
  readonly pivot = new THREE.Group();
  private item: PreparedItem | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private baseDist = 7;
  zoom = 1;
  /** Rotation state: yaw/pitch with inertia. */
  yaw = 0.5;
  pitch = 0.18;
  private velYaw = 0;
  private velPitch = 0;
  private width = 1;
  private height = 1;
  bob = 0;
  /** 0.62 (small item, more empty space around it) … 1 (large item fills the frame). */
  private fill = 1;
  private pedestal = new THREE.Group();
  private tableMap: THREE.Texture | null = null;
  private turnTo: { yaw: number; pitch: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
    this.scene.background = new THREE.Color(0x24170f);
    this.scene.fog = new THREE.Fog(0x24170f, 12, 26);

    this.buildWorkshop();
    this.pivot.position.set(0, PEDESTAL_TOP + ITEM_LIFT, 0);
    this.scene.add(this.pivot);
  }

  private buildWorkshop() {
    // lights: warm key spot with soft shadow, warm rim, dim hemisphere fill
    const key = new THREE.SpotLight(0xffd6a0, 70, 30, 0.42, 0.85, 1.6);
    key.position.set(2.6, 7.5, 4.2);
    key.target.position.set(0, ITEM_LIFT * 0.6, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 6;
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 16;
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xffb070, 1.0);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0xffe2bf, 0x2a1a10, 0.4));

    // back wall with workshop details (canvas texture, slightly blurred = depth of field feel)
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 16),
      new THREE.MeshBasicMaterial({ map: workshopTexture(), color: 0xb09a88, fog: false }),
    );
    wall.position.set(0, 3.2, -8);
    this.scene.add(wall);

    // workbench top
    this.tableMap = woodTexture();
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 14),
      new THREE.MeshStandardMaterial({ map: this.tableMap, roughness: 0.75, metalness: 0, color: 0xc9a27e }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.set(0, PEDESTAL_TOP - 0.62, -1);
    table.receiveShadow = true;
    this.scene.add(table);

    // turntable pedestal
    const V = (x: number, y: number) => new THREE.Vector2(x, y);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3720, roughness: 0.45, metalness: 0.05 });
    const base = new THREE.Mesh(new THREE.LatheGeometry([V(0, -0.62), V(1.05, -0.62), V(1.1, -0.56), V(1.1, -0.5), V(0.92, -0.42), V(0.85, -0.12), V(0.98, -0.06), V(1.0, -0.02), V(0, -0.02)], 64), wood);
    base.castShadow = true;
    base.receiveShadow = true;
    const felt = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 0.04, 64), new THREE.MeshStandardMaterial({ color: 0x6b2b24, roughness: 0.95 }));
    felt.position.y = PEDESTAL_TOP;
    felt.receiveShadow = true;
    this.pedestal.add(base, felt);
    this.scene.add(this.pedestal);

    // a few blurry props on the bench for depth
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 24), new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.4, transparent: true, opacity: 0.55 }));
    jar.position.set(-3.6, PEDESTAL_TOP - 0.17, -3.2);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.8 }));
    box.position.set(3.7, PEDESTAL_TOP - 0.22, -3.4);
    box.rotation.y = 0.4;
    this.scene.add(jar, box);
  }

  /** Adaptive quality: lowers the pixel ratio (2 → 1) when the device cannot hold 60 fps. Returns false at the floor. */
  lowerPixelRatio(): boolean {
    const pr = this.renderer.getPixelRatio();
    if (pr <= 1) return false;
    this.renderer.setPixelRatio(Math.max(1, pr - 0.25));
    this.renderer.setSize(this.width, this.height, false);
    return true;
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitCamera();
  }

  /**
   * @param sizeCm  real largest dimension of the item
   * @param radiusCm real bounding-sphere radius (= 1 world unit, since items are normalized to a unit sphere)
   */
  setItem(item: PreparedItem | null, sizeCm = 20, radiusCm = 12) {
    if (this.item) {
      this.pivot.remove(this.item.root);
      // geometry is cached per item type (ItemFactory); only materials are per instance
      for (const m of this.item.meshes) (m.material as THREE.Material).dispose();
    }
    this.item = item;
    if (item) {
      this.pivot.add(item.root);
      this.yaw = 0.55;
      this.pitch = 0.15;
      this.velYaw = this.velPitch = 0;
      this.zoom = 1;
      this.applyScale(sizeCm, radiusCm);
      this.fitCamera();
      this.pivot.position.y = PEDESTAL_TOP + this.restLift();
    }
  }

  /**
   * Frame the item by its bounding box (not the sphere), so long thin things (hammer, lamp) are not tiny:
   * height up to ~52% of the screen (HUD lives above and below), width up to ~80%.
   */
  private fitCamera() {
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const size = this.item ? this.item.box.getSize(new THREE.Vector3()) : new THREE.Vector3(1.4, 1.4, 1.4);
    const halfH = (size.y / 2) * 1.05;
    const halfW = (Math.hypot(size.x, size.z) / 2) * 0.85;
    const byBox = Math.max(halfH / (0.52 * t), halfW / (0.8 * t * this.camera.aspect));
    // never so close that rotating swings the item far out of the frame
    const bySphere = Math.max(1 / (0.75 * t), 1 / (1.05 * t * this.camera.aspect));
    this.baseDist = Math.max(byBox, bySphere * 0.75);
  }

  /** Real scale: the pedestal and bench planks keep their real size relative to the item; small items get more room. */
  private applyScale(sizeCm: number, radiusCm: number) {
    const t = THREE.MathUtils.clamp(Math.log(sizeCm / 8) / Math.log(96 / 8), 0, 1);
    this.fill = 0.72 + 0.28 * t;
    const ped = THREE.MathUtils.clamp(PEDESTAL_RADIUS_CM / radiusCm, 1.0, 3.8);
    this.pedestal.scale.set(ped, 1, ped);
    const plank = THREE.MathUtils.clamp(PLANK_CM / radiusCm, 0.25, 4);
    this.tableMap?.repeat.set(30 / (6 * plank), 14 / (6 * plank));
  }

  /** How high the item centre must be for its rotated bounding box to rest on the pedestal. */
  private restLift(): number {
    if (!this.item) return ITEM_LIFT;
    const b = this.item.box;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'XYZ'));
    let minY = Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyQuaternion(q);
      minY = Math.min(minY, corner.y);
    }
    return -minY + 0.03;
  }

  rotate(dx: number, dy: number) {
    const k = 0.009;
    this.velYaw = dx * k;
    this.velPitch = dy * k;
    this.yaw += dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k, -1.5, 1.5);
    this.turnTo = null;
  }

  release() {
    /* keep velocity for inertia */
  }

  stopInertia() {
    this.velYaw = this.velPitch = 0;
    this.turnTo = null;
  }

  /** Smoothly turns the item to the given angles (nearest equivalent yaw). */
  turnToAngles(yaw: number, pitch: number) {
    const twoPi = Math.PI * 2;
    this.velYaw = this.velPitch = 0;
    this.turnTo = { yaw: yaw + Math.round((this.yaw - yaw) / twoPi) * twoPi, pitch };
  }

  /** Smoothly turns the item so that item-space direction `d` faces the camera. */
  faceDirection(d: THREE.Vector3) {
    const yaw = Math.atan2(-d.x, d.z);
    const pitch = THREE.MathUtils.clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)) + 0.15, -1.5, 1.5);
    // nearest equivalent yaw
    const twoPi = Math.PI * 2;
    const target = yaw + Math.round((this.yaw - yaw) / twoPi) * twoPi;
    this.velYaw = this.velPitch = 0;
    this.turnTo = { yaw: target, pitch };
  }

  setZoom(z: number) {
    this.zoom = THREE.MathUtils.clamp(z, 0.5, 1.35);
  }

  update(dt: number) {
    const damp = Math.pow(0.02, dt);
    this.velYaw *= damp;
    this.velPitch *= damp;
    this.yaw += this.velYaw * 0.5 * (dt * 60);
    this.pitch = THREE.MathUtils.clamp(this.pitch + this.velPitch * 0.5 * (dt * 60), -1.5, 1.5);
    if (this.turnTo) {
      const k = 1 - Math.pow(0.04, dt);
      this.yaw += (this.turnTo.yaw - this.yaw) * k;
      this.pitch += (this.turnTo.pitch - this.pitch) * k;
      if (Math.abs(this.turnTo.yaw - this.yaw) + Math.abs(this.turnTo.pitch - this.pitch) < 0.01) this.turnTo = null;
    }
    this.pivot.rotation.set(this.pitch, this.yaw, 0, 'XYZ');
    // rest on the pedestal; lift smoothly when a rotation needs more clearance
    const lift = PEDESTAL_TOP + this.restLift();
    this.pivot.position.y += (lift - this.pivot.position.y) * (dt > 0 ? 1 - Math.pow(0.001, dt) : 1);
    const d = (this.baseDist * this.zoom) / this.fill;
    const target = new THREE.Vector3(0, this.pivot.position.y - 0.12 * this.zoom, 0);
    this.camera.position.set(0, target.y + d * 0.2, d);
    this.camera.lookAt(target);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Raycast the item from canvas-relative pixel coords. */
  pick(x: number, y: number): Hit | null {
    if (!this.item) return null;
    this.ndc.set((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const hits = this.raycaster.intersectObjects(this.item.meshes, false);
    const hit = hits[0];
    if (!hit) return null;
    return { local: hit.object.worldToLocal(hit.point.clone()), point: hit.point };
  }

  /** Projects a world point to canvas pixels. */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
  }

  /** Renders and returns a square JPEG crop around the item (for "до/после"). */
  snapshot(size = 360): string {
    this.update(0);
    this.render();
    const src = this.renderer.domElement;
    if (!src.width || !src.height) return '';
    const c = this.toScreen(this.pivot.getWorldPosition(new THREE.Vector3()));
    const top = this.toScreen(this.pivot.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.25, 0)));
    const sx = src.width / this.width;
    const half = Math.abs(c.y - top.y) * sx;
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const g = out.getContext('2d')!;
    g.fillStyle = '#24170f';
    g.fillRect(0, 0, size, size);
    g.drawImage(src, c.x * sx - half, c.y * sx - half, half * 2, half * 2, 0, 0, size, size);
    return out.toDataURL('image/jpeg', 0.86);
  }
}

function woodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7a4f2e';
  g.fillRect(0, 0, 512, 512);
  for (let p = 0; p < 6; p++) {
    const y0 = p * 86;
    g.fillStyle = p % 2 ? '#80542f' : '#734929';
    g.fillRect(0, y0, 512, 84);
    g.strokeStyle = 'rgba(40,20,8,0.25)';
    for (let i = 0; i < 18; i++) {
      g.lineWidth = 1 + Math.random() * 1.5;
      g.beginPath();
      const yy = y0 + Math.random() * 84;
      for (let x = 0; x <= 512; x += 16) g.lineTo(x, yy + Math.sin(x / 60 + i) * 3);
      g.stroke();
    }
    g.fillStyle = 'rgba(20,10,4,0.6)';
    g.fillRect(0, y0 + 84, 512, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 2);
  t.anisotropy = 4;
  return t;
}

function workshopTexture(): THREE.CanvasTexture {
  const W = 1024, H = 768;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // planks
  for (let x = 0; x < W; x += 64) {
    g.fillStyle = (x / 64) % 2 ? '#5b3b25' : '#543621';
    g.fillRect(x, 0, 64, H);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x + 62, 0, 2, H);
  }
  g.filter = 'blur(3px)';
  // window with warm glow
  const wg = g.createRadialGradient(230, 230, 20, 230, 230, 330);
  wg.addColorStop(0, 'rgba(255,214,150,0.95)');
  wg.addColorStop(0.35, 'rgba(255,180,100,0.45)');
  wg.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = wg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,236,200,0.9)';
  g.fillRect(150, 130, 160, 200);
  g.fillStyle = '#3a2416';
  g.fillRect(226, 130, 8, 200);
  g.fillRect(150, 226, 160, 8);
  // pegboard with tool silhouettes
  g.fillStyle = '#8a6a48';
  g.fillRect(420, 110, 420, 260);
  g.fillStyle = 'rgba(40,25,12,0.55)';
  for (let y = 125; y < 365; y += 22) for (let x = 435; x < 835; x += 22) g.fillRect(x, y, 4, 4);
  g.fillStyle = '#2c1c11';
  g.fillRect(470, 140, 14, 150); // screwdriver
  g.fillRect(462, 280, 30, 50);
  g.fillRect(540, 150, 90, 22); // hammer head
  g.fillRect(578, 170, 14, 150);
  g.beginPath(); // wrench
  g.arc(700, 160, 26, 0, Math.PI * 2);
  g.fill();
  g.fillRect(692, 160, 16, 170);
  g.fillRect(760, 140, 50, 190); // saw
  // shelf with jars
  g.fillStyle = '#3b2617';
  g.fillRect(60, 470, 900, 22);
  const jars = ['#a8743c', '#6f8a5a', '#b9925a', '#5b6f8a', '#9a5a3c', '#c9a56a'];
  for (let i = 0; i < 12; i++) {
    g.fillStyle = jars[i % jars.length];
    const w = 40 + (i * 13) % 30;
    const h = 60 + (i * 29) % 60;
    g.fillRect(80 + i * 72, 470 - h, w, h);
  }
  // bokeh
  g.filter = 'blur(6px)';
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(255,${190 + (i * 7) % 50},${110 + (i * 11) % 60},${0.08 + (i % 5) * 0.03})`;
    g.beginPath();
    g.arc((i * 137) % W, 80 + ((i * 89) % 520), 10 + (i % 4) * 9, 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'none';
  // vignette
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(10,5,2,0.7)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
