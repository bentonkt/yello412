// A stylised map of Pittsburgh, shared by everything that needs to know where
// the rivers, hills and street grids are.
//
// Units are roughly 10 m. +x is east, +z is south, y is up. The Allegheny and the
// Monongahela meet at the origin and leave west as the Ohio.

export const CELL = 14;        // one city block, street centre to street centre
export const STREET = 0.115;   // half a street's width, as a share of a block

// [ax, az, bx, bz, half width]
export const RIVERS = [
  [0, 0, -170, -52, 15],       // Ohio
  [-170, -52, -460, -64, 16],
  [0, 0, 150, -78, 12.5],      // Allegheny
  [150, -78, 330, -122, 12],
  [330, -122, 560, -112, 12],
  [0, 0, 140, 62, 13],         // Monongahela
  [140, 62, 300, 92, 13],
  [300, 92, 520, 40, 13],
];
const OHIO = [0, 1], ALLE = [2, 3, 4], MON = [5, 6, 7];

// Street grids run parallel to the nearest river, like the real ones.
export const ANG_N = Math.atan2(-78, 150);
export const ANG_S = Math.atan2(62, 140);

// Where the giant speech bubble hangs, and the middle of the tall buildings.
export const HUB = [40, 60, -2];
export const CORE = [122, -8];
export const POINT = [33, -1];   // the tip of the Golden Triangle (the fountain)

export const STADIUMS = [
  { x: -52, z: -56, r: 17, open: Math.PI * 0.42, face: Math.PI * 0.36, glow: 'yellow' },   // Acrisure
  { x: 42, z: -50, r: 12.5, open: Math.PI * 0.7, face: Math.PI * 0.3, glow: 'white' },   // PNC Park
];

function segDist(i, x, z) {
  const s = RIVERS[i];
  const bx = s[2] - s[0], bz = s[3] - s[1];
  const px = x - s[0], pz = z - s[1];
  let h = (px * bx + pz * bz) / (bx * bx + bz * bz);
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = px - bx * h, dz = pz - bz * h;
  return Math.sqrt(dx * dx + dz * dz) - s[4];
}
function groupDist(group, x, z) {
  let d = Infinity;
  for (let i = 0; i < group.length; i++) d = Math.min(d, segDist(group[i], x, z));
  return d;
}

// Distance to the nearest river bank. Negative means in the water.
export function riverDist(x, z) {
  let d = Infinity;
  for (let i = 0; i < RIVERS.length; i++) d = Math.min(d, segDist(i, x, z));
  return d;
}

function polyZ(group, x) {
  for (let k = 0; k < group.length; k++) {
    const s = RIVERS[group[k]];
    const lo = Math.min(s[0], s[2]), hi = Math.max(s[0], s[2]);
    if ((x >= lo && x <= hi) || k === group.length - 1) {
      return s[1] + (s[3] - s[1]) * ((x - s[0]) / (s[2] - s[0]));
    }
  }
  return 0;
}
const ohioZ = (x) => polyZ(OHIO, x);
const alleZ = (x) => polyZ(ALLE, x);
const monZ = (x) => polyZ(MON, x);

// The line that splits the two street grids: the Ohio, then straight up the
// middle of downtown (Liberty Avenue, more or less).
export function boundaryZ(x) {
  if (x <= -170) return -52 + (x + 170) * (12 / 290);
  if (x <= 0) return x * (52 / 170);
  return x * -0.031;
}
export const isSouth = (x, z) => z > boundaryZ(x);

// 'N' north of the Ohio and Allegheny, 'S' south of the Ohio and Mon,
// 'W' in the wedge between the Allegheny and the Mon.
export function side(x, z) {
  if (x < 0) return z > ohioZ(x) ? 'S' : 'N';
  if (z > monZ(x)) return 'S';
  if (z < alleZ(x)) return 'N';
  return 'W';
}

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// Cheap value noise for a little unevenness in the hills.
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return lerp(
    lerp(hash2(ix, iz), hash2(ix + 1, iz), ux),
    lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), ux), uz);
}

// Ground height. Mount Washington rises straight off the south bank; the north
// side and the Hill District climb more gently, further back.
export function landHeight(x, z) {
  const sd = side(x, z);
  let h = 0;
  if (sd === 'S') {
    const d = Math.max(0, Math.min(groupDist(OHIO, x, z), groupDist(MON, x, z)));
    const ridge = 22 * smooth(6, 44, d);
    const flats = 18 * smooth(62, 150, d);
    h = lerp(ridge, flats, smooth(120, 235, x));
  } else if (sd === 'N') {
    const d = Math.max(0, Math.min(groupDist(OHIO, x, z), groupDist(ALLE, x, z)));
    h = 14 * smooth(105, 250, d);
  } else {
    h = 15 * smooth(235, 390, x);
  }
  if (h > 0.5) h += (noise(x / 70, z / 70) - 0.5) * 5 * smooth(0.5, 12, h);
  return Math.max(0, h);
}

export function slopeAt(x, z) {
  const e = 3;
  const dx = landHeight(x + e, z) - landHeight(x - e, z);
  const dz = landHeight(x, z + e) - landHeight(x, z - e);
  return Math.sqrt(dx * dx + dz * dz) / (2 * e);
}

// Grid coordinates <-> world, for a grid turned by `ang`.
export function toGrid(x, z, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [x * c + z * s, -x * s + z * c];
}
export function fromGrid(u, v, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [u * c - v * s, u * s + v * c];
}

// A point on a river's centre line and the direction across it, for bridges.
export function crossing(seg, t) {
  const s = RIVERS[seg];
  const dx = s[2] - s[0], dz = s[3] - s[1];
  const len = Math.sqrt(dx * dx + dz * dz);
  return {
    x: s[0] + dx * t, z: s[1] + dz * t,
    nx: -dz / len, nz: dx / len,   // across the river
    half: s[4],
  };
}

// Deterministic random numbers, so the city is the same city every visit.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { smooth, lerp };
