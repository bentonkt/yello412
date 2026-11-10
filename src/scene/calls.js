// The calls. Each one starts as a red beacon on a rooftop (a call nobody's
// answering). Once the bubble is live, it picks up: the beacon turns yellow and
// a beam of light runs from the rooftop to the bubble.
//
// All of them draw in two instanced meshes that share one set of buffers.

import * as THREE from 'three';
import { landHeight, riverDist } from './geo.js';

const MAX = 44;
const SEG = 44;

const JOBS = [
  'No heat', 'Locked out', 'Burst pipe', 'Tow needed', 'Dead panel', 'Quote by Friday',
  'Leak in 3B', 'Brakes grinding', 'Tree down', 'Furnace out', 'Come Saturday?', 'Water heater',
];
const FONT = 'Archivo, "Arial Black", system-ui, sans-serif';

const HEAD = /* glsl */`
attribute vec3 iStart;
attribute vec3 iEnd;
attribute vec4 iTime;       // born, picked up, gone, kind (0 call, 1 delivery)
uniform float uTime;
`;

const ARC_VERT = /* glsl */`
${HEAD}
attribute float aT;
attribute float aSide;
varying float vT;
varying float vSide;
varying float vHead;
varying float vFade;
vec3 arc(float t, float h) {
  vec3 p = mix(iStart, iEnd, t);
  p.y += h * 4. * t * (1. - t);
  return p;
}
void main() {
  float picked = uTime - iTime.y;
  float span = length(iEnd - iStart);
  float h = iTime.w > .5 ? span * .1 : 10. + span * .2;
  vec3 p = arc(aT, h);
  vec3 tangent = normalize(arc(aT + .01, h) - p);
  vec3 toCam = cameraPosition - p;
  float dCam = length(toCam);
  vec3 sideV = normalize(cross(tangent, toCam / dCam));
  float dur = .5 + span / 300.;
  float head = picked / dur;
  float dh = head - aT;
  float w = max(.0019 * dCam, .1) * (1. + 2.4 * exp(-dh * dh * 576.));
  p += sideV * aSide * w;
  vT = aT;
  vSide = aSide;
  vHead = picked < 0. ? -1. : head;
  vFade = 1. - smoothstep(iTime.z - .7, iTime.z, uTime);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}
`;
const ARC_FRAG = /* glsl */`
uniform vec3 uYellow;
varying float vT;
varying float vSide;
varying float vHead;
varying float vFade;
void main() {
  if (vHead < 0.) discard;
  float d = vHead - vT;
  if (d < -.02) discard;
  float trail = d > 0. ? exp(-d * 4.5) * .9 + .14 : 0.;
  float head = exp(-d * d * 676.) * 1.6;
  float edge = smoothstep(0., .75, 1. - abs(vSide));
  float a = (trail + head) * edge * vFade;
  gl_FragColor = vec4(uYellow * a, 1.);
  #include <colorspace_fragment>
}
`;

// One horizontal quad (the rings on the roof) and one upright quad (the beam),
// told apart by aPart.
const PING_VERT = /* glsl */`
${HEAD}
attribute float aPart;
varying vec2 vUv;
varying float vPart;
varying float vAge;
varying float vPicked;
varying float vFade;
void main() {
  vec3 p;
  if (aPart < .5) {
    p = iStart + vec3(position.x * 15., .35, position.y * 15.);
  } else {
    vec3 toCam = cameraPosition - iStart;
    vec3 right = normalize(vec3(toCam.z, 0., -toCam.x));
    p = iStart + right * position.x * 1.7 + vec3(0., (position.y + .5) * 15., 0.);
  }
  vUv = uv;
  vPart = aPart;
  vAge = uTime - iTime.x;
  vPicked = uTime - iTime.y;
  vFade = (1. - smoothstep(iTime.z - .7, iTime.z, uTime)) * step(iTime.w, .5);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}
`;
const PING_FRAG = /* glsl */`
uniform vec3 uYellow;
uniform vec3 uRed;
varying vec2 vUv;
varying float vPart;
varying float vAge;
varying float vPicked;
varying float vFade;
void main() {
  if (vFade <= 0. || vAge < 0.) discard;
  vec3 c = mix(uRed, uYellow, smoothstep(0., .25, vPicked));
  float a;
  if (vPart < .5) {
    float r = length(vUv - .5) * 2.;
    float p1 = fract(vAge / 1.5), p2 = fract(vAge / 1.5 + .5);
    a = smoothstep(.06, 0., abs(r - p1)) * (1. - p1) + smoothstep(.06, 0., abs(r - p2)) * (1. - p2);
    a = a * .9 + smoothstep(.2, 0., r) * .9;
    a *= step(r, 1.);
  } else {
    float x = abs(vUv.x - .5) * 2.;
    a = pow(clamp(1. - vUv.y, 0., 1.), 2.2) * (exp(-x * x * 14.) + .25 * exp(-x * x * 2.5)) * .9;
  }
  a *= smoothstep(0., .25, vAge) * vFade;
  gl_FragColor = vec4(c * a, 1.);
  #include <colorspace_fragment>
}
`;

export function createCalls(shared, sites, mouth, renderer) {
  const group = new THREE.Group();
  const iStart = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  const iEnd = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  const iTime = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  for (const a of [iStart, iEnd, iTime]) a.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX; i++) iTime.setXYZW(i, 1e6, 1e6, -1, 0);

  function instancedGeo(base) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
    g.setAttribute('iStart', iStart); g.setAttribute('iEnd', iEnd); g.setAttribute('iTime', iTime);
    g.instanceCount = MAX;
    return g;
  }
  const mat = (vertexShader, fragmentShader) => new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uYellow: shared.uYellow, uRed: shared.uRed },
    vertexShader, fragmentShader,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });

  // arcs: a strip the shader bends into a parabola and turns to face the camera
  const strip = new THREE.BufferGeometry();
  {
    const t = [], s = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      t.push(i / SEG, i / SEG); s.push(-1, 1);
      if (i < SEG) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    strip.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
    strip.setAttribute('aSide', new THREE.Float32BufferAttribute(s, 1));
    strip.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEG + 1) * 6), 3));
    strip.setIndex(idx);
  }
  const arcs = new THREE.Mesh(instancedGeo(strip), mat(ARC_VERT, ARC_FRAG));
  arcs.frustumCulled = false;
  arcs.renderOrder = 8;
  group.add(arcs);

  // pings: two quads
  const quads = new THREE.BufferGeometry();
  {
    const p = [], uv = [], part = [], idx = [];
    for (let q = 0; q < 2; q++) {
      const o = q * 4;
      p.push(-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      part.push(q, q, q, q);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    quads.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    quads.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    quads.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    quads.setIndex(idx);
  }
  const pings = new THREE.Mesh(instancedGeo(quads), mat(PING_VERT, PING_FRAG));
  pings.frustumCulled = false;
  pings.renderOrder = 7;
  group.add(pings);

  // ---------- job tags ----------
  const LABELS = 7;
  const labels = [];
  for (let i = 0; i < LABELS; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = 448; canvas.height = 112;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false, opacity: 0 });
    const sprite = new THREE.Sprite(m);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 20;
    sprite.visible = false;
    group.add(sprite);
    labels.push({ sprite, canvas, tex, call: null, text: '', picked: false });
  }
  function drawLabel(l) {
    const c = l.canvas, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.font = `800 40px ${FONT}`;
    try { g.letterSpacing = '3px'; } catch (e) { /* fine */ }
    const text = l.text.toUpperCase();
    const tw = g.measureText(text).width;
    const w = Math.min(c.width - 8, tw + 52), h = 68, x = (c.width - w) / 2, y = 6, r = 22;
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(c.width / 2 + 14, y + h); g.lineTo(c.width / 2 - 4, y + h + 26); g.lineTo(c.width / 2 - 12, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
    g.fillStyle = l.picked ? '#FFDD00' : 'rgba(23,25,28,.94)';
    g.fill();
    if (!l.picked) { g.lineWidth = 4; g.strokeStyle = '#FF4D2E'; g.stroke(); }
    g.fillStyle = l.picked ? '#17191C' : '#EDEAE4';
    g.textBaseline = 'middle';
    g.fillText(text, x + (w - tw) / 2 + 1, y + h / 2 + 3);
    l.tex.needsUpdate = true;
  }

  // ---------- life cycle ----------
  const calls = [];
  for (let i = 0; i < MAX; i++) calls.push({ alive: false, born: 0, pick: 1e6, gone: 0, kind: 0, start: new THREE.Vector3(), end: new THREE.Vector3(), arrive: 1e6, arrived: false, follow: null, onArrive: null });
  const v = new THREE.Vector3();
  let nextSpawn = 0.6, jobAt = Math.floor(Math.random() * JOBS.length), dirty = false;
  let wasActive = false;

  function write(i) {
    const c = calls[i];
    iStart.setXYZ(i, c.start.x, c.start.y, c.start.z);
    iEnd.setXYZ(i, c.end.x, c.end.y, c.end.z);
    iTime.setXYZW(i, c.born, c.pick, c.gone, c.kind);
    dirty = true;
  }
  function free() {
    for (let i = 0; i < MAX; i++) if (!calls[i].alive) return i;
    return -1;
  }
  function travel(c) { return 0.5 + c.start.distanceTo(c.end) / 300; }

  function pickUp(i, time, delay) {
    const c = calls[i];
    if (c.pick < 1e5) return;
    c.pick = time + delay;
    c.arrive = c.pick + travel(c);
    c.gone = c.arrive + 1.5;
    write(i);
  }

  function spawn(time, pos, { tag = true, hold = 7 } = {}) {
    const i = free();
    if (i < 0) return -1;
    const c = calls[i];
    c.alive = true; c.kind = 0; c.born = time; c.pick = 1e6; c.arrive = 1e6; c.arrived = false;
    c.gone = time + hold; c.follow = null; c.onArrive = null;
    c.start.copy(pos); c.end.copy(mouth);
    write(i);
    if (tag) {
      const l = labels.find((x) => !x.call);
      if (l) {
        l.call = c; l.text = JOBS[jobAt++ % JOBS.length]; l.picked = false;
        drawLabel(l);
        l.sprite.position.set(pos.x, pos.y + 15.5, pos.z);
        l.sprite.visible = true;
      }
    }
    return i;
  }

  // A rooftop that is on screen, in the open part of the picture. Sets ndc to where it is.
  const ndc = new THREE.Vector3();
  function siteInView(camera, box) {
    for (let k = 0; k < 90; k++) {
      const s = sites[Math.floor(Math.random() * sites.length)];
      ndc.set(s[0], s[1], s[2]);
      const d = ndc.distanceTo(camera.position);
      if (d < 45 || d > 560) continue;
      ndc.project(camera);
      if (ndc.z < 1 && ndc.x > box[0] && ndc.x < box[1] && ndc.y > box[2] && ndc.y < box[3]) return s;
    }
    return null;
  }
  // Tags need room: not on top of the bubble, not on top of each other.
  function roomForTag(camera, avoid) {
    if (ndc.x > avoid[0] - 0.17 && ndc.x < avoid[1] + 0.17 && ndc.y > avoid[2] - 0.26 && ndc.y < avoid[3]) return false;
    for (const l of labels) {
      if (!l.call) continue;
      v.copy(l.sprite.position).project(camera);
      if (Math.abs(v.x - ndc.x) < 0.3 && Math.abs(v.y - 0.1 - ndc.y) < 0.13) return false;
    }
    return true;
  }

  return {
    group,

    // A call from wherever the visitor clicked.
    placeAt(time, x, z, active) {
      if (riverDist(x, z) < 0) return false;
      // snap to a nearby rooftop if there is one
      let best = null, bd = 18 * 18;
      for (let k = 0; k < sites.length; k++) {
        const s = sites[k];
        const dx = s[0] - x, dz = s[2] - z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = s; }
      }
      if (best) v.set(best[0], best[1], best[2]); else v.set(x, landHeight(x, z) + 0.4, z);
      const i = spawn(time, v, { hold: active ? 7 : 9 });
      if (i >= 0 && active) pickUp(i, time, 0.45);
      return i >= 0;
    },

    // A beam from the bubble down to a point that moves (the phone on the page).
    deliver(time, follow, onArrive) {
      const i = free();
      if (i < 0) return;
      const c = calls[i];
      c.alive = true; c.kind = 1; c.born = time; c.pick = time;
      c.start.copy(mouth); follow(c.end);
      c.arrive = time + travel(c); c.arrived = false; c.gone = c.arrive + 0.9;
      c.follow = follow; c.onArrive = onArrive;
      write(i);
    },

    update(time, dt, camera, { active, rate, box, avoid, onArrive }) {
      // The moment the bubble goes live, every waiting call gets picked up.
      if (active && !wasActive) {
        let k = 0;
        for (let i = 0; i < MAX; i++) if (calls[i].alive && calls[i].kind === 0) pickUp(i, time, 0.15 + (k++) * 0.11);
      }
      wasActive = active;

      if (time > nextSpawn && sites.length) {
        const s = siteInView(camera, box);
        if (s) {
          const tag = roomForTag(camera, avoid);
          v.set(s[0], s[1], s[2]);
          const i = spawn(time, v, { tag, hold: active ? 8 : 6 + Math.random() * 3 });
          if (i >= 0 && active) pickUp(i, time, 0.55 + Math.random() * 0.5);
        }
        nextSpawn = time + (active ? 0.35 + Math.random() * 0.55 : 0.5 + Math.random() * 0.7) / rate;
      }

      for (let i = 0; i < MAX; i++) {
        const c = calls[i];
        if (!c.alive) continue;
        if (c.follow) { c.follow(c.end); iEnd.setXYZ(i, c.end.x, c.end.y, c.end.z); dirty = true; }
        if (!c.arrived && time >= c.arrive) {
          c.arrived = true;
          if (c.onArrive) c.onArrive(); else onArrive();
        }
        if (time >= c.gone) {
          c.alive = false;
          iTime.setXYZW(i, 1e6, 1e6, -1, 0);
          dirty = true;
        }
      }
      if (dirty) { iStart.needsUpdate = true; iEnd.needsUpdate = true; iTime.needsUpdate = true; dirty = false; }

      for (const l of labels) {
        const c = l.call;
        if (!c) continue;
        const picked = time >= c.pick;
        if (picked !== l.picked) { l.picked = picked; drawLabel(l); }
        const fadeIn = Math.min(1, (time - c.born) / 0.25);
        const fadeOut = Math.min(1, Math.max(0, (c.gone - time) / 0.5));
        const pop = picked ? 1 + 0.25 * Math.max(0, 1 - (time - c.pick) / 0.3) : 1;
        l.sprite.material.opacity = Math.min(fadeIn, fadeOut);
        const hgt = 0.034 * pop * (0.7 + 0.3 * fadeIn);
        l.sprite.scale.set(hgt * 4, hgt, 1);
        if (!c.alive || time >= c.gone) { l.call = null; l.sprite.visible = false; }
      }
    },
  };
}
