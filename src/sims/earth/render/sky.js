/**
 * What is above the atmosphere: the star field and the Moon. (The Sun's disc is drawn by the atmosphere
 * pass, which knows how much air its light crosses.)
 *
 *  - Stars: a seeded, procedurally generated field in the J2000 equatorial frame, turned into the
 *    Earth-fixed frame every frame (precession, nutation, sidereal time) – the sky turns correctly, but the
 *    stars themselves are *generated*, not catalogue stars (a catalogue comes with M1; see the model card).
 *  - Moon: a sphere of the true radius at its true geocentric position, lit by the Sun (phases, earthshine
 *    left out), so it rises, sets and eclipses behind the globe on its own.
 */
import * as THREE from 'three/webgpu';
import { Fn, vec3, vec4, max, dot, normalize, instancedBufferAttribute, uniform, normalWorld, float } from 'three/tsl';

const MOON_RADIUS_M = 1737400;
const STAR_DISTANCE = 1e9; // m – beyond the Moon, inside the far plane

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {{ count?: number, sunIlluminance: Node, sunDirection: Node, starBrightness: Node }} opts
 */
export function createSky({ count = 4000, sunIlluminance, sunDirection, starBrightness }) {
  const group = new THREE.Group();
  group.name = 'sky';

  // --- stars ------------------------------------------------------------------------------------------
  const rand = mulberry32(20261031);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = rand();
    const v = rand();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * STAR_DISTANCE;
    positions[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * STAR_DISTANCE;
    positions[i * 3 + 2] = Math.cos(phi) * STAR_DISTANCE;
    // brightness: many faint, few bright (a magnitude-like power law), radiance units of the scene
    const m = Math.pow(rand(), 3.2);
    const temp = rand();
    color.setHSL(0.6 - temp * 0.12, 0.35 + 0.2 * rand(), 0.6 + 0.4 * temp);
    const k = 0.004 + 0.05 * m;
    colors[i * 3] = color.r * k;
    colors[i * 3 + 1] = color.g * k;
    colors[i * 3 + 2] = color.b * k;
  }
  const starPositions = new THREE.InstancedBufferAttribute(positions, 3);
  const starColors = new THREE.InstancedBufferAttribute(colors, 3);
  const starMaterial = new THREE.PointsNodeMaterial({ sizeAttenuation: false, transparent: false, depthWrite: false });
  starMaterial.positionNode = instancedBufferAttribute(starPositions);
  starMaterial.colorNode = vec4(instancedBufferAttribute(starColors).mul(starBrightness), 1);
  starMaterial.sizeNode = float(2);
  const stars = new THREE.Sprite(starMaterial);
  stars.count = count;
  stars.frustumCulled = false;
  stars.renderOrder = -10;
  const starFrame = new THREE.Group(); // EQJ → ECEF rotation, centred on the camera every frame
  starFrame.add(stars);
  group.add(starFrame);

  // --- the Moon ----------------------------------------------------------------------------------------
  const moonMaterial = new THREE.MeshBasicNodeMaterial();
  const moonAlbedo = uniform(0.12);
  moonMaterial.colorNode = Fn(() => {
    const n = normalize(normalWorld);
    const cosI = max(dot(n, sunDirection), 0);
    return vec3(moonAlbedo).mul(1 / Math.PI).mul(sunIlluminance).mul(cosI);
  })();
  const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS_M, 48, 24), moonMaterial);
  moon.frustumCulled = false;
  group.add(moon);

  const m4 = new THREE.Matrix4();
  return {
    group,
    stars,
    moon,
    /**
     * @param {{ cameraPosition: THREE.Vector3, eqjToEcef: number[][], moonPosition: number[] }} state
     */
    update({ cameraPosition, eqjToEcef, moonPosition }) {
      const m = eqjToEcef;
      m4.set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1);
      starFrame.matrixAutoUpdate = false;
      starFrame.matrix.copy(m4).setPosition(cameraPosition);
      starFrame.matrixWorldNeedsUpdate = true;
      moon.position.set(moonPosition[0], moonPosition[1], moonPosition[2]);
    },
    setStarsVisible(v) {
      starFrame.visible = v;
    },
    dispose() {
      starMaterial.dispose();
      moonMaterial.dispose();
      moon.geometry.dispose();
    },
  };
}
