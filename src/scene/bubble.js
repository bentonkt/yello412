// The giant "yello 412" speech bubble that hangs over downtown, the caution
// tape wrapped around it, and the rings it gives off when it's answering.
//
// Built to the same proportions as the logo in the nav. One unit here is 1em
// of the logo's type; the whole thing is scaled up by EM.

import * as THREE from 'three';
import { HUB } from './geo.js';

export const EM = 18;
const DEPTH = 0.34, BEVEL = 0.07;
const HALF_Z = DEPTH / 2 + BEVEL;

const FONT = 'Archivo, "Arial Black", system-ui, sans-serif';
const ASPHALT = '#17191C', YELLOW = '#FFDD00', CONCRETE = '#EDEAE4';

function spaced(ctx, px) {
  try { ctx.letterSpacing = px + 'px'; } catch (e) { /* older browsers: normal spacing */ }
}
function texture(canvas, renderer) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const BODY_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const BODY_FRAG = /* glsl */`
uniform vec3 uYellow;
uniform float uPower;
uniform float uFlash;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 N = normalize(vN), V = normalize(vV);
  float ndv = max(dot(N, V), 0.);
  float dif = max(dot(N, normalize(vec3(-.45, .7, .55))), 0.);
  float shade = mix(.42, 1., smoothstep(0., 1., dif * .6 + ndv * .5));
  vec3 col = uYellow * shade;
  vec3 R = reflect(-V, N);
  col += vec3(1., .96, .78) * smoothstep(.5, .95, R.y) * .16;    // a soft highlight along the top edge
  col += uYellow * pow(clamp(1. - ndv, 0., 1.), 3.) * .2;
  col = col * uPower + uYellow * uFlash;
  gl_FragColor = vec4(col, 1.);
  #include <colorspace_fragment>
}
`;

const TAPE_VERT = /* glsl */`
attribute float aU;
attribute float aSide;
attribute vec3 aOut;
uniform float uPeel;
uniform float uTime;
varying vec2 vUv;
varying float vD;
varying float vLift;
varying vec3 vOut;
varying vec3 vV;
void main() {
  // Everything behind the tear is gone; just ahead of it the tape lifts and flaps.
  float tear = mix(-.03, 1.03, uPeel);
  float d = aU - tear;
  float lift = uPeel > .001 ? 1. - smoothstep(0., .24, d) : 0.;
  lift *= lift;
  float flap = sin(uTime * 9. + aU * 60.) * .5 + sin(uTime * 13.7 + aU * 31.) * .5;
  vec3 p = position;
  p += aOut * lift * (.55 + .14 * flap);
  p += aOut * aSide * lift * .13 * sin(uTime * 6. + aU * 22.);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vUv = uv;
  vD = d;
  vLift = lift;
  vOut = normalMatrix * aOut;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const TAPE_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uScroll;
uniform vec3 uBack;
varying vec2 vUv;
varying float vD;
varying float vLift;
varying vec3 vOut;
varying vec3 vV;
void main() {
  if (vD < 0.) discard;
  vec3 col = texture2D(uMap, vec2(vUv.x + uScroll, vUv.y)).rgb;
  float facing = dot(normalize(vOut), normalize(vV));
  if (facing < 0.) col = uBack * (.7 + .3 * vUv.y);           // the sticky side
  col *= 1. - .25 * vLift * (1. - vUv.y);
  gl_FragColor = vec4(col, 1.);
  #include <colorspace_fragment>
}
`;

const AURA_VERT = /* glsl */`
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}
`;
const AURA_FRAG = /* glsl */`
uniform vec3 uYellow;
uniform vec2 uHalf;         // half size of the bubble's body
uniform float uRing[3];     // age of each ring, 0..1 (negative = idle)
uniform float uPower;
varying vec2 vP;
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}
void main() {
  float d = box(vP, uHalf, .36);
  float a = exp(-max(d, 0.) * 1.5) * .1 * uPower;              // a glow hugging the outline
  for (int i = 0; i < 3; i++) {
    float t = uRing[i];
    if (t >= 0. && t < 1.) {
      float e = 1. - pow(clamp(1. - t, 0., 1.), 2.2);
      float x = (d - e * 3.1) / (.035 + .05 * t);
      a += exp(-x * x) * pow(clamp(1. - t, 0., 1.), 1.6) * .85;
    }
  }
  a *= smoothstep(4.4, 3.2, d);
  gl_FragColor = vec4(uYellow * a, 1.);
  #include <colorspace_fragment>
}
`;

export function createBubble(shared, renderer) {
  const group = new THREE.Group();      // faces the camera, bobs
  const logo = new THREE.Group();       // the artwork, centred on its own middle
  group.add(logo);
  group.position.set(HUB[0], HUB[1], HUB[2]);
  group.scale.setScalar(EM);

  // ---------- "yello", measured so the bubble fits the word ----------
  const S = 300;                        // canvas pixels per em
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `900 ${S}px ${FONT}`;
  spaced(probe, -0.04 * S);
  const W = probe.measureText('yello').width / S + 0.72;
  const hw = W / 2, hh = 0.71, r = 0.36;

  const word = document.createElement('canvas');
  word.width = Math.ceil(W * S); word.height = Math.ceil(hh * 2 * S);
  let ctx = word.getContext('2d');
  ctx.font = `900 ${S}px ${FONT}`;
  spaced(ctx, -0.04 * S);
  ctx.fillStyle = ASPHALT;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('yello', 0.36 * S, 0.994 * S);

  // ---------- body ----------
  const sh = new THREE.Shape();
  sh.moveTo(-hw + r, -hh);
  sh.lineTo(-hw + r + 0.066, -hh - 0.3);          // the tail
  sh.lineTo(-hw + r + 0.46, -hh);
  sh.lineTo(hw - r, -hh);
  sh.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  sh.lineTo(hw, hh - r);
  sh.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  sh.lineTo(-hw + r, hh);
  sh.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  sh.lineTo(-hw, -hh + r);
  sh.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  const bodyGeo = new THREE.ExtrudeGeometry(sh, {
    depth: DEPTH, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: 0.06, bevelOffset: -0.06,
    bevelSegments: 5, curveSegments: 14,
  });
  bodyGeo.translate(0, 0, -DEPTH / 2);
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: { uYellow: shared.uYellow, uPower: { value: 0.8 }, uFlash: { value: 0 } },
    vertexShader: BODY_VERT, fragmentShader: BODY_FRAG,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  logo.add(body);

  const wordMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(W, hh * 2),
    new THREE.MeshBasicMaterial({ map: texture(word, renderer), transparent: true, depthWrite: false, toneMapped: false }));
  wordMesh.position.z = HALF_Z + 0.006;
  wordMesh.renderOrder = 2;
  logo.add(wordMesh);

  // ---------- "412", stacked a few layers deep so it has an edge ----------
  probe.font = `800 ${0.44 * S}px ${FONT}`;
  spaced(probe, 0);
  const w412 = probe.measureText('412').width / S + 0.04;
  const num = document.createElement('canvas');
  num.width = Math.ceil(w412 * S); num.height = Math.ceil(0.5 * S);
  ctx = num.getContext('2d');
  ctx.font = `800 ${0.44 * S}px ${FONT}`;
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('412', 0.02 * S, 0.38 * S);
  const numTex = texture(num, renderer);
  const numGeo = new THREE.PlaneGeometry(w412, 0.5);
  const numFront = new THREE.MeshBasicMaterial({ map: numTex, color: CONCRETE, transparent: true, depthWrite: false, toneMapped: false });
  const numSide = new THREE.MeshBasicMaterial({ map: numTex, color: '#77746E', transparent: true, depthWrite: false, toneMapped: false });
  const LAYERS = 7;
  for (let i = 0; i < LAYERS; i++) {
    const m = new THREE.Mesh(numGeo, i === LAYERS - 1 ? numFront : numSide);
    m.position.set(hw + 0.12 + w412 / 2 - 0.02, -0.375, -0.1 + (i / (LAYERS - 1)) * 0.2);
    m.renderOrder = 2 + i * 0.01;
    logo.add(m);
  }
  logo.position.x = -(0.12 + w412) / 2;

  // ---------- caution tape ----------
  const tapes = [];
  function tapeTexture(text) {
    const H = 128;
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = `900 ${H * 0.5}px ${FONT}`;
    g.font = font;
    spaced(g, H * 0.05);
    const unit = text + '  ///  ';
    const uw = g.measureText(unit).width;
    const reps = Math.max(1, Math.round(1536 / uw));
    c.width = Math.ceil(uw * reps); c.height = H;
    g.fillStyle = ASPHALT; g.fillRect(0, 0, c.width, H);
    g.fillStyle = YELLOW;
    g.fillRect(0, 0, c.width, H * 0.07); g.fillRect(0, H * 0.93, c.width, H * 0.07);
    g.font = font;
    spaced(g, H * 0.05);
    g.textBaseline = 'middle';
    for (let i = 0; i < reps; i++) g.fillText(unit, i * uw + H * 0.2, H * 0.52);
    const t = texture(c, renderer);
    t.wrapS = THREE.RepeatWrapping;
    return { tex: t, aspect: c.width / H };
  }
  function addTape(text, alpha, width, startAt, shift) {
    const { tex, aspect } = tapeTexture(text);
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const margin = 0.04;
    // Half the length of the wrap: the longest the body gets under the strip.
    let lo = 1e3, hi = -1e3;
    for (const o of [shift - width / 2, shift, shift + width / 2]) {
      const tx = Math.abs(ca) > 1e-3 ? [(-hw + o * sa) / ca, (hw + o * sa) / ca] : [-1e3, 1e3];
      const ty = Math.abs(sa) > 1e-3 ? [(-hh - o * ca) / sa, (hh - o * ca) / sa] : [-1e3, 1e3];
      const t0 = Math.max(Math.min(tx[0], tx[1]), Math.min(ty[0], ty[1]));
      const t1 = Math.min(Math.max(tx[0], tx[1]), Math.max(ty[0], ty[1]));
      lo = Math.min(lo, t0); hi = Math.max(hi, t1);
    }
    const a = (hi - lo) / 2 + margin, mid = (hi + lo) / 2;
    const b = HALF_Z + margin;
    // The wrap is a rounded rectangle seen from the bubble's edge: across the
    // front, round the end, across the back, round the other end.
    const rc = 0.11;
    const la = 2 * (a - rc), lb = 2 * (b - rc), lc = rc * Math.PI / 2;
    const P = 2 * la + 2 * lb + 4 * lc;
    const corner = (cd, cz, phi) => [cd + rc * Math.sin(phi), cz + rc * Math.cos(phi), Math.sin(phi), Math.cos(phi)];
    function along(s) {
      if (s < la) return [-(a - rc) + s, b, 0, 1];
      if ((s -= la) < lc) return corner(a - rc, b - rc, s / rc);
      if ((s -= lc) < lb) return [a, (b - rc) - s, 1, 0];
      if ((s -= lb) < lc) return corner(a - rc, -(b - rc), Math.PI / 2 + s / rc);
      if ((s -= lc) < la) return [(a - rc) - s, -b, 0, -1];
      if ((s -= la) < lc) return corner(-(a - rc), -(b - rc), Math.PI + s / rc);
      if ((s -= lc) < lb) return [-a, -(b - rc) + s, -1, 0];
      return corner(-(a - rc), b - rc, Math.PI * 1.5 + (s - lb) / rc);
    }
    const repeat = Math.max(1, Math.round(P / (width * aspect)));
    const N = 200;
    const pos = [], uvs = [], us = [], sides = [], outs = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const [d, z, nd, nz] = along((u + startAt) % 1 * P);
      for (const side of [-1, 1]) {
        const o = shift + side * width / 2;
        pos.push(ca * (d + mid) - sa * o, sa * (d + mid) + ca * o, z);
        uvs.push(u * repeat, side * 0.5 + 0.5);
        us.push(u); sides.push(side);
        outs.push(ca * nd, sa * nd, nz);
      }
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(us, 1));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 1));
    g.setAttribute('aOut', new THREE.Float32BufferAttribute(outs, 3));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex }, uPeel: { value: 0 }, uScroll: { value: 0 }, uTime: shared.uTime,
        uBack: { value: new THREE.Color(0x4A4F55) },
      },
      vertexShader: TAPE_VERT, fragmentShader: TAPE_FRAG, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    logo.add(mesh);
    tapes.push({ mesh, mat, speed: (tapes.length % 2 ? -1 : 1) * 0.012 });
  }
  addTape('MISSED CALL', -0.14, 0.3, 0.97, -0.2);
  addTape('NO ANSWER', 1.0, 0.27, 0.02, -0.55);
  addTape('VOICEMAIL FULL', -0.82, 0.27, 0.5, 0.62);

  // ---------- rings and glow ----------
  const auraMat = new THREE.ShaderMaterial({
    uniforms: {
      uYellow: shared.uYellow, uHalf: { value: new THREE.Vector2(hw, hh) },
      uRing: { value: [-1, -1, -1] }, uPower: { value: 0 },
    },
    vertexShader: AURA_VERT, fragmentShader: AURA_FRAG,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(W + 9.5, hh * 2 + 9.5), auraMat);
  aura.position.z = -HALF_Z - 0.05;
  aura.renderOrder = 1;
  logo.add(aura);

  // ---------- behaviour ----------
  const rings = [-1, -1, -1];
  let ringAt = 0, bump = 0, flash = 0, power = 0.8;
  const m4 = new THREE.Matrix4(), up = new THREE.Vector3();
  const qFace = new THREE.Quaternion(), qSway = new THREE.Quaternion(), eul = new THREE.Euler();
  let first = true;

  return {
    group,
    width: (W + 0.12 + w412) * EM,
    // where arcs land: just under the body
    mouth: new THREE.Vector3(HUB[0], HUB[1] - hh * EM * 0.8, HUB[2]),

    ring() {
      rings[ringAt] = 0;
      ringAt = (ringAt + 1) % 3;
    },
    bump(amount) { bump = Math.min(1.5, bump + amount); },
    flash(amount) { flash = Math.max(flash, amount); },

    update(dt, time, camera, { peel, active, pointer }) {
      // tape
      for (let i = 0; i < tapes.length; i++) {
        tapes[i].mat.uniforms.uPeel.value = peel[i];
        tapes[i].mat.uniforms.uScroll.value = time * tapes[i].speed;
        tapes[i].mesh.visible = peel[i] < 0.999;
      }

      // power: dimmer while it's taped up, full once it's answering
      power += ((active ? 1 : 0.8) - power) * Math.min(1, dt * 3);
      bump *= Math.exp(-dt * 7);
      flash *= Math.exp(-dt * 3.2);
      bodyMat.uniforms.uPower.value = power + bump * 0.06;
      bodyMat.uniforms.uFlash.value = flash * 0.35;
      auraMat.uniforms.uPower.value = (active ? 1 : 0.35) + flash;
      shared.uHubPow.value = (active ? 1 : 0.45) + flash * 0.8;

      for (let i = 0; i < 3; i++) {
        if (rings[i] >= 0) { rings[i] += dt / 2.6; if (rings[i] >= 1) rings[i] = -1; }
        auraMat.uniforms.uRing.value[i] = rings[i];
      }

      // hang in the air, face whoever's looking, lean a little towards the pointer
      group.position.set(HUB[0], HUB[1] + Math.sin(time * 0.7) * 1.3, HUB[2]);
      const s = EM * (1 + bump * 0.035);
      group.scale.setScalar(s);

      up.setFromMatrixColumn(camera.matrixWorld, 1);
      m4.lookAt(camera.position, group.position, up);
      qFace.setFromRotationMatrix(m4);
      eul.set(
        Math.sin(time * 0.43) * 0.05 - pointer.y * 0.1,
        Math.sin(time * 0.31) * 0.2 + pointer.x * 0.22 - 0.1,
        Math.sin(time * 0.37) * 0.025 - 0.05);
      qSway.setFromEuler(eul);
      qFace.multiply(qSway);
      if (first) { group.quaternion.copy(qFace); first = false; }
      else group.quaternion.slerp(qFace, Math.min(1, dt * 5));
    },
  };
}
