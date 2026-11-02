import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { V1 } from '../spec/v1';
import { V2 } from '../spec/v2';
import { DeviceMesh, buildGeometry } from './device';
import { hitControl, makeV1Shape, makeV2Shape, type DeviceKind, type Hit, type Shape } from './shape';

export type Look = 'tan' | 'bao' | 'clear' | 'v2';
const FRONT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.28, 0));

export const lookKind = (l: Look): DeviceKind => (l === 'v2' ? 'v2' : 'v1');

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private scene = new THREE.Scene();
  private pivot = new THREE.Group();
  private shadow: THREE.Mesh;
  device!: DeviceMesh;
  private geometries = new Map<string, { geo: THREE.BufferGeometry; shape: Shape }>();
  private target: THREE.Quaternion | null = FRONT.clone();
  private ray = new THREE.Raycaster();
  private density: [number, number];
  look: Look = 'tan';

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: location.search.includes('debug'),
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.79;
    const small = Math.min(innerWidth, innerHeight) < 600;
    this.density = small ? [640, 360] : [1024, 576];
    this.scene.background = new THREE.Color().setRGB(0.91, 0.9, 0.85, THREE.SRGBColorSpace);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environmentIntensity = 0.5;
    const key = new THREE.DirectionalLight(0xfff4e8, 1.15);
    key.position.set(-2.5, 3.5, 5);
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.35);
    fill.position.set(4, -1, 3);
    this.scene.add(key, fill, this.pivot);
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    this.camera.position.set(0, 0, 6.2);

    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(128, 128, 20, 128, 128, 128);
    g.addColorStop(0, 'rgba(70,60,50,.5)');
    g.addColorStop(0.55, 'rgba(70,60,50,.22)');
    g.addColorStop(1, 'rgba(70,60,50,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.3, 3.3),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.shadow.position.set(0.1, -0.26, -1.15);
    this.scene.add(this.shadow);
    this.resize();
    addEventListener('resize', () => this.resize());
    this.setLook('tan');
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole device on screen on narrow windows.
    const need = 1.28 / Math.min(1, this.camera.aspect);
    this.camera.position.z = need / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.updateProjectionMatrix();
  }

  setLook(look: Look) {
    this.look = look;
    const clear = look === 'clear';
    const key = look === 'v2' ? 'v2' : clear ? 'v1c' : 'v1';
    let e = this.geometries.get(key);
    if (!e) {
      const shape = look === 'v2' ? makeV2Shape() : makeV1Shape({ deepGrooves: clear });
      e = { shape, geo: buildGeometry(shape, this.density[0], this.density[1]) };
      this.geometries.set(key, e);
    }
    if (this.device) {
      this.pivot.remove(this.device.group);
      this.device.material.dispose();
    }
    const col = look === 'v2' ? V2.color : V1.skins[look].color;
    this.device = new DeviceMesh(e.shape, e.geo, {
      color: col,
      roughness: look === 'v2' ? 0.72 : clear ? 0.42 : 0.66,
      halo: look === 'v2' ? 1.6 : 1,
    });
    this.pivot.add(this.device.group);
    this.shadow.scale.setScalar(1);
  }

  get shape() {
    return this.device.shape;
  }

  /** Marches a screen ray to the device surface, using its profile rather than the dense mesh. */
  pick(ndcX: number, ndcY: number): { point: THREE.Vector3; hit: Hit } | null {
    this.ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const inv = this.pivot.matrixWorld.clone().invert();
    const o = this.ray.ray.origin.clone().applyMatrix4(inv);
    const d = this.ray.ray.direction.clone().transformDirection(inv);
    const s = this.shape;
    const inside = (p: THREE.Vector3) => {
      const r = Math.hypot(p.x, p.y);
      if (r >= 1) return false;
      return Math.abs(p.z) <= s.zOf(r, p.z >= 0);
    };
    const start = Math.max(0, o.length() - 1.2);
    const step = 0.012;
    const p = new THREE.Vector3();
    for (let t = start; t < start + 2.6; t += step) {
      p.copy(o).addScaledVector(d, t);
      if (inside(p)) {
        let a = t - step;
        let b = t;
        for (let i = 0; i < 6; i++) {
          const m = (a + b) / 2;
          p.copy(o).addScaledVector(d, m);
          if (inside(p)) b = m;
          else a = m;
        }
        p.copy(o).addScaledVector(d, b);
        return { point: p.clone(), hit: hitControl(s, p.x, p.y, p.z) };
      }
    }
    return null;
  }

  /** Screen position of an object-space point: for tests, and for the accessible overlay. */
  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(this.pivot.matrixWorld).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  rotate(dx: number, dy: number) {
    this.target = null;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * 0.008, dx * 0.008, 0));
    this.pivot.quaternion.premultiply(q);
  }

  /** Eases to a view: 'front', 'flat', or a rim angle turned toward the camera. */
  view(name: 'front' | 'flat' | 'back' | number, instant = false) {
    let q: THREE.Quaternion;
    if (name === 'front') q = FRONT.clone();
    else if (name === 'flat') q = new THREE.Quaternion();
    else if (name === 'back') q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
    else {
      // Roll the angle to the right of the view, then swing the rim round to the camera.
      const a = THREE.MathUtils.degToRad(name);
      const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a - Math.PI / 2);
      const swing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -1.15);
      q = swing.multiply(roll);
    }
    if (instant) {
      this.pivot.quaternion.copy(q);
      this.target = null;
    } else this.target = q;
  }

  render(dt: number) {
    if (this.target) {
      this.pivot.quaternion.slerp(this.target, Math.min(1, dt * 7));
      if (this.pivot.quaternion.angleTo(this.target) < 0.001) this.target = null;
    }
    this.pivot.updateMatrixWorld();
    this.device.animate(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
