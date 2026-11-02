import * as THREE from 'three';
import type { Rgb } from '../spec/common';
import type { Shape } from './shape';

export const MAX_LEDS = 17;
export interface DeviceLook {
  color: Rgb;
  roughness: number;
  halo: number;
}

export function buildGeometry(shape: Shape, nu: number, nv: number) {
  const pos = new Float32Array(nu * (nv - 1) * 3 + 6);
  const ao = new Float32Array(nu * (nv - 1) + 2);
  const out = { d: 0, ao: 1 };
  const H = shape.halfThickness;
  const put = (i: number, r: number, sa: number, ca: number, front: boolean) => {
    const z = (front ? 1 : -1) * shape.zOf(r, front);
    const x = r * sa;
    const y = r * ca;
    // Base normal of an ellipsoid of the same proportions is close enough to push along.
    const nx = x;
    const ny = y;
    const nz = z / (H * H);
    const l = Math.hypot(nx, ny, nz) || 1;
    out.d = 0;
    out.ao = 1;
    shape.detail(x, y, z, out);
    pos[i * 3] = x + (nx / l) * out.d;
    pos[i * 3 + 1] = y + (ny / l) * out.d;
    pos[i * 3 + 2] = z + (nz / l) * out.d;
    ao[i] = out.ao;
  };
  // Rings from the front centre round the rim to the back centre.
  let i = 0;
  for (let v = 1; v < nv; v++) {
    const t = (v / nv) * Math.PI;
    const r = Math.sin(t);
    const front = t < Math.PI / 2;
    for (let u = 0; u < nu; u++) {
      const a = (u / nu) * Math.PI * 2;
      put(i++, r, Math.sin(a), Math.cos(a), front);
    }
  }
  const frontPole = i;
  put(i++, 0, 0, 1, true);
  const backPole = i;
  put(i++, 0, 0, 1, false);

  const rings = nv - 1;
  const idx = new Uint32Array(nu * 6 * (rings - 1) + nu * 6);
  let k = 0;
  for (let v = 0; v < rings - 1; v++) {
    for (let u = 0; u < nu; u++) {
      const a = v * nu + u;
      const b = v * nu + ((u + 1) % nu);
      const c = (v + 1) * nu + u;
      const d = (v + 1) * nu + ((u + 1) % nu);
      idx[k++] = a;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = d;
      idx[k++] = c;
    }
  }
  for (let u = 0; u < nu; u++) {
    const n = (u + 1) % nu;
    idx[k++] = frontPole;
    idx[k++] = n;
    idx[k++] = u;
    idx[k++] = backPole;
    idx[k++] = (rings - 1) * nu + u;
    idx[k++] = (rings - 1) * nu + n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aOcc', new THREE.BufferAttribute(ao, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

export class DeviceMesh {
  readonly group = new THREE.Group();
  private uniforms = {
    uLedPos: { value: Array.from({ length: MAX_LEDS }, () => new THREE.Vector3()) },
    uLedColor: { value: Array.from({ length: MAX_LEDS }, () => new THREE.Vector3()) },
    uPress: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uHalo: { value: 1 },
  };
  readonly material: THREE.MeshPhysicalMaterial;
  private leds: number;
  private presses: { x: number; y: number; z: number; a: number; target: number; key: number }[] = [];

  constructor(
    readonly shape: Shape,
    geometry: THREE.BufferGeometry,
    look: DeviceLook,
  ) {
    const u = this.uniforms;
    const pos = shape.ledPositions();
    this.leds = pos.length;
    pos.forEach((p, i) => u.uLedPos.value[i].set(p[0], p[1], p[2]));
    if (shape.indicator) u.uLedPos.value[pos.length].set(...shape.indicator);
    this.material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setRGB(look.color[0], look.color[1], look.color[2], THREE.SRGBColorSpace),
      roughness: look.roughness,
      metalness: 0,
      sheen: 0.5,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(0.9, 0.85, 0.8),
    });
    u.uHalo.value = look.halo;
    this.material.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aOcc; varying float vOcc; varying vec3 vObjPos;
          uniform vec4 uPress[4];`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vOcc = aOcc; vObjPos = position;
          for (int i = 0; i < 4; i++) {
            vec3 dp = position - uPress[i].xyz;
            transformed -= objectNormal * uPress[i].w * 0.045 * exp(-dot(dp, dp) / 0.022);
          }`,
        );
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying float vOcc; varying vec3 vObjPos;
          uniform vec3 uLedPos[${MAX_LEDS}]; uniform vec3 uLedColor[${MAX_LEDS}]; uniform float uHalo;
          float grainNoise(vec3 p) { return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          // Fine silicone grain.
          vec3 gp = vObjPos * 340.0;
          normal = normalize(normal + 0.035 * (vec3(grainNoise(gp), grainNoise(gp + 7.1), grainNoise(gp + 3.3)) - 0.5));`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb *= mix(0.08, 1.0, vOcc);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // A bright core in the silicone with a soft scatter round it.
          for (int i = 0; i < ${MAX_LEDS}; i++) {
            float l = dot(uLedColor[i], vec3(1.0));
            if (l < 0.001) continue;
            vec3 dp = vObjPos - uLedPos[i];
            float d2 = dot(dp, dp);
            float core = exp(-d2 / (0.00035 * uHalo));
            float halo = exp(-d2 / (0.0026 * uHalo));
            float wide = exp(-d2 / (0.012 * uHalo));
            // The core clips towards white, as a real LED under silicone does.
            totalEmissiveRadiance += uLedColor[i] * (core * 4.0 + halo * 1.1 + wide * 0.1) + vec3(l / 3.0) * core * 1.6;
          }`,
        );
    };
    this.material.customProgramCacheKey = () => 'stem-device-v1';
    const mesh = new THREE.Mesh(geometry, this.material);
    this.group.add(mesh);
  }

  setLeds(colors: readonly Rgb[], indicator?: Rgb) {
    const u = this.uniforms.uLedColor.value;
    for (let i = 0; i < this.leds; i++) {
      const c = colors[i] ?? [0, 0, 0];
      u[i].set(c[0], c[1], c[2]);
    }
    if (this.shape.indicator) {
      const c = indicator ?? [0, 0, 0];
      u[this.leds].set(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
    }
  }

  /** Soft press under a finger, keyed so several can run together. */
  press(key: number, x: number, y: number, z: number) {
    const p = this.presses.find((q) => q.key === key);
    if (p) Object.assign(p, { x, y, z, target: 1 });
    else if (this.presses.length < 4) this.presses.push({ key, x, y, z, a: 0, target: 1 });
  }
  release(key: number) {
    const p = this.presses.find((q) => q.key === key);
    if (p) p.target = 0;
  }

  animate(dt: number) {
    const u = this.uniforms.uPress.value;
    for (let i = this.presses.length - 1; i >= 0; i--) {
      const p = this.presses[i];
      p.a += (p.target - p.a) * Math.min(1, dt * 26);
      if (p.target === 0 && p.a < 0.01) this.presses.splice(i, 1);
    }
    for (let i = 0; i < 4; i++) {
      const p = this.presses[i];
      if (p) u[i].set(p.x, p.y, p.z, p.a);
      else u[i].w = 0;
    }
  }
}
