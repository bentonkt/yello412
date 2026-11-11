// The camera's route through the city. Each shot is tied to a place on the
// page; scrolling flies from one to the next.
//
//   p, t     where the camera is and what it looks at
//   fov      lens (vertical, degrees)
//   sx, sy   slides the whole picture sideways / up, as a share of half the
//            screen, so the subject sits beside the text instead of under it
//   lift     extra height in the middle of the flight to the next shot
//   hold     0 = keep moving through this shot; otherwise the camera rests on
//            each shot for a while either side of its place on the page
//   tall     overrides for the stacked layout (phones, narrow or short windows)

import * as THREE from 'three';

// In page order: the hero (start and end of the pinned stretch), How it works
// (first and last step), Sorted, the yellow section, Pricing, the demo number,
// and the bottom of the page. index.js matches them to the page by position.
export const SHOTS = [
  // The view from Mount Washington: the Point below, downtown to the right.
  { name: 'heroA', p: [-110, 75, 190], t: [60, 32, 0], fov: 34, sx: 0.5, sy: 0.08, hold: 0,
    tall: { p: [-270, 86, -70], t: [44, 36, -2], fov: 46, sy: 0.36 } },
  { name: 'heroB', p: [-80, 58, 150], t: [60, 35, 0], fov: 36, sx: 0.5, sy: 0.06,
    tall: { p: [-215, 62, -58], t: [44, 40, -2], fov: 46, sy: 0.36 } },
  { name: 'how1', p: [-250, 46, -62], t: [44, 40, -2], fov: 36, sx: 0.2, sy: 0.2, lift: 26, hold: 0,
    tall: { t: [40, 52, -2], fov: 58, sy: 0.46 } },
  { name: 'how3', p: [-186, 27, -50], t: [44, 42, -2], fov: 40, sx: 0.2, sy: 0.2,
    tall: { t: [40, 54, -2], fov: 62, sy: 0.46 } },
  { name: 'sorted', p: [300, 90, -200], t: [44, 30, -6], fov: 36, sx: -0.5, sy: 0.1, lift: 40,
    tall: { p: [280, 250, -230], t: [40, 30, -2], fov: 52, sx: 0, sy: 0.38 } },
  { name: 'wipe', p: [58, 70, 78], t: [40, 60, -2], fov: 42, sx: 0, sy: -0.1,
    tall: { p: [70, 76, 150], fov: 54, sy: -0.1 } },
  { name: 'pricing', p: [270, 58, 100], t: [44, 50, -2], fov: 44, sx: 0.62, sy: 0.47,
    tall: { p: [280, 22, 90], t: [40, 52, -2], fov: 60, sx: 0, sy: 0.46 } },
  { name: 'demo', p: [-150, 26, -40], t: [50, 40, -2], fov: 40, sx: 0.5, sy: 0.02, lift: 115,
    tall: { t: [40, 52, -2], fov: 58, sx: 0, sy: 0.46 } },
  { name: 'end', p: [-200, 44, -56], t: [50, 38, -2], fov: 40, sx: 0.5, sy: 0.02,
    tall: { t: [40, 50, -2], fov: 58, sx: 0, sy: 0.46 } },
];

const HOLD = 0.2;          // share of each flight spent resting at either end
const DESIGN_ASPECT = 1.6; // the side-by-side shots are composed for windows at least this wide
const DESIGN_WIDTH = 1500; // past this the copy column stops growing, so the picture stops sliding further

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

function resolve(shot, stacked) {
  const o = stacked && shot.tall ? shot.tall : {};
  const pick = (k, d) => (o[k] !== undefined ? o[k] : shot[k] !== undefined ? shot[k] : d);
  return { p: pick('p'), t: pick('t'), fov: pick('fov'), sx: stacked && o.sx === undefined ? 0 : pick('sx', 0), sy: pick('sy', 0) };
}

export function createRig(camera) {
  const cur = { p: new THREE.Vector3(), t: new THREE.Vector3(), fov: 42, sx: 0, sy: 0 };
  const goal = { p: new THREE.Vector3(), t: new THREE.Vector3(), fov: 42, sx: 0, sy: 0 };
  const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
  const par = { x: 0, y: 0 };
  let started = false;

  return {
    cur,
    // Next update lands on the goal at once instead of gliding to it.
    snap() { started = false; },

    // story: 0..SHOTS.length-1, fractional between shots.
    // stacked: the page is in its one-column layout (see the media query in index.js).
    aim(story, stacked, width, height) {
      const i = Math.min(SHOTS.length - 2, Math.max(0, Math.floor(story)));
      const raw = clamp01(story - i);
      const h = SHOTS[i].hold === 0 ? 0 : HOLD;
      const f = smooth(clamp01((raw - h) / (1 - 2 * h)));
      const a = resolve(SHOTS[i], stacked), b = resolve(SHOTS[i + 1], stacked);
      goal.p.set(lerp(a.p[0], b.p[0], f), lerp(a.p[1], b.p[1], f), lerp(a.p[2], b.p[2], f));
      goal.p.y += (SHOTS[i + 1].lift || 0) * Math.sin(Math.PI * f);
      goal.t.set(lerp(a.t[0], b.t[0], f), lerp(a.t[1], b.t[1], f), lerp(a.t[2], b.t[2], f));
      let fov = lerp(a.fov, b.fov, f), sx = lerp(a.sx, b.sx, f);
      if (!stacked) {
        // A window narrower than the shots were composed for gets a wider lens, so the
        // same width of city stays in view; a very wide one keeps the subject by the copy.
        const aspect = width / height;
        if (aspect < DESIGN_ASPECT) {
          fov = Math.min(78, 2 * Math.atan(Math.tan(fov * Math.PI / 360) * DESIGN_ASPECT / aspect) * 180 / Math.PI);
        }
        sx *= Math.min(1, DESIGN_WIDTH / width);
      }
      goal.fov = fov;
      goal.sx = sx;
      goal.sy = lerp(a.sy, b.sy, f);
    },

    update(dt, time, pointer, intro, width, height) {
      const k = started ? 1 - Math.exp(-dt * 3.4) : 1;
      started = true;
      cur.p.lerp(goal.p, k);
      cur.t.lerp(goal.t, k);
      cur.fov = lerp(cur.fov, goal.fov, k);
      cur.sx = lerp(cur.sx, goal.sx, k);
      cur.sy = lerp(cur.sy, goal.sy, k);

      camera.position.copy(cur.p);
      camera.up.set(0, 1, 0);
      camera.lookAt(cur.t);
      camera.updateMatrixWorld();
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      fwd.setFromMatrixColumn(camera.matrixWorld, 2);

      // drift with the pointer, breathe a little, and pull in from further out on arrival
      const pk = 1 - Math.exp(-dt * 2.2);
      par.x = lerp(par.x, pointer.x, pk);
      par.y = lerp(par.y, pointer.y, pk);
      const dist = cur.p.distanceTo(cur.t);
      const amp = Math.min(1.6, dist / 170);
      camera.position
        .addScaledVector(right, (par.x * 7 + Math.sin(time * 0.21) * 1.6) * amp)
        .addScaledVector(up, (par.y * 3.5 + Math.sin(time * 0.17 + 1.3) * 0.9) * amp)
        .addScaledVector(fwd, (1 - intro) * 70 * amp);
      camera.lookAt(cur.t);

      camera.fov = cur.fov;
      camera.aspect = width / height;
      camera.setViewOffset(width, height, -cur.sx * width / 2, cur.sy * height / 2, width, height);
      camera.updateMatrixWorld();
    },
  };
}
