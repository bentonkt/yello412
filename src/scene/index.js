// Yello 412 in 3D: a night-time Pittsburgh behind the page.
//
// main.js loads this file only when the browser can draw it (it sets html.gl
// first). If anything here fails, or the device turns out to be too slow, we
// drop html.gl and the page goes back to its flat design, with the reader kept
// at the same place on the page.
//
//   geo.js      the map: rivers, hills, street grids
//   city.js     where the buildings stand
//   world.js    ground, buildings, bridges, lights
//   shaders.js  the GLSL that draws the city
//   bubble.js   the logo in the sky and its rings
//   calls.js    the calls: beacons, beams, job tags
//   camera.js   the shots the camera flies between as you scroll
//   dom.js      the phone and cards in the page

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
// The one-column layout. Must match the media queries in styles.css and main.js.
const STACKED = '(max-width: 999px), (max-height: 559px)';
let stop = null;

// Run a change that reflows the page, then put the reader back where they were:
// the same part of the same section in the middle of the window.
function keepPlace(change) {
  const vh = window.innerHeight;
  let el = null, part = 0;
  for (const m of document.querySelectorAll('.pin, #how, .sec-sorted, .sec-wipe, #pricing, #demo')) {
    const r = m.getBoundingClientRect();
    if (r.top <= vh / 2 && r.bottom >= vh / 2) { el = m; part = (vh / 2 - r.top) / Math.max(1, r.height); }
  }
  change();
  if (el && window.scrollY > 4) {
    const r = el.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, window.scrollY + r.top + part * r.height - vh / 2));
  }
}

function fail(why) {
  if (flags.failed) return;
  flags.failed = true;
  const wasShowing = !!flags.ready;
  if (stop) stop();
  keepPlace(() => {
    if (wasShowing) root.classList.add('gl-fell');     // already mid-visit: don't replay the flat page's entrance
    root.classList.remove('gl', 'gl-ready', 'gl-called');
    root.removeAttribute('data-live');
  });
  window.dispatchEvent(new Event('resize'));           // main.js re-measures the flat layout
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

  const stackedMq = window.matchMedia(STACKED);
  const small = Math.min(window.innerWidth, window.innerHeight) < 700 || window.matchMedia('(pointer: coarse)').matches;
  const quality = { low: small };
  let useComposer = !small;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !useComposer, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x17191C, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  // A shader this graphics driver rejects would leave holes in the city: go flat instead.
  renderer.debug.onShaderError = () => setTimeout(() => fail('a shader did not compile'), 0);
  // Phones drop the graphics context when the tab is put away; three.js rebuilds
  // everything when it comes back. Only give up if it stays gone.
  let lost = false, lostTimer = 0;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => fail('graphics context lost'), 5000);
  });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; clearTimeout(lostTimer); last = 0; });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 2, 6000);

  const shared = {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0x171B24) },
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
  let width = 1, height = 1, ratio = 1, dpr = 0;
  let ratioCap = small ? 1.75 : 2;
  const budget = small ? 2.4e6 : 6.5e6;                  // most pixels we'll draw per frame
  let composer = null, bloom = null;
  if (useComposer) {
    // Bloom needs a float buffer; without one, draw straight to the screen.
    if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
      useComposer = false;
    } else {
      const target = new THREE.WebGLRenderTarget(4, 4, {
        type: THREE.HalfFloatType, samples: (window.devicePixelRatio || 1) > 1.25 ? 2 : 4, resolveDepthBuffer: false,
      });
      composer = new EffectComposer(renderer, target);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.6, 0.82);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    }
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    dpr = window.devicePixelRatio || 1;
    const r = Math.min(dpr, ratioCap, Math.sqrt(budget / (w * h)));
    // Phones fire resize every time the address bar slides away; only rebuild the buffers when the size really changed.
    if (w !== width || h !== height || r !== ratio) {
      width = w; height = h; ratio = r;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      if (composer) { composer.setPixelRatio(ratio); composer.setSize(width, height); }
    }
    measure();
  }
  // Ask for less. True if that changed anything.
  function lower(cap) {
    const before = ratio;
    ratioCap = Math.min(ratioCap, cap);
    resize();
    return ratio < before - 0.01;
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
  let pinSpan = 0, heroRun = 1, stacked = stackedMq.matches;
  function measure() {
    const vh = window.innerHeight;
    const y = window.scrollY;
    const max = Math.max(1, document.documentElement.scrollHeight - vh);
    stacked = stackedMq.matches;
    pinSpan = pin && hero ? Math.max(0, pin.offsetHeight - hero.offsetHeight) : 0;
    heroRun = pinSpan > 0 ? pinSpan : Math.max(1, hero ? hero.offsetHeight * 0.5 : vh * 0.5);
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
  let time = 0, active = false, latched = false;

  function onPointer(e) {
    if (e.pointerType === 'touch') return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
  }
  // Click or tap the city and a call comes in from that spot.
  function place(x, y, target) {
    if (cut.phase) return;
    // not on anything you'd read or press
    if (target && target.closest && target.closest('a, button, input, textarea, select, summary, label, h1, h2, h3, p, li, .card, .plan, .phone, .dock, .nav')) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length) return;
    ndc.set((x / width) * 2 - 1, -((y / height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y > -0.02) return;                              // the sky
    let h = 0;
    for (let i = 0; i < 4; i++) {                         // walk the ray down onto the hills
      hit.copy(o).addScaledVector(d, (h - o.y) / d.y);
      h = landHeight(hit.x, hit.z);
    }
    if (hit.distanceTo(o) > 900) return;
    if (calls.placeAt(time, hit.x, hit.z, active)) root.classList.add('gl-called');
  }
  // iPhones only send "click" for things that look clickable, so taps are read
  // from pointer events; the click listener is for mice.
  let down = null, tapAt = 0;
  function onDown(e) {
    down = e.pointerType !== 'mouse' && e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
  }
  function onUp(e) {
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10 && performance.now() - d.t < 500) {
      tapAt = performance.now();
      place(e.clientX, e.clientY, e.target);
    }
  }
  function onCancel() { down = null; }
  function onClick(e) {
    if (e.defaultPrevented || e.button !== 0 || performance.now() - tapAt < 700) return;
    place(e.clientX, e.clientY, e.target);
  }

  // ---------- jumping to a section ----------
  // A link to a far-off section would scroll the whole page past and drag the
  // camera through every shot on the way. Instead: yellow floods out from the
  // link, the page and camera jump behind it, and it drains into the bubble.
  // main.js calls flags.jump for every same-page link; false means "you scroll it".
  const cutEl = document.createElement('div');
  cutEl.className = 'gl-cut';
  cutEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cutEl);
  const cut = { phase: 0, t: 0, x: 0, y: 0, reach: 0, el: null, arrive: null };   // phase: 0 idle, 1 flooding, 2 covered, 3 draining
  const FLOOD = 0.36, COVERED = 0.14, DRAIN = 0.6;
  const reachFrom = (x, y) => Math.hypot(Math.max(x, width - x), Math.max(y, window.innerHeight - y)) + 8;
  function paintCut(r) {
    cutEl.style.setProperty('--cx', cut.x.toFixed(1) + 'px');
    cutEl.style.setProperty('--cy', cut.y.toFixed(1) + 'px');
    cutEl.style.setProperty('--cr', r.toFixed(1) + 'px');
  }
  const destOf = (el) => Math.max(0, Math.min(el.getBoundingClientRect().top + window.scrollY, document.documentElement.scrollHeight - window.innerHeight));
  flags.jump = (el, e, a, arrive) => {
    if (flags.failed || !shown) return false;
    if (cut.phase) return true;                           // one at a time
    if (Math.abs(destOf(el) - window.scrollY) < window.innerHeight * 1.5) return false;
    let x = e.clientX, y = e.clientY;
    if (!x && !y) { const r = a.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }   // pressed Enter on it
    cut.x = Math.min(width, Math.max(0, x)); cut.y = Math.min(window.innerHeight, Math.max(0, y));
    cut.phase = 1; cut.t = 0; cut.reach = reachFrom(cut.x, cut.y); cut.el = el; cut.arrive = arrive;
    paintCut(0);
    cutEl.classList.add('on');
    return true;
  };
  function stepCut(dt, bubbleX, bubbleY) {
    cut.t += dt;
    if (cut.phase === 1) {
      const k = clamp01(cut.t / FLOOD);
      paintCut(k * k * cut.reach);
      if (k < 1) return;
      // Covered. Do what the link would have done, minus the scrolling.
      cut.arrive();
      window.scrollTo(0, destOf(cut.el));
      cut.phase = 2; cut.t = 0;
      paintCut(1e5);
    } else if (cut.phase === 2) {
      if (cut.t < COVERED) return;                        // a few frames for the new view to settle
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
  let last = 0, raf = 0, introT = 0, shown = false, warm = 0, lastY = window.scrollY;
  let pulseAt = 0, nextRing = 0, nextDelivery = 0, nextNum = 0, measureAt = 0;
  let ema = 16, slowFor = 0, level = 0, shownAt = 0;
  const box = [-1, 1, -1, 1], avoid = [0, 0, 0, 0];
  const wipeSec = document.querySelector('.sec-wipe'), wipeBg = document.querySelector('.wipe-bg');
  const demoNum = document.querySelector('.demo-title .buzz');
  const demoHead = document.querySelector('.demo-head');
  const tmp = new THREE.Vector3();

  function ringOut() {
    bubble.ring();
    shared.uPulse.value[pulseAt] = time;
    pulseAt = (pulseAt + 1) % 3;
  }

  // A point in the city that sits behind a place on the page, for beams that land on the page.
  function behind(x, y, out) {
    out.set((x / width) * 2 - 1, -((y / height) * 2 - 1), 0.5).unproject(camera);
    out.sub(camera.position).normalize().multiplyScalar(46).add(camera.position);
  }
  const followPhone = (out) => behind(dom.phoneRect.x, dom.phoneRect.y, out);
  const followNum = (out) => {
    const r = demoNum.getBoundingClientRect();
    behind(r.left + Math.min(r.width, 420) * 0.5, r.top + r.height * 0.5, out);
  };
  function ringNum() {
    demoNum.classList.remove('is-ringing');
    void demoNum.offsetWidth;
    demoNum.classList.add('is-ringing');
  }

  // If the device can't keep up, give it less to draw, one step at a time; if that's not enough, bow out.
  function stepDown() {
    for (;;) {
      level++;
      if (level === 1) { if (bloom && bloom.enabled && useComposer) { bloom.enabled = false; return; } }
      else if (level === 2) { if (lower(1.25)) return; }
      else if (level === 3) { const had = useComposer; useComposer = false; if (lower(1) || had) return; }
      else if (level === 4) { if (lower(0.7)) return; }
      else { fail('too slow on this device'); return; }
    }
  }

  function loop(now) {
    if (flags.failed) { stop(); return; }                // main.js gave up waiting and went flat
    raf = requestAnimationFrame(loop);
    try { frame(now); } catch (err) { fail(err); }
  }
  function frame(now) {
    const rawMs = last ? now - last : 16;
    last = now;
    if (document.hidden || lost) return;
    const dt = Math.min(0.05, rawMs / 1000);
    time += dt;
    shared.uTime.value = time;

    if (time > measureAt) { resize(); measureAt = time + 1.2; }
    const vh = window.innerHeight;
    const y = window.scrollY;
    // Arrived somewhere far away in one go (Back, a reload, a #link): cut, don't fly.
    if (Math.abs(y - lastY) > vh * 1.5) { rig.snap(); bubble.snap(); }
    lastY = y;

    // The pick-up. Side by side it's tied to the pinned hero's scroll. Stacked, the
    // hero scrolls away under the thumb, so it plays on a timer where it can be seen.
    const p = clamp01(y / heroRun);
    const wasActive = active;
    if (stacked || pinSpan === 0) {
      if (!latched && shown && (introT > 4.6 || (y > 24 && introT > 1.2) || y > heroRun)) latched = true;
      active = latched;
    } else {
      active = wasActive ? p >= 0.2 : p >= 0.35;
      latched = active;
    }
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

    rig.aim(storyAt(y), stacked, width, height);
    rig.update(dt, time, pointer, 1 - Math.pow(1 - clamp01(introT / 3), 3), width, height);
    bubble.update(dt, time, camera, { active, pointer });
    world.lightMat.uniforms.uPx.value = (height * ratio) / (2 * Math.tan((camera.fov * Math.PI) / 360));

    // The text pops onto the phone as soon as it's on view, and a beam from the bubble
    // goes out to it at the same time, then every few seconds while it stays in view.
    dom.update(dt, time, pointer, vh);
    if (dom.phoneRect.on && time > nextDelivery) {
      calls.deliver(time, followPhone, dom.textArrives);
      bubble.bump(0.6);
      nextDelivery = time + 5;
    }
    // ...and the page ends on a ringing number.
    if (demoNum && demoHead && active && time > nextNum && demoHead.classList.contains('in')) {
      const r = demoNum.getBoundingClientRect();
      if (r.top > 70 && r.bottom < vh - 40) {
        calls.deliver(time, followNum, ringNum);
        bubble.bump(0.6);
        nextNum = time + 5;
      }
    }

    // New calls appear in the open part of the picture, not under the copy...
    const sx = rig.cur.sx;
    if (stacked) {
      box[0] = -0.5; box[1] = 0.5; box[2] = 0.34; box[3] = 0.72;      // the window above the copy
    } else {
      box[0] = sx > 0.12 ? 0.22 : -0.84; box[1] = sx < -0.12 ? -0.22 : 0.84; box[2] = -0.72; box[3] = 0.56;
    }
    // ...and their tags keep clear of the bubble.
    tmp.copy(bubble.group.position).project(camera);
    const cx = tmp.x, cy = tmp.y;
    tmp.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(bubble.width / 2).add(bubble.group.position).project(camera);
    const hx = Math.abs(tmp.x - cx), hy = hx * (width / height) * 0.5;
    avoid[0] = cx - hx; avoid[1] = cx + hx; avoid[2] = cy - hy; avoid[3] = cy + hy;
    calls.update(time, dt, camera, { active, rate: small ? 0.75 : 1, box, avoid, intro: introT, onArrive: () => bubble.bump(0.5) });

    const bx = (cx * 0.5 + 0.5) * width, by = (0.5 - cy * 0.5) * height;
    if (cut.phase) stepCut(dt, bx, by);

    // The yellow section floods the screen out of the bubble once it has the window
    // to itself, and drains back before the next section needs it. Its words come
    // and go with the yellow, so they are never dark on dark.
    if (wipeSec && wipeBg) {
      const r = wipeSec.getBoundingClientRect();
      let w = 0;
      if (r.bottom > 0 && r.top < vh) {
        w = Math.min(clamp01((vh * 0.62 - r.top) / (vh * 0.5)), clamp01((r.bottom - vh * 0.42) / (vh * 0.46)));
        w = w * w * (3 - 2 * w);
      }
      const ox = Math.min(width, Math.max(0, bx)), oy = Math.min(vh, Math.max(0, by));
      const reach = Math.hypot(Math.max(ox, width - ox), Math.max(oy, vh - oy)) + 4;
      wipeBg.style.setProperty('--wx', ox.toFixed(1) + 'px');
      wipeBg.style.setProperty('--wy', oy.toFixed(1) + 'px');
      wipeBg.style.setProperty('--wr', (w * w * reach).toFixed(1) + 'px');
      wipeSec.style.setProperty('--wo', clamp01((w - 0.5) / 0.35).toFixed(3));
      // small, it would be a flat dot on the logo: let it melt into the bubble instead
      wipeBg.style.setProperty('--wa', clamp01((w - 0.08) / 0.3).toFixed(3));
    }

    if (composer && useComposer) composer.render(dt); else renderer.render(scene, camera);

    // The first frames finish setting up; keep the canvas hidden until that's done.
    if (!shown && ++warm > 2) {
      shown = true;
      shownAt = now;
      root.classList.add('gl-ready');
      flags.ready = true;
      bubble.ring();
    }

    // Slower than about 23 frames a second for two seconds running, after a five
    // second grace: step down. (A steady 30, as in Low Power Mode, is fine.)
    if (shown) {
      const ms = Math.min(rawMs, 500);
      ema += (ms - ema) * 0.06;
      if (now - shownAt > 5000) {
        slowFor = ema > 44 ? slowFor + ms : Math.max(0, slowFor - ms * 2);
        if (slowFor > 2000) { slowFor = 0; ema = 20; stepDown(); }
      }
    }
  }

  // Time away in another tab isn't slowness.
  function onVisibility() { last = 0; slowFor = 0; ema = 16; }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', onCancel, { passive: true });
  window.addEventListener('click', onClick);
  window.addEventListener('load', measure);
  document.addEventListener('visibilitychange', onVisibility);
  stop = () => {
    cancelAnimationFrame(raf);
    clearTimeout(lostTimer);
    window.removeEventListener('resize', resize);
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisibility);
    delete flags.jump;
    cutEl.remove();
    try { renderer.dispose(); } catch (e) { /* already gone */ }
  };

  resize();
  // Build the shaders before the first frame without freezing the page while the driver works.
  rig.aim(storyAt(window.scrollY), stacked, width, height);
  rig.update(0.016, 0, pointer, 0, width, height);
  rig.snap();
  try {
    if (composer) renderer.setRenderTarget(composer.readBuffer);
    await renderer.compileAsync(scene, camera);
  } catch (e) { /* the first frame will compile them instead */ }
  renderer.setRenderTarget(null);
  if (flags.failed || !root.classList.contains('gl')) { stop(); return; }

  // For tuning from the browser console: edit yello.scene.SHOTS to move the camera,
  // yello.scene.replay() to watch the city rise again, yello.scene.advance(2) to run two seconds at once.
  flags.scene = {
    SHOTS, shared, camera, rig, world, renderer, stops,
    get bloom() { return bloom; },
    get level() { return level; },
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
