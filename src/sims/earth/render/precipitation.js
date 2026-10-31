/**
 * Falling rain and snow around the camera (docs/earth-sim/08 §6): a box of drops that follows the camera
 * and wraps around, so the drops stay put in the world while the walker moves through them. Rain falls at
 * ≈ 7 m/s as thin streaks along its velocity (fall plus wind), snow at ≈ 1 m/s as fluttering flakes; the
 * number drawn follows the precipitation rate at the camera, the slant follows the 10 m wind.
 *
 * All motion is in the vertex shader: each drop's place is its seed plus fall and drift, modulo the box,
 * minus the camera's own offset (kept in double precision on the CPU and wrapped to the box). The drops
 * are light scattered towards the eye: additive, in a scene of their own that is added after the
 * atmosphere pass.
 */
import * as THREE from 'three/webgpu';
import { Fn, vec3, float, uniform, attribute, normalize, cross, length, mix, smoothstep, sin, fract, max, clamp } from 'three/tsl';

const BOX = 36; // m, edge of the box of drops around the camera
const MAX_DROPS = 14000;

/** How many drops to draw (of MAX_DROPS) for a rate (mm/h): about 3000 at 1 mm/h, all at ≥ 12 mm/h (rain). */
export function dropCount(mmPerHour, snow = 0) {
  if (!(mmPerHour > 0.03)) return 0;
  // a millimetre of snow water is ten times the flakes of a millimetre of rain – and they fall slowly
  const k = Math.min(1, (mmPerHour * (1 + 7 * snow)) / 12) ** 0.6;
  return Math.round(MAX_DROPS * k);
}

/**
 * The drops' light (a grey radiance) comes from the frame loop: the sky at the camera, dimmer under thick
 * cloud and at night.
 * @returns {{ mesh: THREE.Mesh, uniforms: object, update: Function, dispose: Function }}
 */
export function createPrecipitation() {
  const geometry = new THREE.BufferGeometry();
  const corners = new Float32Array(MAX_DROPS * 4 * 2);
  const seeds = new Float32Array(MAX_DROPS * 4 * 4);
  const index = new Uint32Array(MAX_DROPS * 6);
  let s = 12345;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < MAX_DROPS; i++) {
    const seed = [rnd(), rnd(), rnd(), rnd()];
    const quad = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      corners.set(quad[k], (i * 4 + k) * 2);
      seeds.set(seed, (i * 4 + k) * 4);
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DROPS * 4 * 3), 3));
  geometry.setAttribute('corner', new THREE.BufferAttribute(corners, 2));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX);

  const uniforms = {
    time: uniform(0), // s
    offset: uniform(new THREE.Vector3()), // the camera's position in the box frame, wrapped (m)
    wind: uniform(new THREE.Vector3()), // m/s, east / north / 0
    snow: uniform(0), // 0 rain … 1 snow
    light: uniform(new THREE.Color(0.1, 0.1, 0.1)), // radiance the drops scatter
  };

  // drawn in their own pass and added onto the finished picture (index.js): the atmosphere pass treats pixels
  // without depth as sky and fades them like stars
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const seed = attribute('seed', 'vec4');
  const corner = attribute('corner', 'vec2');
  // fall speed (m/s): rain 6–9, snow 0.8–1.4, each drop its own
  const fall = mix(float(6).add(seed.w.mul(3)), float(0.8).add(seed.w.mul(0.6)), uniforms.snow);
  const flutter = vec3(sin(uniforms.time.mul(1.7).add(seed.x.mul(40))), sin(uniforms.time.mul(1.3).add(seed.y.mul(40))), float(0)).mul(uniforms.snow.mul(0.35));
  const velocity = vec3(uniforms.wind.x, uniforms.wind.y, fall.negate());
  const travelled = velocity.mul(uniforms.time).add(flutter);
  const centre = fract(seed.xyz.add(travelled.sub(uniforms.offset).div(BOX))).sub(0.5).mul(BOX);
  // the camera sits at the mesh origin (moved there every frame): streaks along the velocity, turned
  // towards the viewer; flakes are small squares facing it
  const toCam = normalize(centre.negate());
  const along = normalize(mix(normalize(velocity), normalize(cross(toCam, vec3(1, 0, 0))), uniforms.snow));
  const side = normalize(cross(along, toCam));
  const dist = length(centre);
  // streaks a few centimetres long per m/s (a 1/30 s glimpse), never thinner than about a pixel
  const lengthM = mix(length(velocity).mul(0.035), float(0.012), uniforms.snow);
  const widthM = max(mix(float(0.0018), float(0.012), uniforms.snow), dist.mul(0.0011));
  material.positionNode = Fn(() => centre.add(side.mul(corner.x.mul(widthM))).add(along.mul(corner.y.sub(0.5).mul(lengthM))))();
  // fade out towards the faces of the box and right at the lens (smoothstep edges stay low → high)
  const near = smoothstep(0.15, 0.6, dist);
  material.colorNode = uniforms.light;
  material.opacityNode = clamp(mix(float(0.22), float(0.75), uniforms.snow).mul(smoothstep(BOX * 0.3, BOX * 0.5, dist).oneMinus()).mul(near), 0, 1);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'precipitation';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;

  const enu = new THREE.Matrix4();
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  const last = new THREE.Vector3();
  let has = false;
  const acc = new THREE.Vector3(); // camera travel in the local frame, wrapped

  return {
    mesh,
    uniforms,
    /**
     * @param {{ cameraPosition: THREE.Vector3, latRad: number, lonRad: number, rate: number, snow: number,
     *           windEast: number, windNorth: number, seconds: number, light: THREE.Color, active: boolean }} s
     */
    update({ cameraPosition: cp, latRad, lonRad, rate, snow, windEast, windNorth, seconds, light, active }) {
      const count = active ? dropCount(rate, snow) : 0;
      mesh.visible = count > 0;
      if (!mesh.visible) {
        has = false;
        return false;
      }
      geometry.setDrawRange(0, count * 6);
      const sl = Math.sin(latRad);
      const cl = Math.cos(latRad);
      const so = Math.sin(lonRad);
      const co = Math.cos(lonRad);
      east.set(-so, co, 0);
      north.set(-sl * co, -sl * so, cl);
      up.set(cl * co, cl * so, sl);
      enu.makeBasis(east, north, up);
      mesh.quaternion.setFromRotationMatrix(enu);
      mesh.position.copy(cp);
      mesh.updateMatrixWorld(true);
      // the camera's travel in the local frame, wrapped to the box (double precision here)
      if (has) {
        const d = cp.clone().sub(last);
        acc.x = (((acc.x + d.dot(east)) % BOX) + BOX) % BOX;
        acc.y = (((acc.y + d.dot(north)) % BOX) + BOX) % BOX;
        acc.z = (((acc.z + d.dot(up)) % BOX) + BOX) % BOX;
      }
      last.copy(cp);
      has = true;
      uniforms.offset.value.copy(acc);
      uniforms.time.value = seconds % 1800; // float32 keeps millimetres this way
      uniforms.wind.value.set(windEast, windNorth, 0);
      uniforms.snow.value = snow;
      uniforms.light.value.copy(light);
      return true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
