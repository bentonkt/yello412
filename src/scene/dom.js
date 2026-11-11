// The parts of the 3D look that live in the page itself rather than on the
// canvas: the phone that turns in space and receives the text, and cards that
// tilt under the pointer.

const lerp = (a, b, t) => a + (b - a) * t;

export function initDom(root) {
  const rig = document.querySelector('.phone-rig');
  const phone = document.querySelector('.phone');
  const how = document.getElementById('how');

  // ---------- cards tilt towards the pointer ----------
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('.card, .plan').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.classList.add('tilting');
        el.style.setProperty('--tx', (x - 0.5).toFixed(3));
        el.style.setProperty('--ty', (y - 0.5).toFixed(3));
        el.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
      });
      el.addEventListener('pointerleave', () => {
        el.classList.remove('tilting');
        el.style.setProperty('--tx', '0');
        el.style.setProperty('--ty', '0');
      });
    });
  }

  // Restart a one-shot CSS animation that is driven by a class.
  function replay(el, name) {
    el.classList.remove(name);
    void el.offsetWidth;
    el.classList.add(name);
  }
  if (phone) {
    phone.addEventListener('animationend', (e) => {
      if (e.animationName === 'phonebuzz') phone.classList.remove('got-text');
      if (e.animationName === 'phoneglow') phone.classList.remove('glow');
    });
  }

  // ---------- the phone ----------
  const pose = { ry: -26, rx: 8, y: 0 };
  const POSES = [{ ry: -30, rx: 10 }, { ry: -19, rx: 6 }, { ry: -9, rx: 4 }];
  const rect = { x: 0, y: 0, on: false };
  let showing = false;

  // The text screen just came up: the message pops in and the phone buzzes at once.
  function popText() {
    phone.classList.add('wait');
    void phone.offsetWidth;
    phone.classList.remove('wait');
    replay(phone, 'got-text');
  }

  return {
    phoneRect: rect,

    // A beam from the bubble has landed on the phone: it glows.
    textArrives() {
      if (phone) replay(phone, 'glow');
    },

    update(dt, time, pointer, vh) {
      rect.on = false;
      if (!rig || !how || !phone) return;
      const hr = how.getBoundingClientRect();
      if (hr.bottom < -100 || hr.top > vh + 100) {
        showing = false;
        return;
      }
      const stepped = root.hasAttribute('data-step');        // side by side: the steps drive the phone
      const step = stepped ? Number(root.getAttribute('data-step')) : 2;
      const target = POSES[step] || POSES[2];
      const k = 1 - Math.exp(-dt * 4);
      pose.ry = lerp(pose.ry, (stepped ? target.ry : -12) + pointer.x * 9, k);
      pose.rx = lerp(pose.rx, (stepped ? target.rx : 5) + pointer.y * 6, k);
      pose.y = Math.sin(time * 0.9) * 6;
      rig.style.setProperty('--ry', pose.ry.toFixed(2) + 'deg');
      rig.style.setProperty('--rx', pose.rx.toFixed(2) + 'deg');
      rig.style.setProperty('--fy', pose.y.toFixed(1) + 'px');

      const pr = rig.getBoundingClientRect();
      rect.x = pr.left + pr.width * 0.5;
      rect.y = pr.top + pr.height * 0.12;
      // Is the text screen up and on view? Stacked, the phone only ever shows the text.
      const now = stepped ? step === 2 && pr.bottom > 0 && pr.top < vh : pr.top < vh * 0.62 && pr.bottom > vh * 0.2;
      if (now && !showing) popText();
      showing = now;
      rect.on = showing;
    },
  };
}
