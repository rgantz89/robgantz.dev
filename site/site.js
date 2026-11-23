(function(){try{var q=new URLSearchParams(location.search).get('r');window.goatcounter={path:location.pathname+(q?'?r='+encodeURIComponent(q):'')};}catch(e){}})();
(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  if (hasIO && !reduce) root.classList.add('fx');
  var ACCENT = '#22D3EE';
  var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  function countIn(el) {
    if (reduce) return;
    el.querySelectorAll('[data-count]').forEach(function (c) {
      var target = Number(c.getAttribute('data-count')), start = null;
      c.textContent = '0';
      function tick(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / 1500), e = 1 - Math.pow(1 - t, 3);
        c.textContent = fmt(target * e);
        if (t < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }
  if (hasIO) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var vh = window.innerHeight || 800;
        if (e.intersectionRatio >= 0.18 || e.intersectionRect.height >= vh * 0.3) {
          e.target.classList.add('in'); countIn(e.target); io.unobserve(e.target);
        }
      });
    }, { threshold: [0, 0.18, 0.4], rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

    var links = document.querySelectorAll('[data-nav-link]');
    var map = { work: 'work', experience: 'exp', skills: 'skills', contact: 'contact' };
    var navIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var key = map[e.target.getAttribute('data-nav')];
        links.forEach(function (a) {
          var on = a.getAttribute('data-nav-link') === key;
          a.style.color = on ? '#FFFFFF' : '#9FB0C3';
          a.style.borderBottomColor = on ? ACCENT : 'transparent';
          if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    document.querySelectorAll('[data-nav]').forEach(function (el) { navIO.observe(el); });

    var panels = document.querySelectorAll('[data-panel]');
    if (panels.length) {
      var stepIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var n = e.target.getAttribute('data-step');
          panels.forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== n; });
          document.querySelectorAll('.story-step').forEach(function (s) { s.style.opacity = s.getAttribute('data-step') === n ? '1' : '0.35'; });
          document.querySelectorAll('[data-dot]').forEach(function (d) { d.style.background = d.getAttribute('data-dot') === n ? ACCENT : '#2A4060'; });
          document.querySelectorAll('[data-bar]').forEach(function (b) { b.style.background = b.getAttribute('data-bar') === n ? ACCENT : '#22385A'; });
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      document.querySelectorAll('[data-step]').forEach(function (el) { stepIO.observe(el); });
    }
  }

  var fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  if (fine && !reduce) {
    document.addEventListener('pointermove', function (e) {
      var el = e.target.closest && e.target.closest('[style*="--mx"], .gb');
      if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
    }, { passive: true });
    document.querySelectorAll('.tilt').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        if (window.innerWidth < 900) return;
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transition = 'transform .12s ease-out';
        el.style.transform = 'perspective(1100px) rotateX(' + (-y * 4).toFixed(2) + 'deg) rotateY(' + (x * 5).toFixed(2) + 'deg) translateY(-4px)';
      });
      el.addEventListener('pointerleave', function () { el.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1)'; el.style.transform = ''; });
    });
    var hero = document.querySelector('.hero-graphic');
    if (hero) {
      var layers = hero.querySelectorAll('[data-depth]');
      hero.addEventListener('pointermove', function (e) {
        var r = hero.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        layers.forEach(function (l) { var d = Number(l.getAttribute('data-depth')); l.style.transition = 'transform .25s ease-out'; l.style.transform = 'translate3d(' + (-x * d).toFixed(1) + 'px,' + (-y * d).toFixed(1) + 'px,0)'; });
      });
      hero.addEventListener('pointerleave', function () { layers.forEach(function (l) { l.style.transition = 'transform .8s cubic-bezier(.2,.8,.2,1)'; l.style.transform = ''; }); });
    }
  }
  var tip = document.getElementById('rg-tip'), host = document.getElementById('rg-parallax');
  if (tip && host) {
    document.querySelectorAll('[data-tip]').forEach(function (g) {
      g.addEventListener('pointerenter', function () {
        var hr = host.getBoundingClientRect(), gr = g.getBoundingClientRect();
        tip.textContent = g.getAttribute('data-tip');
        tip.style.left = (gr.left + gr.width / 2 - hr.left).toFixed(0) + 'px';
        tip.style.top = (gr.top - hr.top).toFixed(0) + 'px';
        tip.hidden = false;
      });
      g.addEventListener('pointerleave', function () { tip.hidden = true; });
    });
  }
  var btn = document.getElementById('rg-menu-btn'), menu = document.getElementById('rg-menu');
  if (btn && menu) {
    btn.addEventListener('click', function () {
      var open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('[data-close-menu]').forEach(function (a) {
      a.addEventListener('click', function () { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
    });
  }
  var bar = document.getElementById('rg-progress'), px = document.getElementById('rg-parallax'), raf = 0;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var max = root.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (bar) bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      if (px && !reduce && window.innerWidth > 760) px.style.transform = 'translateY(' + (Math.min(window.scrollY, 900) * 0.16).toFixed(1) + 'px)';
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
