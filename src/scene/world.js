// Builds the city: ground and rivers, buildings, the yellow bridges, the
// stadiums, and all the small lights. Returns meshes plus the rooftops calls
// can come from.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RIVERS, POINT, STADIUMS, landHeight, crossing, riverDist } from './geo.js';
import { generateCity } from './city.js';
import {
  SKY_VERT, SKY_FRAG, GROUND_VERT, GROUND_FRAG, BUILDING_VERT, BUILDING_FRAG,
  PROP_VERT, PROP_FRAG, LIGHT_VERT, LIGHT_FRAG,
} from './shaders.js';

const col = (hex) => new THREE.Color(hex);

// [river segment, how far along it, type, size]
const BRIDGES = [
  [0, 0.6, 'arch', 1.25],      // West End
  [2, 0.25, 'arch', 1],        // Fort Duquesne
  [2, 0.5, 'susp', 1],         // the Three Sisters
  [2, 0.585, 'susp', 1],
  [2, 0.67, 'susp', 1],
  [2, 0.84, 'girder', 1],      // Fort Wayne railroad bridge
  [3, 0.2, 'arch', 0.9],       // 16th Street
  [3, 0.72, 'girder', 1],
  [5, 0.27, 'arch', 1],        // Fort Pitt
  [5, 0.63, 'arch2', 1],       // Smithfield Street
  [5, 0.8, 'girder', 1],       // Panhandle
  [5, 0.93, 'girder', 1],      // Liberty
  [6, 0.2, 'susp', 1],         // South Tenth Street
  [6, 0.62, 'arch', 0.95],     // Birmingham
];

export function createWorld(shared, rand, quality) {
  const group = new THREE.Group();
  const uniforms = (extra) => Object.assign({}, shared, extra);

  // ---------- sky ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 12),
    new THREE.ShaderMaterial({
      uniforms: uniforms({ uZenith: { value: col(0x05070D) } }),
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    }));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  group.add(sky);

  // ---------- ground ----------
  // One sheet, finely divided near downtown and coarse out where the fog is.
  const N = quality.low ? 150 : 230;
  const R = 1400;
  const gg = new THREE.PlaneGeometry(2, 2, N, N);
  gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position;
  const warp = (u) => R * (0.24 * u + 0.76 * u * u * u);
  for (let i = 0; i < gp.count; i++) {
    const x = 40 + warp(gp.getX(i)), z = 5 + warp(gp.getZ(i));
    gp.setXYZ(i, x, landHeight(x, z), z);
  }
  gg.computeVertexNormals();
  const ground = new THREE.Mesh(gg, new THREE.ShaderMaterial({
    uniforms: uniforms({
      uSeg: { value: RIVERS.map((r) => new THREE.Vector4(r[0], r[1], r[2], r[3])) },
      uHw: { value: RIVERS.map((r) => r[4]) },
      uLand: { value: col(0x14181F) },
      uWater: { value: col(0x040609) },
      uSheen: { value: col(0x3A4350) },
      uStreet: { value: col(0x4A3418) },
      uLamp: { value: col(0xFFC47A) },
      uShore: { value: col(0x6A7480) },
    }),
    vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG,
  }));
  ground.frustumCulled = false;
  group.add(ground);

  // ---------- buildings ----------
  const city = generateCity(rand, { reach: quality.low ? 500 : 640, thin: quality.low ? 0.8 : 1, clear: quality.clear || [] });
  const buildingMat = new THREE.ShaderMaterial({
    uniforms: uniforms({
      uWall: { value: col(0x1E2431) },
      uRoof: { value: col(0x272E3B) },
      uWinWarm: { value: col(0xFFE2A8) },
      uWinCool: { value: col(0xC9DCFF) },
    }),
    vertexShader: BUILDING_VERT, fragmentShader: BUILDING_FRAG,
  });

  const dummy = new THREE.Object3D();
  function instanced(geometry, list) {
    const mesh = new THREE.InstancedMesh(geometry, buildingMat, list.length);
    const data = new Float32Array(list.length * 4);
    list.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, -b.ang, 0);
      dummy.scale.set(b.sx, b.sy, b.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      data[i * 4] = (Math.floor(b.seed * 4096) + 0.5) / 4096;   // see the snap in BUILDING_FRAG
      data[i * 4 + 1] = b.lit; data[i * 4 + 2] = b.kind; data[i * 4 + 3] = b.crown || 0;
    });
    geometry.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  group.add(instanced(boxGeo, city.boxes));
  const pyrGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  pyrGeo.rotateY(Math.PI / 4);
  pyrGeo.translate(0, 0.5, 0);
  group.add(instanced(pyrGeo, city.roofs));

  // ---------- props: bridges, incline, fountain ----------
  const parts = [];
  const lights = [];   // [ax, ay, az, bx, by, bz, r, g, b, size, speed, phase, twinkle]
  const YELLOW = col(0xE6C700), STEEL = col(0x3A3F46), CONCRETE = col(0x55595E);
  const WARM = col(0xFFD9A0), WHITE = col(0xFFF4E0), TAIL = col(0xFF4A2E), GOLD = col(0xFFDD00);

  function paint(g, c, glow) {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { a[i * 4] = c.r; a[i * 4 + 1] = c.g; a[i * 4 + 2] = c.b; a[i * 4 + 3] = glow || 0; }
    g.setAttribute('aColor', new THREE.BufferAttribute(a, 4));
    g.deleteAttribute('uv');
    return g;
  }
  function box(frame, cx, cy, cz, sx, sy, sz, c, glow) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.translate(cx, cy, cz);
    g.applyMatrix4(frame);
    parts.push(paint(g, c, glow));
  }
  function tube(frame, pts, radius, c, glow) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const g = new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), radius, 5, false);
    g.applyMatrix4(frame);
    parts.push(paint(g, c, glow));
  }
  function light(a, b, c, size, speed, phase, twinkle) {
    lights.push([a.x, a.y, a.z, b.x, b.y, b.z, c.r, c.g, c.b, size, speed || 0, phase === undefined ? rand() : phase, twinkle || 0]);
  }
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

  const DECK = 4.6;
  for (const [seg, t, type, size] of BRIDGES) {
    const c = crossing(seg, t);
    const L = (c.half + 9) * 2;
    const frame = new THREE.Matrix4().makeRotationY(Math.atan2(-c.nz, c.nx)).setPosition(c.x, 0, c.z);
    const at = (x, y, z) => v3(x, y, z).applyMatrix4(frame);
    const main = type === 'girder' ? STEEL : YELLOW;
    const W = 3.4;

    box(frame, 0, DECK, 0, L, 0.55, W, type === 'girder' ? CONCRETE : main);

    if (type === 'arch' || type === 'arch2') {
      const spans = type === 'arch2' ? [[-L * 0.21, L * 0.4], [L * 0.21, L * 0.4]] : [[0, L * 0.74 * Math.min(1, size)]];
      for (const [mid, S] of spans) {
        const H = S * 0.2 * size;
        for (const z of [-W / 2, W / 2]) {
          const pts = [];
          for (let i = 0; i <= 12; i++) {
            const u = i / 12 * 2 - 1;
            pts.push([mid + u * S / 2, DECK + H * (1 - u * u), z]);
          }
          tube(frame, pts, 0.36, main);
          const n = Math.floor(S / 2.6);
          for (let i = 1; i < n; i++) {
            const u = i / n * 2 - 1;
            const h = H * (1 - u * u);
            if (h > 0.5) box(frame, mid + u * S / 2, DECK + h / 2, z, 0.14, h, 0.14, main);
          }
        }
        for (const u of [-0.45, 0, 0.45]) box(frame, mid + u * S / 2, DECK + H * (1 - u * u), 0, 0.3, 0.3, W, main);
        for (const e of [-1, 1]) box(frame, mid + e * S / 2, DECK / 2 - 1, 0, 1.3, DECK + 2, W + 0.8, CONCRETE);
      }
    } else if (type === 'susp') {
      const T = L * 0.23, TOP = DECK + 8.5, END = L * 0.47;
      for (const e of [-1, 1]) {
        for (const z of [-W / 2, W / 2]) box(frame, e * T, (TOP + 0.4) / 2 - 1, z, 0.65, TOP + 2.4, 0.65, main);
        box(frame, e * T, TOP - 0.2, 0, 0.5, 0.5, W, main);
        box(frame, e * T, DECK + 4.2, 0, 0.4, 0.4, W, main);
        light(at(e * T, TOP + 0.6, 0), at(e * T, TOP + 0.6, 0), GOLD, 1.1, 0, undefined, 0.25);
      }
      for (const z of [-W / 2, W / 2]) {
        const pts = [];
        for (let i = 0; i <= 6; i++) { const u = i / 6; pts.push([-END + (END - T) * u, DECK + 0.4 + (TOP - DECK - 0.4) * u * u, z]); }
        for (let i = 1; i <= 10; i++) { const u = i / 10 * 2 - 1; pts.push([u * T, DECK + 1.3 + (TOP - DECK - 1.3) * u * u, z]); }
        for (let i = 1; i <= 6; i++) { const u = 1 - i / 6; pts.push([END - (END - T) * u, DECK + 0.4 + (TOP - DECK - 0.4) * u * u, z]); }
        tube(frame, pts, 0.24, main);
        const n = Math.floor(T * 2 / 2.2);
        for (let i = 1; i < n; i++) {
          const u = i / n * 2 - 1;
          const h = 1.3 + (TOP - DECK - 1.3) * u * u;
          box(frame, u * T, DECK + h / 2, z, 0.1, h, 0.1, main);
        }
      }
    } else {
      for (const u of [-0.3, 0, 0.3]) box(frame, u * L, DECK / 2 - 1, 0, 1.2, DECK + 2, W, CONCRETE);
      box(frame, 0, DECK + 0.8, -W / 2, L, 1.1, 0.25, STEEL);
      box(frame, 0, DECK + 0.8, W / 2, L, 1.1, 0.25, STEEL);
    }

    // lamps along both sides of the deck
    const lamps = Math.floor(L / 3.6);
    for (let i = 0; i <= lamps; i++) {
      const x = -L / 2 + (i / lamps) * L;
      for (const z of [-W / 2, W / 2]) {
        const p = at(x, DECK + 1.1, z);
        light(p, p, WARM, 0.55, 0, undefined, 0.15);
      }
    }
    // traffic
    const cars = quality.low ? 4 : 7;
    for (let i = 0; i < cars; i++) {
      const sp = 0.035 + rand() * 0.03;
      light(at(-L / 2, DECK + 0.7, -0.75), at(L / 2, DECK + 0.7, -0.75), WHITE, 0.5, sp, rand());
      light(at(L / 2, DECK + 0.7, 0.75), at(-L / 2, DECK + 0.7, 0.75), TAIL, 0.42, sp, rand());
    }
  }

  // The Duquesne Incline, climbing Mount Washington.
  {
    const c = crossing(0, 0.2);
    const foot = v3(c.x + c.nx * (c.half + 5), 0, c.z + c.nz * (c.half + 5));
    const head = v3(c.x + c.nx * (c.half + 44), 0, c.z + c.nz * (c.half + 44));
    // nz points south for the Ohio's first leg? make sure we climb the south bank
    if (landHeight(head.x, head.z) < 5) {
      foot.set(c.x - c.nx * (c.half + 5), 0, c.z - c.nz * (c.half + 5));
      head.set(c.x - c.nx * (c.half + 44), 0, c.z - c.nz * (c.half + 44));
    }
    foot.y = landHeight(foot.x, foot.z) + 0.6;
    head.y = landHeight(head.x, head.z) + 0.9;
    const I = new THREE.Matrix4();
    const side = v3(head.z - foot.z, 0, foot.x - head.x).normalize().multiplyScalar(0.7);
    for (const s of [-1, 1]) {
      const a = foot.clone().addScaledVector(side, s), b = head.clone().addScaledVector(side, s);
      tube(I, [[a.x, a.y, a.z], [(a.x + b.x) / 2, (a.y + b.y) / 2 + 0.6, (a.z + b.z) / 2], [b.x, b.y, b.z]], 0.16, STEEL);
      light(a.clone().setY(a.y + 0.8), b.clone().setY(b.y + 0.8), s < 0 ? GOLD : TAIL, 1.25, -0.035, s < 0 ? 0 : 0.5);
    }
  }

  // The fountain at the Point.
  {
    const I = new THREE.Matrix4().setPosition(POINT[0] + 6, 0, POINT[1]);
    const ring = new THREE.CylinderGeometry(3.4, 3.6, 0.5, 28, 1, true);
    ring.applyMatrix4(I);
    parts.push(paint(ring, CONCRETE, 0.4));
    for (let i = 0; i < 7; i++) {
      const p = v3(POINT[0] + 6, 0.8 + i * 1.15, POINT[1]);
      light(p, p, WHITE, 1.5 - i * 0.14, 0, i / 7, 0.45);
    }
  }

  // Roof beacons on the tallest buildings.
  for (const b of city.beacons) {
    const p = v3(b[0], b[1], b[2]);
    light(p, p, WHITE, 0.8, 0, undefined, 0.9);
  }

  const propMat = new THREE.ShaderMaterial({
    uniforms: uniforms({}), vertexShader: PROP_VERT, fragmentShader: PROP_FRAG, side: THREE.DoubleSide,
  });
  const props = new THREE.Mesh(mergeGeometries(parts, false), propMat);
  props.frustumCulled = false;
  group.add(props);
  parts.forEach((g) => g.dispose());

  // ---------- stadiums ----------
  for (const s of STADIUMS) {
    const arc = Math.PI * 2 - s.open;
    const from = s.face + s.open / 2;
    const inside = s.glow === 'yellow' ? col(0xA89200) : col(0x8E8A80);
    const bowl = mergeGeometries([
      paint(new THREE.CylinderGeometry(s.r, s.r * 0.94, 5.2, 48, 1, true, from, arc), inside, 1),                               // outer wall
      paint(new THREE.CylinderGeometry(s.r * 0.97, s.r * 0.5, 4.6, 48, 1, true, from, arc).translate(0, -0.3, 0), inside, 1),   // seats
    ], false);
    const turf = new THREE.Mesh(paint(new THREE.CircleGeometry(s.r * 0.5, 40).rotateX(-Math.PI / 2), col(0x1E4D33), 0.6), propMat);
    turf.position.set(s.x, 0.5, s.z);
    turf.frustumCulled = false;
    group.add(turf);
    const mesh = new THREE.Mesh(bowl, new THREE.ShaderMaterial({
      uniforms: uniforms({}),
      vertexShader: PROP_VERT,
      fragmentShader: PROP_FRAG.replace('vec3 col = vColor.rgb * mix(l, 1., vColor.a);',
        'vec3 col = gl_FrontFacing ? vec3(.022, .025, .03) * l : vColor.rgb * (.55 + .45 * smoothstep(-2.6, 2.6, vW.y - 2.6));'),
      side: THREE.DoubleSide,
    }));
    mesh.position.set(s.x, 2.6, s.z);
    mesh.frustumCulled = false;
    group.add(mesh);
    // floodlights around the rim
    for (let i = 0; i < 10; i++) {
      const th = s.face + s.open / 2 + (i + 0.5) / 10 * arc;
      const p = v3(s.x + Math.sin(th) * s.r, 6.4, s.z + Math.cos(th) * s.r);
      light(p, p, WHITE, 1.3, 0, undefined, 0.2);
    }
  }

  // A few boats on the rivers.
  if (!quality.low) {
    for (const seg of [0, 2, 5]) {
      const s = RIVERS[seg];
      for (let i = 0; i < 2; i++) {
        const o = (rand() - 0.5) * s[4] * 0.9;
        const dx = s[2] - s[0], dz = s[3] - s[1], len = Math.hypot(dx, dz);
        const nx = -dz / len * o, nz = dx / len * o;
        const a = v3(s[0] + dx * 0.12 + nx, 0.5, s[1] + dz * 0.12 + nz);
        const b = v3(s[0] + dx * 0.95 + nx, 0.5, s[1] + dz * 0.95 + nz);
        if (riverDist(a.x, a.z) < -2) light(a, b, WARM, 0.9, -0.006 - rand() * 0.004, rand(), 0.1);
      }
    }
  }

  // ---------- lights ----------
  const count = lights.length;
  const lg = new THREE.BufferGeometry();
  const pa = new Float32Array(count * 3), pb = new Float32Array(count * 3);
  const pc = new Float32Array(count * 3), pm = new Float32Array(count * 4);
  lights.forEach((l, i) => {
    pa.set(l.slice(0, 3), i * 3); pb.set(l.slice(3, 6), i * 3);
    pc.set(l.slice(6, 9), i * 3); pm.set(l.slice(9, 13), i * 4);
  });
  lg.setAttribute('position', new THREE.BufferAttribute(pa, 3));
  lg.setAttribute('aB', new THREE.BufferAttribute(pb, 3));
  lg.setAttribute('aCol', new THREE.BufferAttribute(pc, 3));
  lg.setAttribute('aMisc', new THREE.BufferAttribute(pm, 4));
  const lightMat = new THREE.ShaderMaterial({
    uniforms: uniforms({ uPx: { value: 1000 } }),
    vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  const points = new THREE.Points(lg, lightMat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  group.add(points);

  return { group, sites: city.sites, lightMat, counts: { buildings: city.boxes.length, lights: count } };
}
