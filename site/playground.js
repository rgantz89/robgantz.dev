/* Change risk playground.
 * A simplified, browser-only version of how my change governance platform screens network changes.
 * All data is synthetic. The rules engine (top half) is pure and unit tested; the UI (bottom half)
 * only runs in a browser.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Reference data (synthetic)
  // ---------------------------------------------------------------------------

  var TEAMS = ['Core', 'Transport', 'Access', 'Metro', 'Edge', 'Voice', 'Platforms'];
  var GROUPS = ['Infra-Eng', 'Projects', 'Field-Ops', 'Tools-Eng'];
  var REGIONS = ['Central', 'East', 'South', 'West'];
  var WINDOW = { start: '00:00', end: '06:00' };
  var LOCKDOWN = { DAL: 'regional event lockdown' };

  var DEVICES = {
    'core-rtr-01.stl': { site: 'STL', region: 'Central', tier: 'core' },
    'core-rtr-02.kcy': { site: 'KCY', region: 'Central', tier: 'core' },
    'bb-rtr-01.dal': { site: 'DAL', region: 'South', tier: 'core' },
    'bb-rtr-02.atl': { site: 'ATL', region: 'East', tier: 'core' },
    'trn-mux-04.stl': { site: 'STL', region: 'Central', tier: 'transport' },
    'trn-roadm-02.dal': { site: 'DAL', region: 'South', tier: 'transport' },
    'trn-roadm-07.den': { site: 'DEN', region: 'West', tier: 'transport' },
    'agg-sw-11.stl': { site: 'STL', region: 'Central', tier: 'metro' },
    'agg-sw-03.atl': { site: 'ATL', region: 'East', tier: 'metro' },
    'met-rtr-05.den': { site: 'DEN', region: 'West', tier: 'metro' },
    'olt-2214.kcy': { site: 'KCY', region: 'Central', tier: 'access' },
    'olt-3108.atl': { site: 'ATL', region: 'East', tier: 'access' },
    'cmts-09.dal': { site: 'DAL', region: 'South', tier: 'access' },
    'edge-fw-02.stl': { site: 'STL', region: 'Central', tier: 'edge' },
    'edge-lb-01.den': { site: 'DEN', region: 'West', tier: 'edge' },
    'sbc-01.kcy': { site: 'KCY', region: 'Central', tier: 'voice' },
    'sbc-03.dal': { site: 'DAL', region: 'South', tier: 'voice' },
    'plat-k8s-01.stl': { site: 'STL', region: 'Central', tier: 'platforms' }
  };

  var TIER_WEIGHT = { core: 15, transport: 12, edge: 10, metro: 8, voice: 8, access: 4, platforms: 4 };

  // Order matters: it's the order flags are listed and the order of the bar segments.
  var REASONS = [
    { key: 'lockdown', label: 'Site in lockdown', weight: 40 },
    { key: 'conflict', label: 'Cross-team conflict', weight: 30 },
    { key: 'window', label: 'Outside maint window', weight: 25 },
    { key: 'rollback', label: 'Rollback plan missing', weight: 20 },
    { key: 'impact', label: 'Impact statement missing', weight: 15 },
    { key: 'region', label: 'Region mismatch', weight: 10 },
    { key: 'ticket', label: 'Ticket not linked', weight: 10 }
  ];
  var REASON = {};
  REASONS.forEach(function (r) { REASON[r.key] = r; });

  // Queue states outside tonight's pending list (counts only).
  var QUEUE_OTHER = { approved: 61, inProgress: 2, other: 18 };

  // id, team, group, device, action, start, end, docs (R rollback, I impact, T ticket), service-impacting, ticket region override
  var SEED = [
    ['CHG-1001', 'Core', 'Infra-Eng', 'core-rtr-01.stl', 'BGP policy update', '01:00', '03:00', 'RIT', true],
    ['CHG-1002', 'Transport', 'Infra-Eng', 'trn-mux-04.stl', 'Optical card swap', '01:30', '04:00', 'RI', true],
    ['CHG-1003', 'Metro', 'Field-Ops', 'agg-sw-11.stl', 'Uplink migration', '04:30', '05:30', 'RIT', false],
    ['CHG-1004', 'Access', 'Field-Ops', 'olt-2214.kcy', 'OLT firmware upgrade', '00:30', '03:30', 'RT', true],
    ['CHG-1005', 'Voice', 'Infra-Eng', 'sbc-01.kcy', 'SBC certificate renewal', '02:00', '02:30', 'RIT', false],
    ['CHG-1006', 'Edge', 'Infra-Eng', 'edge-fw-02.stl', 'Firewall rule cleanup', '23:00', '00:30', 'RIT', false],
    ['CHG-1007', 'Core', 'Projects', 'bb-rtr-01.dal', 'Backbone link turn-up', '01:00', '04:00', 'RIT', true],
    ['CHG-1008', 'Transport', 'Projects', 'trn-roadm-07.den', 'ROADM degree add', '00:00', '05:00', 'IT', true],
    ['CHG-1009', 'Platforms', 'Tools-Eng', 'plat-k8s-01.stl', 'Cluster node patching', '03:00', '05:00', 'RIT', false],
    ['CHG-1010', 'Metro', 'Projects', 'met-rtr-05.den', 'Metro ring re-home', '02:00', '04:00', 'RIT', true, 'South'],
    ['CHG-1011', 'Access', 'Field-Ops', 'olt-3108.atl', 'Line card replacement', '01:00', '02:00', 'RIT', false],
    ['CHG-1012', 'Core', 'Infra-Eng', 'bb-rtr-02.atl', 'Line card reseat', '01:30', '02:30', 'R', true],
    ['CHG-1013', 'Voice', 'Field-Ops', 'sbc-03.dal', 'Trunk group change', '03:00', '04:00', 'RIT', false],
    ['CHG-1014', 'Edge', 'Tools-Eng', 'edge-lb-01.den', 'Load balancer pool update', '05:30', '06:30', 'RIT', false],
    ['CHG-1015', 'Transport', 'Infra-Eng', 'trn-roadm-02.dal', 'Amplifier swap', '00:30', '01:30', 'RIT', false],
    ['CHG-1016', 'Metro', 'Field-Ops', 'agg-sw-03.atl', 'Software upgrade', '03:00', '05:00', 'RIT', true, 'Central'],
    ['CHG-1017', 'Access', 'Projects', 'cmts-09.dal', 'Node split', '02:00', '05:00', 'RIT', true],
    ['CHG-1018', 'Platforms', 'Tools-Eng', 'plat-k8s-01.stl', 'Monitoring agent rollout', '01:00', '02:00', 'IT', false],
    ['CHG-1019', 'Core', 'Infra-Eng', 'core-rtr-02.kcy', 'IGP metric tuning', '03:30', '04:30', 'RIT', true],
    ['CHG-1020', 'Voice', 'Infra-Eng', 'sbc-01.kcy', 'Dial plan update', '02:15', '02:45', 'RIT', false],
    ['CHG-1021', 'Transport', 'Field-Ops', 'trn-mux-04.stl', 'Fiber re-route', '05:00', '05:45', 'RT', true],
    ['CHG-1022', 'Edge', 'Infra-Eng', 'edge-fw-02.stl', 'NAT pool expansion', '02:00', '03:00', 'IT', false],
    ['CHG-1023', 'Access', 'Field-Ops', 'olt-2214.kcy', 'Port remap', '04:00', '05:00', 'RIT', false],
    ['CHG-1024', 'Metro', 'Projects', 'met-rtr-05.den', 'Capacity upgrade', '05:00', '05:30', 'RIT', false]
  ];

  function seedQueue() {
    return SEED.map(function (r) {
      return {
        id: r[0], team: r[1], group: r[2], device: r[3], action: r[4],
        start: r[5], end: r[6],
        rollback: r[7].indexOf('R') >= 0, impact: r[7].indexOf('I') >= 0, ticket: r[7].indexOf('T') >= 0,
        serviceImpacting: r[8], ticketRegion: r[9] || DEVICES[r[3]].region
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Rules engine
  // ---------------------------------------------------------------------------

  // Maintenance work happens overnight, so times before noon count as "after midnight".
  function nightMinutes(hhmm) {
    var p = hhmm.split(':');
    var m = Number(p[0]) * 60 + Number(p[1]);
    return m < 12 * 60 ? m + 24 * 60 : m;
  }

  function overlaps(a, b) {
    return nightMinutes(a.start) < nightMinutes(b.end) && nightMinutes(b.start) < nightMinutes(a.end);
  }

  // Two changes conflict if they touch the same device at the same time, or if two different
  // teams take service-impacting work at the same site at the same time.
  function conflictsWith(a, b) {
    if (a.id === b.id || !overlaps(a, b)) return false;
    if (a.device === b.device) return true;
    var sameSite = DEVICES[a.device].site === DEVICES[b.device].site;
    return sameSite && a.team !== b.team && a.serviceImpacting && b.serviceImpacting;
  }

  function validate(change) {
    var errors = [];
    if (!DEVICES[change.device]) errors.push('Pick a device.');
    if (TEAMS.indexOf(change.team) < 0) errors.push('Pick a team.');
    if (!change.action || !String(change.action).trim()) errors.push('Describe the change.');
    if (nightMinutes(change.end) <= nightMinutes(change.start)) errors.push('End time must be after start time.');
    return errors;
  }

  function screen(change, queue) {
    var dev = DEVICES[change.device];
    var flags = [];
    var add = function (key, detail, hint) { flags.push({ key: key, label: REASON[key].label, detail: detail, hint: hint }); };

    if (LOCKDOWN[dev.site]) {
      add('lockdown', dev.site + ' is under a ' + LOCKDOWN[dev.site] + ' tonight.', 'Reschedule after the lockdown lifts.');
    }
    var conflicts = queue.filter(function (o) { return conflictsWith(change, o); });
    if (conflicts.length) {
      var names = conflicts.map(function (o) { return o.id + ' (' + o.team + ', ' + o.start + '–' + o.end + ')'; });
      add('conflict', 'Overlaps ' + names.join(', ') + '.',
        'Coordinate with ' + unique(conflicts.map(function (o) { return o.team; })).join(' and ') + ', or move one change to another window.');
    }
    if (nightMinutes(change.start) < nightMinutes(WINDOW.start) || nightMinutes(change.end) > nightMinutes(WINDOW.end)) {
      add('window', 'Runs ' + change.start + '–' + change.end + '; tonight’s window is ' + WINDOW.start + '–' + WINDOW.end + '.', 'Fit the work inside the maintenance window.');
    }
    if (!change.rollback) add('rollback', 'No rollback plan is attached.', 'Attach a tested rollback plan before approval.');
    if (!change.impact) add('impact', 'No impact statement is attached.', 'State who loses service, and for how long.');
    if (change.ticketRegion !== dev.region) {
      add('region', 'The ticket says ' + change.ticketRegion + ', but ' + change.device + ' is in ' + dev.region + '.', 'Correct the ticket or the device.');
    }
    if (!change.ticket) add('ticket', 'Not linked to a parent ticket or request.', 'Link the change to the work it belongs to.');

    var score = TIER_WEIGHT[dev.tier] + flags.reduce(function (s, f) { return s + REASON[f.key].weight; }, 0);
    var level = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
    return { flags: flags, score: score, level: level, conflictIds: conflicts.map(function (o) { return o.id; }) };
  }

  function screenAll(queue) {
    return queue.map(function (c) {
      var r = screen(c, queue);
      return Object.assign({}, c, { result: r });
    }).sort(function (a, b) { return b.result.score - a.result.score || (a.id < b.id ? -1 : 1); });
  }

  function summarize(screened) {
    var s = { pending: screened.length, flagged: 0, conflicts: 0, high: 0, clean: 0, medium: 0,
              byTeam: {}, byGroup: {}, byReason: {} };
    TEAMS.forEach(function (t) { s.byTeam[t] = 0; });
    GROUPS.forEach(function (g) { s.byGroup[g] = {}; REASONS.forEach(function (r) { s.byGroup[g][r.key] = 0; }); });
    REASONS.forEach(function (r) { s.byReason[r.key] = 0; });
    screened.forEach(function (c) {
      var f = c.result.flags;
      if (f.length) { s.flagged++; s.byTeam[c.team]++; } else { s.clean++; }
      if (c.result.level === 'high') s.high++;
      else if (f.length) s.medium++;
      if (c.result.conflictIds.length) s.conflicts++;
      f.forEach(function (x) { s.byReason[x.key]++; s.byGroup[c.group][x.key]++; });
    });
    return s;
  }

  function unique(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }

  var Engine = {
    TEAMS: TEAMS, GROUPS: GROUPS, REGIONS: REGIONS, DEVICES: DEVICES, REASONS: REASONS, WINDOW: WINDOW,
    LOCKDOWN: LOCKDOWN, QUEUE_OTHER: QUEUE_OTHER,
    seedQueue: seedQueue, nightMinutes: nightMinutes, overlaps: overlaps, conflictsWith: conflictsWith,
    validate: validate, screen: screen, screenAll: screenAll, summarize: summarize
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = Engine; }
  if (typeof document === 'undefined') return;

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  var COLORS = {
    lockdown: ['#991B1B', '#DC2626'], conflict: ['#1E40AF', '#2563EB'], window: ['#166534', '#16A34A'],
    rollback: ['#B45309', '#F59E0B'], impact: ['#4338CA', '#6366F1'], region: ['#115E59', '#0D9488'],
    ticket: ['#0E7490', '#0891B2']
  };
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  var svgEl = function (tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  };

  var state = { queue: seedQueue(), team: 'Overview', filter: null, lastId: null, nextId: 9001, showAll: false };
  var TOP_N = 10;

  function visible(screened) {
    return state.team === 'Overview' ? screened : screened.filter(function (c) { return c.team === state.team; });
  }

  function render() {
    var screened = screenAll(state.queue);
    var all = summarize(screened);
    var shown = visible(screened);
    var s = summarize(shown);
    renderTabs(all);
    renderMetrics(s);
    renderRings(s);
    renderBars(s);
    renderWorklist(shown);
    renderFilter();
    $('pg-updated').textContent = 'just now';
  }

  function renderTabs(all) {
    var wrap = $('pg-tabs');
    wrap.textContent = '';
    ['Overview'].concat(TEAMS).forEach(function (t) {
      var b = el('button', 'pg-tab' + (state.team === t ? ' active' : ''), t);
      b.type = 'button';
      b.setAttribute('aria-pressed', state.team === t ? 'true' : 'false');
      var n = t === 'Overview' ? 0 : all.byTeam[t];
      if (n) {
        var badge = el('span', 'pg-badge', String(n));
        badge.setAttribute('aria-label', n + ' flagged');
        b.appendChild(badge);
      }
      b.addEventListener('click', function () { state.team = t; state.filter = null; render(); });
      wrap.appendChild(b);
    });
  }

  function renderMetrics(s) {
    var cards = [
      { id: null, k: 'Pending changes', v: s.pending, note: 'awaiting approval tonight', g: '#1D4ED8' },
      { id: 'flagged', k: 'Changes with flags', v: s.flagged, note: 'at least one check failed', g: '#4F46E5' },
      { id: 'conflict', k: 'Cross-team conflicts', v: s.conflicts, note: 'overlapping work at one site', g: '#0E7490' },
      { id: 'high', k: 'High-risk pending', v: s.high, note: 'ranked first for review', g: '#B91C1C' }
    ];
    var wrap = $('pg-metrics');
    wrap.textContent = '';
    cards.forEach(function (c) {
      var b = el('button', 'pg-card pg-metric' + (state.filter && state.filter.metric === c.id ? ' active' : ''));
      b.type = 'button';
      b.style.setProperty('--g', c.g);
      b.appendChild(el('span', 'pg-blob'));
      b.appendChild(el('span', 'k', c.k));
      b.appendChild(el('span', 'v mono', String(c.v)));
      b.appendChild(el('span', 'note', c.note));
      b.addEventListener('click', function () {
        state.filter = c.id && !(state.filter && state.filter.metric === c.id) ? { metric: c.id } : null;
        render();
      });
      wrap.appendChild(b);
    });
  }

  function drawRing(group, glow, r, w, parts) {
    var circ = 2 * Math.PI * r;
    var total = parts.reduce(function (a, p) { return a + p.n; }, 0) || 1;
    var acc = 0;
    group.textContent = ''; glow.textContent = '';
    parts.forEach(function (p) {
      if (!p.n) return;
      var frac = p.n / total;
      var len = Math.max(frac * circ - 2, 0.5);
      [group, glow].forEach(function (parent) {
        parent.appendChild(svgEl('circle', {
          cx: 125, cy: 125, r: r, fill: 'none', stroke: 'url(#' + p.grad + ')', 'stroke-width': w,
          'stroke-dasharray': len + ' ' + (circ - len), 'stroke-dashoffset': String(-acc * circ)
        }));
      });
      acc += frac;
    });
  }

  function renderRings(s) {
    var outer = [
      { label: 'Approved / scheduled', n: state.team === 'Overview' ? QUEUE_OTHER.approved : 0, grad: 'gApproved' },
      { label: 'Pending', n: s.pending, grad: 'gPending' },
      { label: 'In progress', n: state.team === 'Overview' ? QUEUE_OTHER.inProgress : 0, grad: 'gProg' },
      { label: 'Other', n: state.team === 'Overview' ? QUEUE_OTHER.other : 0, grad: 'gOther' }
    ];
    var inner = [
      { label: 'High risk', n: s.high, grad: 'gHigh' },
      { label: 'Flagged', n: s.flagged - s.high, grad: 'gFlag' },
      { label: 'Clean', n: s.clean, grad: 'gClean' }
    ];
    drawRing($('pg-outer'), $('pg-outer-glow'), 104, 20, outer);
    drawRing($('pg-inner'), $('pg-inner-glow'), 68, 17, inner);
    $('pg-center').textContent = String(s.pending);
    var legend = $('pg-legend');
    legend.textContent = '';
    var grads = { gApproved: ['#15803D', '#22C55E'], gPending: ['#1E40AF', '#2563EB'], gProg: ['#B45309', '#F59E0B'],
                  gOther: ['#475569', '#64748B'], gHigh: ['#991B1B', '#DC2626'], gFlag: ['#1D4ED8', '#0E7490'], gClean: ['#15803D', '#22C55E'] };
    [['Whole queue', outer], ['Tonight’s pending', inner]].forEach(function (grp) {
      legend.appendChild(el('div', 'pg-legend-h', grp[0]));
      grp[1].forEach(function (p) {
        var row = el('div', 'pg-legend-row');
        var dot = el('span', 'dot');
        dot.style.background = 'linear-gradient(135deg,' + grads[p.grad][0] + ',' + grads[p.grad][1] + ')';
        row.appendChild(dot);
        row.appendChild(el('span', '', p.label));
        row.appendChild(el('span', 'n mono', String(p.n)));
        legend.appendChild(row);
      });
    });
    var pass = s.pending ? Math.round(s.clean / s.pending * 100) : 0;
    $('pg-ring-cap').textContent = 'Inner ring: ' + s.pending + ' pending, ' + pass + '% passing every check · Outer ring: the whole queue by approval state';
  }

  function renderBars(s) {
    var wrap = $('pg-bars');
    wrap.textContent = '';
    var totals = GROUPS.map(function (g) { return REASONS.reduce(function (a, r) { return a + s.byGroup[g][r.key]; }, 0); });
    var max = Math.max.apply(null, totals.concat([1]));
    GROUPS.forEach(function (g, gi) {
      var row = el('div', 'pg-bar');
      var top = el('div', 'top');
      top.appendChild(el('span', 'name', g));
      top.appendChild(el('span', 'tot mono', String(totals[gi])));
      row.appendChild(top);
      var track = el('div', 'track');
      REASONS.forEach(function (r) {
        var n = s.byGroup[g][r.key];
        if (!n) return;
        var seg = el('button', 'seg');
        seg.type = 'button';
        seg.style.width = (n / max * 100) + '%';
        seg.style.background = 'linear-gradient(90deg,' + COLORS[r.key][0] + ',' + COLORS[r.key][1] + ')';
        seg.title = g + ': ' + n + ' × ' + r.label;
        seg.setAttribute('aria-label', seg.title + '. Show these changes.');
        if (state.filter && state.filter.group === g && state.filter.reason === r.key) seg.classList.add('active');
        seg.addEventListener('click', function () {
          var same = state.filter && state.filter.group === g && state.filter.reason === r.key;
          state.filter = same ? null : { group: g, reason: r.key };
          render();
        });
        track.appendChild(seg);
      });
      row.appendChild(track);
      wrap.appendChild(row);
    });
    var legend = $('pg-blegend');
    legend.textContent = '';
    REASONS.forEach(function (r) {
      var item = el('span', 'item');
      var dot = el('span', 'dot');
      dot.style.background = 'linear-gradient(90deg,' + COLORS[r.key][0] + ',' + COLORS[r.key][1] + ')';
      item.appendChild(dot);
      item.appendChild(document.createTextNode(r.label));
      legend.appendChild(item);
    });
  }

  function matchesFilter(c) {
    var f = state.filter;
    if (!f) return true;
    if (f.metric === 'flagged') return c.result.flags.length > 0;
    if (f.metric === 'conflict') return c.result.conflictIds.length > 0;
    if (f.metric === 'high') return c.result.level === 'high';
    if (f.group) return c.group === f.group && c.result.flags.some(function (x) { return x.key === f.reason; });
    return true;
  }

  function renderFilter() {
    var chip = $('pg-filter');
    var f = state.filter;
    if (!f) { chip.hidden = true; return; }
    var labels = { flagged: 'Changes with flags', conflict: 'Cross-team conflicts', high: 'High-risk pending' };
    chip.hidden = false;
    $('pg-filter-text').textContent = 'Showing: ' + (f.metric ? labels[f.metric] : f.group + ' · ' + REASON[f.reason].label);
  }

  function riskBadge(level, score) {
    var b = el('span', 'pg-risk ' + level, level.charAt(0).toUpperCase() + level.slice(1) + ' ' + score);
    return b;
  }

  function renderWorklist(shown) {
    var body = $('pg-rows');
    body.textContent = '';
    var rows = shown.filter(matchesFilter);
    $('pg-count').textContent = rows.length + ' of ' + shown.length + ' changes, ranked by risk';
    var more = $('pg-more');
    var limited = !state.showAll && rows.length > TOP_N;
    var mineIndex = rows.map(function (c) { return c.id; }).indexOf(state.lastId);
    var visibleRows = limited ? rows.slice(0, TOP_N) : rows;
    if (limited && mineIndex >= TOP_N) visibleRows = visibleRows.concat([rows[mineIndex]]);
    more.hidden = rows.length <= TOP_N;
    more.textContent = state.showAll ? 'Show top ' + TOP_N : 'Show all ' + rows.length;
    visibleRows.forEach(function (c) {
      var tr = el('tr', c.id === state.lastId ? 'mine' : '');
      var rank = shown.indexOf(c) + 1;
      tr.appendChild(el('td', 'mono muted', String(rank)));
      var idCell = el('td');
      idCell.appendChild(el('div', 'mono strong', c.id));
      idCell.appendChild(el('div', 'muted small', c.action));
      tr.appendChild(idCell);
      tr.appendChild(el('td', '', c.team));
      var dev = el('td', 'dev');
      dev.appendChild(el('div', 'mono small', c.device));
      dev.appendChild(el('div', 'muted small', c.start + '–' + c.end));
      tr.appendChild(dev);
      var risk = el('td');
      risk.appendChild(riskBadge(c.result.level, c.result.score));
      tr.appendChild(risk);
      var flags = el('td', 'flags');
      if (!c.result.flags.length) flags.appendChild(el('span', 'pg-chip clean', 'All checks pass'));
      c.result.flags.forEach(function (f) {
        var chip = el('span', 'pg-chip', f.label);
        chip.style.setProperty('--c', COLORS[f.key][1]);
        chip.title = f.detail;
        flags.appendChild(chip);
      });
      tr.appendChild(flags);
      body.appendChild(tr);
    });
    if (!rows.length) {
      var tr = el('tr');
      var td = el('td', 'muted', 'No changes match this filter.');
      td.colSpan = 6;
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }

  // --- Submit form -------------------------------------------------------------

  var PRESETS = {
    clean: { team: 'Edge', group: 'Tools-Eng', device: 'edge-lb-01.den', action: 'Certificate rotation', start: '02:00', end: '03:00',
             rollback: true, impact: true, ticket: true, serviceImpacting: false, ticketRegion: 'auto' },
    conflict: { team: 'Metro', group: 'Field-Ops', device: 'agg-sw-11.stl', action: 'Aggregation switch upgrade', start: '01:00', end: '03:00',
                rollback: true, impact: true, ticket: true, serviceImpacting: true, ticketRegion: 'auto' },
    paperwork: { team: 'Access', group: 'Field-Ops', device: 'olt-3108.atl', action: 'OLT chassis swap', start: '03:00', end: '07:00',
                 rollback: false, impact: false, ticket: true, serviceImpacting: true, ticketRegion: 'West' },
    lockdown: { team: 'Core', group: 'Projects', device: 'bb-rtr-01.dal', action: 'Backbone capacity add', start: '04:30', end: '05:30',
                rollback: true, impact: true, ticket: true, serviceImpacting: false, ticketRegion: 'auto' }
  };

  function fillSelect(sel, values, labelFn) {
    values.forEach(function (v) {
      var o = el('option', '', labelFn ? labelFn(v) : v);
      o.value = v;
      sel.appendChild(o);
    });
  }

  function timeOptions() {
    var out = [];
    for (var m = 22 * 60; m <= 32 * 60; m += 30) {
      var h = Math.floor(m / 60) % 24, mm = m % 60;
      out.push((h < 10 ? '0' : '') + h + ':' + (mm ? '30' : '00'));
    }
    return out;
  }

  function applyPreset(p) {
    $('f-team').value = p.team; $('f-group').value = p.group; $('f-device').value = p.device;
    $('f-action').value = p.action; $('f-start').value = p.start; $('f-end').value = p.end;
    $('f-rollback').checked = p.rollback; $('f-impact').checked = p.impact; $('f-ticket').checked = p.ticket;
    $('f-svc').checked = p.serviceImpacting; $('f-region').value = p.ticketRegion;
    $('f-errors').textContent = '';
  }

  function readForm() {
    var device = $('f-device').value;
    var region = $('f-region').value;
    return {
      id: 'CHG-' + state.nextId, team: $('f-team').value, group: $('f-group').value, device: device,
      action: $('f-action').value.trim().slice(0, 60), start: $('f-start').value, end: $('f-end').value,
      rollback: $('f-rollback').checked, impact: $('f-impact').checked, ticket: $('f-ticket').checked,
      serviceImpacting: $('f-svc').checked,
      ticketRegion: region === 'auto' ? (DEVICES[device] ? DEVICES[device].region : '') : region
    };
  }

  function showResult(change, screened) {
    var mine = screened.filter(function (c) { return c.id === change.id; })[0];
    var r = mine.result;
    var box = $('pg-result');
    box.textContent = '';
    box.hidden = false;
    var head = el('div', 'pg-result-head');
    head.appendChild(riskBadge(r.level, r.score));
    head.appendChild(el('span', 'strong', change.id + ' ranked #' + (screened.indexOf(mine) + 1) + ' of ' + screened.length));
    box.appendChild(head);
    if (!r.flags.length) {
      box.appendChild(el('p', 'pg-pass', 'All checks pass. This change goes to the bottom of the review queue so approvers can spend their time on riskier work.'));
    } else {
      box.appendChild(el('p', 'muted small', r.flags.length + (r.flags.length === 1 ? ' check' : ' checks') + ' failed. Approvers see this before anyone signs off:'));
      var ul = el('ul', 'pg-flaglist');
      r.flags.forEach(function (f) {
        var li = el('li');
        var dot = el('span', 'dot');
        dot.style.background = COLORS[f.key][1];
        li.appendChild(dot);
        var txt = el('div');
        txt.appendChild(el('div', 'strong', f.label));
        txt.appendChild(el('div', 'muted small', f.detail + ' ' + f.hint));
        li.appendChild(txt);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
  }

  function onSubmit(ev) {
    ev.preventDefault();
    var change = readForm();
    var errors = validate(change);
    $('f-errors').textContent = errors.join(' ');
    if (errors.length) return;
    state.queue = state.queue.filter(function (c) { return c.id !== state.lastId; }).concat([change]);
    state.lastId = change.id;
    state.nextId++;
    state.team = 'Overview';
    state.filter = null;
    render();
    showResult(change, screenAll(state.queue));
    $('pg-reset').hidden = false;
    try {
      if (root.goatcounter && root.goatcounter.count) {
        root.goatcounter.count({ path: 'playground-screen', title: 'Screened a change', event: true });
      }
    } catch (e) { /* analytics is optional */ }
  }

  function onReset() {
    state.queue = seedQueue();
    state.lastId = null;
    state.filter = null;
    state.team = 'Overview';
    $('pg-result').hidden = true;
    $('pg-reset').hidden = true;
    render();
  }

  function initTheme() {
    var html = document.documentElement, btn = $('pg-theme');
    var sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>';
    var moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    var set = function (t) {
      html.setAttribute('data-pg-theme', t);
      btn.innerHTML = t === 'dark' ? sun : moon;
      btn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    };
    set('dark');
    btn.addEventListener('click', function () { set(html.getAttribute('data-pg-theme') === 'dark' ? 'light' : 'dark'); });
  }

  function init() {
    fillSelect($('f-team'), TEAMS);
    fillSelect($('f-group'), GROUPS);
    fillSelect($('f-device'), Object.keys(DEVICES), function (d) { return d + '  (' + DEVICES[d].region + ')'; });
    fillSelect($('f-start'), timeOptions());
    fillSelect($('f-end'), timeOptions());
    var reg = $('f-region');
    var auto = el('option', '', 'Matches the device');
    auto.value = 'auto';
    reg.appendChild(auto);
    fillSelect(reg, REGIONS);
    applyPreset(PRESETS.conflict);
    Object.keys(PRESETS).forEach(function (k) {
      var b = document.querySelector('[data-preset="' + k + '"]');
      if (b) b.addEventListener('click', function () { applyPreset(PRESETS[k]); });
    });
    $('pg-form').addEventListener('submit', onSubmit);
    $('pg-reset').addEventListener('click', onReset);
    $('pg-filter-clear').addEventListener('click', function () { state.filter = null; render(); });
    $('pg-more').addEventListener('click', function () { state.showAll = !state.showAll; render(); });
    initTheme();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : this);
