(function () {
  'use strict';

  var dot = document.getElementById('cursor-dot');
  var ring = document.getElementById('cursor-ring');
  var label = document.getElementById('cursor-text');
  var badge = document.getElementById('cursor-badge');
  if (!dot || !ring || !label) return;

  var isDemoPage = !document.getElementById('app');

  function canUse() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if (window.matchMedia('(pointer: coarse)').matches) return false;
    if (window.innerWidth < 900) return false;
    return true;
  }

  var enabled = false;
  var mx = -200;
  var my = -200;
  var rx = -200;
  var ry = -200;
  var raf;
  var trail = [];
  var TRAIL_LEN = 8;
  var lastTrailTime = 0;

  function clearState() {
    document.body.classList.remove('cursor-hover', 'cursor-link', 'cursor-text-select');
    if (!isDemoPage) label.textContent = 'Read paper';
  }

  function enable() {
    if (enabled || !canUse()) return;
    enabled = true;
    document.body.classList.add('custom-cursor-page');
    dot.style.opacity = '1';
    ring.style.opacity = '1';
    if (!raf) animateRing();
    bindMagnetic();
    if (isDemoPage && badge) {
      setTimeout(function () {
        badge.classList.add('show');
      }, 800);
      setTimeout(function () {
        badge.classList.remove('show');
      }, 3400);
    }
  }

  function disable() {
    enabled = false;
    document.body.classList.remove('custom-cursor-page');
    dot.style.opacity = '0';
    ring.style.opacity = '0';
    clearState();
    if (raf) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    trail.forEach(function (t) {
      t.el.style.opacity = '0';
    });
  }

  function animateRing() {
    rx += (mx - rx) * 0.13;
    ry += (my - ry) * 0.13;
    ring.style.left = rx + 'px';
    ring.style.top = ry + 'px';
    raf = requestAnimationFrame(animateRing);
  }

  function updateTrail(x, y) {
    var now = Date.now();
    if (now - lastTrailTime < 30) return;
    lastTrailTime = now;
    for (var i = TRAIL_LEN - 1; i > 0; i--) {
      trail[i].x = trail[i - 1].x;
      trail[i].y = trail[i - 1].y;
    }
    trail[0].x = x;
    trail[0].y = y;
    trail.forEach(function (t, idx) {
      t.el.style.left = t.x + 'px';
      t.el.style.top = t.y + 'px';
      t.el.style.opacity = String((1 - idx / TRAIL_LEN) * 0.35);
      var s = (1 - idx / TRAIL_LEN) * 4;
      t.el.style.width = s + 'px';
      t.el.style.height = s + 'px';
    });
  }

  function onMove(e) {
    if (!enabled) return;
    mx = e.clientX;
    my = e.clientY;
    dot.style.left = mx + 'px';
    dot.style.top = my + 'px';
    label.style.left = mx + 14 + 'px';
    label.style.top = my + 'px';
    updateTrail(mx, my);
  }

  function setLinkFrom(el) {
    var txt =
      (el.closest('[data-cursor-text]') && el.closest('[data-cursor-text]').dataset.cursorText) ||
      el.dataset.cursorText ||
      (el.closest('[data-open-paper], .paper-card, .featured-paper') ? 'Read paper' : '');
    if (txt) {
      label.textContent = txt;
      document.body.classList.add('cursor-link');
      document.body.classList.remove('cursor-hover');
      return true;
    }
    return false;
  }

  function onOver(e) {
    if (!enabled) return;
    var textEl = e.target.closest(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea, select'
    );
    if (textEl) {
      clearState();
      document.body.classList.add('cursor-text-select');
      return;
    }
    var interactive = e.target.closest(
      'a, button, .filter-btn, .paper-tag, .tag-pill, .trending-title, [data-open-paper], .featured-paper, .paper-card, [data-cursor-text], .sidebar-link, #admin-btn, .submit-btn, .action-btn'
    );
    if (!interactive) return;
    clearState();
    if (!setLinkFrom(interactive)) {
      document.body.classList.add('cursor-hover');
    }
  }

  function onOut(e) {
    if (!enabled) return;
    var related = e.relatedTarget;
    if (related && e.target.closest('a, button, .paper-card, .featured-paper, .filter-btn')) {
      if (e.target.closest('a, button, .paper-card, .featured-paper, .filter-btn').contains(related)) return;
    }
    clearState();
  }

  function bindMagnetic() {
    document.querySelectorAll('.magnet').forEach(function (btn) {
      if (btn._magnetBound) return;
      btn._magnetBound = true;
      btn.addEventListener('mousemove', function (e) {
        if (!enabled) return;
        var r = btn.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        btn.style.transform =
          'translate(' + (e.clientX - cx) * 0.35 + 'px,' + (e.clientY - cy) * 0.35 + 'px)';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.transform = '';
      });
    });
  }

  function initTrail() {
    for (var i = 0; i < TRAIL_LEN; i++) {
      var td = document.createElement('div');
      td.className = 'trail-dot';
      td.style.opacity = '0';
      td.setAttribute('aria-hidden', 'true');
      document.body.appendChild(td);
      trail.push({ el: td, x: -200, y: -200 });
    }
  }

  function initDemoBindings() {
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.filter-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        btn.classList.add('active');
      });
    });
  }

  function init() {
    initTrail();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('mouseenter', function () {
      if (enabled) {
        dot.style.opacity = '1';
        ring.style.opacity = '1';
      }
    });
    document.addEventListener('mouseleave', function () {
      dot.style.opacity = '0';
      ring.style.opacity = '0';
      clearState();
    });

    if (isDemoPage) initDemoBindings();
    if (canUse()) enable();

    window.addEventListener('resize', function () {
      if (canUse()) enable();
      else disable();
    });

    window.rebindCustomCursor = bindMagnetic;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
