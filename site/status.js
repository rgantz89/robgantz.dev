(function () {
  'use strict';
  var SRC = '/status/status.json';
  var STALE_MIN = 15;
  var $ = function (id) { return document.getElementById(id); };

  function pct(x, digits) { return (x * 100).toFixed(digits) + '%'; }
  function ago(iso) {
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    return h + (h === 1 ? ' hour ago' : ' hours ago');
  }
  function text(id, value) { $(id).textContent = value; }

  function renderState(s) {
    var labels = { operational: 'All systems operational', degraded: 'Degraded performance', down: 'Site is down' };
    var el = $('state');
    el.className = 'state ' + s.current.state;
    text('state-text', labels[s.current.state] || s.current.state);
    text('checked', 'Checked ' + ago(s.generatedAt) + ', every ' + s.intervalMinutes + ' minutes');
    var staleMin = (Date.now() - new Date(s.generatedAt).getTime()) / 60000;
    var notice = $('notice');
    if (staleMin > STALE_MIN) {
      notice.hidden = false;
      notice.textContent = 'The last check was ' + ago(s.generatedAt) + '. The checker may be paused, so these numbers could be out of date.';
    } else {
      notice.hidden = true;
    }
  }

  function renderCards(s) {
    var slo = s.slo;
    if (slo.uptime === null) {
      text('uptime', '--');
    } else {
      text('uptime', pct(slo.uptime, slo.uptime === 1 ? 2 : 3));
    }
    text('uptime-s', slo.checks.toLocaleString() + ' checks since ' + s.trackingSince);

    text('budget', slo.budgetRemainingPct.toFixed(1) + '%');
    text('budget-s', 'SLO ' + pct(slo.target, 1) + ' · ' + slo.budgetUsedMinutes + ' of ' + slo.budgetMinutes + ' min used');
    var bar = $('budget-bar');
    requestAnimationFrame(function () { bar.style.width = Math.max(0, Math.min(100, slo.budgetRemainingPct)) + '%'; });

    var lat = s.latency24h;
    text('p95', lat.p95 === null ? '--' : lat.p95 + ' ms');
    text('p95-s', lat.p50 === null ? 'No samples yet' : 'median ' + lat.p50 + ' ms · ' + lat.samples.length + ' samples');

    var days = s.current.certDaysLeft;
    text('cert', days === null ? '--' : days + ' days');
    text('cert-s', days === null ? 'Could not read certificate' : 'until expiry · ACM renews it automatically');
  }

  function renderBars(s) {
    var wrap = $('bars');
    wrap.textContent = '';
    s.days.forEach(function (d) {
      var i = document.createElement('i');
      var label;
      if (d.uptime === null) {
        label = d.date + ': no data';
      } else {
        i.className = d.uptime >= s.slo.target ? 'good' : (d.uptime >= 0.99 ? 'warn' : 'bad');
        label = d.date + ': ' + pct(d.uptime, 2) + ' over ' + d.checks + ' checks';
        if (d.fails && d.fails.length) label += ', failed at ' + d.fails.slice(0, 6).join(', ') + ' UTC';
      }
      i.title = label;
      i.setAttribute('aria-label', label);
      wrap.appendChild(i);
    });
  }

  function renderSpark(s) {
    var svg = $('spark');
    var pts = s.latency24h.samples;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (pts.length < 2) return;
    var W = 600, H = 120, pad = 8;
    var max = Math.max.apply(null, pts), min = Math.min.apply(null, pts);
    if (max === min) { max += 1; min -= 1; }
    var x = function (i) { return (i / (pts.length - 1)) * W; };
    var y = function (v) { return H - pad - ((v - min) / (max - min)) * (H - pad * 2); };
    var line = pts.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
    var ns = 'http://www.w3.org/2000/svg';
    var defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = '<linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22D3EE" stop-opacity=".35"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/></linearGradient>';
    svg.appendChild(defs);
    var area = document.createElementNS(ns, 'polygon');
    area.setAttribute('points', '0,' + H + ' ' + line + ' ' + W + ',' + H);
    area.setAttribute('fill', 'url(#sg)');
    svg.appendChild(area);
    var pl = document.createElementNS(ns, 'polyline');
    pl.setAttribute('points', line);
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', '#22D3EE');
    pl.setAttribute('stroke-width', '2');
    pl.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(pl);
    text('lat-cap', 'Home page, measured from AWS us-east-1. Range ' + Math.min.apply(null, pts) + ' to ' + Math.max.apply(null, pts) + ' ms.');
  }

  function renderPages(s) {
    var body = $('pages');
    body.textContent = '';
    s.current.pages.forEach(function (p) {
      var tr = document.createElement('tr');
      var cells = [
        [p.path, ''],
        [p.status === 0 ? 'unreachable' : String(p.status), p.status === 200 ? 'ok' : 'bad-t'],
        [p.ms + ' ms', 'r'],
        [p.headersOk ? 'present' : 'missing', 'r ' + (p.headersOk ? 'ok' : 'bad-t')],
      ];
      cells.forEach(function (c, idx) {
        var td = document.createElement('td');
        td.textContent = c[0];
        if (c[1]) td.className = c[1];
        if (idx === 0) td.className = 'mono';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function load() {
    fetch(SRC, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (s) {
        renderState(s); renderCards(s); renderBars(s); renderSpark(s); renderPages(s);
      })
      .catch(function () {
        $('state').className = 'state';
        text('state-text', 'Monitoring is starting up');
        text('checked', 'The first check runs within 5 minutes of deployment.');
      });
  }

  load();
  setInterval(load, 60000);
})();
