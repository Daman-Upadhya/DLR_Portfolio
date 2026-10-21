/* Page behaviour for both templates. Reads the JSON the build embedded in
   <script type="application/json" id="data"> and renders it. <body data-page="project|landing">
   selects the renderer.

   The project page is interactive: its slicers (date range, organisation, trade, location) are
   applied by Agg.run (scripts/aggregate.js) over the row-level facts calculation.py embedded.
   Every per-row flag comes from calculation.py; this file only chooses the filter context and
   draws the result. The filter state lives in the URL hash so a view can be shared. */
(function () {
  'use strict';
  var C = window.Charts, A = window.Agg;
  var el = C.el;
  var D = JSON.parse(document.getElementById('data').textContent);
  C.setLocale((D.data && D.data.locale) || (D.meta && D.meta.locale) || 'en-IN');

  /* ---------- theme ---------- */
  var root = document.documentElement;
  function applyTheme(t) {
    if (t === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
    var b = document.getElementById('themeBtn');
    if (b) { b.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false'); b.title = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'; }
  }
  (function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem('dlr-theme'); } catch (e) { /* private mode */ }
    var preset = root.getAttribute('data-theme');
    var t = stored || preset || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(t);
    var b = document.getElementById('themeBtn');
    if (b) b.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('dlr-theme', next); } catch (e) { /* ignore */ }
    });
  })();

  /* ---------- helpers ---------- */
  function dash(v) { return (v === null || v === undefined || v === '') ? '—' : v; }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var h = d.getHours(), m = d.getMinutes();
    return C.fmtDate(iso) + ', ' + (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' pm' : ' am');
  }
  function hoursSince(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return null;
    return (Date.now() - d.getTime()) / 36e5;
  }
  function pill(label, tone, icon) {
    var p = el('span', 'pill tone-' + (tone || 'inert'));
    p.appendChild(el('span', 'pill-ic', icon || toneIcon(tone)));
    p.appendChild(el('span', null, label));
    return p;
  }
  function toneIcon(t) { return { good: '✓', warn: '!', bad: '✕', inert: '•' }[t] || '•'; }

  function statusCls(status) {
    var g = (D.data && D.data.status && D.data.status.groups) || {};
    if ((g.complete || []).indexOf(status) >= 0) return 's-complete';
    if ((g.inProgress || []).indexOf(status) >= 0) return 's-started';
    if ((g.issue || []).indexOf(status) >= 0) return status === 'Warning' ? 's-warning' : 's-stopped';
    if ((g.ready || []).indexOf(status) >= 0) return 's-notcommitted';
    return 's-notstarted';
  }
  function statusLabel(s) {
    var L = (D.data && D.data.status && D.data.status.labels) || {};
    return L[s] || s || '—';
  }
  function ageCls(days) {
    if (days === null || days === undefined) return '';
    if (days <= 7) return 'age-1';
    if (days <= 14) return 'age-2';
    if (days <= 30) return 'age-3';
    if (days <= 60) return 'age-4';
    return 'age-5';
  }
  function fmtDays(v) { return (v === null || v === undefined) ? '—' : C.fmtNum(Math.round(v * 10) / 10) + ' d'; }
  function fmtRange(a, b) { return C.fmtDate(a, true) + ' – ' + C.fmtDate(b, true); }
  function weekLabel(key) { return key ? 'W' + key.split('-')[1] : '—'; }
  function plural(n, one, many) { return C.fmtNum(n) + ' ' + (n === 1 ? one : (many || one + 's')); }
  var TONE_WORD = { good: 'Good', warn: 'Watch', bad: 'Critical', inert: 'Not measured' };
  /* a change between two percentages is in percentage points, not percent */
  function fmtPts(v) { return v === null || v === undefined ? '—' : C.fmtNum(Math.round(Math.abs(v) * 10) / 10) + ' pts'; }

  /* ---------- banner: stale / unavailable. Sample builds show nothing: the page is the same either way ---------- */
  function renderBanner(meta) {
    var box = document.getElementById('banner');
    if (!box) return;
    box.innerHTML = '';
    var staleAfter = Number(meta.staleAfterHours || 20);
    var msg = null, tone = 'warn';
    if (meta.state === 'unavailable') {
      msg = 'This dashboard has no data yet. The first fetch from VisiLean has not completed; the next scheduled build will fill it.';
      tone = 'inert';
    } else if (meta.state === 'stale') {
      msg = 'VisiLean was unreachable at build time. Showing the last successful data, as of ' + fmtDateTime(meta.dataAsOf) + '.';
    } else if (meta.origin !== 'sample') {
      var h = hoursSince(meta.generatedAt);
      if (h !== null && h > staleAfter) msg = 'This page was built ' + Math.round(h) + ' hours ago. A newer build may be pending.';
    }
    if (!msg) { box.hidden = true; return; }
    box.hidden = false;
    box.className = 'banner tone-' + tone;
    box.appendChild(el('span', 'pill-ic', toneIcon(tone)));
    box.appendChild(el('span', null, msg));
  }

  function kpiTile(d) {
    var tile = el('div', 'kpi' + (d.value === '—' ? ' nodata' : ''));
    tile.appendChild(el('div', 'kpi-value' + (d.tone && d.tone !== 'inert' ? ' tone-text-' + d.tone : ''), d.value));
    tile.appendChild(el('div', 'kpi-label', d.label));
    if (d.tone) tile.appendChild(pill(d.toneLabel || TONE_WORD[d.tone], d.tone));
    if (d.sub) tile.appendChild(el('div', 'kpi-sub', d.sub));
    if (d.title) tile.title = d.title;
    if (d.pick) { makePick(tile, d.pick); tile.appendChild(el('div', 'kpi-more', 'View list')); }
    return tile;
  }
  function chip(label, n, cls, title, pick) {
    var c = el('span', 'chip');
    if (cls) c.appendChild(el('span', 'swatch ' + cls));
    c.appendChild(el('span', null, label));
    if (n !== undefined && n !== null) c.appendChild(el('span', 'chip-n', typeof n === 'number' ? C.fmtNum(n) : n));
    if (title) c.title = title;
    if (pick) makePick(c, pick);
    return c;
  }
  function emptyRow(tb, cols, text) {
    var tr = el('tr'); var td = el('td', 'empty', text); td.colSpan = cols; tr.appendChild(td); tb.appendChild(tr);
  }
  function statusCell(status) {
    var td = el('td'); var sp = el('span', 'status');
    sp.appendChild(el('span', 'swatch ' + statusCls(status))); sp.appendChild(el('span', null, statusLabel(status)));
    td.appendChild(sp); return td;
  }
  function setText(id, text) { var n = document.getElementById(id); if (n) n.textContent = text; }

  var perfDim = 'trade';      /* performance card: 'trade' (default) or 'organisation' */
  (function measureAppbar() {
    var bar = document.querySelector('.appbar');
    if (!bar) return;
    function set() { root.style.setProperty('--appbar-h', Math.round(bar.getBoundingClientRect().height) + 'px'); }
    set();
    if (window.ResizeObserver) new ResizeObserver(set).observe(bar); else window.addEventListener('resize', set);
  })();
  var reasonView = 'reasons'; /* reasons card: 'reasons' (Reasons for variance) or 'events' (Reason category) */
  var ppcSpec = null;       /* the weekly chart's last spec, redrawn at the new width on resize */
  (function watchChart() {
    var svg = document.getElementById('ppcChart');
    if (!svg || !window.ResizeObserver) return;
    var last = 0, pending = false;
    new ResizeObserver(function () {
      var w = Math.round(svg.getBoundingClientRect().width);
      if (!ppcSpec || Math.abs(w - last) < 8 || pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; last = w; C.comboChart(svg, ppcSpec); });
    }).observe(svg);
  })();

  var laWeeksSpec = null;  /* the look-ahead status chart's last spec, redrawn when its width changes (the tab starts hidden) */
  (function watchLaWeeks() {
    var svg = document.getElementById('laWeeksChart');
    if (!svg || !window.ResizeObserver) return;
    var last = 0, pending = false;
    new ResizeObserver(function () {
      var w = Math.round(svg.getBoundingClientRect().width);
      if (!laWeeksSpec || !w || Math.abs(w - last) < 8 || pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; last = w; C.comboChart(svg, laWeeksSpec); });
    }).observe(svg);
  })();

  var riskWeeksSpec = null;  /* the high-risk look-ahead chart's last spec, redrawn when its width changes (the tab starts hidden) */
  (function watchRiskWeeks() {
    var svg = document.getElementById('riskWeeksChart');
    if (!svg || !window.ResizeObserver) return;
    var last = 0, pending = false;
    new ResizeObserver(function () {
      var w = Math.round(svg.getBoundingClientRect().width);
      if (!riskWeeksSpec || !w || Math.abs(w - last) < 8 || pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; last = w; C.comboChart(svg, riskWeeksSpec); });
    }).observe(svg);
  })();

  var consWeeksSpec = null;  /* the target-week chart's last spec, redrawn when its width changes (the tab starts hidden) */
  (function watchConsWeeks() {
    var svg = document.getElementById('consWeeksChart');
    if (!svg || !window.ResizeObserver) return;
    var last = 0, pending = false;
    new ResizeObserver(function () {
      var w = Math.round(svg.getBoundingClientRect().width);
      if (!consWeeksSpec || !w || Math.abs(w - last) < 8 || pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; last = w; C.comboChart(svg, consWeeksSpec); });
    }).observe(svg);
  })();

  /* ---------- detail list: the activities or constraints behind a mark ----------
     Every clickable mark calls lister(spec, title, sub). Agg.records turns the spec into rows
     from the current filter context; this panel only lists, searches and exports them. */
  var CUR = { V: null, data: null };
  var DR = { rows: [], cols: [], csv: [], title: '', opener: null };
  var DRAWER_LIMIT = 300;

  function makePick(node, fn, hint) {
    node.classList.add('pick');
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    if (hint !== false) node.title = (node.title ? node.title + ' · ' : '') + 'Click to list them';
    node.addEventListener('click', function (e) { e.stopPropagation(); fn(node); });
    node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(node); } });
  }
  function lister(spec, title, sub) { return function (node) { openList(spec, title, sub, node); }; }
  function ensureListBtn(descId, fn) {
    var d = document.getElementById(descId);
    if (!d) return;
    var head = d.parentNode, b = head.querySelector('.list-btn');
    if (!b) {
      b = el('button', 'btn list-btn'); b.type = 'button';
      b.appendChild(el('span', 'list-ic')); b.appendChild(document.createTextNode('View list'));
      head.appendChild(b);
    }
    b.hidden = !fn;
    b.onclick = fn ? function () { fn(b); } : null;
  }

  function nameCell(main, sub) {
    var td = el('td', 'cell-name');
    td.appendChild(el('div', null, main || '—'));
    if (sub) td.appendChild(el('div', 'cell-sub', sub));
    return td;
  }
  function textCell(v, cls) { return el('td', cls || null, dash(v)); }
  function dateCell(v) { return el('td', 'num', v ? C.fmtDate(v, true) : '—'); }
  function reasonsCell(r) {
    var td = el('td', 'cell-reasons', r.categories.length ? r.categories.join(', ') : '—');
    var bits = [];
    if (r.reasons.length) bits.push('Reasons: ' + r.reasons.join(', '));
    if (r.events.length) bits.push('Events: ' + r.events.join(', '));
    if (bits.length) td.title = bits.join(' · ');
    return td;
  }
  function actSub(r) { return [r.id ? '#' + r.id : null, r.location].filter(Boolean).join(' · '); }

  /* ---------- high-risk activity type icons: matched on the type's words, a warning sign otherwise ---------- */
  var RISK_ICONS = [
    [/height|hauteur|ladder|scaffold|echafaud|nacelle|mewp/i, '<path d="M5 1.8v12.4M11 1.8v12.4"/><path d="M5 4.6h6M5 7.6h6M5 10.6h6"/>'],
    [/lift|crane|levage|grue|hoist/i, '<path d="M3 14V2.5h9.5"/><path d="M3 5.5 6 2.5"/><path d="M11 2.5v3.5"/><path d="M11 6a2 2 0 1 1-2 2"/>'],
    [/hot|weld|soud|flame|fire|feu|cut/i, '<path d="M8 14.2c-2.6 0-4.2-1.8-4.2-4 0-2.6 2.1-3.8 2.6-6.4 1.5 1 2.1 2.4 2.1 3.6.7-.4 1.3-1.2 1.4-2.1 1.4 1.3 2.3 2.9 2.3 4.9 0 2.2-1.6 4-4.2 4Z"/>'],
    [/electr|energi|elec|live|consign/i, '<path d="M9.2 1.5 3.6 9h4.2l-1 5.5L12.4 7H8.2z"/>'],
    [/excavat|trench|terrass|dig|ground|fouille/i, '<path d="M10.2 2.2 13.8 5.8"/><path d="M12 4 7.2 8.8"/><path d="M7.8 8.2 4.4 11.6a2.4 2.4 0 0 1-3-.1 2.4 2.4 0 0 1-.1-3L4.7 5z"/>'],
    [/chemic|hazard|substance|coshh|toxic|produit/i, '<path d="M6 1.8h4"/><path d="M6.6 1.8v4.1L2.9 12.3A1.2 1.2 0 0 0 4 14.2h8a1.2 1.2 0 0 0 1.1-1.9L9.4 5.9V1.8"/><path d="M4.6 10h6.8"/>'],
    [/material|handling|manutention|load|charge/i, '<path d="M2.2 5 8 2.2 13.8 5v6.2L8 14 2.2 11.2z"/><path d="M2.2 5 8 7.8 13.8 5"/><path d="M8 7.8V14"/>'],
    [/vehicle|plant|traffic|engin|machine|movement/i, '<path d="M1.5 3.8h8.2v6.8H1.5z"/><path d="M9.7 6.2h2.8l2 2.3v2.1H9.7"/><circle cx="4.4" cy="11.8" r="1.4"/><circle cx="11.6" cy="11.8" r="1.4"/>'],
    [/noise|bruit|sound|vibrat/i, '<path d="M2.2 6h2.6L8.4 3v10L4.8 10H2.2z"/><path d="M10.8 5.6a3.4 3.4 0 0 1 0 4.8"/><path d="M12.7 3.8a6 6 0 0 1 0 8.4"/>'],
    [/confined|confin|tank|manhole|cuve/i, '<ellipse cx="8" cy="5" rx="5.6" ry="2.2"/><path d="M2.4 5v6c0 1.2 2.5 2.2 5.6 2.2s5.6-1 5.6-2.2V5"/>'],
    [/demoli|break|hammer/i, '<path d="M9.2 2.4 13.6 6.8"/><path d="M7.6 4 12 8.4l-1.6 1.6L6 5.6z"/><path d="M8.3 7.7 2.6 13.4"/>'],
    [/not recorded|unspecified/i, '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4"/><path d="M8 11.4v.1"/>']
  ];
  var RISK_DEFAULT_ICON = '<path d="M8 1.8 14.6 13.5H1.4Z"/><path d="M8 6.2v3.3"/><path d="M8 11.6v.1"/>';
  function riskIcon(type, small) {
    var body = RISK_DEFAULT_ICON;
    for (var i = 0; i < RISK_ICONS.length; i++) if (RISK_ICONS[i][0].test(type || '')) { body = RISK_ICONS[i][1]; break; }
    var s = el('span', 'risk-ic' + (small ? ' sm' : ''));
    s.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
    s.title = type;
    return s;
  }
  function riskTypesCell(types) {
    var td = el('td'), w = el('div', 'risk-cell');
    (types || []).forEach(function (x) { w.appendChild(riskIcon(x, true)); });
    w.appendChild(el('span', 'cell-note', (types || []).join(', ')));
    td.appendChild(w); return td;
  }
  var COLS = {
    commits: [
      { h: 'Activity', cell: function (r) { return nameCell(r.name, actSub(r)); } },
      { h: 'Trade', cell: function (r) { return textCell(r.trade); } },
      { h: 'Organisation', cell: function (r) { return textCell(r.organisation); } },
      { h: 'Committed week', num: true, cell: function (r) { return el('td', 'num', r.committedWeek ? weekLabel(r.committedWeek) + ' · ' + C.fmtDate(r.committedEnd, true) : '—'); } },
      { h: 'Result', cell: function (r) { var td = el('td'); if (r.kept === null) td.textContent = '—'; else td.appendChild(pill(r.kept ? 'Successful' : 'Unsuccessful', r.kept ? 'good' : 'bad')); return td; } },
      { h: 'Planned end', num: true, cell: function (r) { return dateCell(r.plannedEnd); } },
      { h: 'Actual end', num: true, cell: function (r) { return dateCell(r.actualEnd); } },
      { h: 'Status', cell: function (r) { return statusCell(r.status); } },
      { h: 'Reasons', cell: reasonsCell }
    ],
    tasks: [
      { h: 'Activity', cell: function (r) { return nameCell(r.name, actSub(r)); } },
      { h: 'Trade', cell: function (r) { return textCell(r.trade); } },
      { h: 'Organisation', cell: function (r) { return textCell(r.organisation); } },
      { h: 'Planned start', num: true, cell: function (r) { return dateCell(r.plannedStart); } },
      { h: 'Planned end', num: true, cell: function (r) { return dateCell(r.plannedEnd); } },
      { h: 'Actual end', num: true, cell: function (r) { return dateCell(r.actualEnd); } },
      { h: 'Delay', num: true, cell: function (r) {
          var td = el('td', 'num');
          if (r.delayDays === null || r.delayDays === undefined) td.textContent = '—';
          else { var a = el('span', 'age-chip ' + ageCls(r.delayDays), C.fmtNum(r.delayDays) + ' d'); a.title = r.delayKind || ''; td.appendChild(a); }
          return td; } },
      { h: 'Status', cell: function (r) { return statusCell(r.status); } },
      { h: 'Reasons', cell: reasonsCell }
    ],
    lookahead: [
      { h: 'Activity', cell: function (r) {
          var td = nameCell(r.name, actSub(r));
          if (r.riskTypes.length) { var w = el('div', 'risk-cell'); r.riskTypes.forEach(function (x) { w.appendChild(riskIcon(x, true)); }); td.appendChild(w); }
          return td; } },
      { h: 'Trade', cell: function (r) { return textCell(r.trade); } },
      { h: 'Organisation', cell: function (r) { return textCell(r.organisation); } },
      { h: 'Planned start', num: true, cell: function (r) { return dateCell(r.plannedStart); } },
      { h: 'Planned end', num: true, cell: function (r) { return dateCell(r.plannedEnd); } },
      { h: 'Status', cell: function (r) { return statusCell(r.status); } },
      { h: 'Constraints', cell: function (r) {
          var td = el('td');
          if (!r.consTotal) { td.textContent = '—'; return td; }
          td.appendChild(el('div', r.consOverdue ? 'tone-text-bad' : r.consOpen ? 'tone-text-warn' : 'tone-text-good',
            r.consOpen ? r.consOpen + ' open of ' + r.consTotal + (r.consOverdue ? ', ' + r.consOverdue + ' overdue' : '') : 'All ' + r.consTotal + ' closed'));
          if (r.consTitles.length) { var d = el('div', 'cell-note', r.consTitles.join(' · ')); d.title = r.consTitles.join('\n'); td.appendChild(d); }
          return td; } }
    ],
    risk: [
      { h: 'Activity', cell: function (r) { return nameCell(r.name, actSub(r)); } },
      { h: 'Risk type', cell: function (r) { return riskTypesCell(r.riskTypes); } },
      { h: 'Trade', cell: function (r) { return textCell(r.trade); } },
      { h: 'Organisation', cell: function (r) { return textCell(r.organisation); } },
      { h: 'Start', num: true, cell: function (r) {
          var td = dateCell(r.effStart);
          if (r.moved) { td.appendChild(el('div', 'cell-note', 'planned ' + C.fmtDate(r.plannedStart, true) + ', in progress')); td.title = 'Started, planned start passed: shown from today'; }
          else if (r.lateStart) { td.appendChild(el('div', 'cell-note tone-text-bad', 'should have started')); }
          return td; } },
      { h: 'Planned end', num: true, cell: function (r) {
          var td = dateCell(r.plannedEnd);
          if (r.overdue) td.appendChild(el('div', 'cell-note tone-text-bad', 'past planned finish'));
          return td; } },
      { h: 'Status', cell: function (r) { return statusCell(r.status); } }
    ],
    constraints: [
      { h: 'Constraint', cell: function (r) { return nameCell(r.title, r.activities.length ? r.activities.join(' · ') : 'not linked to an activity'); } },
      { h: 'Category', cell: function (r) { return textCell(r.category); } },
      { h: 'Owner', cell: function (r) { return textCell(r.owner); } },
      { h: 'Owner organisation', cell: function (r) { return textCell(r.ownerOrganisation); } },
      { h: 'Trade', cell: function (r) { return textCell(r.trade); } },
      { h: 'Status', cell: function (r) { return textCell(r.status); } },
      { h: 'Target', num: true, cell: function (r) { return dateCell(r.target); } },
      { h: 'Completed', num: true, cell: function (r) { return dateCell(r.completion); } },
      { h: 'Overdue / lag', num: true, cell: function (r) {
          var td = el('td', 'num');
          if (r.overdueDays !== null) td.appendChild(el('span', 'age-chip ' + ageCls(r.overdueDays), C.fmtNum(r.overdueDays) + ' d overdue'));
          else if (r.lagDays !== null) td.appendChild(el('span', r.lagDays > 0 ? 'tone-text-bad' : 'tone-text-good', (r.lagDays > 0 ? '+' : '') + C.fmtNum(r.lagDays) + ' d'));
          else td.textContent = '—';
          return td; } }
    ]
  };
  var CSV = {
    activity: [['Activity ID', 'id'], ['Activity', 'name'], ['Type', 'type'], ['Trade', 'trade'], ['Organisation', 'organisation'], ['Location', 'location'],
               ['Status', 'status'], ['Planned start', 'plannedStart'], ['Planned end', 'plannedEnd'], ['Actual start', 'actualStart'], ['Actual end', 'actualEnd'],
               ['Committed week', 'committedWeek'], ['Committed end', 'committedEnd'], ['Result', function (r) { return r.kept === null ? '' : (r.kept ? 'Successful' : 'Unsuccessful'); }],
               ['Planned duration', 'duration'], ['Delay days', 'delayDays'], ['Delay type', 'delayKind'],
               ['Reason categories', function (r) { return r.categories.join('; '); }], ['Reasons', function (r) { return r.reasons.join('; '); }],
               ['Events', function (r) { return r.events.join('; '); }]],
    lookahead: [['Activity ID', 'id'], ['Activity', 'name'], ['Type', 'type'], ['Trade', 'trade'], ['Organisation', 'organisation'], ['Location', 'location'],
                ['Status', 'status'], ['Planned start', 'plannedStart'], ['Planned end', 'plannedEnd'], ['Look-ahead week', function (r) { return weekLabel(r.lookWeek); }],
                ['Linked constraints', 'consTotal'], ['Open constraints', 'consOpen'], ['Overdue constraints', 'consOverdue'], ['Next constraint target', 'nextTarget'],
                ['Open constraint titles', function (r) { return r.consTitles.join('; '); }], ['High-risk types', function (r) { return r.riskTypes.join('; '); }]],
    risk: [['Activity ID', 'id'], ['Activity', 'name'], ['High-risk types', function (r) { return r.riskTypes.join('; '); }], ['Type', 'type'], ['Trade', 'trade'],
           ['Organisation', 'organisation'], ['Location', 'location'], ['Status', 'status'], ['Planned start', 'plannedStart'], ['Start (in progress from today)', 'effStart'],
           ['Planned end', 'plannedEnd'], ['Actual start', 'actualStart'],
           ['Should have started', function (r) { return r.lateStart ? 'Yes' : ''; }], ['Past planned finish', function (r) { return r.overdue ? 'Yes' : ''; }]],
    constraint: [['Constraint ID', 'id'], ['Constraint', 'title'], ['Category', 'category'], ['Priority', 'priority'], ['Owner', 'owner'], ['Owner organisation', 'ownerOrganisation'], ['Trade', 'trade'],
                 ['Location', 'location'], ['Status', 'status'], ['Created', 'created'], ['Target', 'target'], ['Committed', 'commitment'], ['Completed', 'completion'],
                 ['Overdue days', 'overdueDays'], ['Lag days', 'lagDays'], ['Linked activities', function (r) { return r.activities.join('; '); }]]
  };
  function rowText(r) {
    return [r.name, r.id, r.title, r.trade, r.organisation, r.location, r.status, r.category, r.owner, (r.activities || []).join(' '), (r.categories || []).join(' '), (r.riskTypes || []).join(' ')]
      .filter(Boolean).join(' ').toLowerCase();
  }
  function drawerRows() {
    var q = document.getElementById('drawerSearch').value.trim().toLowerCase();
    return q ? DR.rows.filter(function (r) { return rowText(r).indexOf(q) >= 0; }) : DR.rows;
  }
  function renderDrawer() {
    var rows = drawerRows(), noun = DR.kind === 'constraint' ? 'constraint' : 'activity', nouns = DR.kind === 'constraint' ? 'constraints' : 'activities';
    var head = document.getElementById('drawerHead'), body = document.getElementById('drawerBody');
    head.innerHTML = ''; body.innerHTML = '';
    var tr = el('tr');
    DR.cols.forEach(function (c) { tr.appendChild(el('th', c.num ? 'num' : null, c.h)); });
    head.appendChild(tr);
    if (!rows.length) emptyRow(body, DR.cols.length, DR.rows.length ? 'No ' + noun + ' in this list matches "' + document.getElementById('drawerSearch').value + '".' : 'No ' + nouns + ' behind this mark in the current filters.');
    rows.slice(0, DRAWER_LIMIT).forEach(function (r) {
      var row = el('tr');
      DR.cols.forEach(function (c) { row.appendChild(c.cell(r)); });
      body.appendChild(row);
    });
    setText('drawerCount', rows.length === DR.rows.length ? plural(rows.length, noun, nouns) : C.fmtNum(rows.length) + ' of ' + plural(DR.rows.length, noun, nouns));
    var more = document.getElementById('drawerMore');
    more.hidden = rows.length <= DRAWER_LIMIT;
    more.textContent = 'Showing the first ' + DRAWER_LIMIT + '. Download the CSV for all ' + C.fmtNum(rows.length) + '.';
    document.getElementById('drawerCsv').disabled = !rows.length;
  }
  function openList(spec, title, sub, opener) {
    if (!CUR.V) return;
    C.hideTip();
    var rows = A.records(CUR.V, spec, CUR.data);
    var kind = spec.type === 'constraints' ? 'constraint' : 'activity';
    var isRisk = spec.type === 'risk', isLa = spec.type === 'lookahead';
    DR = { rows: rows, kind: kind, title: title, opener: opener || document.activeElement,
           cols: COLS[isLa ? 'lookahead' : isRisk ? 'risk' : spec.type === 'constraints' ? 'constraints' : (spec.type === 'tasks' ? 'tasks' : 'commits')], csv: CSV[isLa ? 'lookahead' : isRisk ? 'risk' : kind] };
    setText('drawerEyebrow', kind === 'constraint' ? 'Constraints' : 'Activities');
    setText('drawerTitle', title);
    setText('drawerSub', sub || '');
    document.getElementById('drawerSearch').value = '';
    renderDrawer();
    document.getElementById('drawerScrim').hidden = false;
    document.getElementById('drawer').hidden = false;
    document.body.classList.add('drawer-open');
    document.getElementById('drawerClose').focus();
  }
  function closeDrawer() {
    var d = document.getElementById('drawer');
    if (!d || d.hidden) return false;
    d.hidden = true;
    document.getElementById('drawerScrim').hidden = true;
    document.body.classList.remove('drawer-open');
    if (DR.opener && document.body.contains(DR.opener)) DR.opener.focus();
    return true;
  }
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadCsv() {
    var rows = drawerRows();
    var lines = [DR.csv.map(function (c) { return csvCell(c[0]); }).join(',')];
    rows.forEach(function (r) { lines.push(DR.csv.map(function (c) { return csvCell(typeof c[1] === 'function' ? c[1](r) : r[c[1]]); }).join(',')); });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (DR.title || 'list').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  (function initDrawer() {
    var d = document.getElementById('drawer');
    if (!d) return;
    document.getElementById('drawerClose').addEventListener('click', closeDrawer);
    document.getElementById('drawerScrim').addEventListener('click', closeDrawer);
    document.getElementById('drawerSearch').addEventListener('input', renderDrawer);
    document.getElementById('drawerCsv').addEventListener('click', downloadCsv);
    document.addEventListener('keydown', function (e) {
      if (d.hidden) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); return; }
      if (e.key !== 'Tab') return;
      /* keep focus inside the panel while it is open */
      var f = Array.prototype.filter.call(d.querySelectorAll('button, input, [tabindex="0"]'), function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }, true);
  })();

  /* ---------- multi-select picker (one per dimension) ---------- */
  var openPop = null;
  function closePop() {
    if (!openPop) return;
    openPop.pop.hidden = true; openPop.btn.setAttribute('aria-expanded', 'false');
    var f = openPop.host.closest('.filters'); if (f) f.classList.remove('has-pop');
    openPop = null;
  }
  document.addEventListener('click', function (e) { if (openPop && !openPop.host.contains(e.target)) closePop(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openPop && document.getElementById('drawer').hidden) { var b = openPop.btn; closePop(); b.focus(); } });

  /* ---------- date range picker: presets, two months, whole ISO weeks ----------
     dateRangePicker(host, {extent:{from,to}, today, from, to, presets:[{key,label,from,to}], onChange(from, to)})
     Clicking a day selects its whole Monday-Sunday week; a second click extends to that week.
     Days outside the extent (all task history, commitments and planned work) are struck through.
     Shares the page's single-popover state (openPop), so Escape and outside clicks close it. */
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  function ymd(y, m, d) { return y + '-' + (m < 9 ? '0' : '') + (m + 1) + '-' + (d < 10 ? '0' : '') + d; }
  function monthOf(iso) { return { y: +iso.slice(0, 4), m: +iso.slice(5, 7) - 1 }; }
  function shiftMonth(v, k) { var t = v.y * 12 + v.m + k; return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; }
  function monthKey(v) { return v.y * 12 + v.m; }
  function datePresets(FX, ext) {
    var t = FX.today, mon = A.mondayOf(t), tm = monthOf(t);
    function monthSpan(v) {
      var first = ymd(v.y, v.m, 1), nx = shiftMonth(v, 1), last = A.addDays(ymd(nx.y, nx.m, 1), -1);
      return [A.mondayOf(first), A.addDays(A.mondayOf(last), 6)];
    }
    var thisM = monthSpan(tm), lastM = monthSpan(shiftMonth(tm, -1));
    return [
      { key: 'tw', label: 'This week', from: mon, to: A.addDays(mon, 6) },
      { key: 'lw', label: 'Last week', from: A.addDays(mon, -7), to: A.addDays(mon, -1) },
      { key: 'l4', label: 'Last 4 weeks', from: A.addDays(mon, -28), to: A.addDays(mon, -1) },
      { key: 'l6', label: 'Last 6 weeks', from: FX.window.from, to: FX.window.to },
      { key: 'l12', label: 'Last 12 weeks', from: FX.trend.from, to: FX.trend.to },
      { key: 'tm', label: 'This month', from: thisM[0], to: thisM[1] },
      { key: 'lm', label: 'Last month', from: lastM[0], to: lastM[1] },
      { key: 'all', label: 'All data', from: ext.from, to: ext.to }
    ];
  }
  function dateRangePicker(host, cfg) {
    host.innerHTML = '';
    var ext = cfg.extent, cur = { from: cfg.from, to: cfg.to }, pend = { a: null, b: null }, hover = null, view = null, focusD = null;
    var btn = el('button', 'dr-btn'); btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg class="dr-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4"/></svg>';
    var btxt = el('span', 'dr-btn-txt'); btn.appendChild(btxt); btn.appendChild(el('span', 'ms-caret'));
    var pop = el('div', 'dr-pop'); pop.hidden = true;
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose a date range');
    var side = el('div', 'dr-presets'), main = el('div', 'dr-main');
    var bar = el('div', 'dr-bar');
    var latest = el('button', 'btn dr-soft', 'Go to latest'); latest.type = 'button';
    var fromChip = el('span', 'dr-chip'), toChip = el('span', 'dr-chip'), span = el('span', 'dr-span');
    var clear = el('button', 'btn', 'Clear'); clear.type = 'button';
    var applyB = el('button', 'btn dr-apply', 'Apply'); applyB.type = 'button';
    [latest, fromChip, toChip, span, el('span', 'spacer'), clear, applyB].forEach(function (n) { bar.appendChild(n); });
    var months = el('div', 'dr-months');
    var weeks = Math.round((Date.parse(ext.to) - Date.parse(ext.from)) / 864e5 + 1) / 7;
    var note = el('div', 'dr-note');
    note.appendChild(document.createTextNode('Selections snap to whole ISO weeks (Monday–Sunday), because the measures in this report are counted per week. Selectable span covers all task history, commitments and planned work: '));
    note.appendChild(el('b', null, C.fmtDate(ext.from) + ' to ' + C.fmtDate(ext.to)));
    note.appendChild(document.createTextNode(' (' + C.fmtNum(Math.round(weeks)) + ' weeks).'));
    main.appendChild(bar); main.appendChild(months); main.appendChild(note);
    pop.appendChild(side); pop.appendChild(main);
    host.appendChild(btn); host.appendChild(pop);
    pop.addEventListener('click', function (e) { e.stopPropagation(); });

    var presetBtns = cfg.presets.map(function (p) {
      var b = el('button', 'dr-preset', p.label); b.type = 'button';
      b.addEventListener('click', function () { cur = { from: p.from, to: p.to }; label(); closePop(); btn.focus({ preventScroll: true }); cfg.onChange(p.from, p.to); });
      side.appendChild(b);
      return b;
    });
    function matchPreset(a, b) { for (var i = 0; i < cfg.presets.length; i++) if (cfg.presets[i].from === a && cfg.presets[i].to === b) return cfg.presets[i]; return null; }
    function label() {
      var p = matchPreset(cur.from, cur.to);
      btxt.innerHTML = '';
      if (p) btxt.appendChild(el('span', 'dr-btn-p', p.label));
      btxt.appendChild(document.createTextNode(fmtRange(cur.from, cur.to)));
      presetBtns.forEach(function (b, i) { b.setAttribute('aria-pressed', cfg.presets[i] === p ? 'true' : 'false'); });
    }
    function chip(node, cap, v) {
      node.innerHTML = '';
      node.appendChild(el('b', null, cap));
      node.appendChild(el('span', v ? null : 'dr-empty', v ? C.fmtDate(v, true) : '—'));
    }
    function bounds() {
      if (!pend.a) return null;
      if (pend.b) return [pend.a, pend.b];
      if (hover) { var h = A.mondayOf(hover); return h < pend.a ? [h, A.addDays(pend.a, 6)] : [pend.a, A.addDays(h, 6)]; }
      return [pend.a, A.addDays(pend.a, 6)];
    }
    function updateBar() {
      var bb = bounds();
      chip(fromChip, 'From', bb ? bb[0] : null);
      chip(toChip, 'To', bb ? bb[1] : null);
      span.textContent = bb ? plural(Math.round((Date.parse(bb[1]) - Date.parse(bb[0])) / 864e5 + 1) / 7, 'week') : '';
      applyB.disabled = !pend.a;
    }
    function paint() {
      var bb = bounds();
      months.querySelectorAll('.dr-day').forEach(function (c) {
        var d = c.getAttribute('data-date');
        var inR = bb && d >= bb[0] && d <= bb[1];
        c.classList.toggle('in', !!inR);
        c.classList.toggle('rs', !!bb && d === bb[0]);
        c.classList.toggle('re', !!bb && d === bb[1]);
        c.tabIndex = d === focusD ? 0 : -1;
      });
    }
    function build() {
      months.innerHTML = '';
      var minV = monthOf(ext.from), maxV = monthOf(ext.to);
      [view, shiftMonth(view, 1)].forEach(function (v, k) {
        var box = el('div', 'dr-month'), head = el('div', 'dr-mhead');
        function nav(dir, cls) {
          var b = el('button', 'dr-nav ' + cls, dir < 0 ? '‹' : '›'); b.type = 'button';
          b.setAttribute('aria-label', dir < 0 ? 'Previous month' : 'Next month');
          var target = shiftMonth(view, dir);
          b.disabled = dir < 0 ? monthKey(view) <= monthKey(minV) : monthKey(shiftMonth(target, k === 0 ? 0 : 1)) > monthKey(maxV) && monthKey(target) > monthKey(maxV);
          b.addEventListener('click', function () { view = target; build(); });
          head.appendChild(b);
        }
        if (k === 0) nav(-1, 'dr-prev');
        head.appendChild(el('span', 'dr-mtitle', MONTH_NAMES[v.m] + ' ' + v.y));
        if (k === 1) nav(1, 'dr-next');
        if (k === 0) nav(1, 'dr-next dr-mobile-only');
        box.appendChild(head);
        var grid = el('div', 'dr-grid'); grid.setAttribute('role', 'grid');
        DOW.forEach(function (d) { grid.appendChild(el('span', 'dr-dow', d)); });
        var start = A.mondayOf(ymd(v.y, v.m, 1));
        for (var i = 0; i < 42; i++) {
          var d = A.addDays(start, i), inMonth = +d.slice(5, 7) - 1 === v.m, off = d < ext.from || d > ext.to;
          var c = el('button', 'dr-day' + (inMonth ? '' : ' out') + (off ? ' off' : '') + (d === cfg.today ? ' today' : ''));
          c.type = 'button';
          c.setAttribute('data-date', d);
          if (off) c.setAttribute('aria-disabled', 'true');
          c.setAttribute('aria-label', C.fmtDate(d) + (off ? ', outside the data' : ''));
          c.appendChild(el('span', 'dr-n', String(+d.slice(8))));
          grid.appendChild(c);
        }
        box.appendChild(grid);
        months.appendChild(box);
      });
      paint();
    }
    function pick(d) {
      if (d < ext.from || d > ext.to) return;
      var w = A.mondayOf(d);
      if (!pend.a || pend.b) { pend.a = w; pend.b = null; }
      else if (w < pend.a) { pend.b = A.addDays(pend.a, 6); pend.a = w; }
      else pend.b = A.addDays(w, 6);
      if (pend.a < ext.from) pend.a = ext.from;
      if (pend.b && pend.b > ext.to) pend.b = ext.to;
      hover = null; focusD = d;
      updateBar(); paint();
    }
    function show(d) {
      var v = monthOf(d);
      if (monthKey(v) < monthKey(view) || monthKey(v) > monthKey(view) + 1) { view = monthKey(v) < monthKey(view) ? v : shiftMonth(v, -1); build(); }
    }
    months.addEventListener('click', function (e) { var c = e.target.closest('.dr-day'); if (c) pick(c.getAttribute('data-date')); });
    months.addEventListener('mouseover', function (e) {
      var c = e.target.closest('.dr-day');
      var d = c && !c.classList.contains('off') ? c.getAttribute('data-date') : null;
      if (pend.a && !pend.b && d !== hover) { hover = d; updateBar(); paint(); }
    });
    months.addEventListener('mouseleave', function () { if (hover) { hover = null; updateBar(); paint(); } });
    months.addEventListener('keydown', function (e) {
      var c = e.target.closest('.dr-day'); if (!c) return;
      var d = c.getAttribute('data-date'), step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key], next = null;
      if (step) next = A.addDays(d, step);
      else if (e.key === 'Home') next = A.mondayOf(d);
      else if (e.key === 'End') next = A.addDays(A.mondayOf(d), 6);
      else if (e.key === 'PageUp' || e.key === 'PageDown') next = A.addDays(d, e.key === 'PageUp' ? -28 : 28);
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(d); return; }
      if (!next) return;
      e.preventDefault();
      focusD = next; show(next); paint();
      var n = months.querySelector('.dr-day[data-date="' + next + '"]'); if (n) n.focus();
    });
    latest.addEventListener('click', function () {
      var t = cfg.today < ext.to ? cfg.today : ext.to;
      view = monthOf(t); focusD = t; build();
    });
    clear.addEventListener('click', function () { pend = { a: null, b: null }; hover = null; updateBar(); paint(); });
    applyB.addEventListener('click', function () {
      if (!pend.a) return;
      var a = pend.a, b = pend.b || A.addDays(pend.a, 6);
      cur = { from: a, to: b }; label(); closePop(); btn.focus({ preventScroll: true }); cfg.onChange(a, b);
    });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (openPop && openPop.btn === btn) { closePop(); return; }
      closePop();
      pend = { a: cur.from ? A.mondayOf(cur.from) : null, b: cur.to || null }; hover = null;
      var endV = monthOf(cur.to || cfg.today), minV = monthOf(ext.from);
      view = shiftMonth(endV, -1);
      if (monthKey(view) < monthKey(minV)) view = minV;
      focusD = cur.to || cfg.today;
      build(); updateBar();
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
      openPop = { host: host, btn: btn, pop: pop };
      var fc = host.closest('.filters'); if (fc) fc.classList.add('has-pop');
      var f = months.querySelector('.dr-day[tabindex="0"]') || applyB; f.focus({ preventScroll: true });
    });
    label();
    return { set: function (a, b) { cur = { from: a, to: b }; label(); } };
  }

  /* ---------- PPC review export ----------
     Builds a standalone, printable HTML report from Agg.review for the current filters and opens
     it in a new tab: print / save as PDF, download the HTML, download the activity list as CSV.
     Charts are drawn with the same renderer, off screen, and inlined as SVG. */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function offscreenChart(spec, width) {
    var host = el('div');
    host.style.cssText = 'position:absolute;left:-20000px;top:0;width:' + width + 'px';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'chart');
    svg.style.width = width + 'px';
    host.appendChild(svg);
    document.body.appendChild(host);
    C.comboChart(svg, spec);
    svg.setAttribute('role', 'img');
    var out = svg.outerHTML;
    host.remove();
    return out;
  }
  function pillHtml(text, tone) {
    return '<span class="pill tone-' + esc(tone || 'inert') + '"><span class="pill-ic">' + esc(toneIcon(tone)) + '</span><span>' + esc(text) + '</span></span>';
  }
  function tileHtml(value, label, tone, sub) {
    return '<div class="kpi"><div class="kpi-value' + (tone && tone !== 'inert' ? ' tone-text-' + tone : '') + '">' + esc(value) + '</div>'
      + '<div class="kpi-label">' + esc(label) + '</div>' + (tone ? pillHtml(TONE_WORD[tone], tone) : '') + (sub ? '<div class="kpi-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }
  function reviewCsv(R) {
    var head = ['Trade', 'Committed week', 'Week start', 'Week end', 'Result', 'Activity ID', 'Activity', 'Organisation', 'Location', 'Type', 'Status',
                'Committed end', 'Planned start', 'Planned end', 'Actual end', 'Reason categories', 'Reasons'];
    var spans = {};
    R.weeks.forEach(function (w) { spans[w.week] = w; });
    var lines = [head.map(csvCell).join(',')];
    R.activities.forEach(function (r) {
      var w = spans[r.committedWeek] || {};
      lines.push([r.trade || R.unassigned, r.committedWeek, w.start, w.end, r.kept ? 'Successful' : 'Unsuccessful', r.id, r.name, r.organisation, r.location, r.type, r.status,
                  r.committedEnd, r.plannedStart, r.plannedEnd, r.actualEnd, r.categories.join('; '), r.reasons.join('; ')].map(csvCell).join(','));
    });
    return '﻿' + lines.join('\r\n');
  }
  function buildReview(R, ctx) {
    var V = R.V, data = ctx.data, P = ctx.project, S = ctx.S, N = R.rollingWeeks;
    var tolP = (data.tolerance && data.tolerance.ppc) || {}, good = (tolP.good || [0, 80])[1], watch = (tolP.watch || [0, 65])[1];
    function band(v) { return v === null || v === undefined ? 'inert' : (v >= good ? 'good' : (v >= watch ? 'warn' : 'bad')); }
    var rangeText = fmtRange(V.range.from, V.range.to);
    var weekSpan = R.weeks.length ? weekLabel(R.weeks[0].week) + '–' + weekLabel(R.weeks[R.weeks.length - 1].week) : '—';
    function dims(key, noun) { return S[key] ? Object.keys(S[key]).sort().join(', ') : 'All ' + noun + 's'; }
    var LW = V.tradePerformance, lw = LW && LW.week ? LW.overall : null;
    var title = 'PPC review · ' + (P.title || P.key) + ' · ' + rangeText;
    var h = [];
    function section(num, name, desc, cls) {
      return '<section class="rp-sec' + (cls ? ' ' + cls : '') + '"><div class="rp-sec-head"><span class="rp-num">' + num + '</span><div><h2>' + esc(name) + '</h2>'
        + (desc ? '<p>' + esc(desc) + '</p>' : '') + '</div></div>';
    }
    h.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">');
    h.push('<meta name="robots" content="noindex, nofollow"><title>' + esc(title) + '</title><style>' + ctx.css + REVIEW_CSS + '</' + 'style></head><body class="report">');
    h.push('<div class="rp-toolbar no-print"><span class="rp-tb-title">PPC review</span><span class="hint">' + esc(rangeText) + '</span><span class="sp"></span>'
      + '<button class="btn" type="button" id="rpCsv">Download activity list (CSV)</button>'
      + '<button class="btn" type="button" id="rpHtml">Download HTML</button>'
      + '<button class="btn dr-apply" type="button" id="rpPrint">Print / Save as PDF</button></div>');
    h.push('<main class="rp">');

    /* ---- cover ---- */
    h.push('<header class="rp-cover"><div class="rp-cover-main"><div class="eyebrow">PPC review · ' + esc(ctx.eyebrow) + (P.client ? ' · ' + esc(P.client) : '') + '</div>'
      + '<h1>' + esc(P.title || P.key) + '</h1>'
      + '<div class="rp-chips"><span class="rp-chip"><b>Period</b>' + esc(rangeText) + '</span><span class="rp-chip"><b>Weeks</b>' + esc(weekSpan + ' · ' + R.weeks.length) + '</span></div></div>'
      + '<dl class="rp-facts"><div><dt>Organisations</dt><dd>' + esc(dims('org', 'organisation')) + '</dd></div><div><dt>Trades</dt><dd>' + esc(dims('trade', 'trade')) + '</dd></div>'
      + '<div><dt>Locations</dt><dd>' + esc(dims('loc', 'location')) + '</dd></div><div><dt>Data as of</dt><dd>' + esc(fmtDateTime(ctx.meta.dataAsOf || ctx.meta.generatedAt)) + '</dd></div>'
      + '<div><dt>Generated</dt><dd>' + esc(fmtDateTime(new Date().toISOString())) + (ctx.meta.origin === 'sample' ? ' · <span class="rp-sample">sample data</span>' : '') + '</dd></div></dl></header>');
    if (!R.totals) {
      h.push('<div class="card"><p class="empty">No commitments end in the selected range' + (S.org || S.trade || S.loc ? ' for the selected filters' : '') + ', so there is no PPC to review.</p></div></main></body></html>');
      return { html: h.join(''), csv: reviewCsv(R), title: title };
    }

    /* counts with repeats: one row per activity per committed week, as in the activity list */
    var kept = R.activities.filter(function (r) { return r.kept; }).length, missed = R.activities.length - kept, total = R.activities.length;
    var perTrade = {};
    R.activities.forEach(function (r) { var k = r.trade || R.unassigned, p = perTrade[k] = perTrade[k] || { kept: 0, missed: 0 }; if (r.kept) p.kept++; else p.missed++; });
    var firstRoll = null, lastRoll = R.latestRolling;
    R.weeks.forEach(function (w) { if (firstRoll === null && w.rolling !== null) firstRoll = w.rolling; });

    /* ---- 1 · summary ---- */
    h.push(section(1, 'Summary', weekSpan + ' · counts include an activity once for every week it was committed'));
    h.push('<div class="rp-kpis">'
      + tileHtml(C.fmtPct(lw ? lw.pct : null), 'Last week PPC', lw ? V.tones.lastWeek : 'inert', lw ? weekLabel(LW.week) + ' · ' + C.fmtNum(lw.successful) + ' of ' + C.fmtNum(lw.total) + ' successful' : 'No complete week in the range')
      + tileHtml(C.fmtPct(lastRoll), N + '-week rolling PPC', R.latestTone, 'As of ' + weekLabel(R.weeks[R.weeks.length - 1].week)
          + (firstRoll !== null && lastRoll !== null && R.weeks.length > 1 ? ' · ' + (lastRoll - firstRoll >= 0 ? '▲ ' : '▼ ') + fmtPts(lastRoll - firstRoll) + ' since ' + weekLabel(R.weeks[0].week) : ''))
      + tileHtml(C.fmtNum(total), 'Total tasks', null, 'Committed in ' + weekSpan + ', repeats included')
      + tileHtml(C.fmtNum(kept), 'Successful tasks', null, 'Finished in the committed week · ' + C.fmtPct(total ? 100 * kept / total : null))
      + tileHtml(C.fmtNum(missed), 'Unsuccessful tasks', null, 'Not finished in the committed week · ' + C.fmtPct(total ? 100 * missed / total : null))
      + '</div>');
    var tCrit = R.trades.filter(function (t) { return t.tone === 'bad'; }), tWatch = R.trades.filter(function (t) { return t.tone === 'warn'; }), tGood = R.trades.filter(function (t) { return t.tone === 'good'; });
    var worst = R.trades.filter(function (t) { return t.latestRolling !== null && (perTrade[t.trade] || {}).kept + (perTrade[t.trade] || {}).missed >= 3; }).slice(0, 3);
    var mostMissed = Object.keys(perTrade).sort(function (a, b) { return perTrade[b].missed - perTrade[a].missed || a.localeCompare(b); }).slice(0, 3).filter(function (k) { return perTrade[k].missed; });
    h.push('<div class="rp-highlights"><h3>Highlights</h3><ul>'
      + (firstRoll !== null && lastRoll !== null && R.weeks.length > 1 ? '<li>The ' + N + '-week rolling PPC moved from <b>' + esc(C.fmtPct(firstRoll)) + '</b> in ' + esc(weekLabel(R.weeks[0].week)) + ' to <b>'
          + esc(C.fmtPct(lastRoll)) + '</b> in ' + esc(weekLabel(R.weeks[R.weeks.length - 1].week)) + ', against a target of ' + esc(C.fmtPct(data.ppc.targetPct)) + '.</li>' : '')
      + '<li><b>' + esc(C.fmtNum(kept)) + '</b> of ' + esc(C.fmtNum(total)) + ' committed tasks were finished in their committed week; <b>' + esc(C.fmtNum(missed)) + '</b> were not.</li>'
      + '<li>Trades by latest rolling PPC: ' + esc(C.fmtNum(tGood.length)) + ' good, ' + esc(C.fmtNum(tWatch.length)) + ' on watch and <b>' + esc(C.fmtNum(tCrit.length)) + ' critical</b> (under ' + esc(C.fmtPct(watch)) + ').</li>'
      + (worst.length ? '<li>Lowest rolling PPC (3 or more tasks): ' + worst.map(function (t) { return '<b>' + esc(t.trade) + '</b> ' + esc(C.fmtPct(t.latestRolling)); }).join(', ') + '.</li>' : '')
      + (mostMissed.length ? '<li>Most unsuccessful tasks: ' + mostMissed.map(function (k) { return '<b>' + esc(k) + '</b> ' + esc(C.fmtNum(perTrade[k].missed)); }).join(', ') + '.</li>' : '')
      + '</ul></div></section>');

    /* ---- 2 · overall trend ---- */
    var svg = offscreenChart({
      labels: R.weeks.map(function (w) { return weekLabel(w.week); }), band: R.weeks.map(function (w) { return w.inWindow; }),
      axisTitles: ['Tasks', 'Rolling PPC'], showLabels: true, target: data.ppc.targetPct, height: 270,
      columns: [{ name: 'Successful', cls: 'kept', values: R.weeks.map(function (w) { return w.successful; }) },
                { name: 'Unsuccessful', cls: 'missed', values: R.weeks.map(function (w) { return w.unsuccessful; }) }],
      lines: [{ name: N + '-week rolling PPC', cls: 'ppc', values: R.weeks.map(function (w) { return w.rolling; }) }]
    }, 1120);
    h.push(section(2, 'Overall PPC trend', 'Successful and unsuccessful tasks per committed week, with the ' + N + '-week rolling average PPC'));
    h.push('<div class="card rp-card">' + svg + '<div class="legend"><span><span class="key sq kept"></span>Successful</span><span><span class="key sq missed"></span>Unsuccessful</span>'
      + '<span><span class="key"></span>' + N + '-week rolling PPC</span><span><span class="key target"></span>Target ' + esc(C.fmtPct(data.ppc.targetPct)) + '</span><span><span class="key band"></span>Last six weeks</span></div></div></section>');

    /* ---- 3 · trades ---- */
    h.push(section(3, 'Rolling PPC by trade', plural(R.trades.length, 'trade') + ', lowest latest rolling PPC first · ' + C.fmtNum(tCrit.length) + ' critical, ' + C.fmtNum(tWatch.length) + ' watch, ' + C.fmtNum(tGood.length) + ' good'));
    h.push('<div class="card rp-card rp-heat"><div class="legend rp-bands"><span><span class="key sq h-good"></span>Good, ' + esc(C.fmtPct(good)) + '+</span><span><span class="key sq h-warn"></span>Watch, '
      + esc(C.fmtPct(watch)) + '–' + esc(C.fmtPct(good)) + '</span><span><span class="key sq h-bad"></span>Critical, under ' + esc(C.fmtPct(watch)) + '</span><span>— no commitments in the window</span></div>'
      + '<div class="table-wrap"><table class="heat"><thead><tr><th class="tl">Trade</th>' + R.weeks.map(function (w) { return '<th>' + esc(weekLabel(w.week)) + '</th>'; }).join('')
      + '<th class="num sep">Total</th><th class="num">Successful</th><th class="num">Unsuccessful</th><th class="num">Latest rolling</th></tr></thead><tbody>');
    R.trades.forEach(function (t) {
      var c = perTrade[t.trade] || { kept: 0, missed: 0 };
      h.push('<tr><td class="tr" title="' + esc(t.trade) + '">' + esc(t.trade) + '</td>' + t.weeks.map(function (w) {
        var tip = weekLabel(w.week) + ': rolling ' + C.fmtPct(w.rolling) + (w.total ? ' · this week ' + w.successful + ' of ' + w.total + ' successful' : ' · nothing committed this week');
        return '<td class="' + (w.rolling === null ? 'h-none' : 'h-' + w.tone) + '" title="' + esc(tip) + '">' + esc(w.rolling === null ? '—' : Math.round(w.rolling) + '%') + '</td>';
      }).join('') + '<td class="num sep">' + esc(C.fmtNum(c.kept + c.missed)) + '</td><td class="num">' + esc(C.fmtNum(c.kept)) + '</td><td class="num">' + esc(C.fmtNum(c.missed))
        + '</td><td class="num">' + pillHtml(C.fmtPct(t.latestRolling), t.latestRolling === null ? 'inert' : band(t.latestRolling)) + '</td></tr>');
    });
    h.push('</tbody></table></div></div></section>');

    /* ---- 4 · activities ---- */
    h.push(section(4, 'Activities by trade and week', plural(total, 'task') + ' in ' + weekSpan + ' · trades in the same order as section 3 · an activity committed in several weeks is listed once per week'));
    var byTrade = {};
    R.activities.forEach(function (r) { var k = r.trade || R.unassigned; (byTrade[k] = byTrade[k] || []).push(r); });
    R.trades.forEach(function (t) {
      var rows = byTrade[t.trade] || [];
      if (!rows.length) return;
      var c = perTrade[t.trade];
      h.push('<div class="rp-trade"><table class="rp-acts"><thead><tr class="rp-trade-row"><th colspan="9"><div class="rp-trade-head"><h3>' + esc(t.trade) + '</h3><span class="rp-trade-stats">'
        + '<span><b>' + esc(C.fmtNum(c.kept + c.missed)) + '</b> tasks</span><span class="tone-text-good"><b>' + esc(C.fmtNum(c.kept)) + '</b> successful</span>'
        + '<span class="tone-text-bad"><b>' + esc(C.fmtNum(c.missed)) + '</b> unsuccessful</span></span>'
        + pillHtml('Rolling ' + C.fmtPct(t.latestRolling), t.latestRolling === null ? 'inert' : band(t.latestRolling)) + '</div></th></tr>'
        + '<tr class="rp-cols"><th>Activity</th><th>Organisation</th><th>Location</th><th class="num">Committed end</th><th class="num">Planned end</th><th class="num">Actual end</th><th>Result</th><th>Status</th><th>Reasons</th></tr></thead><tbody>');
      var cur = null;
      rows.forEach(function (r) {
        if (r.committedWeek !== cur) {
          cur = r.committedWeek;
          var ws = R.weeks.filter(function (w) { return w.week === cur; })[0] || {};
          var wk = rows.filter(function (x) { return x.committedWeek === cur; }), wkKept = wk.filter(function (x) { return x.kept; }).length;
          h.push('<tr class="wk"><td colspan="9"><span>' + esc(weekLabel(cur)) + '</span>' + esc(' · ' + fmtRange(ws.start, ws.end)) + '<span class="wk-n">' + esc(wkKept + ' of ' + wk.length + ' successful') + '</span></td></tr>');
        }
        h.push('<tr><td class="cell-name"><div>' + esc(r.name) + '</div>' + (r.id ? '<div class="cell-sub">#' + esc(r.id) + '</div>' : '') + '</td><td>' + esc(dash(r.organisation)) + '</td><td>' + esc(dash(r.location))
          + '</td><td class="num">' + esc(C.fmtDate(r.committedEnd, true)) + '</td><td class="num">' + esc(C.fmtDate(r.plannedEnd, true)) + '</td><td class="num">' + esc(r.actualEnd ? C.fmtDate(r.actualEnd, true) : '—')
          + '</td><td>' + pillHtml(r.kept ? 'Successful' : 'Unsuccessful', r.kept ? 'good' : 'bad') + '</td><td>' + esc(dash(r.status)) + '</td><td class="cell-sub">' + esc(r.categories.length ? r.categories.join(', ') : '—') + '</td></tr>');
      });
      h.push('</tbody></table></div>');
    });
    h.push('</section>');

    /* ---- notes ---- */
    h.push('<footer class="rp-foot"><h3>How the numbers are counted</h3>'
      + '<p><b>Total, successful and unsuccessful tasks</b> count an activity once for every week it was committed, so successful + unsuccessful = total, and they match the activity list in section 4.</p>'
      + '<p><b>PPC</b> (last week and rolling) is the share of committed activities finished in the ISO week they were committed for, counted once per activity per week, as in the Power BI model.</p>'
      + '<p><b>' + N + '-week rolling PPC</b> is the mean of the weekly PPC over the ' + N + ' weeks ending that week, looking back before the period start where needed but never before the first week of the commitment feed. Overall, a week with no commitments counts as 0, as the "PPC Avg (6wk Running)" measure does; per trade, only weeks in which the trade had commitments count.</p>'
      + '<p><b>Bands</b>: good ' + esc(C.fmtPct(good)) + '+, watch ' + esc(C.fmtPct(watch)) + '–' + esc(C.fmtPct(good)) + ', critical below ' + esc(C.fmtPct(watch)) + '. Source: VisiLean · ' + esc(P.title || P.key) + ' · build ' + esc(ctx.meta.buildId || '') + '.</p></footer>');
    var foot = (P.title || P.key) + ' · PPC review · ' + rangeText;
    h.push('<style>@media print { @page { @bottom-left { content: "' + foot.split('"').join('').split(String.fromCharCode(92)).join('') + '"; font: 8pt sans-serif; color: rgb(126, 140, 150); }'
      + ' @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt sans-serif; color: rgb(126, 140, 150); } } }</' + 'style>');
    h.push('</main>');
    h.push('<script type="text/csv" id="rpCsvData">' + reviewCsv(R).replace(/<\//g, '<\\/') + '</' + 'script>');
    h.push('<script>(function(){var name=' + JSON.stringify(slug('ppc-review-' + (P.title || P.key) + '-' + V.range.from + '-to-' + V.range.to)) + ';'
      + 'function dl(text,type,ext){var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type:type}));a.download=name+ext;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},0);}'
      + 'document.getElementById("rpPrint").onclick=function(){window.print();};'
      + 'document.getElementById("rpCsv").onclick=function(){dl(document.getElementById("rpCsvData").textContent.replace(/<\\\\\\//g,"</"),"text/csv;charset=utf-8",".csv");};'
      + 'document.getElementById("rpHtml").onclick=function(){dl("<!doctype html>\\n"+document.documentElement.outerHTML,"text/html;charset=utf-8",".html");};'
      + '})();</' + 'script>');
    h.push('</body></html>');
    return { html: h.join(''), csv: reviewCsv(R), title: title };
  }
  var REVIEW_CSS = [
    '.report { background: var(--bg); }',
    '.rp-toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 10px 28px; background: var(--card); border-bottom: 1px solid var(--line); font-size: 14.5px; }',
    '.rp-toolbar .sp { flex: 1; } .rp-toolbar .hint { color: var(--muted); font-size: 13px; } .rp-tb-title { font-weight: 600; }',
    '.rp { max-width: 1240px; margin: 0 auto; padding: 24px 28px 48px; }',
    /* cover */
    '.rp-cover { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 20px 32px; align-items: end; background: var(--card); border: 1px solid var(--line-soft); border-top: 4px solid var(--brand); border-radius: var(--r-xl); padding: 20px 24px; box-shadow: var(--shadow); }',
    '@media (max-width: 860px) { .rp-cover { grid-template-columns: minmax(0, 1fr); } }',
    '.rp-cover h1 { font-size: 26px; letter-spacing: -.025em; margin: 6px 0 10px; }',
    '.rp-chips { display: flex; gap: 8px; flex-wrap: wrap; } .rp-chip { display: inline-flex; gap: 8px; align-items: baseline; background: var(--inset); border-radius: 999px; padding: 5px 12px; font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; }',
    '.rp-chip b { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }',
    '.rp-facts { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; }',
    '.rp-facts div { min-width: 0; } .rp-facts dt { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); } .rp-facts dd { margin: 1px 0 0; font-size: 14px; overflow-wrap: anywhere; }',
    '.rp-sample { color: var(--warn); font-weight: 600; }',
    /* sections */
    '.rp-sec { margin-top: 30px; } .rp-sec + .rp-sec { padding-top: 26px; border-top: 1px solid var(--line-soft); }',
    '.rp-sec-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }',
    '.rp-num { flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--brand); color: var(--on-fill); display: grid; place-items: center; font-weight: 600; font-size: 14.5px; }',
    '.rp-sec-head h2 { font-size: 17px; letter-spacing: -.01em; } .rp-sec-head p { margin: 2px 0 0; font-size: 13px; color: var(--muted); }',
    '.rp-card { padding: 18px 20px; }',
    /* summary */
    '.rp-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }',
    '@media (max-width: 900px) { .rp-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }',
    '.rp-kpis .kpi:nth-child(-n+2) { border-top: 3px solid var(--brand); }',
    '.rp-highlights { margin-top: 14px; background: var(--card); border: 1px solid var(--line-soft); border-left: 4px solid var(--brand); border-radius: var(--r-lg); padding: 12px 18px; }',
    '.rp-highlights h3 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--brand); } .rp-highlights ul { margin: 8px 0 0; padding-left: 18px; font-size: 14.5px; line-height: 1.6; } .rp-highlights b { font-weight: 600; }',
    /* chart */
    '.rp svg.chart { width: 100% !important; height: auto !important; }',
    /* heat table */
    '.rp-bands { margin: 0 0 10px; }',
    '.heat { border-collapse: separate; border-spacing: 2px; font-size: 12.5px; width: 100%; } .heat th { font-size: 11px; padding: 4px 6px; text-align: center; } .heat th.tl { text-align: left; }',
    '.heat td { padding: 5px 6px; border: 0; text-align: center; border-radius: 4px; font-variant-numeric: tabular-nums; white-space: nowrap; }',
    '.heat td.tr { text-align: left; font-weight: 500; max-width: 220px; overflow: hidden; text-overflow: ellipsis; } .heat td.num, .heat th.num { text-align: right; } .heat .sep { padding-left: 14px; }',
    '.heat tbody tr:nth-child(even) td.tr, .heat tbody tr:nth-child(even) td.num { background: var(--inset); }',
    '.h-good { background: var(--good-bg); color: var(--good); font-weight: 600; } .h-warn { background: var(--warn-bg); color: var(--warn); font-weight: 600; }',
    '.h-bad { background: var(--bad-bg); color: var(--bad); font-weight: 600; } .h-none { color: var(--faint); }',
    '.legend .key.sq.h-good { background: var(--good-bg); outline: 1px solid var(--good); } .legend .key.sq.h-warn { background: var(--warn-bg); outline: 1px solid var(--warn); } .legend .key.sq.h-bad { background: var(--bad-bg); outline: 1px solid var(--bad); }',
    /* activities */
    '.rp-trade { margin-top: 14px; background: var(--card); border: 1px solid var(--line-soft); border-radius: var(--r-xl); overflow: hidden; box-shadow: var(--shadow); }',
    '.rp-trade-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 12px 16px; background: var(--inset); border-bottom: 1px solid var(--line); }',
    '.rp-acts tr.rp-trade-row th { padding: 0; background: var(--inset); text-transform: none; letter-spacing: 0; font-size: 14.5px; color: var(--ink); font-weight: 400; white-space: normal; border-bottom: 0; }',
    '.rp-acts tr.rp-trade-row .rp-trade-head h3 { font-weight: 600; } .rp-acts td:nth-child(3) { min-width: 150px; }',
    '.rp-trade-head h3 { font-size: 15.5px; margin-right: auto; } .rp-trade-stats { display: flex; gap: 14px; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; } .rp-trade-stats b { font-weight: 600; }',
    '.rp-acts { width: 100%; } .rp-acts td, .rp-acts th { padding: 6px 10px; font-size: 12.5px; vertical-align: middle; } .rp-acts th { background: var(--card); } .rp-acts .cell-name { min-width: 240px; }',
    '.rp-acts tr.wk td { background: color-mix(in srgb, var(--brand) 7%, var(--card)); font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); }',
    '.rp-acts tr.wk td span:first-child { font-weight: 600; color: var(--ink); } .rp-acts tr.wk .wk-n { float: right; font-weight: 600; color: var(--muted); }',
    /* notes */
    '.rp-foot { margin-top: 32px; padding: 14px 18px; background: var(--card); border: 1px solid var(--line-soft); border-radius: var(--r-lg); font-size: 12.5px; color: var(--muted); }',
    '.rp-foot h3 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink); margin-bottom: 6px; } .rp-foot p { margin: 4px 0; } .rp-foot b { color: var(--ink); }',
    /* print */
    '@media print { @page { size: A4 landscape; margin: 10mm 10mm 14mm; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    '  .no-print { display: none !important; } .report { background: var(--card); } .rp { max-width: none; padding: 0; } .card, .kpi, .rp-cover, .rp-trade { box-shadow: none; }',
    /* page 1: cover, the five cards in one row and the highlights */
    '  .rp-cover { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) !important; padding: 14px 18px; } .rp-cover h1 { font-size: 22px; margin: 4px 0 8px; }',
    '  .rp-kpis { grid-template-columns: repeat(5, minmax(0, 1fr)) !important; gap: 8px; } .rp-kpis .kpi { padding: 10px 12px; } .rp-kpis .kpi-value { font-size: 22px; }',
    '  .rp-sec { margin-top: 16px; } .rp-sec + .rp-sec { padding-top: 14px; } .rp-sec-head { margin-bottom: 8px; } .rp-highlights { margin-top: 10px; padding: 8px 14px; } .rp-highlights ul { font-size: 11.5px; line-height: 1.5; }',
    '  .rp-card, .rp-highlights, .rp-kpis, .rp-sec-head { break-inside: avoid; } .rp-sec-head { break-after: avoid; }',
    /* a long trade table may split across pages; its heading and column header stay with it */
    '  .rp-card.rp-heat { break-inside: auto; padding: 12px 16px; } .heat thead { display: table-header-group; } .heat tr { break-inside: avoid; } .rp-bands { break-after: avoid; }',
    /* activities: the trade header and column header repeat on every page; a week label never sits alone at a page foot */
    '  .rp-trade { break-inside: auto; border-radius: 8px; } thead { display: table-header-group; } tr { break-inside: avoid; } .rp-acts tr.wk { break-after: avoid; }',
    '  .rp-acts td, .rp-acts th { padding: 4px 8px; font-size: 10.5px; } .rp-acts .cell-name { min-width: 200px; } .rp-acts tr.rp-trade-row th { font-size: 12px; } .rp-trade-head { padding: 7px 12px; }',
    '  .rp-acts .pill { font-size: 10px; padding: 1px 6px 1px 4px; } .heat td { padding: 4px 5px; font-size: 10.5px; } .rp-foot { break-inside: avoid; } }'
  ].join('\n');

  function openReview(R, ctx) {
    var built = buildReview(R, ctx);
    var url = URL.createObjectURL(new Blob([built.html], { type: 'text/html;charset=utf-8' }));
    var w = window.open(url, '_blank');
    if (!w) {
      /* pop-ups blocked: hand the file over instead */
      var a = document.createElement('a');
      a.href = url; a.download = slug('ppc-review-' + (ctx.project.title || ctx.project.key) + '-' + R.V.range.from + '-to-' + R.V.range.to) + '.html';
      document.body.appendChild(a); a.click(); a.remove();
    }
    setTimeout(function () { URL.revokeObjectURL(url); }, 10 * 60 * 1000);
  }

  function plurals(noun) { return /[^aeiou]y$/.test(noun) ? noun.slice(0, -1) + 'ies' : noun + 's'; }

  /* A hierarchy for a picker: paths (top level first, the last name being the value in the data,
     e.g. data.locationTree) -> root nodes { name, value, kids, all }. A node's value is set only
     where that name is in the options (its first occurrence); `all` is the node's own value plus
     every value under it. Branches with no data are dropped; options in no path go under `other`. */
  function buildTree(paths, options, other) {
    var root = { kids: [] }, byKey = {}, owner = {}, inOpts = {};
    options.forEach(function (o) { inOpts[o] = 1; });
    paths.forEach(function (p) {
      var parent = root, key = '';
      p.forEach(function (name) {
        key += '\u0001' + name;
        var n = byKey[key];
        if (!n) { n = byKey[key] = { name: name, value: null, kids: [] }; parent.kids.push(n); }
        parent = n;
      });
      var leaf = p[p.length - 1];
      if (inOpts[leaf] && !owner[leaf]) { owner[leaf] = 1; parent.value = leaf; }
    });
    var rest = options.filter(function (o) { return !owner[o]; });
    if (rest.length) root.kids.push({ name: other, value: null, kids: rest.map(function (o) { return { name: o, value: o, kids: [] }; }) });
    (function prune(n) {
      n.kids = n.kids.filter(function (k) { prune(k); return k.all.length; });
      n.all = [].concat.apply(n.value ? [n.value] : [], n.kids.map(function (k) { return k.all; }));
    })(root);
    return root.kids;
  }
  /* a child named after its parent shows only its own part: "L0 | IPR | HV A" under "L0 | IPR" -> "HV A" */
  function shortName(name, parent) {
    if (!parent || name.length <= parent.length || name.indexOf(parent) !== 0) return name;
    var s = name.slice(parent.length).replace(/^\s*[|\-–]\s*/, '');
    return s && s !== name.slice(parent.length) ? s : name;
  }

  function multiSelect(host, noun, options, selected, onChange, treePaths) {
    var nouns = plurals(noun);
    host.innerHTML = '';
    var btn = el('button', 'ms-btn'); btn.type = 'button'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    var txt = el('span'), nspan = el('span', 'ms-n');
    btn.appendChild(txt); btn.appendChild(nspan); btn.appendChild(el('span', 'ms-caret'));
    var pop = el('div', 'ms-pop'); pop.hidden = true;
    var tools = el('div', 'ms-tools');
    var search = el('input'); search.type = 'search'; search.placeholder = 'Search ' + nouns; search.setAttribute('aria-label', 'Search ' + nouns);
    var all = el('button', 'ms-link', 'All'); all.type = 'button';
    var none = el('button', 'ms-link', 'None'); none.type = 'button';
    tools.appendChild(search); tools.appendChild(all); tools.appendChild(none);
    var list = el('div', 'ms-list'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-multiselectable', 'true');
    pop.appendChild(tools); pop.appendChild(list);
    host.appendChild(btn); host.appendChild(pop);
    var state = selected ? Object.assign({}, selected) : null; /* null = all */
    /* tree mode: open = expanded nodes by path ('/Data Center/NIVEAU 0'); refocus = the control to focus again after a redraw */
    var tree = treePaths && treePaths.length ? buildTree(treePaths, options, 'Other ' + nouns) : null, open = {}, refocus = null;
    if (tree) { pop.classList.add('ms-tree'); tree.forEach(function (n) { open['/' + n.name] = 1; }); }

    /* the one tree node whose values are exactly the selection, so the button can name it */
    function namedNode() {
      var keys = Object.keys(state), hit = null;
      (function walk(ns) {
        ns.forEach(function (n) {
          if (hit) return;
          if (n.all.length === keys.length && n.all.every(function (v) { return state[v]; })) hit = n; else walk(n.kids);
        });
      })(tree);
      return hit;
    }
    function label() {
      var n = state ? Object.keys(state).length : options.length, node = tree && state && n > 1 ? namedNode() : null;
      if (!state) { txt.textContent = 'All ' + nouns; nspan.textContent = C.fmtNum(options.length); btn.classList.remove('active'); }
      else { txt.textContent = node ? node.name : n === 1 ? Object.keys(state)[0] : n + ' ' + nouns; nspan.textContent = (node ? n + ' ' : '') + 'of ' + C.fmtNum(options.length); btn.classList.add('active'); }
    }
    function setValues(vals, on) {
      if (!state) { state = {}; options.forEach(function (x) { state[x] = 1; }); }
      vals.forEach(function (v) { if (on) state[v] = 1; else delete state[v]; });
      if (Object.keys(state).length === options.length) state = null;
      label(); onChange(state);
    }
    function drawTree(q) {
      var any = false;
      function matches(n) { return n.name.toLowerCase().indexOf(q) >= 0; }
      function hasMatch(n) { return matches(n) || n.kids.some(hasMatch); }
      function row(n, path, depth, parentName, shown) {
        var key = path + '/' + n.name, expanded = !!q || !!open[key];
        var on = n.all.filter(function (v) { return !state || state[v]; }).length;
        var r = el('div', 'ms-row'); r.style.paddingLeft = (depth * 16) + 'px';
        var tw = el('button', 'ms-twist' + (n.kids.length ? '' : ' leaf'), n.kids.length ? (expanded ? '▾' : '▸') : '');
        tw.type = 'button'; tw.tabIndex = n.kids.length ? 0 : -1;
        if (n.kids.length) {
          tw.setAttribute('aria-label', (expanded ? 'Collapse ' : 'Expand ') + n.name);
          tw.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          /* the redraw detaches this button, so keep the click from reaching the outside-click close */
          tw.addEventListener('click', function (e) { e.stopPropagation(); if (open[key]) delete open[key]; else open[key] = 1; refocus = 'tw' + key; draw(); });
        }
        var lab = el('label'); lab.setAttribute('role', 'option'); lab.title = n.name;
        var cb = el('input'); cb.type = 'checkbox'; cb.checked = on === n.all.length; cb.indeterminate = on > 0 && on < n.all.length;
        lab.setAttribute('aria-selected', cb.checked ? 'true' : 'false');
        cb.addEventListener('change', function () { setValues(n.all, cb.checked); refocus = 'cb' + key; draw(); });
        lab.appendChild(cb); lab.appendChild(el('span', null, shortName(n.name, parentName)));
        if (n.kids.length) lab.appendChild(el('span', 'ms-count', C.fmtNum(n.all.length)));
        r.appendChild(tw); r.appendChild(lab); list.appendChild(r); any = true;
        if (refocus === 'tw' + key) tw.focus(); else if (refocus === 'cb' + key) cb.focus();
        if (expanded) n.kids.forEach(function (k) { if (shown || !q || hasMatch(k)) row(k, key, depth + 1, n.name, shown || (!!q && matches(n))); });
      }
      tree.forEach(function (n) { if (!q || hasMatch(n)) row(n, '', 0, null, false); });
      refocus = null;
      return any;
    }
    function draw() {
      list.innerHTML = '';
      var q = search.value.trim().toLowerCase();
      if (tree) { if (!drawTree(q)) list.appendChild(el('div', 'ms-empty', 'No ' + noun + ' matches "' + search.value + '".')); return; }
      var shown = options.filter(function (o) { return !q || o.toLowerCase().indexOf(q) >= 0; });
      if (!shown.length) list.appendChild(el('div', 'ms-empty', 'No ' + noun + ' matches "' + search.value + '".'));
      shown.forEach(function (o) {
        var lab = el('label'); lab.setAttribute('role', 'option');
        var cb = el('input'); cb.type = 'checkbox'; cb.checked = !state || !!state[o]; cb.value = o;
        cb.addEventListener('change', function () {
          if (!state) { state = {}; options.forEach(function (x) { state[x] = 1; }); }
          if (cb.checked) state[o] = 1; else delete state[o];
          if (Object.keys(state).length === options.length) state = null;
          lab.setAttribute('aria-selected', cb.checked ? 'true' : 'false');
          label(); onChange(state);
        });
        lab.appendChild(cb); lab.appendChild(el('span', null, o));
        list.appendChild(lab);
      });
    }
    btn.addEventListener('click', function () {
      if (openPop && openPop.btn === btn) { closePop(); return; }
      closePop();
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); openPop = { host: host, btn: btn, pop: pop };
      var fc = host.closest('.filters'); if (fc) fc.classList.add('has-pop');
      search.value = ''; draw(); search.focus();
    });
    search.addEventListener('input', draw);
    all.addEventListener('click', function () { state = null; draw(); label(); onChange(state); });
    none.addEventListener('click', function () { state = {}; draw(); label(); onChange(state); });
    label();
    return { set: function (s) { state = s ? Object.assign({}, s) : null; label(); if (!pop.hidden) draw(); } };
  }

  /* slicer keys: Performance uses org / trade / loc (from the activity); Constraints uses cat / ctrade / cown (from the constraint);
     High-risk uses the risk type and the activity's org / trade / loc */
  var FILTER_KEYS = ['org', 'trade', 'loc', 'cat', 'ctrade', 'cown', 'rtype'];
  var PAGE_KEYS = { performance: ['org', 'trade', 'loc'], lookahead: ['trade', 'loc', 'org'], constraints: ['cat', 'ctrade', 'cown'], risk: ['rtype', 'trade', 'loc', 'org'] };
  var PAGES = { performance: 'pagePerformance', lookahead: 'pageLookahead', constraints: 'pageConstraints', risk: 'pageRisk' };

  /* ---------- filter state in the URL hash ---------- */
  function parseHash(opts) {
    var out = {};
    var h = location.hash.replace(/^#/, '');
    if (!h) return out;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if ((k === 'from' || k === 'to') && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[k] = v;
      if (k === 'page' && PAGES[v]) out.page = v;
      if (FILTER_KEYS.indexOf(k) >= 0) {
        var m = {}; v.split('|').forEach(function (x) { if (opts[k].indexOf(x) >= 0) m[x] = 1; });
        if (Object.keys(m).length) out[k] = m;
      }
    });
    return out;
  }
  function writeHash(S, defaults) {
    var parts = [];
    if (S.from !== defaults.from) parts.push('from=' + S.from);
    if (S.to !== defaults.to) parts.push('to=' + S.to);
    FILTER_KEYS.forEach(function (k) { if (S[k]) parts.push(k + '=' + encodeURIComponent(Object.keys(S[k]).join('|'))); });
    /* defaults are the page's own (its default range); the page itself is written unless it is the first one */
    if (S.page && S.page !== 'performance') parts.push('page=' + S.page);
    var next = parts.length ? '#' + parts.join('&') : location.pathname + location.search;
    try { history.replaceState(null, '', next); } catch (e) { /* file:// in some browsers */ }
  }

  /* ========================================================== project page */
  function renderProject() {
    var meta = D.meta, P = D.project, M = D.metrics, data = D.data || {};
    renderBanner(meta);
    var asof = document.getElementById('asof');
    if (asof) asof.textContent = M ? 'Data as of ' + fmtDateTime(meta.dataAsOf || meta.generatedAt) : 'No data yet';

    /* project status beside the name in the app bar (the facts strip is gone) */
    var stHost = document.getElementById('projStatus');
    if (stHost) {
      stHost.innerHTML = '';
      var st = (P.facts || []).filter(function (f) { return f.label === 'Status' && f.value; })[0];
      if (st) {
        var tone = /complete|closed|finished/i.test(st.value) ? 'good' : (/hold|stopp|suspend/i.test(st.value) ? 'warn' : 'inert');
        var sp = pill(st.value, tone, tone === 'inert' ? '•' : null);
        sp.className += ' status-pill'; sp.title = 'Project status';
        stHost.appendChild(sp);
      }
    }
    if (!M) {
      document.querySelectorAll('section[data-needs-data]').forEach(function (s) { s.hidden = true; });
      var empty = document.getElementById('emptyState');
      if (empty) empty.hidden = false;
      return;
    }

    /* ---- slicers ---- */
    var FX = M.facts, opts = A.options(FX, data), ext = A.extent(FX);
    var defaults = { from: FX.trend.from, to: FX.trend.to, org: null, trade: null, loc: null, cat: null, ctrade: null, cown: null, rtype: null, page: 'performance' };
    /* the High-risk page looks ahead: from this week's Monday, data.highRisk.defaultWeeks whole weeks */
    var hasRisk = FX.tasks.some(function (t) { return t.hr; });
    var riskMon = A.mondayOf(FX.today), riskWeeks = Number((data.highRisk || {}).defaultWeeks) || 6;
    /* the Look-ahead page: whole weeks from next Monday (data.lookahead.startNextWeek), 4 by default */
    var LA = data.lookahead || {}, laWeeks = Number(LA.defaultWeeks) || 4;
    var laMon = LA.startNextWeek === false ? riskMon : A.addDays(riskMon, 7);
    function laSpan(n) { return { from: laMon, to: A.addDays(laMon, 7 * n - 1) }; }
    var PAGE_DEFAULTS = {
      performance: Object.assign({}, defaults),
      constraints: Object.assign({}, defaults, { page: 'constraints' }),
      risk: Object.assign({}, defaults, { page: 'risk', from: riskMon, to: A.addDays(riskMon, 7 * riskWeeks - 1) }),
      lookahead: Object.assign({}, defaults, { page: 'lookahead' }, laSpan(laWeeks))
    };
    function defaultsOf(page) { return PAGE_DEFAULTS[page] || defaults; }
    /* each page keeps its own slicers: the controls show the active page's, and changing them never touches the other page.
       A link carries the filters of the page it opens on. */
    var fromHash = parseHash(opts), startPage = fromHash.page === 'risk' && !hasRisk ? 'performance' : (fromHash.page || 'performance');
    var FS = {};
    Object.keys(PAGE_DEFAULTS).forEach(function (k) { FS[k] = Object.assign({}, PAGE_DEFAULTS[k]); });
    Object.assign(FS[startPage], fromHash, { page: startPage });
    var S = FS[startPage];
    /* reason-category colour slots are fixed once per page from the unfiltered view, so a filter never repaints a category */
    var base = A.run(FX, { from: null, to: null, org: null, trade: null, loc: null }, data);
    var noneLabel = (data.reasons && data.reasons.noneLabel) || 'No reason recorded';
    var catSlots = {}, nSlots = 0;
    (base.reasons.categories || []).map(function (c) { return c.label; })
      .concat(((base.reasonsByTrade && base.reasonsByTrade.categories) || []).map(function (c) { return c.label; }))
      .forEach(function (l) { if (l !== noneLabel && !catSlots[l] && nSlots < 8) catSlots[l] = 'cat-' + (++nSlots); });
    function catCls(label) { return label === noneLabel ? 'cat-none' : (catSlots[label] || 'cat-other'); }
    /* past the eighth colour slot; not the model's own "Others" category */
    function catFold(label) { return label === noneLabel || catSlots[label] ? label : 'Other categories'; }

    var dayRange = dateRangePicker(document.getElementById('fDate'), {
      extent: ext, today: FX.today, from: S.from, to: S.to, presets: datePresets(FX, ext),
      onChange: function (a, b) { S.from = a; S.to = b; apply(); }
    });
    var pickers = {
      org: multiSelect(document.getElementById('fOrg'), 'organisation', opts.org, S.org, function (s) { S.org = s; apply(); }),
      trade: multiSelect(document.getElementById('fTrade'), 'trade', opts.trade, S.trade, function (s) { S.trade = s; apply(); }),
      loc: multiSelect(document.getElementById('fLoc'), 'location', opts.loc, S.loc, function (s) { S.loc = s; apply(); }, data.locationTree),
      cat: multiSelect(document.getElementById('fCat'), 'category', opts.cat, S.cat, function (s) { S.cat = s; apply(); }),
      ctrade: multiSelect(document.getElementById('fCTrade'), 'trade', opts.ctrade, S.ctrade, function (s) { S.ctrade = s; apply(); }),
      cown: multiSelect(document.getElementById('fCOwn'), 'owner', opts.cown, S.cown, function (s) { S.cown = s; apply(); }),
      rtype: multiSelect(document.getElementById('fRType'), 'risk type', opts.rtype, S.rtype, function (s) { S.rtype = s; apply(); })
    };
    /* export: the PPC review for the current range and filters, as a standalone report */
    var exportBtn = document.getElementById('fExport');
    if (!FX.commitments) { exportBtn.disabled = true; exportBtn.title = 'No commitment feed is configured for this project'; }
    exportBtn.addEventListener('click', function () {
      var SP = FS.performance;
      openReview(A.review(FX, SP, data), { project: P, meta: meta, S: SP, data: data, eyebrow: data.eyebrow || 'DLR',
                                          css: (document.querySelector('head style') || {}).textContent || '' });
    });
    /* Reset clears the active page's filters only */
    function resetFilters() {
      S = FS[S.page] = Object.assign({}, defaultsOf(S.page)); syncControls(); apply();
    }
    function syncControls() { FILTER_KEYS.forEach(function (k) { pickers[k].set(S[k]); }); dayRange.set(S.from, S.to); }
    document.getElementById('fReset').addEventListener('click', resetFilters);
    /* the Look-ahead page's 4 / 8 week buttons set its range to that many weeks from next Monday */
    document.querySelectorAll('#laSpan button').forEach(function (b) {
      b.addEventListener('click', function () { Object.assign(S, laSpan(Number(b.getAttribute('data-weeks')))); syncControls(); apply(); });
    });

    /* ---- page tabs: Performance | Constraints | High-risk (only when the feed flags high-risk activities), each with its own slicers ---- */
    document.getElementById('tabRisk').hidden = !hasRisk;
    var tabs = ['tabPerformance', 'tabLookahead', 'tabConstraints', 'tabRisk'].map(function (id) { return document.getElementById(id); }).filter(function (t) { return !t.hidden; });
    function showPage(page, focus) {
      S = FS[page];
      /* each page shows its own slicers */
      document.querySelectorAll('#filters [data-for]').forEach(function (n) { n.hidden = n.getAttribute('data-for').split(' ').indexOf(page) < 0; });
      tabs.forEach(function (t) {
        var on = t.getAttribute('data-page') === page;
        t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        if (on && focus) t.focus();
      });
      writeHash(S, defaultsOf(page));
      var nav = document.getElementById('controlBar'), panel = document.getElementById(PAGES[page]);
      if (nav && panel) {
        var stuck = nav.getBoundingClientRect().bottom;
        var top = panel.getBoundingClientRect().top;
        if (top < stuck) window.scrollTo({ top: window.scrollY + top - stuck - 12 });
      }
    }
    /* switching pages swaps in that page's own filters */
    function switchPage(page, focus) {
      if (page === S.page) return;
      showPage(page, focus);
      syncControls();
      apply();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { switchPage(t.getAttribute('data-page')); });
      t.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        switchPage(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].getAttribute('data-page'), true);
      });
    });
    showPage(S.page || 'performance');

    function activeFilters() {
      var d = defaultsOf(S.page);
      return (S.from !== d.from || S.to !== d.to ? 1 : 0) + PAGE_KEYS[S.page].filter(function (k) { return S[k]; }).length;
    }
    function apply() {
      var nAct = activeFilters(), reset = document.getElementById('fReset');
      reset.disabled = !nAct;
      reset.innerHTML = '';
      reset.appendChild(document.createTextNode('Reset'));
      if (nAct) reset.appendChild(el('span', 'reset-n', String(nAct)));
      reset.title = nAct ? nAct + (nAct === 1 ? ' filter differs' : ' filters differ') + ' from the default view' : 'Showing the default view';
      dayRange.set(S.from, S.to);
      writeHash(S, defaultsOf(S.page));
      /* the Constraints and High-risk tab badges and the panel's open-constraint count always follow their own page's filters */
      var V = A.run(FX, S, data), VC = S.page === 'constraints' ? V : A.run(FX, FS.constraints, data);
      var VR = !hasRisk ? null : S.page === 'risk' ? V : A.run(FX, FS.risk, data);
      renderView(V, S, { laSpan: laSpan, opts: opts, catCls: catCls, catFold: catFold, noneLabel: noneLabel, data: data, M: M, consCN: VC.constraints, risk: VR ? VR.risk : null });
    }
    apply();
  }

  /* ========================================================== Look-ahead page */
  var laHeatAll = false; /* the trade x week grid shows the 15 trades with the most starts until expanded */
  var LA_HEAT_ROWS = 15;
  var LA_GROUP_INFO = [['complete', 'Complete'], ['inProgress', 'In progress'], ['issue', 'Stopped / rejected'], ['ready', 'Ready'], ['notStarted', 'Not ready']];
  var LA_CSTATES = [['overdue', 'Open, overdue constraints', 'c-overdue'], ['open', 'Open constraints, not yet due', 'c-open'],
                    ['closed', 'Constraints all closed', 'c-closed'], ['none', 'No linked constraints', 'c-none']];
  function pctTone(v) { return v === null || v === undefined ? null : v >= 80 ? 'good' : v >= 50 ? 'warn' : 'bad'; }
  function renderLookahead(V, S, rangeText, ctx) {
    var L = V.lookahead, UN = V.sets.UN;
    function ll(spec, title, sub) { spec.type = 'lookahead'; return lister(spec, title, sub || rangeText); }
    document.querySelectorAll('#laSpan button').forEach(function (b) {
      var sp = ctx.laSpan(Number(b.getAttribute('data-weeks')));
      b.setAttribute('aria-pressed', S.from === sp.from && S.to === sp.to ? 'true' : 'false');
    });
    setText('laDesc', plural(L.weeks.length, 'week') + ', ' + rangeText + ' · activities whose planned start or planned end falls in the range, each in the week it starts');

    /* ---- tiles ---- */
    var k = document.getElementById('laKpis'); k.innerHTML = '';
    [
      { label: 'Look-ahead activities', value: C.fmtNum(L.total), sub: 'Planned start or end in the range',
        pick: L.total ? ll({}, 'Look-ahead activities') : null },
      { label: 'Planned to start', value: C.fmtNum(L.starting), sub: C.fmtNum(L.finishing) + ' planned to finish in the range',
        pick: L.starting ? ll({ pred: 'starting' }, 'Activities planned to start') : null },
      { label: 'Ready to start', value: C.fmtPct(L.readyPct), tone: pctTone(L.readyPct), sub: C.fmtNum(L.ready) + ' of ' + C.fmtNum(L.toStart) + ' not-yet-started starts are Ready',
        pick: L.toStart ? ll({ pred: 'toStart' }, 'Starts not yet started', rangeText + ' · Ready first in the status column') : null },
      { label: 'Constraint-free starts', value: C.fmtPct(L.constraintFreePct), tone: pctTone(L.constraintFreePct), sub: 'Starts with no open constraint',
        pick: L.starting ? ll({ pred: 'starting', cstate: null }, 'Activities planned to start') : null },
      { label: 'Held by constraints', value: C.fmtNum(L.withOpen), tone: L.withOpen ? 'warn' : 'good', toneLabel: L.withOpen ? 'Open' : 'None',
        sub: plural(L.openCons, 'open constraint') + ' on these activities',
        pick: L.withOpen ? ll({ pred: 'open' }, 'Look-ahead activities with open constraints') : null },
      { label: 'Constraints overdue', value: C.fmtNum(L.overdueCons), tone: L.overdueCons ? 'bad' : 'good', toneLabel: L.overdueCons ? 'Overdue' : 'None',
        sub: 'Open, target before today, on ' + plural(L.withOverdue, 'activity', 'activities'),
        pick: L.withOverdue ? ll({ pred: 'overdue' }, 'Look-ahead activities with overdue constraints') : null }
    ].forEach(function (d) { k.appendChild(kpiTile(d)); });

    /* ---- status by look-ahead week ---- */
    var W = L.weeks;
    setText('laWeeksDesc', 'Activities per look-ahead week by status today · ' + C.fmtNum(L.starting) + ' starts, ' + C.fmtNum(L.total - L.starting) + ' finishing only');
    laWeeksSpec = {
      labels: W.map(function (w) { return weekLabel(w.week); }), band: W.map(function () { return false; }),
      stacked: true, showLabels: true, axisTitles: ['Activities', ''], emptyText: 'No activities planned to start or finish in the selected range.',
      columns: LA_GROUP_INFO.map(function (g) {
        return { name: g[1], cls: 'g-' + g[0], values: W.map(function (w) { return w[g[0]]; }),
                 tips: W.map(function (w) { return weekLabel(w.week) + ', ' + fmtRange(w.start, w.end) + ': ' + C.fmtNum(w[g[0]]) + ' ' + g[1].toLowerCase() + ' of ' + C.fmtNum(w.total); }),
                 picks: W.map(function (w) { return w[g[0]] ? ll({ week: w.week, group: g[0] }, weekLabel(w.week) + ': ' + g[1].toLowerCase(), fmtRange(w.start, w.end)) : null; }) };
      })
    };
    C.comboChart(document.getElementById('laWeeksChart'), laWeeksSpec);
    var lg = document.getElementById('laWeeksLegend'); lg.innerHTML = '';
    LA_GROUP_INFO.forEach(function (g) { lg.appendChild(chip(g[1], L.byGroup[g[0]], 'g-' + g[0], null, L.byGroup[g[0]] ? ll({ group: g[0] }, 'Look-ahead activities: ' + g[1].toLowerCase()) : null)); });
    ensureListBtn('laWeeksDesc', L.total ? ll({}, 'Look-ahead activities by week') : null);

    /* ---- status distribution: every status value ---- */
    C.barRows(document.getElementById('laStatus'), L.byStatus.map(function (x) {
      var pk = ll({ status: x.status }, statusLabel(x.status) + ': look-ahead activities');
      return { label: statusLabel(x.status), total: x.count, valueText: C.fmtNum(x.count), title: statusLabel(x.status) + ': ' + C.fmtNum(x.count) + ' (' + C.fmtPct(L.total ? 100 * x.count / L.total : null) + ')', pick: pk,
               parts: [{ count: x.count, cls: 'g-' + x.group, label: statusLabel(x.status), pick: pk }] };
    }), { emptyText: 'No look-ahead activities.' });
    setText('laStatusDesc', plural(L.byStatus.length, 'status', 'statuses') + ' across ' + plural(L.total, 'activity', 'activities'));

    /* ---- linked constraints ---- */
    C.barRows(document.getElementById('laCons'), LA_CSTATES.map(function (c) {
      var n = L.cstates[c[0]], pk = n ? ll({ cstate: c[0] }, 'Look-ahead activities: ' + c[1].toLowerCase()) : null;
      return { label: c[1], total: n, valueText: C.fmtNum(n), title: c[1] + ': ' + C.fmtNum(n) + ' (' + C.fmtPct(L.total ? 100 * n / L.total : null) + ')', pick: pk, parts: [{ count: n, cls: c[2], label: c[1], pick: pk }] };
    }), { emptyText: 'No look-ahead activities.' });
    setText('laConsDesc', plural(L.linked, 'activity', 'activities') + ' with linked constraints');
    var ck = document.getElementById('laConsKey'); ck.innerHTML = '';
    ck.appendChild(chip('Open constraints', L.openCons, 'c-open', 'Distinct open constraints linked to look-ahead activities', L.withOpen ? ll({ pred: 'open' }, 'Look-ahead activities with open constraints') : null));
    ck.appendChild(chip('Overdue', L.overdueCons, 'c-overdue', 'Open constraints with a target before today', L.withOverdue ? ll({ pred: 'overdue' }, 'Look-ahead activities with overdue constraints') : null));
    if (L.highRisk) ck.appendChild(chip('High-risk activities', L.highRisk, null, 'Look-ahead activities flagged high-risk', ll({ pred: 'highRisk' }, 'High-risk look-ahead activities')));
    ensureListBtn('laConsDesc', L.linked ? ll({ pred: 'linked' }, 'Look-ahead activities with linked constraints') : null);

    /* ---- starts by trade and week ---- */
    var host = document.getElementById('laHeat'); host.innerHTML = '';
    var more = document.getElementById('laHeatMore'), key = document.getElementById('laHeatKey'); key.innerHTML = '';
    if (!L.byTrade.length) {
      host.appendChild(el('p', 'empty', 'No activities are planned to start in the selected range.')); more.hidden = true;
    } else {
      var tbl = el('table', 'heat'), hr = el('tr'), thead = el('thead');
      hr.appendChild(el('th', null, ''));
      W.forEach(function (w) {
        var th = el('th'), box = el('div', 'ht-type'); box.appendChild(el('strong', null, weekLabel(w.week))); box.appendChild(el('span', null, C.fmtDate(w.start, true)));
        if (w.starts) makePick(box, ll({ pred: 'starting', week: w.week }, 'Starts in ' + weekLabel(w.week), fmtRange(w.start, w.end)), false);
        th.appendChild(box); hr.appendChild(th);
      });
      hr.appendChild(el('th', 'num', 'Starts')); hr.appendChild(el('th', 'num', 'Held'));
      thead.appendChild(hr); tbl.appendChild(thead);
      var tb = el('tbody');
      (laHeatAll ? L.byTrade : L.byTrade.slice(0, LA_HEAT_ROWS)).forEach(function (row) {
        var tr = el('tr'), name = el('th', 'ht-trade', row.trade);
        makePick(name, ll({ pred: 'starting', trade: row.trade }, row.trade + ': starts'), false); name.title = row.trade + ': ' + plural(row.starts, 'start');
        tr.appendChild(name);
        W.forEach(function (w) {
          var v = row.cells[w.week] || 0, td = el('td', 'hc' + (v ? '' : ' zero'), v ? C.fmtNum(v) : '·');
          if (v) {
            var p = L.maxCell ? v / L.maxCell : 0;
            td.style.background = 'color-mix(in srgb, var(--risk) ' + Math.round(14 + 80 * p) + '%, var(--card))';
            if (p > 0.55) td.classList.add('hot');
            td.title = row.trade + ' · ' + weekLabel(w.week) + ': ' + plural(v, 'start');
            makePick(td, ll({ trade: row.trade, startWeek: w.week }, row.trade + ' · starts in ' + weekLabel(w.week), fmtRange(w.start, w.end)), false);
          }
          tr.appendChild(td);
        });
        var tot = el('td', 'hc tot', C.fmtNum(row.starts)); makePick(tot, ll({ pred: 'starting', trade: row.trade }, row.trade + ': starts'), false); tr.appendChild(tot);
        var held = el('td', 'hc tot' + (row.open ? ' tone-text-warn' : ''), row.open ? C.fmtNum(row.open) : '—');
        if (row.open) { held.title = row.open + ' of ' + row.starts + ' starts have open constraints'; makePick(held, ll({ pred: 'open', trade: row.trade }, row.trade + ': activities with open constraints'), false); }
        tr.appendChild(held);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      var tf = el('tfoot'), fr = el('tr'); fr.appendChild(el('th', null, 'All trades'));
      W.forEach(function (w) { fr.appendChild(el('td', 'hc', C.fmtNum(w.starts))); });
      fr.appendChild(el('td', 'hc', C.fmtNum(L.starting)));
      fr.appendChild(el('td', 'hc', C.fmtNum(L.byTrade.reduce(function (a, r) { return a + r.open; }, 0))));
      tf.appendChild(fr); tbl.appendChild(tf); host.appendChild(tbl);
      more.hidden = L.byTrade.length <= LA_HEAT_ROWS;
      more.textContent = laHeatAll ? 'Show the top ' + LA_HEAT_ROWS + ' trades' : 'Show all ' + C.fmtNum(L.byTrade.length) + ' trades';
      more.onclick = function () { laHeatAll = !laHeatAll; renderLookahead(V, S, rangeText, ctx); };
      key.appendChild(el('span', null, '1')); key.appendChild(el('span', 'heat-ramp')); key.appendChild(el('span', null, C.fmtNum(L.maxCell)));
      key.appendChild(el('span', null, '· activities planned to start, per trade and week. Held = starts with an open constraint.'));
    }
    setText('laHeatDesc', L.byTrade.length ? plural(L.byTrade.length, 'trade') + ' starting work' + (L.byTrade.length > LA_HEAT_ROWS && !laHeatAll ? ' · the ' + LA_HEAT_ROWS + ' with the most starts shown' : '') : '');
    ensureListBtn('laHeatDesc', L.starting ? ll({ pred: 'starting' }, 'Activities planned to start') : null);

    /* ---- activities held by open constraints ---- */
    var held = L.rows.filter(function (r) { return r.open.length; }).sort(function (a, b) {
      return (b.overdue.length > 0) - (a.overdue.length > 0) || a.anchor.localeCompare(b.anchor) || (a.t.n || '').localeCompare(b.t.n || '');
    });
    var HB = document.getElementById('laBlockedBody'); HB.innerHTML = '';
    setText('laBlockedDesc', held.length ? plural(held.length, 'activity', 'activities') + ' · overdue constraints first' + (held.length > 10 ? ', the first 10 shown' : '') : 'No look-ahead activity has an open constraint');
    ensureListBtn('laBlockedDesc', held.length ? ll({ pred: 'open' }, 'Look-ahead activities with open constraints') : null);
    if (!held.length) emptyRow(HB, 6, 'No look-ahead activity has an open constraint.');
    held.slice(0, 10).forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(nameCell(r.t.n, [r.t.id ? '#' + r.t.id : null, r.t.l].filter(Boolean).join(' · ')));
      tr.appendChild(textCell(r.t.tr || UN));
      tr.appendChild(dateCell(r.t.ps));
      var cc = el('td'), list = el('div', 'cons-list');
      r.open.slice(0, 3).forEach(function (c) { var sp = el('span', c.tg && c.tg < V.today ? 'tone-text-bad' : null, c.t || '(untitled)'); sp.title = (c.c ? c.c + ' · ' : '') + (c.ow || '') + (c.tg ? ' · target ' + C.fmtDate(c.tg, true) : ''); list.appendChild(sp); });
      if (r.open.length > 3) list.appendChild(el('span', 'cell-note', '+ ' + (r.open.length - 3) + ' more'));
      cc.appendChild(list); tr.appendChild(cc);
      var nt = dateCell(r.nextTarget); if (r.overdue.length) nt.appendChild(el('div', 'cell-note tone-text-bad', r.overdue.length + ' overdue')); tr.appendChild(nt);
      tr.appendChild(statusCell(r.t.st));
      HB.appendChild(tr);
    });
  }

  /* ========================================================== High-risk page */
  var riskHeatAll = false; /* the heat map shows the 12 trades with the most high-risk activities until expanded */
  var RISK_HEAT_ROWS = 12;
  function renderRisk(V, S, rangeText) {
    var R = V.risk, UN = V.sets.UN;
    function rl(spec, title, sub) { spec.type = 'risk'; return lister(spec, title, sub || rangeText); }
    setText('riskDesc', plural(R.total, 'open high-risk activity', 'open high-risk activities') + ' planned in ' + rangeText
      + ' · ' + C.fmtNum(R.flagged) + ' flagged in the project · complete and quality-checked activities are left out');

    /* ---- tiles ---- */
    var rk = document.getElementById('riskKpis'); rk.innerHTML = '';
    [
      { label: 'High-risk activities', value: C.fmtNum(R.total), sub: 'Open, planned in the range',
        pick: R.total ? rl({}, 'High-risk activities') : null },
      { label: 'In progress', value: C.fmtNum(R.started), sub: R.moved ? C.fmtNum(R.moved) + ' started past their planned start, counted from today' : 'Started, not yet complete',
        pick: R.started ? rl({ pred: 'started' }, 'High-risk activities in progress') : null },
      { label: 'Starting in 7 days', value: C.fmtNum(R.soon), sub: 'Not started, planned start ' + fmtRange(V.today, A.addDays(V.today, 6)),
        pick: R.soon ? rl({ pred: 'soon' }, 'High-risk activities starting in the next 7 days', fmtRange(V.today, A.addDays(V.today, 6))) : null },
      { label: 'Should have started', value: C.fmtNum(R.lateStart), tone: R.lateStart ? 'bad' : 'good', toneLabel: R.lateStart ? 'Late' : 'None late', sub: 'Not started, planned start before today',
        pick: R.lateStart ? rl({ pred: 'lateStart' }, 'High-risk activities that should have started') : null },
      { label: 'Past planned finish', value: C.fmtNum(R.overdue), tone: R.overdue ? 'bad' : 'good', toneLabel: R.overdue ? 'Overdue' : 'None overdue', sub: 'Open, planned end before today',
        pick: R.overdue ? rl({ pred: 'overdue' }, 'High-risk activities past their planned finish') : null },
      { label: 'Multiple risk types', value: C.fmtNum(R.multi), sub: 'Combined hazards on one activity',
        pick: R.multi ? rl({ pred: 'multi' }, 'High-risk activities with several risk types') : null }
    ].forEach(function (d) { rk.appendChild(kpiTile(d)); });

    /* ---- heat map: trade x risk type ---- */
    var types = R.byType.map(function (x) { return x.type; });
    var host = document.getElementById('riskHeat'); host.innerHTML = '';
    var moreBtn = document.getElementById('riskHeatMore');
    if (!R.total) {
      host.appendChild(el('p', 'empty', 'No open high-risk activities are planned in the selected range.'));
      moreBtn.hidden = true; document.getElementById('riskHeatKey').innerHTML = '';
    } else {
      var tbl = el('table', 'heat'), thead = el('thead'), hr = el('tr');
      hr.appendChild(el('th', null, ''));
      R.byType.forEach(function (x) {
        var th = el('th'), box = el('div', 'ht-type');
        box.appendChild(riskIcon(x.type)); box.appendChild(el('span', null, x.type));
        makePick(box, rl({ riskType: x.type }, x.type + ': high-risk activities'), false);
        box.title = x.type + ': ' + plural(x.count, 'activity', 'activities') + ' · click to list them';
        th.appendChild(box); hr.appendChild(th);
      });
      hr.appendChild(el('th', 'num', 'Activities'));
      thead.appendChild(hr); tbl.appendChild(thead);
      var tb = el('tbody'), shown = riskHeatAll ? R.byTrade : R.byTrade.slice(0, RISK_HEAT_ROWS);
      shown.forEach(function (row) {
        var tr = el('tr'), name = el('th', 'ht-trade', row.trade);
        name.title = row.trade + ': ' + plural(row.total, 'activity', 'activities') + ' · click to list them';
        makePick(name, rl({ trade: row.trade }, row.trade + ': high-risk activities'), false);
        tr.appendChild(name);
        types.forEach(function (ty) {
          var v = row.cells[ty] || 0, td = el('td', 'hc' + (v ? '' : ' zero'), v ? C.fmtNum(v) : '·');
          if (v) {
            var p = R.maxCell ? v / R.maxCell : 0;
            td.style.background = 'color-mix(in srgb, var(--risk) ' + Math.round(14 + 80 * p) + '%, var(--card))';
            if (p > 0.55) td.classList.add('hot');
            td.title = row.trade + ' · ' + ty + ': ' + plural(v, 'activity', 'activities');
            makePick(td, rl({ trade: row.trade, riskType: ty }, row.trade + ' · ' + ty), false);
          }
          tr.appendChild(td);
        });
        var tot = el('td', 'hc tot', C.fmtNum(row.total));
        makePick(tot, rl({ trade: row.trade }, row.trade + ': high-risk activities'), false);
        tr.appendChild(tot);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      var tf = el('tfoot'), fr = el('tr');
      fr.appendChild(el('th', null, 'All trades'));
      R.byType.forEach(function (x) { fr.appendChild(el('td', 'hc', C.fmtNum(x.count))); });
      fr.appendChild(el('td', 'hc', C.fmtNum(R.total)));
      tf.appendChild(fr); tbl.appendChild(tf);
      host.appendChild(tbl);
      moreBtn.hidden = R.byTrade.length <= RISK_HEAT_ROWS;
      moreBtn.textContent = riskHeatAll ? 'Show the top ' + RISK_HEAT_ROWS + ' trades' : 'Show all ' + C.fmtNum(R.byTrade.length) + ' trades';
      moreBtn.onclick = function () { riskHeatAll = !riskHeatAll; renderRisk(V, S, rangeText); };
      var key = document.getElementById('riskHeatKey'); key.innerHTML = '';
      key.appendChild(el('span', null, '1')); key.appendChild(el('span', 'heat-ramp')); key.appendChild(el('span', null, C.fmtNum(R.maxCell)));
      key.appendChild(el('span', null, '· activities per trade and type. An activity with several types counts under each.'));
    }
    setText('riskHeatDesc', R.total ? plural(R.trades, 'trade') + ' × ' + plural(types.length, 'risk type') + (R.byTrade.length > RISK_HEAT_ROWS && !riskHeatAll ? ' · the ' + RISK_HEAT_ROWS + ' trades with the most shown' : '') : '');
    ensureListBtn('riskHeatDesc', R.total ? rl({}, 'High-risk activities') : null);

    /* ---- one card per risk type: count, flags, top trades and locations ---- */
    var tg = document.getElementById('riskTypes'); tg.innerHTML = '';
    setText('riskTypesDesc', R.byType.length ? 'Open activities per type, with the trades and locations carrying them' : '');
    if (!R.byType.length) tg.appendChild(el('p', 'empty', 'No high-risk types in the selected range.'));
    R.byType.forEach(function (x) {
      var card = el('div', 'card rt-card'), head = el('div', 'rt-head');
      head.appendChild(riskIcon(x.type)); head.appendChild(el('div', 'rt-name', x.type)); head.appendChild(el('div', 'rt-n', C.fmtNum(x.count)));
      makePick(head, rl({ riskType: x.type }, x.type + ': high-risk activities'));
      card.appendChild(head);
      var flags = el('div', 'rt-flags');
      if (x.started) flags.appendChild(chip('In progress', x.started, 'r-started', null, rl({ riskType: x.type, pred: 'started' }, x.type + ': in progress')));
      if (x.lateStart) flags.appendChild(chip('Should have started', x.lateStart, 's-fail', null, rl({ riskType: x.type, pred: 'lateStart' }, x.type + ': should have started')));
      if (x.overdue) flags.appendChild(chip('Past finish', x.overdue, 's-fail', null, rl({ riskType: x.type, pred: 'overdue' }, x.type + ': past planned finish')));
      if (!flags.children.length) flags.appendChild(chip('All planned ahead', null, 's-ok'));
      card.appendChild(flags);
      function rows(cap, list, specOf) {
        var box = el('div', 'rt-rows'); box.appendChild(el('div', 'rt-cap', cap));
        list.slice(0, 3).forEach(function (g) {
          var r = el('div', 'rt-row'), bar = el('div', 'rt-bar'), fill = el('span');
          fill.style.width = Math.max(4, Math.round(100 * g.count / x.count)) + '%'; bar.appendChild(fill);
          var l = el('span', 'rt-l', g.label); l.title = g.label;
          r.appendChild(l); r.appendChild(bar); r.appendChild(el('span', 'rt-c', C.fmtNum(g.count)));
          if (specOf) makePick(r, specOf(g), false);
          box.appendChild(r);
        });
        if (list.length > 3) box.appendChild(el('div', 'cell-note', '+ ' + plural(list.length - 3, cap === 'Trades' ? 'more trade' : 'more location')));
        card.appendChild(box);
      }
      rows('Trades', x.trades, function (g) { return rl({ riskType: x.type, trade: g.label }, g.label + ' · ' + x.type); });
      rows('Locations', x.locations, null);
      tg.appendChild(card);
    });

    /* ---- look-ahead: active per week by readiness ---- */
    var W = R.weeks, STATES = [['started', 'In progress', 'r-started'], ['ready', 'Ready', 'r-ready'], ['notReady', 'Not ready', 'r-notready']];
    setText('riskWeeksDesc', W.length ? 'Open high-risk activities active each week (planned start to end), by status today · the current week shaded' : '');
    riskWeeksSpec = {
      labels: W.map(function (w) { return weekLabel(w.week); }), band: W.map(function (w) { return w.isNow; }),
      stacked: true, showLabels: true, axisTitles: ['Activities', ''], emptyText: 'No open high-risk activities in the selected range.',
      columns: STATES.map(function (k) {
        return { name: k[1], cls: k[2], values: W.map(function (w) { return w[k[0]]; }),
                 tips: W.map(function (w) { return weekLabel(w.week) + ', ' + fmtRange(w.start, w.end) + ': ' + C.fmtNum(w[k[0]]) + ' ' + k[1].toLowerCase() + ' of ' + C.fmtNum(w.total) + ' active'; }),
                 picks: W.map(function (w) { return w[k[0]] ? rl({ state: k[0], start: w.start, end: w.end }, 'High-risk activities active ' + weekLabel(w.week) + ', ' + k[1].toLowerCase(), fmtRange(w.start, w.end)) : null; }) };
      })
    };
    C.comboChart(document.getElementById('riskWeeksChart'), riskWeeksSpec);
    var lg = document.getElementById('riskWeeksLegend'); lg.innerHTML = '';
    STATES.forEach(function (k) { lg.appendChild(chip(k[1], R.rows.filter(function (r) { return r.state === k[0]; }).length, k[2])); });
    ensureListBtn('riskWeeksDesc', R.total ? rl({}, 'High-risk activities by week') : null);

    /* ---- next to start: not started, by effective start; late starts first ---- */
    var next = R.rows.filter(function (r) { return !r.started; }).sort(function (a, b) { return a.es.localeCompare(b.es) || (a.t.n || '').localeCompare(b.t.n || ''); });
    var NB = document.getElementById('riskNextBody'); NB.innerHTML = '';
    setText('riskNextDesc', next.length ? plural(next.length, 'activity', 'activities') + ' not started' + (next.length > 8 ? ', the first 8 by planned start' : '') : 'Nothing waiting to start');
    ensureListBtn('riskNextDesc', next.length ? rl({ pred: 'all' }, 'High-risk activities by start date') : null);
    if (!next.length) emptyRow(NB, 5, 'Every open high-risk activity in the range has started.');
    next.slice(0, 8).forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(nameCell(r.t.n, [r.t.id ? '#' + r.t.id : null, r.t.l].filter(Boolean).join(' · ')));
      var rc = el('td'), w = el('div', 'risk-cell'); r.types.forEach(function (x) { w.appendChild(riskIcon(x, true)); }); rc.appendChild(w); tr.appendChild(rc);
      tr.appendChild(textCell(r.t.tr || UN));
      var sd = dateCell(r.es); if (r.lateStart) sd.appendChild(el('div', 'cell-note tone-text-bad', 'should have started')); tr.appendChild(sd);
      tr.appendChild(statusCell(r.t.st));
      NB.appendChild(tr);
    });
  }

  function renderView(V, S, ctx) {
    var data = ctx.data, M = ctx.M, win = fmtRange(V.l6w.from, V.l6w.to), rangeText = fmtRange(V.range.from, V.range.to);
    var T = V.totals, A6 = V.activity, TN = V.tones, CN = V.constraints, hasCommitted = V.feeds.committed;
    CUR.V = V; CUR.data = data;

    /* ---- filter summary ---- */
    function dimText(key, noun) { return S[key] ? (Object.keys(S[key]).length === 1 ? Object.keys(S[key])[0] : Object.keys(S[key]).length + ' of ' + ctx.opts[key].length + ' ' + plurals(noun)) : 'all ' + plurals(noun); }
    /* live counts in the top panel */
    var PT = T.project;
    setText('hpActs', C.fmtNum(PT.activities));
    setText('hpTrades', C.fmtNum(PT.trades));
    /* the same count as the Constraints page: open, with a target date in the selected range */
    var CC = ctx.consCN;
    setText('hpOpenCons', CC ? C.fmtNum(CC.open) : '—');
    var dimList = S.page === 'constraints' ? [dimText('cat', 'category'), dimText('ctrade', 'trade'), dimText('cown', 'owner')]
                : S.page === 'lookahead' ? [dimText('trade', 'trade'), dimText('loc', 'location'), dimText('org', 'organisation')]
                : S.page === 'risk' ? [dimText('rtype', 'risk type'), dimText('trade', 'trade'), dimText('loc', 'location'), dimText('org', 'organisation')]
                : [dimText('org', 'organisation'), dimText('trade', 'trade'), dimText('loc', 'location')];
    var dims = dimList.filter(function (t) { return t.indexOf('all ') !== 0; }).map(function (t) { return ' · ' + t; }).join('');
    setText('fSummary', (S.page === 'constraints'
      ? 'Constraints filters · ' + (CN ? plural(CN.total, 'constraint') + ' with a target in ' + rangeText : 'no constraint feed')
      : S.page === 'lookahead'
      ? 'Look-ahead filters · ' + plural(V.lookahead.total, 'activity', 'activities') + ' planned to start or finish in ' + rangeText
      : S.page === 'risk'
      ? 'High-risk filters · ' + (V.risk ? plural(V.risk.total, 'open high-risk activity', 'open high-risk activities') + ' planned in ' + rangeText : 'no high-risk activities flagged')
      : 'Performance filters · ' + C.fmtNum(T.tasks) + ' of ' + C.fmtNum(T.allTasks) + ' activities planned to finish in ' + rangeText
        + (hasCommitted ? ' · ' + C.fmtNum(V.commitmentRows) + ' commitments' : '')) + dims);

    /* the High-risk tab badge follows the High-risk page's own filters */
    var RB0 = ctx.risk, rbadge = document.getElementById('tabRiskBadge'), rlate = RB0 ? RB0.lateStart + RB0.overdue - RB0.rows.filter(function (r) { return r.lateStart && r.overdue; }).length : 0;
    rbadge.hidden = !rlate;
    if (rlate) { rbadge.textContent = C.fmtNum(rlate) + ' late'; rbadge.className = 'tab-badge tone-bad'; rbadge.title = rlate + ' open high-risk activities that should have started or are past their planned finish, under the High-risk filters'; }
    if (S.page === 'risk' && V.risk) renderRisk(V, S, rangeText);
    if (S.page === 'lookahead') renderLookahead(V, S, rangeText, ctx);

    /* ---- weekly committed PPC: kept / missed columns, PPC line ---- */
    var weeks = V.weeks;
    ppcSpec = {
      labels: weeks.map(function (w) { return weekLabel(w.week); }),
      band: weeks.map(function (w) { return w.inWindow; }),
      axisTitles: ['Activities', 'Committed PPC'],
      showLabels: true,
      emptyText: hasCommitted ? 'No commitments end in the selected range.' : 'No commitment feed is configured for this project.',
      columns: [
        { name: 'Successful', cls: 'kept', values: weeks.map(function (w) { return w.committed ? w.committed.successful : null; }),
          tips: weeks.map(function (w) { var c = w.committed || {}; return weekLabel(w.week) + ' (' + fmtRange(w.start, w.end) + '): ' + C.fmtNum(c.successful) + ' successful of ' + C.fmtNum(c.total) + ' committed'; }),
          picks: weeks.map(function (w) { return w.committed && w.committed.successful ? lister({ type: 'commits', week: w.week, ok: true }, 'Successful commitments, ' + weekLabel(w.week), fmtRange(w.start, w.end) + ' · finished in the committed week') : null; }) },
        { name: 'Unsuccessful', cls: 'missed', values: weeks.map(function (w) { return w.committed ? w.committed.unsuccessful : null; }),
          tips: weeks.map(function (w) { var c = w.committed || {}; return weekLabel(w.week) + ' (' + fmtRange(w.start, w.end) + '): ' + C.fmtNum(c.unsuccessful) + ' unsuccessful of ' + C.fmtNum(c.total) + ' committed'; }),
          picks: weeks.map(function (w) { return w.committed && w.committed.unsuccessful ? lister({ type: 'commits', week: w.week, ok: false }, 'Unsuccessful commitments, ' + weekLabel(w.week), fmtRange(w.start, w.end) + ' · not finished in the committed week') : null; }) }
      ],
      line: { name: 'Committed PPC', cls: 'ppc', values: weeks.map(function (w) { return w.committed && w.committed.total ? w.committed.pct : null; }),
              tips: weeks.map(function (w) { var c = w.committed || {}; return 'Committed PPC ' + weekLabel(w.week) + ': ' + C.fmtPct(c.pct) + ' (' + C.fmtNum(c.successful) + ' of ' + C.fmtNum(c.total) + ')'; }),
              picks: weeks.map(function (w) { return w.committed && w.committed.total ? lister({ type: 'commits', week: w.week }, 'Commitments, ' + weekLabel(w.week), fmtRange(w.start, w.end) + ' · ' + C.fmtPct(w.committed.pct) + ' successful') : null; }) },
      target: data.ppc.targetPct
    };
    C.comboChart(document.getElementById('ppcChart'), ppcSpec);
    ensureListBtn('ppcDesc', hasCommitted ? lister({ type: 'commits' }, 'All commitments in the range', rangeText) : null);
    var pt = document.getElementById('ppcTable'); pt.innerHTML = '';
    if (!hasCommitted || !weeks.length) emptyRow(pt, 6, hasCommitted ? 'No commitments end in the selected range.' : 'No commitment feed is configured for this project.');
    weeks.forEach(function (w) {
      var c = w.committed || {};
      var tr = el('tr', w.inWindow ? 'in-window' : null);
      tr.appendChild(el('td', null, weekLabel(w.week) + (w.inWindow ? ' •' : '')));
      tr.appendChild(el('td', 'cell-sub num-left', fmtRange(w.start, w.end)));
      tr.appendChild(el('td', 'num', C.fmtNum(c.total)));
      tr.appendChild(el('td', 'num', C.fmtNum(c.successful)));
      tr.appendChild(el('td', 'num', C.fmtNum(c.unsuccessful)));
      var pc = el('td', 'num');
      var tolP = (data.tolerance && data.tolerance.ppc) || {};
      var wTone = c.pct >= (tolP.good || [0, 80])[1] ? 'good' : (c.pct >= (tolP.watch || [0, 65])[1] ? 'warn' : 'bad');
      if (c.total) pc.appendChild(pill(C.fmtPct(c.pct), wTone));
      else pc.textContent = '—';
      tr.appendChild(pc);
      pt.appendChild(tr);
    });
    var lg = document.getElementById('ppcLegend'); lg.innerHTML = '';
    [['sq kept', 'Successful (finished in the committed week)'], ['sq missed', 'Unsuccessful'], ['', 'Committed PPC'], ['target', 'Target ' + C.fmtPct(data.ppc.targetPct)], ['band', 'Last six weeks']]
      .forEach(function (k) { var s = el('span'); s.appendChild(el('span', 'key ' + k[0])); s.appendChild(document.createTextNode(k[1])); lg.appendChild(s); });
    setText('ppcDesc', 'Activities per committed week, ' + rangeText + ' · ' + (hasCommitted ? C.fmtNum(V.committedAll.successful) + ' successful, ' + C.fmtNum(V.committedAll.unsuccessful) + ' unsuccessful' : 'no commitment feed'));

    /* ---- last six weeks tiles (range ∩ window, as CALCULATE(..., IsLastSixWeeks) does) ---- */
    setText('l6wDesc', V.l6w.valid
      ? win + ' · ' + C.fmtNum(A6.tasksInWindow) + ' activities planned to finish in the window' + (V.l6w.from !== M.facts.window.from || V.l6w.to !== M.facts.window.to ? ' (the six-week window clipped to the selected range)' : '')
      : 'The selected range does not overlap the last six weeks (' + fmtRange(M.facts.window.from, M.facts.window.to) + '), so these measures have nothing to show.');
    var tiles = [
      (function () {
        var LW = V.tradePerformance, has = !!(LW && LW.week), o = has ? LW.overall : null, po = has ? LW.previousOverall : null;
        var d = o && po && po.total && o.pct !== null && po.pct !== null ? Math.round((o.pct - po.pct) * 10) / 10 : null;
        return { label: 'Last week PPC', value: C.fmtPct(o ? o.pct : null), tone: TN.lastWeek,
                 sub: has ? weekLabel(LW.week) + ' · ' + C.fmtNum(o.successful) + ' of ' + C.fmtNum(o.total) + ' successful' + (d === null ? '' : ' · ' + (d >= 0 ? '▲ ' : '▼ ') + fmtPts(d) + ' on ' + weekLabel(LW.previousWeek))
                          : (hasCommitted ? 'No complete committed week in the range' : 'No commitment feed is configured'),
                 pick: has ? lister({ type: 'commits', week: LW.week }, 'Commitments, last committed week', weekLabel(LW.week) + ', ' + fmtRange(LW.start, LW.end)) : null };
      })(),
      { label: '6-week rolling PPC', value: C.fmtPct(V.running), tone: TN.ppcRunning, sub: 'Mean of the weekly committed PPCs in the window',
        pick: V.running !== null ? lister({ type: 'commits', l6w: true }, 'Commitments in the last six weeks', win) : null },
      { label: 'Avg. planned duration', value: fmtDays(A6.avgPlannedDuration), tone: TN.plannedDuration, sub: 'Planned working days per activity',
        pick: A6.tasksInWindow ? lister({ type: 'tasks', set: 'l6w', pred: 'duration' }, 'Activities planned to finish in the window', win) : null },
      { label: 'Weekly planned activities', value: C.fmtNum(A6.avgPerWeek), tone: TN.weeklyPlanned, sub: 'Mean number of activities planned to finish per week',
        pick: A6.tasksInWindow ? lister({ type: 'tasks', set: 'l6w', pred: 'all' }, 'Activities planned to finish in the window', win) : null }
    ];
    var kp = document.getElementById('kpis'); kp.innerHTML = '';
    tiles.forEach(function (d) { kp.appendChild(kpiTile(d)); });

    /* ---- performance, last committed week, by trade (default) or organisation:
            summary, tiers, the worst 8 as bars, the rest as chips ---- */
    function drawPerformance() {
      var isOrg = perfDim === 'organisation';
      var TP = isOrg ? V.orgPerformance : V.tradePerformance;
      var noun = isOrg ? 'organisation' : 'trade', Noun = isOrg ? 'Organisation' : 'Trade';
      ['perfTabTrade', 'perfTabOrg'].forEach(function (id) {
        var b = document.getElementById(id), on = b.getAttribute('data-dim') === perfDim;
        b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      });
      setText('tradeTitle', Noun + ' performance, last committed week');
      var stats = document.getElementById('tradeStats'), tiers = document.getElementById('tradeTiers'), tierLg = document.getElementById('tradeTierLegend');
      var bars = document.getElementById('tradeBars'), rest = document.getElementById('tradeRest');
      [stats, tiers, tierLg, bars, rest].forEach(function (n) { n.innerHTML = ''; });
      var hasWeek = !!(TP && TP.week);
      document.getElementById('tradeTierWrap').hidden = !hasWeek;
      document.getElementById('tradeBarsTitle').hidden = !hasWeek;
      if (!hasWeek) {
        setText('tradeDesc', hasCommitted ? 'No complete committed week in the selected range' : 'no commitment feed');
        ensureListBtn('tradeDesc', null);
        bars.appendChild(el('div', 'empty', hasCommitted ? 'No commitments ended in a complete week of the selected range.' : 'No commitment feed is configured for this project.'));
        return;
      }
      var ov = TP.overall, pov = TP.previousOverall;
      var ppcTol = (data.tolerance && data.tolerance.ppc) || {};
      var goodBand = (ppcTol.good || [null, 80])[1], watchBand = (ppcTol.watch || [null, 65])[1];
      setText('tradeDesc', weekLabel(TP.week) + ', ' + fmtRange(TP.start, TP.end) + ' · ' + plural(TP.groups, noun) + ', ' + C.fmtNum(ov.total) + ' commitments');
      var below = TP.rows.filter(function (r) { return r.tone === 'bad' || r.tone === 'warn'; });
      var missedBelow = below.reduce(function (x, r) { return x + r.unsuccessful; }, 0);
      var dOv = pov.total && ov.pct !== null && pov.pct !== null ? Math.round((ov.pct - pov.pct) * 10) / 10 : null;
      var wk = weekLabel(TP.week), wkSub = wk + ', ' + fmtRange(TP.start, TP.end);
      function labelsOf(list) { return list.map(function (r) { return r.label; }); }
      function grp(groups, ok, title) { return groups.length ? lister({ type: 'commits', week: TP.week, by: perfDim, groups: groups, ok: ok }, title, wkSub) : null; }
      var critical = TP.rows.filter(function (r) { return r.tone === 'bad'; });
      ensureListBtn('tradeDesc', lister({ type: 'commits', week: TP.week }, 'Commitments, ' + wk, wkSub));
      var ovTone = ov.pct === null ? 'inert' : (ov.pct >= goodBand ? 'good' : (ov.pct >= watchBand ? 'warn' : 'bad'));
      [
        { v: C.fmtPct(ov.pct), l: 'Committed PPC', cls: 'tone-text-' + ovTone, pick: lister({ type: 'commits', week: TP.week }, 'Commitments, ' + wk, wkSub),
          s: C.fmtNum(ov.successful) + ' of ' + C.fmtNum(ov.total) + ' successful' + (dOv === null ? '' : ' · ' + (dOv >= 0 ? '▲ ' : '▼ ') + fmtPts(dOv) + ' on ' + weekLabel(TP.previousWeek)) },
        { v: C.fmtNum(below.length) + ' / ' + C.fmtNum(TP.groups), l: Noun + 's below ' + C.fmtPct(goodBand), cls: 'tone-text-' + (below.length ? 'warn' : 'good'),
          pick: grp(labelsOf(below), null, 'Commitments of ' + noun + 's below ' + C.fmtPct(goodBand)),
          s: C.fmtPct(TP.groups ? 100 * below.length / TP.groups : null) + ' of ' + noun + 's with commitments' },
        { v: C.fmtNum(TP.critical), l: 'Critical, under ' + C.fmtPct(watchBand), cls: 'tone-text-' + (TP.critical ? 'bad' : 'good'),
          pick: grp(labelsOf(critical), null, 'Commitments of ' + noun + 's in the critical band'),
          s: TP.critical ? plural(TP.critical, noun) + ' successful on less than ' + C.fmtPct(watchBand) : 'no ' + noun + ' in the critical band' },
        { v: C.fmtNum(missedBelow) + ' / ' + C.fmtNum(ov.unsuccessful), l: 'Unsuccessful by those ' + noun + 's', cls: '',
          pick: missedBelow ? grp(labelsOf(below), false, 'Unsuccessful commitments of ' + noun + 's below ' + C.fmtPct(goodBand)) : null,
          s: ov.unsuccessful ? C.fmtPct(100 * missedBelow / ov.unsuccessful) + ' of the week\'s unsuccessful commitments' : 'nothing was unsuccessful this week' }
      ].forEach(function (d) {
        var b = el('div', 'tp-stat');
        b.appendChild(el('div', 'tp-stat-v ' + d.cls, d.v));
        b.appendChild(el('div', 'tp-stat-l', d.l));
        b.appendChild(el('div', 'tp-stat-s', d.s));
        if (d.pick) makePick(b, d.pick);
        stats.appendChild(b);
      });

      var tierSegs = [
        { label: 'Good, ' + C.fmtPct(goodBand) + '+', count: TP.rows.length - below.length, cls: 's-ok', tone: 'good' },
        { label: 'Watch', count: below.length - TP.critical, cls: 's-warning', tone: 'warn' },
        { label: 'Critical, under ' + C.fmtPct(watchBand), count: TP.critical, cls: 's-fail', tone: 'bad' }
      ];
      tierSegs.forEach(function (t) { t.pick = grp(labelsOf(TP.rows.filter(function (r) { return r.tone === t.tone; })), null, 'Commitments of ' + noun + 's rated ' + t.label); });
      C.stackedTrack(tiers, tierSegs.map(function (t) { return { label: t.label, count: t.count, cls: t.cls, tip: t.label + ': ' + plural(t.count, noun), pick: t.pick }; }));
      tierSegs.forEach(function (t) { tierLg.appendChild(chip(t.label, t.count, t.cls, null, t.count ? t.pick : null)); });

      /* the groups that cost the most: below target, ranked by commitments missed, then by PPC */
      var ranked = below.slice().sort(function (x, y) { return y.unsuccessful - x.unsuccessful || (x.pct || 0) - (y.pct || 0) || x.label.localeCompare(y.label); });
      var top = ranked.slice(0, 8), others = ranked.slice(8);
      setText('tradeBarsTitle', below.length ? 'Below target, most unsuccessful commitments first' : 'Every ' + noun + ' was successful on at least ' + C.fmtPct(goodBand) + ' of its commitments');
      if (top.length) {
        C.barRows(bars, top.map(function (r) {
          var change = r.delta === null ? (r.previousTotal ? '' : ', nothing committed the week before')
            : ', ' + (r.delta >= 0 ? 'up ' : 'down ') + fmtPts(r.delta) + ' on ' + weekLabel(TP.previousWeek);
          return { label: r.label, total: r.total,
                   title: r.label + ': ' + C.fmtPct(r.pct) + ', ' + r.unsuccessful + ' of ' + r.total + ' unsuccessful' + change,
                   valueText: toneIcon(r.tone) + ' ' + C.fmtPct(r.pct) + ' · ' + r.successful + '/' + r.total, valueCls: 'tone-text-' + r.tone,
                   pick: grp([r.label], null, r.label + ': commitments, ' + wk),
                   parts: [{ count: r.successful, cls: 's-ok', label: 'Successful', pick: grp([r.label], true, r.label + ': successful commitments, ' + wk) },
                           { count: r.unsuccessful, cls: 's-fail', label: 'Unsuccessful', pick: grp([r.label], false, r.label + ': unsuccessful commitments, ' + wk) }] };
        }), { rowCls: 'tp-row' });
      }
      function chipGroup(title, list) {
        if (!list.length) return;
        var wrap = el('div', 'tp-rest');
        wrap.appendChild(el('div', 'tp-sub', title));
        var cs = el('div', 'chips');
        list.forEach(function (r) {
          cs.appendChild(chip(r.label, C.fmtPct(r.pct) + ' · ' + r.successful + '/' + r.total,
            r.tone === 'bad' ? 's-fail' : (r.tone === 'warn' ? 's-warning' : 's-ok'),
            r.label + ' (' + TONE_WORD[r.tone] + '): ' + r.successful + ' of ' + r.total + ' successful' + (r.previousTotal ? ', ' + C.fmtPct(r.previousPct) + ' the week before' : ''),
            grp([r.label], null, r.label + ': commitments, ' + wk)));
        });
        wrap.appendChild(cs);
        rest.appendChild(wrap);
      }
      chipGroup('Also below target' + (others.length ? ' · ' + others.length : ''), others);
      var onTarget = TP.rows.filter(function (r) { return r.tone === 'good'; });
      chipGroup('On target · ' + onTarget.length, TP.rows.filter(function (r) { return r.tone === 'good'; }).sort(function (x, y) { return y.total - x.total || x.label.localeCompare(y.label); }));
    }
    ['perfTabTrade', 'perfTabOrg'].forEach(function (id) {
      var b = document.getElementById(id);
      b.onclick = function () { perfDim = b.getAttribute('data-dim'); drawPerformance(); };
      b.onkeydown = function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        perfDim = perfDim === 'trade' ? 'organisation' : 'trade'; drawPerformance();
        document.getElementById(perfDim === 'trade' ? 'perfTabTrade' : 'perfTabOrg').focus();
      };
    });
    drawPerformance();

    /* ---- reasons for variance by trade, activities that missed a commitment ---- */
    var RB = V.reasonsByTrade;
    var rbtBars = document.getElementById('rbtBars'), rbtOthers = document.getElementById('rbtOthers'), rbtLegend = document.getElementById('rbtLegend');
    rbtOthers.innerHTML = ''; rbtLegend.innerHTML = '';
    var noReasonNote = RB && RB.withoutReason ? C.fmtNum(RB.withoutReason) + ' of ' + C.fmtNum(RB.missed) + ' unsuccessful activities have no recorded reason and are left out' : '';
    if (!RB || !RB.activities) {
      setText('rbtDesc', !hasCommitted ? 'no commitment feed' : (RB && RB.missed ? noReasonNote : 'No unsuccessful commitments in the selected range'));
      ensureListBtn('rbtDesc', null);
      rbtBars.innerHTML = ''; rbtBars.appendChild(el('div', 'empty', !hasCommitted ? 'No commitment feed is configured for this project.'
        : (RB && RB.missed ? 'None of the unsuccessful activities in the selected range has a reason recorded in its history.' : 'No unsuccessful activities in the selected range.')));
      rbtOthers.hidden = true; document.getElementById('rbtHr').hidden = true;
    } else {
      setText('rbtDesc', C.fmtNum(RB.activities) + ' unsuccessful activities with a recorded reason in ' + rangeText + (noReasonNote ? ' · ' + noReasonNote : ''));
      var legendOrder = [];
      function foldParts(parts) {
        var m = {};
        parts.forEach(function (p) { var k = ctx.catFold(p.label); m[k] = (m[k] || 0) + p.count; });
        return Object.keys(m).sort(function (x, y) { return legendOrder.indexOf(x) - legendOrder.indexOf(y); }).map(function (k) { return { label: k, count: m[k], cls: ctx.catCls(k) }; });
      }
      var folded = {};
      RB.categories.forEach(function (c) { var k = ctx.catFold(c.label); folded[k] = (folded[k] || 0) + c.count; });
      legendOrder = Object.keys(folded).sort(function (x, y) {
        var rx = x === ctx.noneLabel ? 2 : (x === 'Other categories' ? 1 : 0), ry = y === ctx.noneLabel ? 2 : (y === 'Other categories' ? 1 : 0);
        return rx - ry || folded[y] - folded[x] || x.localeCompare(y);
      });
      var top = RB.rows.slice(0, 8), rest = RB.rows.slice(8);
      function rawCats(k) { return RB.categories.map(function (c) { return c.label; }).filter(function (l) { return ctx.catFold(l) === k; }); }
      function missedList(trade, k) {
        var spec = { type: 'missed' };
        if (trade) { spec.by = 'trade'; spec.groups = [trade]; }
        if (k) spec.categories = rawCats(k);
        return lister(spec, (trade ? trade + ': ' : '') + (k ? k + ', ' : '') + 'unsuccessful activities with a recorded reason', rangeText);
      }
      ensureListBtn('rbtDesc', missedList(null, null));
      C.barRows(rbtBars, top.map(function (r) {
        var parts = foldParts(r.parts).map(function (p) { p.pick = missedList(r.trade, p.label); return p; });
        return { label: r.trade, total: r.activities, valueText: C.fmtNum(r.activities), parts: parts, pick: missedList(r.trade, null) };
      }), { emptyText: 'No unsuccessful activities in the selected range.' });
      rbtOthers.hidden = !rest.length; document.getElementById('rbtHr').hidden = !rest.length;
      rest.forEach(function (r) { rbtOthers.appendChild(chip(r.trade, r.activities, null, r.parts.map(function (p) { return p.label + ' ' + p.count; }).join(', '), missedList(r.trade, null))); });
      legendOrder.forEach(function (k) { rbtLegend.appendChild(chip(k, folded[k], ctx.catCls(k), k === 'Other categories' ? 'Categories outside the eight most frequent' : null, missedList(null, k))); });
    }

    /* ---- reasons for variance ---- */
    var R = V.reasons;
    function drawReasons() {
      var isEv = reasonView === 'events', slices;
      ['rvTabReasons', 'rvTabEvents'].forEach(function (id) {
        var b = document.getElementById(id), on = b.getAttribute('data-view') === reasonView;
        b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      });
      if (isEv) {
        /* Reasons Category: one slot per event, fixed by the configured order */
        slices = R.events.map(function (e, i) {
          return { label: e.label, count: e.tasks, cls: 'cat-' + (i % 8 + 1), tip: e.label + ': ' + C.fmtNum(e.tasks) + ' activities with this event in their history',
                   pick: e.tasks ? lister({ type: 'tasks', set: 'range', pred: 'event', event: e.label }, 'Activities with a "' + e.label + '" event', rangeText) : null };
        });
      } else {
        /* Reasons for variance: categories in fixed colour slots; anything past the eighth slot folds into Other */
        var folded = {}, detail = {};
        R.categories.forEach(function (c) {
          var k = ctx.catFold(c.label);
          folded[k] = (folded[k] || 0) + c.tasks;
          detail[k] = (detail[k] || []).concat(c.reasons.map(function (r) { return r.label + ' ' + r.tasks; }));
        });
        slices = Object.keys(folded).sort(function (x, y) { return (x === 'Other categories') - (y === 'Other categories') || folded[y] - folded[x] || x.localeCompare(y); })
          .map(function (k) {
            var raw = R.categories.map(function (c) { return c.label; }).filter(function (l) { return ctx.catFold(l) === k; });
            return { label: k, count: folded[k], cls: ctx.catCls(k), tip: k + ': ' + C.fmtNum(folded[k]) + ' activities · ' + detail[k].join(', '),
                     pick: lister({ type: 'tasks', set: 'range', pred: 'reason', categories: raw }, k + ': activities with this reason', rangeText) };
          });
      }
      var sum = slices.reduce(function (a, s) { return a + s.count; }, 0);
      var people = isEv ? sum : R.tasksWithReason;
      ensureListBtn('reasonsDesc', (isEv ? sum : R.tasksWithReason) ? lister({ type: 'tasks', set: 'range', pred: isEv ? 'event' : 'reason' },
        isEv ? 'Activities with a variance event' : 'Activities with a recorded reason', rangeText) : null);
      setText('reasonsDesc', isEv
        ? 'Variance events in the history of ' + C.fmtNum(R.tasks) + ' activities in the range'
        : C.fmtNum(R.tasksWithReason) + ' of ' + C.fmtNum(R.tasks) + ' activities in the range have a recorded reason');
      C.donut(document.getElementById('reasonPie'), slices, {
        center: C.fmtNum(people), centerSub: isEv ? 'events' : 'activities',
        emptyText: isEv ? 'No events in the range' : 'No reasons recorded'
      });
      document.getElementById('reasonPie').setAttribute('aria-label', (isEv ? 'Reason category' : 'Reasons for variance') + ': ' + slices.map(function (s) { return s.label + ' ' + s.count; }).join(', '));
      var lg = document.getElementById('reasonLegend'); lg.innerHTML = '';
      var maxCount = slices.reduce(function (m, s) { return Math.max(m, s.count); }, 0);
      slices.forEach(function (s) {
        var li = el('li', s.count ? null : 'zero');
        li.appendChild(el('span', 'swatch ' + s.cls));
        var lab = el('span', 'pl-label', s.label); lab.title = s.tip; li.appendChild(lab);
        li.appendChild(el('span', 'pl-n', C.fmtNum(s.count)));
        li.appendChild(el('span', 'pl-pct', sum ? C.fmtPct(100 * s.count / sum) : '—'));
        /* the rest of the row: a bar sized to this reason against the largest one */
        var bar = el('span', 'pl-bar'), fill = el('i', s.cls);
        fill.style.width = maxCount ? (100 * s.count / maxCount).toFixed(1) + '%' : '0%';
        bar.appendChild(fill); li.appendChild(bar);
        if (s.count && s.pick) makePick(li, s.pick, false);
        lg.appendChild(li);
      });
      if (!slices.length) lg.appendChild(el('li', 'zero', 'No reason for variance is recorded for the selected activities.'));
      if (!isEv && sum > R.tasksWithReason) {
        var note = el('li', 'pie-note', 'Shares are of ' + C.fmtNum(sum) + ' category mentions: an activity with reasons in several categories counts in each.');
        lg.appendChild(note);
      }
      var rs = document.getElementById('reasonStandard'); rs.innerHTML = '';
      R.standard.forEach(function (s) { rs.appendChild(chip(s.label, s.tasks, null, plural(s.tasks, 'activity', 'activities') + ' with a reason in the "' + s.label + '" standard group',
        lister({ type: 'tasks', set: 'range', pred: 'standard', group: s.label }, s.label + ': activities in this standard group', rangeText))); });
      document.getElementById('reasonStandardWrap').hidden = isEv || !R.standard.length;
    }
    ['rvTabReasons', 'rvTabEvents'].forEach(function (id) {
      var b = document.getElementById(id);
      b.onclick = function () { reasonView = b.getAttribute('data-view'); drawReasons(); };
      b.onkeydown = function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        reasonView = reasonView === 'reasons' ? 'events' : 'reasons'; drawReasons();
        document.getElementById(reasonView === 'reasons' ? 'rvTabReasons' : 'rvTabEvents').focus();
      };
    });
    drawReasons();

    /* ---- constraints ---- */
    var badge = document.getElementById('tabConstraintsBadge');
    badge.hidden = !CC || !CC.overdueCount;
    if (CC && CC.overdueCount) { badge.textContent = C.fmtNum(CC.overdueCount) + ' overdue'; badge.className = 'tab-badge tone-bad'; badge.title = CC.overdueCount + ' open constraints (no completion date) with a target date before today, under the Constraints filters'; }
    document.getElementById('consEmpty').hidden = !!CN;
    document.getElementById('consBody').hidden = !CN;
    setText('consDesc', CN ? C.fmtNum(CN.total) + ' constraints with a target in the range · overdue and on-time rates use targets in ' + win : 'no constraint feed');
    if (CN) {
      var ck = document.getElementById('consKpis'); ck.innerHTML = '';
      [
        { label: 'Constraints raised', value: C.fmtNum(CN.total), sub: 'With a target date in the selected range',
          pick: CN.total ? lister({ type: 'constraints' }, 'Constraints with a target in the range', rangeText) : null },
        { label: 'Open constraints', value: C.fmtNum(CN.open), sub: 'No completion date yet',
          pick: CN.open ? lister({ type: 'constraints', pred: 'open' }, 'Open constraints', rangeText + ' · not yet completed') : null },
        { label: 'Overdue now', value: C.fmtNum(CN.overdueCount), tone: CN.overdueCount ? 'bad' : 'good', sub: 'Open, with a target date before today',
          pick: CN.overdueCount ? lister({ type: 'constraints', pred: 'pastTarget' }, 'Overdue constraints', 'Open (no completion date) with a target before ' + C.fmtDate(V.today)) : null },
        { label: 'Constraints overdue', value: C.fmtPct(CN.overduePct), tone: TN.constraintsOverdue, sub: 'Share of last-six-week targets still open past their date',
          pick: CN.overduePct ? lister({ type: 'constraints', l6w: true, pred: 'overdue' }, 'Overdue constraints, last six weeks', win + ' · open, target date before today') : null },
        { label: 'Resolved on time', value: C.fmtPct(CN.resolvedOnTimePct), tone: TN.constraintsOnTime, sub: 'Share of last-six-week targets completed by their date',
          pick: CN.resolvedOnTimePct ? lister({ type: 'constraints', l6w: true, pred: 'onTime' }, 'Constraints resolved on time, last six weeks', win) : null },
        { label: 'Avg. time to resolve', value: fmtDays(CN.avgResolveDays), sub: 'Days from raised to completed, closed constraints',
          pick: CN.avgResolveDays !== null ? lister({ type: 'constraints', pred: 'closed' }, 'Closed constraints', rangeText + ' · raised to completed') : null },
        { label: 'Avg. age of open', value: fmtDays(CN.avgOpenAgeDays), sub: 'Days since raised, open constraints',
          pick: CN.avgOpenAgeDays !== null ? lister({ type: 'constraints', pred: 'open' }, 'Open constraints', rangeText + ' · days since raised') : null },
        { label: 'Avg. constraint lag', value: fmtDays(CN.avgLagDays), tone: TN.constraintLag, sub: 'Completion date minus target date, rounded up',
          pick: CN.avgLagDays !== null ? lister({ type: 'constraints', pred: 'lag' }, 'Completed constraints and their lag', rangeText + ' · completion minus target') : null },
        { label: 'Unlinked constraints', value: C.fmtPct(CN.unlinkedPct), tone: TN.unlinked, sub: 'Not linked to an activity',
          pick: CN.unlinkedPct ? lister({ type: 'constraints', pred: 'unlinked' }, 'Constraints not linked to an activity', rangeText) : null },
        { label: 'Resolved before start', value: C.fmtPct(CN.beforeStartPct), sub: C.fmtNum(CN.beforeStart) + ' of ' + C.fmtNum(CN.linked) + ' linked, before the activity\'s planned start',
          pick: CN.beforeStart ? lister({ type: 'constraints', pred: 'beforeStart' }, 'Constraints resolved before the activity\'s planned start', rangeText) : null }
      ].forEach(function (d) { ck.appendChild(kpiTile(d)); });
      var STATE = { closedOnTime: { label: 'Closed on time', cls: 'o-ontime' }, closedLate: { label: 'Closed late', cls: 'o-late' },
                    openNotDue: { label: 'Open, not yet due', cls: 'o-open' }, openOverdue: { label: 'Open, overdue', cls: 'o-overdue' } };
      function stateList(k) { return lister({ type: 'constraints', pred: 'state', value: k }, STATE[k].label + ' constraints', rangeText); }
      /* a donut with a compact legend: name, count and share; legend rows and slices open the list */
      function drawPie(svgId, ulId, slices, opts) {
        var svg = document.getElementById(svgId), lg = document.getElementById(ulId);
        var sum = slices.reduce(function (a, x) { return a + x.count; }, 0);
        C.donut(svg, slices, opts);
        svg.setAttribute('aria-label', opts.aria + ': ' + slices.map(function (x) { return x.label + ' ' + x.count; }).join(', '));
        lg.innerHTML = '';
        slices.forEach(function (x) {
          var li = el('li', x.count ? null : 'zero');
          li.appendChild(el('span', 'swatch ' + x.cls));
          var lab = el('span', 'pl-label', x.label); lab.title = x.label; li.appendChild(lab);
          li.appendChild(el('span', 'pl-n', C.fmtNum(x.count)));
          li.appendChild(el('span', 'pl-pct', sum ? C.fmtPct(100 * x.count / sum) : '—'));
          if (x.count && x.pick) makePick(li, x.pick, false);
          lg.appendChild(li);
        });
      }

      /* outcome donut */
      drawPie('consOutcomePie', 'consOutcomeLegend', CN.states.map(function (k) {
        return { label: STATE[k].label, count: CN.split[k], cls: STATE[k].cls, pick: stateList(k) };
      }), { aria: 'Constraint outcome', center: C.fmtNum(CN.total), centerSub: 'constraints', emptyText: 'No constraints in the range' });
      var closed = CN.split.closedOnTime + CN.split.closedLate;
      setText('consOutcomeDesc', closed ? C.fmtPct(100 * CN.split.closedOnTime / closed) + ' of closed constraints were on time' : 'None closed yet');
      ensureListBtn('consOutcomeDesc', CN.total ? lister({ type: 'constraints' }, 'All constraints in the range', rangeText) : null);

      /* category donut: the seven largest, the rest folded, and the uncategorised */
      var catSl = CN.byCategory.slice(0, 7).map(function (c, n) {
        return { label: c.label, count: c.count, cls: 'cat-' + (n + 1), pick: lister({ type: 'constraints', pred: 'category', value: c.label }, c.label + ': constraints', rangeText) };
      });
      var catRest = CN.byCategory.slice(7).reduce(function (a, c) { return a + c.count; }, 0);
      if (catRest) catSl.push({ label: 'Other categories', count: catRest, cls: 'cat-other' });
      if (CN.total - CN.categorised) catSl.push({ label: 'No category', count: CN.total - CN.categorised, cls: 'cat-none',
        pick: lister({ type: 'constraints', pred: 'noCategory' }, 'Constraints without a category', rangeText) });
      drawPie('consCatPie', 'consCatLegend', catSl, { aria: 'Constraints by category', center: C.fmtNum(CN.categorised), centerSub: 'categorised', emptyText: 'No constraints in the range' });
      setText('consCatDesc', C.fmtNum(CN.categorised) + ' of ' + C.fmtNum(CN.total) + ' have a category');

      /* priority donut */
      var prioCls = { High: 'cat-2', Medium: 'cat-1', Low: 'cat-3', 'No priority': 'cat-none' };
      drawPie('consPrioPie', 'consPrioLegend', CN.byPriority.map(function (x) {
        return { label: x.label, count: x.count, cls: prioCls[x.label] || 'cat-other', pick: lister({ type: 'constraints', pred: 'priority', value: x.label }, x.label + ' priority constraints', rangeText) };
      }), { aria: 'Constraints by priority', center: C.fmtNum(CN.total), centerSub: 'constraints', emptyText: 'No constraints in the range' });
      var hi = CN.byPriority.filter(function (x) { return x.label === 'High'; })[0];
      setText('consPrioDesc', hi ? plural(hi.count, 'high-priority constraint') : 'No high-priority constraints');

      /* ageing of open constraints, on the ordinal ramp */
      C.barRows(document.getElementById('consAgeing'), CN.ageing.map(function (b, n) {
        var pk = b.count ? lister({ type: 'constraints', pred: 'age', from: b.from, to: b.to }, 'Open constraints raised ' + b.label + ' ago', rangeText) : null;
        return { label: b.label, total: b.count, valueText: C.fmtNum(b.count), pick: pk, parts: [{ count: b.count, cls: 'age-' + Math.min(5, n + 1), label: 'Open constraints', pick: pk }] };
      }), { emptyText: 'No open constraints in the range.' });
      setText('consAgeDesc', CN.open ? 'Days since raised · ' + plural(CN.open, 'open constraint') : 'No open constraints in the range');

      /* by responsible organisation and by trade: the top eight as outcome stacks, the rest as chips */
      function groupBars(prefix, rows, pred, noun) {
        var top = rows.slice(0, 8), rest = rows.slice(8);
        function gl(g, k) { return lister({ type: 'constraints', pred: pred, value: g.label, state: k || null }, g.label + ': ' + (k ? STATE[k].label.toLowerCase() + ' ' : '') + 'constraints', rangeText); }
        C.barRows(document.getElementById(prefix), top.map(function (g) {
          var open = g.openNotDue + g.openOverdue;
          return { label: g.label, total: g.total, valueText: C.fmtNum(open) + ' / ' + C.fmtNum(g.total), pick: gl(g),
                   title: g.label + ': ' + open + ' open of ' + g.total + (g.openOverdue ? ', ' + g.openOverdue + ' overdue' : ''),
                   parts: CN.states.map(function (k) { return { count: g[k], cls: STATE[k].cls, label: STATE[k].label, pick: g[k] ? gl(g, k) : null }; }) };
        }), { emptyText: 'No constraints in the range.' });
        var more = document.getElementById(prefix + 'More'); more.innerHTML = '';
        more.hidden = document.getElementById(prefix + 'Hr').hidden = !rest.length;
        rest.forEach(function (g) { more.appendChild(chip(g.label, (g.openNotDue + g.openOverdue) + ' / ' + g.total, null, g.label + ': open / raised', gl(g))); });
        setText(prefix + 'Desc', 'Open / raised · ' + plural(rows.length, noun) + (rows.length > 8 ? ', the 8 with the most open shown' : ''));
      }
      groupBars('consOwner', CN.byOwner, 'owner', 'owner');
      groupBars('consTrade', CN.byTrade, 'trade', 'trade');
      var sk = document.getElementById('consStateLegend'); sk.innerHTML = '';
      CN.states.forEach(function (k) { sk.appendChild(chip(STATE[k].label, CN.split[k], STATE[k].cls, null, CN.split[k] ? stateList(k) : null)); });

      var cw = CN.weeks || [];
      setText('consWeeksDesc', 'Constraints due each week by target date, ' + rangeText + ' · ' + cw.filter(function (w) { return w.inWindow; }).reduce(function (a, w) { return a + w.due; }, 0) + ' due in the last six weeks (shaded)');
      function wl(w, state, what) { return lister({ type: 'constraints', pred: 'week', start: w.start, end: w.end, state: state }, 'Constraints due ' + weekLabel(w.week) + (what ? ', ' + what : ''), fmtRange(w.start, w.end)); }
      consWeeksSpec = {
        labels: cw.map(function (w) { return weekLabel(w.week); }), band: cw.map(function (w) { return w.inWindow; }),
        stacked: true, showLabels: true, axisTitles: ['Constraints', ''], emptyText: 'No constraint targets in the selected range.',
        columns: [['onTime', 'Completed by target', 'w-ontime'], ['late', 'Completed after target', 'w-late'], ['open', 'Still open', 'w-open']].map(function (k) {
          return { name: k[1], cls: k[2], values: cw.map(function (w) { return w[k[0]]; }),
                   tips: cw.map(function (w) { return weekLabel(w.week) + ', ' + fmtRange(w.start, w.end) + ': ' + C.fmtNum(w[k[0]]) + ' ' + k[1].toLowerCase() + ' of ' + C.fmtNum(w.due) + ' due'; }),
                   picks: cw.map(function (w) { return w[k[0]] ? wl(w, k[0], k[1].toLowerCase()) : null; }) };
        })
      };
      C.comboChart(document.getElementById('consWeeksChart'), consWeeksSpec);
      var cwl = document.getElementById('consWeeksLegend'); cwl.innerHTML = '';
      [['Completed by target', 's-ok', 'onTime'], ['Completed after target', 's-warning', 'late'], ['Still open', 's-fail', 'open']].forEach(function (k) {
        cwl.appendChild(chip(k[0], cw.reduce(function (a, w) { return a + w[k[2]]; }, 0), k[1]));
      });
      setText('consOverdueDesc', CN.overdueCount ? CN.overdueCount + ' open with a target date before today' + (CN.overdueCount > CN.overdue.length ? ', the ' + CN.overdue.length + ' most overdue shown' : '') : 'Nothing in the range is past its target date');
      ensureListBtn('consOverdueDesc', CN.overdueCount ? lister({ type: 'constraints', pred: 'pastTarget' }, 'Overdue constraints', 'Open (no completion date) with a target before ' + C.fmtDate(V.today)) : null);
      ensureListBtn('consWeeksDesc', CN.total ? lister({ type: 'constraints' }, 'Constraints by target week', rangeText) : null);
      var ob = document.getElementById('consOverdueBody'); ob.innerHTML = '';
      if (!CN.overdue.length) emptyRow(ob, 6, 'No overdue constraints in the selected range.');
      CN.overdue.forEach(function (r) {
        var tr = el('tr');
        var name = el('td', 'cell-name'); name.appendChild(el('div', null, r.title)); name.appendChild(el('div', 'cell-sub', r.taskName || 'not linked to an activity'));
        tr.appendChild(name);
        tr.appendChild(el('td', null, dash(r.category)));
        tr.appendChild(el('td', null, dash(r.owner)));
        tr.appendChild(el('td', 'num', C.fmtDate(r.target, true)));
        var od = el('td', 'num'); od.appendChild(el('span', 'age-chip ' + ageCls(r.overdueDays), C.fmtNum(r.overdueDays) + ' d')); tr.appendChild(od);
        tr.appendChild(el('td', null, r.status));
        ob.appendChild(tr);
      });
    }

  }

  /* ========================================================== landing page */
  /* The portfolio: a panel of portfolio totals, then one card per project, PPC first, as on the
     project page's default view (the 12-week trend range). Search, a band filter and a sort make a
     long list workable; the band and sort are remembered in this browser. */
  var BAND_WORD = { good: 'Good', warn: 'Watch', bad: 'Critical' };
  function freshness(p) {
    if (p.state === 'unavailable') return 'No data yet';
    if (p.state === 'stale') return 'Stale · data as of ' + C.fmtDate(p.dataAsOf, true);
    if (p.origin === 'sample') return 'Sample data';
    return 'Updated ' + fmtDateTime(p.dataAsOf || p.generatedAt);
  }
  function projectCard(p) {
    var a = el('a', 'card project-card' + (p.ppcRunningTone ? ' t-' + p.ppcRunningTone : ''));
    a.href = p.href;
    a.setAttribute('aria-label', p.title + ': open the dashboard');
    var head = el('div', 'pc-head');
    var tt = el('div'); tt.appendChild(el('div', 'eyebrow', p.client || '—')); tt.appendChild(el('h3', 'pc-title', p.title));
    head.appendChild(tt);
    if (p.state === 'unavailable') head.appendChild(pill('Pending', 'inert'));
    else if (p.projectStatus) {
      var tone = /complete|closed|finished/i.test(p.projectStatus) ? 'good' : (/hold|stopp|suspend/i.test(p.projectStatus) ? 'warn' : 'inert');
      var sp = pill(p.projectStatus, tone, tone === 'inert' ? '•' : null); sp.title = 'Project status'; head.appendChild(sp);
    }
    a.appendChild(head);
    if (p.state === 'unavailable') {
      a.appendChild(el('div', 'pc-pending', 'The first fetch from VisiLean has not completed yet.'));
    } else {
      var ppc = el('div', 'pc-ppc');
      [[p.lastWeekPpc, p.lastWeekTone, 'Last week PPC', p.lastWeek ? weekLabel(p.lastWeek) + ', the last complete committed week' : 'No complete committed week'],
       [p.ppcRunning, p.ppcRunningTone, '6-week rolling PPC', 'Mean of the weekly committed PPCs over the last six weeks']].forEach(function (m) {
        var b = el('div', 'pc-metric'); b.title = m[3];
        b.appendChild(el('div', 'pc-big' + (m[1] ? ' tone-text-' + m[1] : ''), C.fmtPct(m[0])));
        b.appendChild(el('div', 'pc-lbl', m[2]));
        if (m[1]) b.appendChild(pill(BAND_WORD[m[1]], m[1]));
        ppc.appendChild(b);
      });
      a.appendChild(ppc);
      var nums = el('div', 'pc-nums');
      [['Activities', C.fmtNum(p.tasks), 'Unique activities in the task history'],
       ['Trades', C.fmtNum(p.trades), 'Trades with at least one activity'],
       ['Open constraints', p.openConstraints === null || p.openConstraints === undefined ? '—' : C.fmtNum(p.openConstraints), 'No completion date, target in the 12-week range']].forEach(function (x) {
        var n = el('div', 'pc-num'); n.title = x[2];
        n.appendChild(el('div', 'pc-num-v', x[1]));
        n.appendChild(el('div', 'pc-num-l', x[0])); nums.appendChild(n);
      });
      a.appendChild(nums);
    }
    var foot = el('div', 'pc-foot');
    foot.appendChild(el('span', 'pc-fresh', freshness(p)));
    var open = el('span', 'pc-open', 'Open dashboard');
    open.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>');
    foot.appendChild(open);
    a.appendChild(foot);
    return a;
  }
  function renderLanding() {
    var meta = D.meta, projects = D.projects || [];
    renderBanner(meta);
    var asof = document.getElementById('asof');
    if (asof) asof.textContent = 'Built ' + fmtDateTime(meta.generatedAt);

    /* portfolio totals in the panel */
    /* the panel: total projects and how many sit in each 6-week rolling PPC band */
    setText('pfProjects', C.fmtNum(projects.length));

    /* search, band filter and sort; the band and sort are remembered in this browser */
    var store = {};
    try { store = JSON.parse(localStorage.getItem('dlr-portfolio') || '{}') || {}; } catch (e) { store = {}; }
    var st = { q: '', band: store.band || 'all', sort: ['ppc', 'open', 'name'].indexOf(store.sort) >= 0 ? store.sort : 'ppc' };
    function save() { try { localStorage.setItem('dlr-portfolio', JSON.stringify({ band: st.band, sort: st.sort })); } catch (e) { /* storage blocked */ } }
    var bands = [['all', 'All'], ['bad', 'Critical'], ['warn', 'Watch'], ['good', 'Good']];
    var sorts = [['ppc', 'Lowest PPC'], ['open', 'Most open constraints'], ['name', 'A–Z']];
    function segmented(host, items, key, counts) {
      host.innerHTML = '';
      items.forEach(function (it) {
        var b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', st[key] === it[0] ? 'true' : 'false');
        if (key === 'band' && it[0] !== 'all') b.appendChild(el('span', 'dot ' + it[0]));
        b.appendChild(document.createTextNode(it[1]));
        if (counts) b.appendChild(el('span', 'seg-n', C.fmtNum(counts[it[0]])));
        b.addEventListener('click', function () { st[key] = it[0]; save(); draw(); });
        host.appendChild(b);
      });
    }
    var bandCount = { all: projects.length, good: 0, warn: 0, bad: 0 };
    projects.forEach(function (p) { if (p.ppcRunningTone) bandCount[p.ppcRunningTone]++; });
    setText('pfBad', C.fmtNum(bandCount.bad)); setText('pfWarn', C.fmtNum(bandCount.warn)); setText('pfGood', C.fmtNum(bandCount.good));
    /* clicking a band count shows only those projects; clicking it again shows all */
    document.querySelectorAll('.pf-band').forEach(function (n) {
      n.tabIndex = 0; n.setAttribute('role', 'button');
      function go() { var b = n.getAttribute('data-band'); st.band = st.band === b ? 'all' : b; save(); draw(); document.getElementById('projects').scrollIntoView({ block: 'nearest' }); }
      n.addEventListener('click', go);
      n.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    var search = document.getElementById('pjSearch');
    search.addEventListener('input', function () { st.q = search.value.trim().toLowerCase(); draw(); });
    search.addEventListener('keydown', function (e) { if (e.key === 'Escape' && search.value) { search.value = ''; st.q = ''; draw(); } });

    function nul(v, hi) { return v === null || v === undefined ? (hi ? Infinity : -Infinity) : v; }
    function draw() {
      document.querySelectorAll('.pf-band').forEach(function (n) { var on = n.getAttribute('data-band') === st.band; n.classList.toggle('on', on); n.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      segmented(document.getElementById('pjBand'), bands, 'band', bandCount);
      segmented(document.getElementById('pjSort'), sorts, 'sort', null);
      var list = projects.filter(function (p) {
        if (st.band !== 'all' && p.ppcRunningTone !== st.band) return false;
        return !st.q || ((p.title || '') + ' ' + (p.client || '') + ' ' + (p.key || '')).toLowerCase().indexOf(st.q) >= 0;
      }).sort(function (x, y) {
        if (st.sort === 'open') return nul(y.openConstraints, false) - nul(x.openConstraints, false) || (x.title || '').localeCompare(y.title || '');
        if (st.sort === 'name') return (x.title || '').localeCompare(y.title || '');
        return nul(x.ppcRunning, true) - nul(y.ppcRunning, true) || (x.title || '').localeCompare(y.title || '');
      });
      setText('pjDesc', list.length === projects.length ? plural(projects.length, 'project') + ' · open a card for its full dashboard'
                                                         : C.fmtNum(list.length) + ' of ' + plural(projects.length, 'project') + ' shown');
      var grid = document.getElementById('projects'); grid.innerHTML = '';
      if (!projects.length) {
        grid.appendChild(el('div', 'empty', 'No projects yet. Add a P<key> folder with project.json and a token secret, then run the build.'));
        return;
      }
      if (!list.length) {
        var e = el('div', 'empty', 'No project matches ' + (st.q ? '"' + search.value.trim() + '"' : '') + (st.q && st.band !== 'all' ? ' with ' : '') + (st.band !== 'all' ? 'a ' + BAND_WORD[st.band].toLowerCase() + ' 6-week rolling PPC' : '') + '.');
        var clr = el('button', 'btn', 'Clear search and filter'); clr.type = 'button';
        clr.addEventListener('click', function () { search.value = ''; st.q = ''; st.band = 'all'; save(); draw(); search.focus(); });
        e.appendChild(el('br')); e.appendChild(clr);
        grid.appendChild(e);
        return;
      }
      list.forEach(function (p) { grid.appendChild(projectCard(p)); });
    }
    draw();
  }

  var page = document.body.getAttribute('data-page');
  if (page === 'landing') renderLanding(); else renderProject();
})();
