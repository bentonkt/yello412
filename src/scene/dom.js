// The parts of the 3D look that live in the page itself rather than on the
// canvas: the phone that turns in space, and cards that tilt under the pointer.

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

  if (phone) phone.addEventListener('animationend', (e) => { if (e.animationName === 'phonebuzz') phone.classList.remove('buzz'); });

  // ---------- the phone ----------
  const pose = { ry: -26, rx: 8, y: 0 };
  const POSES = [{ ry: -30, rx: 10 }, { ry: -19, rx: 6 }, { ry: -9, rx: 4 }];
  const rect = { x: 0, y: 0, on: false };

  return {
    phoneRect: rect,
    buzz() { if (phone) { phone.classList.remove('buzz'); void phone.offsetWidth; phone.classList.add('buzz'); } },

    update(dt, time, pointer, vh) {
      if (!rig || !how) return;
      const hr = how.getBoundingClientRect();
      const near = hr.bottom > -100 && hr.top < vh + 100;
      rect.on = false;
      if (!near) return;
      const step = Number(root.getAttribute('data-step') || 2);
      const target = POSES[step] || POSES[2];
      const k = 1 - Math.exp(-dt * 4);
      pose.ry = lerp(pose.ry, target.ry + pointer.x * 9, k);
      pose.rx = lerp(pose.rx, target.rx + pointer.y * 6, k);
      pose.y = Math.sin(time * 0.9) * 6;
      rig.style.setProperty('--ry', pose.ry.toFixed(2) + 'deg');
      rig.style.setProperty('--rx', pose.rx.toFixed(2) + 'deg');
      rig.style.setProperty('--fy', pose.y.toFixed(1) + 'px');

      const pr = rig.getBoundingClientRect();
      rect.x = pr.left + pr.width * 0.5;
      rect.y = pr.top + pr.height * 0.12;
      rect.on = pr.bottom > 0 && pr.top < vh && root.hasAttribute('data-step') && step === 2;
    },
  };
}
