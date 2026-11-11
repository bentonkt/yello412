// GLSL for the city. Everything is unlit and hand-shaded, so the brand colours
// come out exactly as specified and the scene needs no lights.

import { CELL, STREET, ANG_N, ANG_S, CORE, POINT } from './geo.js';

const f = (n) => (Number.isInteger(n) ? n + '.' : String(n));

export const COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uFogColor;
uniform float uFogD;
uniform vec3 uHub;
uniform float uHubPow;
uniform float uPulse[3];
uniform float uIntroR;
uniform vec3 uYellow;

const vec2 POINT = vec2(${f(POINT[0])}, ${f(POINT[1])});

float fogF(float d) { float x = d / uFogD; return 1. - exp(-x * x); }

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Rings of light that roll out across the city each time the bubble rings.
float pulseAt(float dist) {
  float s = 0.;
  for (int i = 0; i < 3; i++) {
    float age = uTime - uPulse[i];
    if (age > 0. && age < 7.) {
      float r = age * 150.;
      float w = 8. + r * .035;
      float x = (dist - r) / w;
      s += exp(-x * x) * exp(-r / 360.);
    }
  }
  return s;
}
`;

// ---------- sky ----------

export const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.);
  gl_Position = p.xyww;
}
`;
export const SKY_FRAG = /* glsl */`
${COMMON}
uniform vec3 uZenith;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = smoothstep(0., .55, d.y);
  vec3 col = mix(uFogColor, uZenith, h);
  col += vec3(.10, .115, .15) * exp(-max(d.y, 0.) * 14.) * .55;   // haze along the horizon
  // a few stars, high up
  vec2 sp = d.xz / (abs(d.y) + .35) * 260.;
  vec2 cell = floor(sp);
  float st = step(.985, hash21(cell)) * smoothstep(.42, .08, length(fract(sp) - .5));
  float tw = .55 + .45 * sin(uTime * 1.3 + hash21(cell + 3.) * 40.);
  col += vec3(.75, .8, .9) * st * tw * smoothstep(.1, .45, d.y) * (.25 + .5 * hash21(cell + 9.));
  gl_FragColor = vec4(col, 1.);
  #include <colorspace_fragment>
}
`;

// ---------- ground and rivers ----------

export const GROUND_VERT = /* glsl */`
varying vec3 vW;
varying float vNy;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.);
  vW = wp.xyz;
  vNy = normal.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const GROUND_FRAG = /* glsl */`
${COMMON}
uniform vec4 uSeg[8];
uniform float uHw[8];
uniform vec3 uLand;
uniform vec3 uWater;
uniform vec3 uStreet;
uniform vec3 uLamp;
uniform vec3 uShore;
uniform vec3 uSheen;
varying vec3 vW;
varying float vNy;

const vec2 CORE = vec2(${f(CORE[0])}, ${f(CORE[1])});

float riverD(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    vec2 a = uSeg[i].xy, ba = uSeg[i].zw - uSeg[i].xy;
    vec2 pa = p - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
    d = min(d, length(pa - ba * h) - uHw[i]);
  }
  return d;
}
float boundaryZ(float x) {
  return x <= -170. ? -52. + (x + 170.) * .04138 : (x <= 0. ? x * .30588 : x * -.031);
}

void main() {
  vec2 p = vW.xz;
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  float rd = riverD(p);
  float aa = fwidth(rd) + .002;
  float water = 1. - smoothstep(-aa, aa, rd);

  // Streets: a grid turned to follow the nearest river.
  float ang = mix(${f(ANG_N)}, ${f(ANG_S)}, step(boundaryZ(p.x), p.y));
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(p.x * c + p.y * s, -p.x * s + p.y * c) / ${f(CELL)};
  vec2 fq = abs(fract(q) - .5);
  float fw = clamp(fwidth(q.x) + fwidth(q.y), 1e-4, .5);
  float m = max(fq.x, fq.y);
  float st = smoothstep(.5 - ${f(STREET)} - fw, .5 - ${f(STREET)} + fw, m);
  float far = smoothstep(.1, .4, fw);
  st = mix(st, ${f(STREET * 3.2)}, far);                       // far away, the grid blurs to an even glow
  vec2 g = fract(q * 3.) - .5;
  float lamp = smoothstep(.22, .04, length(g)) * step(.5 - ${f(STREET)}, m) * (1. - smoothstep(.03, .12, fw));

  float dC = length(p - CORE);
  float flat_ = smoothstep(.74, .92, vNy);
  float urbanW = exp(-dC * dC / 122500.);
  float urban = urbanW * flat_ * smoothstep(.5, 5., rd);
  float on = smoothstep(0., 70., uIntroR - length(p - POINT));

  vec3 land = uLand * mix(.82 + .36 * hash21(floor(q)), 1., far);
  land *= mix(.55, 1., flat_);                                 // wooded hillsides stay dark
  land += uStreet * st * urban * on;
  land += uLamp * lamp * urban * on;

  // the bubble's light, and its rings
  float dh = length(p - uHub.xz);
  float pool = uHubPow / (1. + dh * dh / 6400.);
  float pu = pulseAt(dh);
  land += uYellow * pool * .03;
  land += uYellow * pu * (.03 + .75 * st * urban);             // the rings light the streets, not whole neighbourhoods

  // water: dark, mirroring the lit city and the bubble, broken up by ripples
  vec3 wcol = uWater;
  if (water > .001) {
  float t = uTime;
  vec2 w1 = p * .21 + vec2(t * .33, t * .11);
  vec2 w2 = p * .53 + vec2(-t * .21, t * .29);
  vec2 w3 = p * 1.27 + vec2(t * .47, -t * .38);
  vec2 grad = vec2(cos(w1.x) * sin(w1.y * 1.3), sin(w1.x * .7) * cos(w1.y)) * .5
            + vec2(cos(w2.x + w2.y), sin(w2.x - w2.y * 1.4)) * .3
            + vec2(cos(w3.x * 1.1 + w3.y * .6), sin(w3.y - w3.x * .4)) * .22;
  float calm = mix(1., .25, smoothstep(80., 700., dist));
  vec3 N = normalize(vec3(grad.x * .17 * calm, 1., grad.y * .17 * calm));
  float fres = pow(clamp(1. - dot(N, V), 0., 1.), 3.);
  wcol += uSheen * fres;
  vec3 H = normalize(normalize(uHub - vW) + V + vec3(0., 1e-5, 0.));
  float nh = max(dot(N, H), 0.);
  wcol += uYellow * uHubPow * (pow(nh, 220.) * .35 + pow(nh, 20.) * .012);
  wcol += uYellow * pu * .06;
  // Reflections. Mirror the line of sight in flat water and ask where it lands:
  // on downtown (columns of window light, cut into dashes by the ripples) or on the bubble.
  float ry = max(V.y, .05);
  vec2 q1 = p - V.xz * (14. / ry) - CORE;
  vec2 q2 = p - V.xz * (34. / ry) - CORE;
  float skyl = min(exp(-dot(q1, q1) / 5000.) + .8 * exp(-dot(q2, q2) / 2500.), 1.);
  vec2 dv = p - cameraPosition.xz;
  float pa = dv.x / (abs(dv.x) + abs(dv.y) + .001);
  float sd = dv.y < 0. ? 3. : 9.;
  float colm = hash21(vec2(floor(pa * 400.), sd));
  float brk = smoothstep(.25, .6, hash21(vec2(floor(log(length(dv) + 1.) * 55. + grad.x * 1.2), floor(pa * 60.) + sd)));
  wcol += uLamp * skyl * (.03 + .3 * smoothstep(.8, .97, colm) * brk) * on;
  vec2 qb = p - V.xz * (uHub.y / ry) - uHub.xz;
  wcol += uYellow * uHubPow * exp(-dot(qb, qb) / 1400.) * (.22 + .35 * brk);
  // a few lamps along the banks
  vec2 sp = vec2(p.x * c + p.y * s, -p.x * s + p.y * c);
  float glint = hash21(floor(vec2(sp.x * .55, sp.y * 1.9) + grad * 1.2));
  float nearBank = smoothstep(-13., -.5, rd) * (1. - smoothstep(60., 520., dist));
  wcol += uLamp * step(.97, glint) * nearBank * urbanW * on * .2;
  }

  vec3 col = mix(land, wcol, water);
  float sh = rd / (.55 + aa);
  col += uShore * exp(-sh * sh) * on;         // bank outline, like a map

  col = mix(col, uFogColor, fogF(dist));
  col = min(max(col, 0.), 16.);               // never hand bloom a bad number
  gl_FragColor = vec4(col, 1.);
  #include <colorspace_fragment>
}
`;

// ---------- buildings (instanced boxes and pyramids) ----------

export const BUILDING_VERT = /* glsl */`
${COMMON}
attribute vec4 aData;       // seed, share of windows lit, kind, crown (0 none, 1 lit band, 2 glass, 3 yellow)
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vData;
varying vec3 vScl;
varying float vH;
varying float vDist0;
varying float vFace;
varying float vCrown;
void main() {
  vec3 scl = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 base = (modelMatrix * instanceMatrix * vec4(0., 0., 0., 1.)).xyz;
  float dist0 = length(base.xz - POINT);

  // The city rises out of the ground in a wave from the Point.
  float gr = clamp((uIntroR - dist0) / 95., 0., 1.);
  float grow = 1. - pow(1. - gr, 3.);
  grow *= 1. + .16 * sin(gr * 3.14159) * (1. - gr);
  // Grow in world space, so upper tiers stay on their tower, and wait under the ground until then.
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.);
  wp.y = wp.y * grow - (1. - min(grow, 1.)) * 1.5;
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vScl = scl;
  vH = position.y * scl.y;
  vDist0 = dist0;
  vData = aData.xyz;
  vCrown = aData.w;
  if (abs(normal.y) > .9) { vUv = position.xz * scl.xz; vFace = 0.; }
  else if (abs(normal.x) > abs(normal.z)) { vUv = vec2(position.z * scl.z, position.y * scl.y); vFace = normal.x > 0. ? 1. : 2.; }
  else { vUv = vec2(position.x * scl.x, position.y * scl.y); vFace = normal.z > 0. ? 3. : 4.; }
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const BUILDING_FRAG = /* glsl */`
${COMMON}
uniform vec3 uWall;
uniform vec3 uRoof;
uniform vec3 uWinWarm;
uniform vec3 uWinCool;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying vec3 vData;
varying vec3 vScl;
varying float vH;
varying float vDist0;
varying float vFace;
varying float vCrown;
void main() {
  // Snapped, because interpolation leaves a hair of noise on values that should be constant
  // and the hash below turns that into speckle.
  float seed = (floor(vData.x * 4096.) + .5) / 4096., litShare = vData.y, kind = vData.z;
  float face = floor(vFace + .5);
  vec3 N = normalize(vN);
  bool roof = face < .5;
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);

  // moonlight from the south-west, so every face reads differently
  float sideL = .5 + .5 * max(dot(N, normalize(vec3(-.55, .3, .78))), 0.);
  vec3 col;
  if (roof) {
    float e = min(vScl.x * .5 - abs(vUv.x), vScl.z * .5 - abs(vUv.y));
    col = uRoof * (1. + .8 * (1. - smoothstep(0., .4, e)));
  } else {
    col = uWall * sideL * (.8 + .4 * hash21(vec2(seed * 53., face)));
    col *= mix(.45, 1., smoothstep(0., 4., vH));               // darker towards the street
    // a lighter edge up each corner and towards the top, so boxes separate from each other
    float halfW = (face < 2.5 ? vScl.z : vScl.x) * .5;
    col += uRoof * .55 * (1. - smoothstep(0., .22, halfW - abs(vUv.x))) * smoothstep(0., 3., vH);
    col += uRoof * .22 * smoothstep(.55, 1., vH / max(vScl.y, 1.));
  }

  if (!roof && kind < 1.5) {
    vec2 ws = kind > .5 ? vec2(1.7, 1.5) : vec2(1.3, 1.2);
    vec2 wuv = vUv / ws;
    float band = step(.75, vH) * step(vH, vScl.y - .5);
    vec2 cell = floor(wuv);
    vec2 fr = fract(wuv);
    // Towers come in three kinds: separate windows, ribbon windows, and tall windows between piers.
    float style = kind > .5 ? floor(hash21(vec2(seed * 7.1, 3.)) * 3.) : 0.;
    bool ribbon = style > .5 && style < 1.5, piers = style > 1.5;
    vec2 lc = ribbon ? vec2(floor(cell.x / 5.), cell.y) : piers ? vec2(cell.x, floor(cell.y / 4.)) : cell;
    float r = hash21(lc + vec2(seed * 91.7, face * 17.3 + seed * 13.1));
    float lit = step(1. - litShare, r);
    float win = (ribbon ? 1. : step(.2, fr.x) * step(fr.x, .8)) * (piers ? step(.08, fr.y) : step(.24, fr.y) * step(fr.y, .78));
    float px = fwidth(wuv.x) + fwidth(wuv.y);
    float detail = clamp(1.5 - px * 1.7, 0., 1.);
    float glow = mix(litShare * .3, lit * win, detail) * band;
    vec3 wc = mix(uWinWarm, uWinCool, step(.8, hash21(cell * 1.7 + seed)));
    float bright = .3 + .7 * hash21(cell + 7.3 + seed);
    float on = smoothstep(0., 1., (uIntroR - vDist0 - 120. - r * 170.) / 40.);
    col += wc * glow * bright * on;
    col += uRoof * win * (1. - lit) * detail * band * .5;       // unlit glass catches a little sky
  }

  // Landmarks: a lit band under the roofline, glass that glows from inside, or brand yellow.
  float cOn = smoothstep(0., 1., (uIntroR - vDist0 - 200.) / 40.);
  float cb = step(.5, vCrown) * step(vCrown, 1.5), cg = step(1.5, vCrown) * step(vCrown, 2.5), cy = step(2.5, vCrown);
  float hN = clamp(vH / max(vScl.y, 1.), 0., 1.);
  float cband = smoothstep(vScl.y - 3.6, vScl.y - 3.3, vH) * (1. - smoothstep(vScl.y - 1.2, vScl.y - .9, vH));
  if (!roof) col += vec3(.8, .9, 1.) * cb * cband * .7 * cOn;
  col += uWinCool * cg * (.07 + .22 * hN) * cOn;
  col += uYellow * cy * (.15 + .45 * hN) * cOn;

  // The bubble lights the faces turned towards it: a warm rim, not a wash.
  vec3 toHub = uHub - vW;
  float dh = length(toHub);
  float hl = uHubPow / (1. + dh * dh / 9000.);
  float facing = roof ? .3 : pow(max(dot(N, toHub / max(dh, .001)), 0.), 1.5);
  col += mix(uYellow, vec3(1., .86, .55), .45) * hl * facing * .17;
  // Its rings pick out roof edges as they pass.
  float pu = pulseAt(length(vW.xz - uHub.xz));
  float re = min(vScl.x * .5 - abs(vUv.x), vScl.z * .5 - abs(vUv.y));
  col += uYellow * pu * (roof ? .08 + .85 * (1. - smoothstep(0., .45, re)) : .2);

  col = mix(col, uFogColor, fogF(dist));
  col = min(max(col, 0.), 16.);
  gl_FragColor = vec4(col, 1.);
  #include <colorspace_fragment>
}
`;

// ---------- bridges, stadiums and other fixed props ----------

export const PROP_VERT = /* glsl */`
${COMMON}
attribute vec4 aColor;      // rgb, glow
varying vec3 vW;
varying vec3 vN;
varying vec4 vColor;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.);
  float on = smoothstep(0., 60., uIntroR - length(wp.xz - POINT) - 20.);
  wp.y = mix(-1., wp.y, on);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
export const PROP_FRAG = /* glsl */`
${COMMON}
varying vec3 vW;
varying vec3 vN;
varying vec4 vColor;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float l = .42 + .58 * max(dot(N, normalize(vec3(-.4, .75, .5))), 0.);
  vec3 col = vColor.rgb * mix(l, 1., vColor.a);
  col *= mix(.55, 1., smoothstep(.45, 1., uHubPow));           // dimmer until the bubble picks up
  float pu = pulseAt(length(vW.xz - uHub.xz));
  col += uYellow * pu * .25;
  float dist = length(cameraPosition - vW);
  col = mix(col, uFogColor, fogF(dist));
  gl_FragColor = vec4(col, 1.);
  #include <colorspace_fragment>
}
`;

// ---------- small lights: street lamps on bridges, cars, beacons ----------

export const LIGHT_VERT = /* glsl */`
${COMMON}
attribute vec3 aB;          // where a moving light is heading (same as position if it stays put)
attribute vec3 aCol;
attribute vec4 aMisc;       // size, speed, phase, twinkle
uniform float uPx;
varying vec3 vCol;
varying float vA;
void main() {
  float t = 0.;
  if (aMisc.y > 0.) t = fract(aMisc.z + uTime * aMisc.y);
  else if (aMisc.y < 0.) t = abs(fract(aMisc.z - uTime * aMisc.y) * 2. - 1.);
  vec3 p = mix(position, aB, t);
  vec4 mv = viewMatrix * vec4(p, 1.);
  float d = -mv.z;
  gl_Position = projectionMatrix * mv;
  float tw = 1. - aMisc.w * (.5 + .5 * sin(uTime * (1.5 + 4. * fract(aMisc.z * 7.31)) + aMisc.z * 40.));
  float on = smoothstep(0., 30., uIntroR - length(p.xz - POINT) - 70.);
  float size = aMisc.x * uPx / max(d, 1.);
  gl_PointSize = clamp(size, 2., 90.);
  vA = tw * on * (1. - fogF(d)) * min(1., size / 2.);
  vCol = aCol;
}
`;
export const LIGHT_FRAG = /* glsl */`
varying vec3 vCol;
varying float vA;
void main() {
  float r = length(gl_PointCoord - .5) * 2.;
  float a = smoothstep(1., 0., r);
  a = a * a * (1. + 2. * smoothstep(.35, 0., r));
  gl_FragColor = vec4(vCol * a * vA, 1.);
  #include <colorspace_fragment>
}
`;
