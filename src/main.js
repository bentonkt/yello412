// Yello 412 — page behaviour.
//
// For everyone:
//   - links to a section of this page scroll there smoothly (and keep whatever
//     is after the "?" in the address, so a visitor from an ad doesn't reload)
//   - html.dock-on shows the call/text bar while the visitor is between the
//     hero's button and the demo section
//
// Scroll effects (skipped when the visitor prefers reduced motion; the inline
// script in <head> only adds html.js when they don't). They write CSS custom
// properties that styles.css animates from:
//   --p   0 → 1 while the hero is pinned (drives the caution-tape peel)
//   --sy  pixels scrolled through the hero (drives the ticker)
//   --e   0 → 1 per .sp section as it enters (yellow wipe, hazard unroll)
// and toggle:
//   .in on .rv elements once they enter the window (fade/slide in)
//   data-step on <html> for the "How it works" phone
//
// On the home page this file also loads the 3D scene (src/scene/, built into
// scene.js) when the browser can draw it. See the end of the file.

(function () {
  var root = document.documentElement;
  var state = (window.yello = window.yello || {});
  state.main = true;          // the inline script in <head> checks this ran
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- links to a section of this page ----------
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[href*="#"]') : null;
    if (!a || a.target === '_blank') return;
    var url;
    try { url = new URL(a.href, window.location.href); } catch (err) { return; }
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.hash.length < 2) return;
    var el = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!el) return;
    e.preventDefault();
    // What following the link would have done, minus the reload and the scrolling.
    var arrive = function () {
      if (window.location.hash !== url.hash) history.pushState(null, '', window.location.pathname + window.location.search + url.hash);
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    };
    // In 3D a long jump is covered by a flood of yellow instead (scene/index.js).
    if (state.jump && state.jump(el, e, a, arrive)) return;
    arrive();
    el.scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', block: 'start' });
  });

  // ---------- the call/text bar ----------
  var cta = document.querySelector('.hero-cta');
  var demoHead = document.querySelector('.demo-head');
  function dock() {
    if (!cta || !demoHead) return;
    root.classList.toggle('dock-on', cta.getBoundingClientRect().bottom < 0 && demoHead.getBoundingClientRect().top > window.innerHeight * 0.85);
  }

  if (!root.classList.contains('js')) {
    // Reduced motion: everything shows in its finished state.
    root.style.setProperty('--p', '1');
    var asked = false;
    var ask = function () { if (!asked) { asked = true; requestAnimationFrame(function () { asked = false; dock(); }); } };
    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask);
    dock();
    return;
  }

  // ---------- scroll effects ----------
  var pin = document.querySelector('.pin');
  var hero = document.querySelector('.hero');
  var main = document.getElementById('main');
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.rv'));
  var steps = document.querySelectorAll('.step');
  var sections = document.querySelectorAll('.sp');
  // When the phone sits under the steps instead of beside them. Must match styles.css.
  var narrowFlat = window.matchMedia('(max-width: 899px)');
  var narrow3d = window.matchMedia('(max-width: 999px), (max-height: 559px)');
  var queued = false;

  function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }

  function tick() {
    queued = false;
    var vh = window.innerHeight;
    dock();

    // Hero: progress through the pinned stretch. Where the hero isn't pinned
    // (span is 0) the tape counts as peeled. Skipped once the hero is off screen.
    if (pin && hero) {
      var pr = pin.getBoundingClientRect();
      if (pr.bottom > -200) {
        var span = pr.height - hero.offsetHeight;
        pin.style.setProperty('--p', (span > 0 ? clamp01(-pr.top / span) : 1).toFixed(4));
        pin.style.setProperty('--sy', String(Math.max(0, Math.round(-pr.top))));
      }
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
    // When the phone sits below the steps, it just shows the text.
    if (root.classList.contains('gl') ? narrow3d.matches : narrowFlat.matches) { root.removeAttribute('data-step'); return; }
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

  // ---------- the 3D scene ----------
  // The inline script in the home page's <head> adds html.gl when the browser can
  // draw it; the scene adds html.gl-ready once it's on screen. If it doesn't
  // load, fails or never gets going, drop back to the flat page.
  var scene = document.querySelector('meta[name="yello-scene"]');
  if (scene && root.classList.contains('gl')) {
    var flat = function () {
      if (state.ready || state.failed) return;
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
