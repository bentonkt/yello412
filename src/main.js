// Yello 412 — scroll effects.
//
// Writes CSS custom properties that styles.css animates from:
//   --p   0 → 1 while the hero is pinned (drives the caution-tape peel)
//   --sy  pixels scrolled through the hero (drives the ticker)
//   --e   0 → 1 per .sp section as it enters (yellow wipe, hazard unroll)
// and toggles:
//   .in on .rv elements once they enter the window (fade/slide in)
//   data-step on <html> for the "How it works" phone
//
// The inline script in <head> adds html.js unless the visitor prefers reduced
// motion. Without it, every effect stays in its finished state.
//
// On the home page this file also loads the 3D scene (src/scene/, built into
// scene.js) when the browser can draw it. See the end of the file.

(function () {
  var root = document.documentElement;
  if (!root.classList.contains('js')) {
    root.style.setProperty('--p', '1');
    return;
  }

  var pin = document.querySelector('.pin');
  var hero = document.querySelector('.hero');
  var main = document.getElementById('main');
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.rv'));
  var steps = document.querySelectorAll('.step');
  var sections = document.querySelectorAll('.sp');
  var narrow = window.matchMedia('(max-width: 860px)');
  var queued = false;

  function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }

  function tick() {
    queued = false;
    var vh = window.innerHeight;

    // Hero: progress through the pinned stretch. On phones the hero isn't
    // pinned (span is 0), so the tape counts as peeled.
    if (pin && hero) {
      var pr = pin.getBoundingClientRect();
      var span = pr.height - hero.offsetHeight;
      root.style.setProperty('--p', (span > 0 ? clamp01(-pr.top / span) : 1).toFixed(4));
      root.style.setProperty('--sy', String(Math.max(0, Math.round(-pr.top))));
    }

    // Sections with their own entry progress. Each finishes within its own
    // stretch of scrolling, and always before the page runs out of scroll.
    var left = main ? Math.max(0, main.getBoundingClientRect().bottom - vh) : 0;
    for (var k = 0; k < sections.length; k++) {
      var sr = sections[k].getBoundingClientRect();
      var reach = (vh - (sr.top - left)) * 0.8;
      var run = Math.max(1, Math.min(vh * (sections[k].id === 'demo' ? 0.5 : 0.85), reach));
      sections[k].style.setProperty('--e', clamp01((vh - sr.top) / run).toFixed(4));
    }

    // Fade-ins: once in, stay in.
    for (var i = reveals.length - 1; i >= 0; i--) {
      if (reveals[i].getBoundingClientRect().top < vh * 0.9) {
        reveals[i].classList.add('in');
        reveals.splice(i, 1);
      }
    }

    // How it works: the step nearest the middle of the window is active.
    // On narrow screens the phone sits below the steps, so it just shows the text.
    if (narrow.matches) { root.removeAttribute('data-step'); return; }
    var best = 0, bestDist = Infinity, mid = vh / 2;
    for (var j = 0; j < steps.length; j++) {
      var r = steps[j].getBoundingClientRect();
      var d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestDist) { bestDist = d; best = j; }
    }
    if (steps.length) root.setAttribute('data-step', String(best));
  }

  function queue() {
    if (!queued) { queued = true; requestAnimationFrame(tick); }
  }

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  window.addEventListener('load', queue);
  tick();

  // The 3D scene. The inline script in the home page's <head> adds html.gl when
  // the browser can draw it; the scene adds html.gl-ready once it's on screen.
  // If it doesn't load, fails or never gets going, drop back to the flat page.
  var scene = document.querySelector('meta[name="yello-scene"]');
  if (scene && root.classList.contains('gl')) {
    var state = (window.yello = window.yello || {});
    var flat = function () {
      if (state.ready) return;
      state.failed = true;
      root.classList.remove('gl', 'gl-ready');
      queue();
    };
    var s = document.createElement('script');
    s.type = 'module';
    s.src = scene.content;
    s.onerror = flat;
    document.head.appendChild(s);
    // Give it 12 seconds of the tab actually being looked at. (A tab opened in
    // the background draws nothing, so that time doesn't count.)
    var waited = 0;
    var watch = setInterval(function () {
      if (state.ready || state.failed) { clearInterval(watch); return; }
      if (!document.hidden && (waited += 500) >= 12000) { clearInterval(watch); flat(); }
    }, 500);
  }
})();
