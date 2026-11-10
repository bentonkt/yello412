// Yello 412 in 3D: a night-time Pittsburgh behind the page.
//
// main.js loads this file only when the browser can draw it (it sets html.gl
// first). If anything here fails, or the device turns out to be too slow, we
// drop html.gl and the page goes back to its flat design.
//
//   geo.js      the map: rivers, hills, street grids
//   city.js     where the buildings stand
//   world.js    ground, buildings, bridges, lights
//   shaders.js  the GLSL that draws the city
//   bubble.js   the logo in the sky and its rings
//   calls.js    the calls: beacons, beams, job tags
//   camera.js   the shots the camera flies between as you scroll
//   dom.js      the tilting phone and cards in the page

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { rng, landHeight } from './geo.js';
import { createWorld } from './world.js';
import { createBubble } from './bubble.js';
import { createCalls } from './calls.js';
import { createRig, SHOTS } from './camera.js';
import { initDom } from './dom.js';

const root = document.documentElement;
const flags = (window.yello = window.yello || {});
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
let stop = null;

function fail(why) {
  if (flags.failed) return;
  flags.failed = true;
  if (stop) stop();
  root.classList.remove('gl', 'gl-ready');
  root.removeAttribute('data-live');
  window.dispatchEvent(new Event('resize'));       // main.js re-measures the flat layout
  if (why) console.warn('[yello] 3D scene switched off:', why);
}

async function start() {
  const canvas = document.getElementById('gl');
  if (!canvas || !root.classList.contains('gl')) return;

  // The logo is drawn with the page's own fonts, so wait for them (briefly).
  if (document.fonts && document.fonts.load) {
    await Promise.race([
      Promise.all([document.fonts.load('900 64px Archivo'), document.fonts.load('800 64px Archivo')]),
      new Promise((r) => setTimeout(r, 2500)),
    ]).catch(() => {});
  }
  if (flags.failed || !root.classList.contains('gl')) return;

  const small = Math.min(window.innerWidth, window.innerHeight) < 700 || window.matchMedia('(pointer: coarse)').matches;
  const quality = { low: small };
  let useBloom = !small;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !useBloom, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x17191C, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fail('context lost'); });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 2, 6000);

  const shared = {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0x1B1E23) },
    uFogD: { value: 520 },
    uHub: { value: new THREE.Vector3() },
    uHubPow: { value: 0.45 },
    uPulse: { value: [-100, -100, -100] },
    uIntroR: { value: 0 },
    uYellow: { value: new THREE.Color(0xFFDD00) },
    uRed: { value: new THREE.Color(0xFF4D2E) },
  };

  // keep buildings out of the camera's way
  quality.clear = [];
  for (const s of SHOTS) for (const p of [s.p, s.tall && s.tall.p]) if (p && p[1] < 100) quality.clear.push([p[0], p[2], 30]);
  const world = createWorld(shared, rng(412), quality);
  scene.add(world.group);
  const bubble = createBubble(shared, renderer);
  scene.add(bubble.group);
  shared.uHub.value.copy(bubble.group.position);
  const calls = createCalls(shared, world.sites, bubble.mouth, renderer);
  scene.add(calls.group);
  const rig = createRig(camera);
  const dom = initDom(root);

  // ---------- size and quality ----------
  let width = 1, height = 1, ratio = 1, ratioCap = small ? 1.5 : 1.75;
  let composer = null, bloom = null;
  function buildComposer() {
    const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.6, 0.82);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  if (useBloom) buildComposer();

  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    const r = Math.min(window.devicePixelRatio || 1, ratioCap, Math.sqrt(3.4e6 / (w * h)));
    // Phones fire resize every time the address bar slides away; only rebuild the buffers when the size really changed.
    if (w !== width || h !== height || r !== ratio) {
      width = w; height = h; ratio = r;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      if (composer) { composer.setPixelRatio(ratio); composer.setSize(width, height); }
    }
    measure();
  }

  // ---------- where the page is ----------
  const pin = document.querySelector('.pin');
  const hero = document.querySelector('.hero');
  const steps = document.querySelectorAll('.step');
  const marks = [
    null, null,                                           // hero start and end, worked out below
    steps[0], steps[steps.length - 1],
    document.querySelector('.sec-sorted'),
    document.querySelector('.sec-wipe'),
    document.getElementById('pricing'),
    document.querySelector('.demo-head'),
    null,                                                 // the bottom of the page
  ];
  const stops = new Array(SHOTS.length).fill(0);
  let pinSpan = 0, heroRun = 1;
  function measure() {
    const vh = window.innerHeight;
    const y = window.scrollY;
    const max = Math.max(1, document.documentElement.scrollHeight - vh);
    pinSpan = pin && hero ? Math.max(0, pin.offsetHeight - hero.offsetHeight) : 0;
    heroRun = pinSpan > 0 ? pinSpan : (hero ? hero.offsetHeight * 0.5 : vh * 0.5);
    stops[0] = 0;
    stops[1] = heroRun;
    for (let i = 2; i < marks.length - 1; i++) {
      const el = marks[i];
      if (!el) { stops[i] = stops[i - 1] + 1; continue; }
      const r = el.getBoundingClientRect();
      stops[i] = r.top + y + r.height / 2 - vh / 2;
    }
    stops[marks.length - 1] = max;
    for (let i = 1; i < stops.length; i++) stops[i] = Math.max(stops[i - 1] + 1, Math.min(stops[i], max + i));
  }
  function storyAt(y) {
    for (let i = 0; i < stops.length - 1; i++) {
      if (y < stops[i + 1]) return i + clamp01((y - stops[i]) / (stops[i + 1] - stops[i]));
    }
    return stops.length - 1;
  }

  // ---------- pointer ----------
  const pointer = { x: 0, y: 0 };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  let time = 0, active = false;

  function onPointer(e) {
    if (e.pointerType === 'touch') return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  }
  // Click or tap the city and a call comes in from that spot.
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.target.closest && e.target.closest('a, button, input, textarea, select, summary, label, .card, .plan, .phone')) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length) return;
    ndc.set((e.clientX / width) * 2 - 1, -((e.clientY / height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y > -0.02) return;                              // clicked the sky
    let h = 0;
    for (let i = 0; i < 4; i++) {                         // walk the ray down onto the hills
      const t = (h - o.y) / d.y;
      hit.copy(o).addScaledVector(d, t);
      h = landHeight(hit.x, hit.z);
    }
    if (hit.distanceTo(o) > 900) return;
    if (calls.placeAt(time, hit.x, hit.z, active)) root.classList.add('gl-called');
  }

  // ---------- jumping to a section ----------
  // A link to a far-off section would scroll the whole page past and drag the
  // camera through every shot on the way. Instead: yellow floods out from the
  // link, the page and camera jump behind it, and it drains into the bubble.
  const cutEl = document.createElement('div');
  cutEl.className = 'gl-cut';
  cutEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cutEl);
  const cut = { phase: 0, t: 0, x: 0, y: 0, reach: 0, el: null, hash: '' };   // phase: 0 idle, 1 flooding, 2 covered, 3 draining
  const FLOOD = 0.36, HOLD = 0.12, DRAIN = 0.6;
  const reachFrom = (x, y) => Math.hypot(Math.max(x, width - x), Math.max(y, window.innerHeight - y)) + 8;
  function paintCut(r) {
    cutEl.style.setProperty('--cx', cut.x.toFixed(1) + 'px');
    cutEl.style.setProperty('--cy', cut.y.toFixed(1) + 'px');
    cutEl.style.setProperty('--cr', r.toFixed(1) + 'px');
  }
  const destOf = (el) => Math.max(0, Math.min(el.getBoundingClientRect().top + window.scrollY, document.documentElement.scrollHeight - window.innerHeight));
  function onNav(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href*="#"]');
    if (!a || a.target === '_blank' || a.classList.contains('skip')) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.hash.length < 2) return;
    const el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!el) return;
    if (cut.phase) { e.preventDefault(); return; }
    if (Math.abs(destOf(el) - window.scrollY) < window.innerHeight * 1.5) return;   // a short hop: the normal smooth scroll is fine
    e.preventDefault();
    let x = e.clientX, y = e.clientY;
    if (!x && !y) { const r = a.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }   // pressed Enter on it
    x = Math.min(width, Math.max(0, x)); y = Math.min(window.innerHeight, Math.max(0, y));
    cut.phase = 1; cut.t = 0; cut.x = x; cut.y = y; cut.reach = reachFrom(x, y); cut.el = el; cut.hash = url.hash;
    paintCut(0);
    cutEl.classList.add('on');
  }
  function stepCut(dt, bubbleX, bubbleY) {
    cut.t += dt;
    if (cut.phase === 1) {
      const k = clamp01(cut.t / FLOOD);
      paintCut(k * k * cut.reach);
      if (k < 1) return;
      // Covered. Jump the page the way the link would have, minus the scrolling.
      root.style.scrollBehavior = 'auto';
      if (window.location.hash !== cut.hash) window.location.hash = cut.hash;   // history and keyboard focus follow, as with any link
      window.scrollTo(0, destOf(cut.el));
      rig.snap();
      bubble.snap();
      cut.phase = 2; cut.t = 0;
      paintCut(1e5);
    } else if (cut.phase === 2) {
      if (cut.t < HOLD) return;                           // a few frames for the new view to settle
      root.style.scrollBehavior = '';
      cut.phase = 3; cut.t = 0;
      cut.x = Math.min(width, Math.max(0, bubbleX)); cut.y = Math.min(window.innerHeight, Math.max(0, bubbleY));
      cut.reach = reachFrom(cut.x, cut.y);
      paintCut(cut.reach);
    } else {
      const k = clamp01(cut.t / DRAIN);
      paintCut(Math.pow(1 - k, 2.4) * cut.reach);
      if (k >= 1) { cut.phase = 0; cutEl.classList.remove('on'); }
    }
  }

  // ---------- frame ----------
  let last = 0, raf = 0, introT = 0, shown = false, warm = 0;
  let pulseAt = 0, nextRing = 0, nextDelivery = 0, measureAt = 0;
  let ema = 16, slowFor = 0, level = 0;
  const box = [-1, 1, -1, 1], avoid = [0, 0, 0, 0];
  const wipeSec = document.querySelector('.sec-wipe'), wipeBg = document.querySelector('.wipe-bg');
  let wipeW = -1;
  const tmp = new THREE.Vector3();

  function ringOut() {
    bubble.ring();
    shared.uPulse.value[pulseAt] = time;
    pulseAt = (pulseAt + 1) % 3;
  }

  function followPhone(out) {
    const r = dom.phoneRect;
    out.set((r.x / width) * 2 - 1, -((r.y / height) * 2 - 1), 0.5).unproject(camera);
    out.sub(camera.position).normalize().multiplyScalar(46).add(camera.position);
  }

  function loop(now) {
    if (flags.failed) { stop(); return; }                // main.js gave up waiting and went flat
    raf = requestAnimationFrame(loop);
    frame(now);
  }
  function frame(now) {
    const rawMs = last ? now - last : 16;
    last = now;
    if (document.hidden) return;
    const dt = Math.min(0.05, rawMs / 1000);
    time += dt;
    shared.uTime.value = time;

    if (time > measureAt) { measure(); measureAt = time + 1.2; }
    const y = window.scrollY;
    const p = clamp01(y / heroRun);
    const wasActive = active;
    active = p >= 0.5;                                   // halfway through the hero, the bubble picks up
    if (active !== wasActive) {
      root.setAttribute('data-live', active ? '1' : '0');
      if (active) { bubble.flash(1); ringOut(); nextRing = time + 1.1; }
    }
    if (active && time > nextRing) { ringOut(); nextRing = time + 2.7; }

    // the city rises on arrival
    if (shown) {
      introT += dt;
      shared.uIntroR.value = 30 + Math.pow(clamp01((introT - 0.3) / 2.9), 1.3) * 1250;
    }

    rig.aim(storyAt(y), width / height);
    rig.update(dt, time, pointer, 1 - Math.pow(1 - clamp01(introT / 3), 3), width, height);
    bubble.update(dt, time, camera, { active, pointer });
    world.lightMat.uniforms.uPx.value = (height * ratio) / (2 * Math.tan((camera.fov * Math.PI) / 360));

    dom.update(dt, time, pointer, window.innerHeight);
    if (dom.phoneRect.on && time > nextDelivery) {
      calls.deliver(time, followPhone, dom.buzz);
      nextDelivery = time + 2.4;
    }
    // New calls appear in the open part of the picture, not under the copy.
    const sx = rig.cur.sx, sy = rig.cur.sy;
    const edge = width < height ? 0.55 : 0.94;      // tags are wide on a phone; keep them off the edges
    box[0] = sx > 0.15 ? -0.05 : -edge; box[1] = sx < -0.15 ? 0.05 : edge;
    box[2] = sy > 0.25 ? -0.05 : -0.8; box[3] = 0.62;
    // ...and their tags keep clear of the bubble.
    tmp.copy(bubble.group.position).project(camera);
    const cx = tmp.x, cy = tmp.y;
    tmp.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(bubble.width / 2).add(bubble.group.position).project(camera);
    const hx = Math.abs(tmp.x - cx), hy = hx * (width / height) * 0.5;
    avoid[0] = cx - hx; avoid[1] = cx + hx; avoid[2] = cy - hy; avoid[3] = cy + hy;
    calls.update(time, dt, camera, { active, rate: small ? 0.75 : 1, box, avoid, onArrive: () => bubble.bump(0.5) });

    if (cut.phase) stepCut(dt, (cx * 0.5 + 0.5) * width, (0.5 - cy * 0.5) * height);

    // The yellow section floods the screen out of the bubble, then drains back into it.
    if (wipeSec && wipeBg) {
      const vh = window.innerHeight;
      const r = wipeSec.getBoundingClientRect();
      let w = 0;
      if (r.bottom > 0 && r.top < vh) {
        w = Math.min(clamp01((vh - r.top) / (vh * 0.75)), clamp01((r.bottom - vh * 0.1) / (vh * 0.6)));
        w = w * w * (3 - 2 * w);
      }
      if (w !== wipeW || (w > 0 && w < 1)) {
        wipeW = w;
        const bx = clamp01(cx * 0.5 + 0.5) * width, by = Math.min(vh, clamp01(0.5 - cy * 0.5) * height);
        const reach = Math.hypot(Math.max(bx, width - bx), Math.max(by, vh - by)) + 4;
        wipeBg.style.setProperty('--wx', bx.toFixed(1) + 'px');
        wipeBg.style.setProperty('--wy', by.toFixed(1) + 'px');
        wipeBg.style.setProperty('--wr', (w * w * reach).toFixed(1) + 'px');
      }
    }

    if (composer && useBloom) composer.render(dt); else renderer.render(scene, camera);

    // The first frames compile the shaders; keep the canvas hidden until that's done.
    if (!shown && ++warm > 2) {
      shown = true;
      root.classList.add('gl-ready');
      flags.ready = true;
    }

    // If the device can't keep up, give it less to draw; if that's not enough, bow out.
    if (rawMs < 250 && time > 5) {
      ema += (rawMs - ema) * 0.06;
      slowFor = ema > 31 ? slowFor + rawMs : Math.max(0, slowFor - rawMs * 2);
      if (slowFor > 1800) {
        slowFor = 0; ema = 18; level++;
        if (level === 1) { ratioCap = 1.2; resize(); }
        else if (level === 2) { useBloom = false; ratioCap = 1; resize(); }
        else if (level === 3) { ratioCap = 0.7; resize(); }
        else fail('too slow on this device');
      }
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('click', onClick);
  document.addEventListener('click', onNav);
  window.addEventListener('load', measure);
  stop = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('click', onClick);
    document.removeEventListener('click', onNav);
    cutEl.remove();
    root.style.scrollBehavior = '';
    try { renderer.dispose(); } catch (e) { /* already gone */ }
  };

  resize();
  // For tuning from the browser console: edit yello.scene.SHOTS to move the camera,
  // yello.scene.replay() to watch the city rise again, yello.scene.advance(2) to run two seconds at once.
  flags.scene = {
    SHOTS, shared, camera, rig, world, renderer, stops,
    get bloom() { return bloom; },
    replay() { introT = 0; },
    advance(seconds) {
      let t = last || performance.now();
      for (let i = 0; i < seconds * 60; i++) frame(t += 1000 / 60);
      last = 0;
    },
  };
  raf = requestAnimationFrame(loop);
}

start().catch(fail);
