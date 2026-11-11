// The giant "yello 412" speech bubble that hangs over the Point, and the rings
// it gives off when it's answering.
//
// Built to the same proportions as the logo in the nav. One unit here is 1em
// of the logo's type; the whole thing is scaled up by EM.

import * as THREE from 'three';
import { HUB } from './geo.js';

export const EM = 18;
const DEPTH = 0.34, BEVEL = 0.07;
const HALF_Z = DEPTH / 2 + BEVEL;

const FONT = 'Archivo, "Arial Black", system-ui, sans-serif';
const ASPHALT = '#17191C', CONCRETE = '#EDEAE4';

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
varying vec2 vP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  vP = position.xy;
  gl_Position = projectionMatrix * mv;
}
`;
const BODY_FRAG = /* glsl */`
uniform vec3 uYellow;
uniform float uPower;
uniform float uFlash;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec2 vP;
void main() {
  vec3 N = normalize(vN), V = normalize(vV);
  float ndv = max(dot(N, V), 0.);
  float dif = max(dot(N, normalize(vec3(-.45, .7, .55))), 0.);
  float shade = mix(.42, 1., smoothstep(0., 1., dif * .6 + ndv * .5));
  // The face is the brand yellow; edges that turn away go amber, like moulded plastic.
  vec3 base = mix(vec3(.95, .66, 0.), uYellow, smoothstep(.1, .75, N.y * .5 + .5 + ndv * .35));
  vec3 col = base * shade * (1. + .07 * clamp(vP.y / .71, -1., 1.));
  float sw = vP.x * .55 + vP.y - (mod(uTime * .8, 8.) - 2.5) * 2.;
  col += vec3(1., .97, .8) * exp(-sw * sw * 5.) * .1 * ndv;       // a band of gloss slides across every ten seconds
  vec3 R = reflect(-V, N);
  col += vec3(1., .96, .78) * smoothstep(.5, .95, R.y) * .3;     // a highlight along the top edge
  col += uYellow * pow(clamp(1. - ndv, 0., 1.), 3.) * .2;
  col = col * uPower + uYellow * uFlash;
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
    uniforms: { uYellow: shared.uYellow, uPower: { value: 0.8 }, uFlash: { value: 0 }, uTime: shared.uTime },
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
    mouth: new THREE.Vector3(HUB[0], HUB[1] - hh * EM * 1.12, HUB[2]),

    ring() {
      rings[ringAt] = 0;
      ringAt = (ringAt + 1) % 3;
    },
    bump(amount) { bump = Math.min(1.5, bump + amount); },
    flash(amount) { flash = Math.max(flash, amount); },
    // Turn to face the camera at once (after the camera has jumped).
    snap() { first = true; },

    update(dt, time, camera, { active, pointer }) {
      // power: dimmer while calls are going unanswered, full once it's answering
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
