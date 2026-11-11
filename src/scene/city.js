// Lays out the buildings: where each one stands, how big it is and how many of
// its windows are lit. Pure data; world.js turns it into meshes.

import {
  CELL, STREET, ANG_N, ANG_S, CORE, STADIUMS,
  riverDist, landHeight, slopeAt, isSouth, boundaryZ, side, fromGrid,
} from './geo.js';

// Buildings you'd know from the skyline, placed by hand. Heights are stretched.
const LANDMARKS = [
  { name: 'steel', x: 158, z: -30, w: 13, d: 13, h: 50, top: 'flat', lit: 0.3 },        // U.S. Steel Tower
  { name: 'mellon', x: 136, z: -6, w: 10, d: 10, h: 41, top: 'mansard', lit: 0.42 },    // BNY Mellon
  { name: 'ppg', x: 96, z: 8, w: 9, d: 9, h: 35, top: 'castle', lit: 0.5 },            // PPG Place
  { name: 'fifth', x: 70, z: -12, w: 9, d: 9, h: 30, top: 'spire', lit: 0.4 },          // Fifth Avenue Place
  { name: 'gulf', x: 172, z: -52, w: 9, d: 9, h: 31, top: 'steps', lit: 0.38 },         // Gulf Tower
  { name: 'oxford', x: 128, z: 26, w: 9, d: 9, h: 36, top: 'flat', lit: 0.45 },         // One Oxford Centre
  { name: 'highmark', x: 100, z: -22, w: 8, d: 8, h: 33, top: 'spire', lit: 0.4 },
  { name: 'cathedral', x: 395, z: 6, w: 9, d: 9, h: 40, top: 'steps', lit: 0.3 },       // Cathedral of Learning
];

export function generateCity(rand, { reach = 640, thin = 1, clear = [] } = {}) {
  const boxes = [];    // { x, y, z, sx, sy, sz, ang, seed, lit, kind }  kind: 0 small, 1 tower, 2 no windows
  const roofs = [];    // pyramids, same fields
  const sites = [];    // rooftops a call can come from
  const beacons = [];  // lights on top of the tallest things

  const keepOut = [];
  for (const s of STADIUMS) keepOut.push([s.x, s.z, s.r + 7]);
  for (const l of LANDMARKS) keepOut.push([l.x, l.z, Math.max(l.w, l.d) * 0.5 + 6.5]);
  for (const c of clear) keepOut.push(c);
  const blocked = (x, z) => {
    for (let i = 0; i < keepOut.length; i++) {
      const k = keepOut[i];
      const dx = x - k[0], dz = z - k[1];
      if (dx * dx + dz * dz < k[2] * k[2]) return true;
    }
    return false;
  };

  const inner = CELL * (1 - 2 * STREET);

  // crown: how a landmark is lit (0 not, 1 a bright band under the roofline, 2 glass that glows, 3 brand yellow)
  function add(list, x, y, z, sx, sy, sz, ang, lit, kind, crown = 0) {
    list.push({ x, y, z, sx, sy, sz, ang, seed: rand(), lit, kind, crown });
  }

  function tower(x, z, y0, fx, fz, h, ang, lit) {
    add(boxes, x, y0, z, fx, h, fz, ang, lit, 1);
    if (h < 19) return;
    // Setbacks, the way tall buildings step in near the top.
    let top = y0 + h, w = fx, d = fz;
    const tiers = h > 30 ? 2 : 1;
    for (let t = 0; t < tiers; t++) {
      if (rand() < 0.3) break;
      w *= 0.7; d *= 0.7;
      const th = h * (0.1 + rand() * 0.1);
      add(boxes, x, top, z, w, th, d, ang, lit, 1);
      top += th;
    }
    const r = rand();
    if (r < 0.2) {
      add(roofs, x, top, z, w, w * (0.5 + rand() * 0.7), d, ang, 0, 2);
    } else if (r < 0.5) {
      const mast = 4 + rand() * 7;
      add(boxes, x, top, z, 0.4, mast, 0.4, ang, 0, 2);
      beacons.push([x, top + mast + 0.3, z]);
    }
  }

  function block(cx, cz, ang, dC) {
    const sd = side(cx, cz);
    const downtown = sd === 'W' && cx > 52 && cx < 226;
    const coreK = Math.exp(-Math.pow(dC / 60, 2));
    const density = Math.exp(-Math.pow(dC / 400, 2));
    const near = dC < 250 && landHeight(cx, cz) < 12;        // up on the hills it is all houses
    const n = downtown ? (coreK > 0.3 ? 1 : 2) : near ? 2 : 3;
    const lot = inner / n;

    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const u = ((a + 0.5) / n - 0.5) * inner;
      const v = ((b + 0.5) / n - 0.5) * inner;
      const off = fromGrid(u, v, ang);
      const x = cx + off[0], z = cz + off[1];

      const chance = downtown ? 0.95 : near ? 0.5 + 0.42 * density : density * 0.8;
      if (rand() > chance * thin) continue;
      if (riverDist(x, z) < lot * 0.72 + 1.6) continue;
      if (sd === 'W' && x < 52) continue;                 // Point State Park stays open
      if (blocked(x, z)) continue;
      if (slopeAt(x, z) > 0.5) continue;                  // the wooded hillsides

      const fx = lot * (0.6 + 0.3 * rand());
      const fz = lot * (0.6 + 0.3 * rand());
      const ground = landHeight(x, z);
      const sink = ground > 1 ? 3 : 0;
      const y0 = ground - sink;

      if (downtown) {
        const r = rand();
        const h = n === 1
          ? 9 + rand() * 9 + coreK * (8 + r * r * 30)
          : 5 + rand() * 8 + coreK * 9;
        tower(x, z, y0, fx, fz, h + sink, ang, 0.2 + rand() * 0.3);
      } else if (near) {
        const r = rand();
        let h = 1.5 + r * r * 4.6;
        if (rand() < 0.05) h = 7 + rand() * 7;
        add(boxes, x, y0, z, fx, h + sink, fz, ang, 0.1 + rand() * 0.22, h > 6.5 ? 1 : 0);
        if (h < 9 && dC > 45) sites.push([x, y0 + h + sink, z]);
      } else {
        const h = 1.1 + rand() * 1.4;
        add(boxes, x, y0, z, fx * 0.85, h + sink, fz * 0.85, ang, 0.2 + rand() * 0.3, 0);
        if (dC < 430 && rand() < 0.5) sites.push([x, y0 + h + sink, z]);
      }
    }
  }

  const span = Math.ceil(reach / CELL) + 12;
  for (const R of [{ south: false, ang: ANG_N }, { south: true, ang: ANG_S }]) {
    for (let i = -span; i < span; i++) for (let j = -span; j < span; j++) {
      const c = fromGrid((i + 0.5) * CELL, (j + 0.5) * CELL, R.ang);
      if (isSouth(c[0], c[1]) !== R.south) continue;
      // Leave a gap where the two grids meet, so blocks never overlap.
      if (c[0] > 0 && Math.abs(c[1] - boundaryZ(c[0])) < CELL * 0.62) continue;
      const dC = Math.hypot(c[0] - CORE[0], c[1] - CORE[1]);
      if (dC > reach) continue;
      block(c[0], c[1], R.ang, dC);
    }
  }

  for (const l of LANDMARKS) {
    const ang = isSouth(l.x, l.z) ? ANG_S : ANG_N;
    const y0 = landHeight(l.x, l.z);
    const band = l.name === 'steel' || l.name === 'mellon' || l.name === 'oxford' ? 1 : l.name === 'ppg' ? 2 : 0;
    add(boxes, l.x, y0, l.z, l.w, l.h, l.d, ang, l.lit, 1, band);
    let top = y0 + l.h;
    if (l.top === 'mansard') {
      add(boxes, l.x, top, l.z, l.w * 0.8, 3.2, l.d * 0.8, ang, 0, 2);
      add(boxes, l.x, top + 3.2, l.z, l.w * 0.52, 2.4, l.d * 0.52, ang, 0, 2);
      top += 5.6;
    } else if (l.top === 'spire') {
      add(roofs, l.x, top, l.z, l.w, 7, l.d, ang, 0, 2, 2);
      add(boxes, l.x, top + 6, l.z, 0.35, 9, 0.35, ang, 0, 2);
      top += 15;
    } else if (l.top === 'steps') {
      let w = l.w;
      for (let t = 0; t < 3; t++) {
        w *= 0.74;
        add(boxes, l.x, top, l.z, w, 2.6, w, ang, l.lit, 1, 3);
        top += 2.6;
      }
      add(roofs, l.x, top, l.z, w, 4.5, w, ang, 0, 2, 3);
      top += 4.5;
    } else if (l.top === 'castle') {
      // PPG Place: glass turrets on every corner and a crown in the middle.
      const c = Math.cos(ang), s = Math.sin(ang);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const u = a * l.w * 0.5, v = b * l.d * 0.5;
        const x = l.x + u * c - v * s, z = l.z + u * s + v * c;
        add(boxes, x, y0, z, 2.4, l.h + 2.5, 2.4, ang, l.lit, 1, 2);
        add(roofs, x, y0 + l.h + 2.5, z, 2.4, 6, 2.4, ang, 0, 2, 2);
      }
      add(roofs, l.x, top, l.z, l.w * 0.62, 5, l.d * 0.62, ang, 0, 2, 2);
      top += 8.5;
    } else {
      add(boxes, l.x, top, l.z, 0.5, 6, 0.5, ang, 0, 2);
      top += 6;
    }
    beacons.push([l.x, top + 0.4, l.z]);
  }

  return { boxes, roofs, sites, beacons };
}
