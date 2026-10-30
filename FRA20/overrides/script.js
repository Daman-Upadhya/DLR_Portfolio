/* FRA20 only. With Outcome and By priority hidden (style.css), By category would sit alone in
   its row: move it in front of the ageing / owner / trade cards, which style.css makes a 2 x 2 grid.
   Only the card moves; app.js finds its chart by id, so it keeps drawing as before. */
(function () {
  'use strict';
  var cat = document.getElementById('consCatPie'), age = document.getElementById('consAgeing');
  if (!cat || !age) return;
  var card = cat.closest('.card'), row = age.closest('.grid');
  if (card && row) row.insertBefore(card, row.firstChild);
})();

/* FRA20 only. Prerequisites by trade shows, per prerequisite, the look-ahead activities that do
   NOT have it selected (the trade's activities minus those with it selected), instead of those
   that do. app.js draws the shared matrix (on every render and on "Show all trades"); this
   rewrites each prerequisite column of that table in place, and the cells, column heads and
   footer then list the activities missing it. The None selected and Activities columns stay. */
(function () {
  'use strict';
  var host = document.getElementById('laPq');
  if (!host) return;
  var C = window.Charts;
  var CROSS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  function num(td) { var n = parseInt((td.textContent || '').replace(/\D/g, ''), 10); return isNaN(n) ? 0 : n; }
  function fmt(n) { return C && C.fmtNum ? C.fmtNum(n) : String(n); }
  function list(spec, title) {
    return function (e) {
      e.stopPropagation(); spec.type = 'lookahead';
      if (window.DLR && window.DLR.openList) window.DLR.openList(spec, title, 'Look-ahead activities without this prerequisite selected', e.currentTarget);
    };
  }
  /* a fresh copy of a node drops app.js's "selected" click handlers */
  function fresh(node) { var c = node.cloneNode(true); node.parentNode.replaceChild(c, node); return c; }
  function pick(node, fn, title) {
    node.classList.add('pick'); node.setAttribute('role', 'button'); node.tabIndex = 0; node.title = title;
    node.addEventListener('click', fn);
    node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } });
  }

  function invert() {
    var tbl = host.querySelector('table.heat');
    if (!tbl || tbl.getAttribute('data-missing')) return;
    tbl.setAttribute('data-missing', '1');
    var heads = tbl.querySelectorAll('thead th'), names = [];
    /* columns: trade, one per prerequisite, None selected, Activities */
    for (var i = 1; i < heads.length - 2; i++) names.push(heads[i].textContent.trim());

    var rows = [], max = 0;
    tbl.querySelectorAll('tbody tr').forEach(function (tr) {
      var cells = tr.children, trade = cells[0].textContent, total = num(cells[cells.length - 1]), vals = [];
      names.forEach(function (x, j) { var v = total - num(cells[j + 1]); vals.push(v); if (v > max) max = v; });
      rows.push({ tr: tr, trade: trade, vals: vals, total: total });
    });
    rows.forEach(function (r) {
      r.vals.forEach(function (v, j) {
        var td = fresh(r.tr.children[j + 1]), x = names[j];
        td.className = 'hc' + (v ? '' : ' zero'); td.removeAttribute('style'); td.removeAttribute('role'); td.removeAttribute('tabindex');
        td.textContent = v ? fmt(v) : '·';
        if (v) {
          var p = max ? v / max : 0;
          td.style.background = 'color-mix(in srgb, var(--bad) ' + Math.round(10 + 70 * p) + '%, var(--card))';
          if (p > 0.55) td.classList.add('hot');
          pick(td, list({ trade: r.trade, pqMissing: x }, r.trade + ' · ' + x + ' not selected'),
               r.trade + ' · ' + x + ': not selected on ' + v + ' of ' + r.total + ' activities · click to list them');
        } else td.title = r.trade + ' · ' + x + ': selected on every activity';
      });
    });

    /* column heads: list the activities missing the prerequisite */
    var foot = tbl.querySelector('tfoot tr'), all = foot ? num(foot.children[foot.children.length - 1]) : 0;
    names.forEach(function (x, j) {
      var box = heads[j + 1].querySelector('.ht-type');
      var missing = foot ? all - num(foot.children[j + 1]) : null;
      if (box) {
        box = fresh(box);
        var ic = box.querySelector('.pq-ic');
        if (ic) ic.innerHTML = CROSS; box.classList.remove('pick'); box.removeAttribute('role'); box.removeAttribute('tabindex');
        if (missing) pick(box, list({ pqMissing: x }, x + ' not selected'), x + ': not selected on ' + missing + ' activities · click to list them');
        else box.title = x + ': selected on every activity';
      }
      if (foot) foot.children[j + 1].textContent = fmt(missing);
    });

    var key = document.getElementById('laPqKey');
    if (key && key.children.length >= 3) { key.children[0].textContent = max ? '1' : '0'; key.children[2].textContent = fmt(max); }
  }

  var h2 = document.querySelector('#laPqCard .card-head h2');
  if (h2) h2.textContent = 'Prerequisites not selected, by trade';
  invert();
  new MutationObserver(invert).observe(host, { childList: true });
})();

/* FRA20 only. Extra pages (Energisation, Trade performance): a tab after the shared ones and a
   panel after the shared panels. app.js owns its own tabs and does not know these. Opening one
   hides app.js's panels; leaving for an app.js tab shows that tab's panel again, since app.js
   ignores a click on the page it already has open. The slicers do not apply to these pages and
   are hidden while one is open. */
var FRA20Pages = (function () {
  'use strict';
  var nav = document.querySelector('.page-tabs'), el = window.Charts.el;
  var mine = [], open = null, prev = null;   /* prev: app.js's page when the first extra page opened */
  function select(t, on) {
    t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
    var p = document.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !on;
  }
  function shared() { return Array.prototype.filter.call(nav.querySelectorAll('.page-tab'), function (t) { return mine.indexOf(t) < 0 && !t.hidden; }); }
  function show(tab) {
    if (open === tab) return;
    if (open) select(open, false);
    else shared().forEach(function (t) { if (t.getAttribute('aria-selected') === 'true') prev = t.getAttribute('data-page'); select(t, false); });
    select(tab, true); open = tab;
    document.body.classList.add('xp-open');
  }
  if (nav) nav.addEventListener('click', function (e) {
    var t = e.target.closest('.page-tab');
    if (!t || mine.indexOf(t) >= 0 || !open) return;
    select(open, false); open = null;
    document.body.classList.remove('xp-open');
    if (t.getAttribute('data-page') === prev) select(t, true);
  }, true);
  /* add(key, label, svg path) -> the new, empty panel; null on a page without the tab bar */
  function add(key, label, icon) {
    var panels = document.querySelectorAll('.page-panel'), last = panels[panels.length - 1];
    if (!nav || !last) return null;
    var id = key.charAt(0).toUpperCase() + key.slice(1), tab = el('button', 'page-tab');
    tab.type = 'button'; tab.id = 'tab' + id;
    tab.setAttribute('role', 'tab'); tab.setAttribute('data-page', key);
    tab.setAttribute('aria-controls', 'page' + id); tab.setAttribute('aria-selected', 'false'); tab.tabIndex = -1;
    tab.innerHTML = '<svg class="tab-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icon + '</svg>' + label;
    nav.appendChild(tab); mine.push(tab);
    var panel = el('div', 'page-panel');
    panel.id = 'page' + id; panel.hidden = true;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
    last.parentNode.insertBefore(panel, last.nextSibling);
    tab.addEventListener('click', function () { show(tab); });
    tab.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var all = shared().concat(mine), i = all.indexOf(tab);
      var t = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      t.click(); t.focus();
    });
    return panel;
  }
  return { add: add };
})();

/* FRA20 only. Energisation page: the activities extra_calc.py flags (custom field "Deliver..."
   mentions Energisation), one per machine. The machine is named by the activity's location and
   grouped (rows) by its task name without the word "Energisation". In each group the machines are
   ordered by planned end, and each distinct planned-end date is the next stage, so stage 1 is
   every group's first. Status at the data date: done (actual end or a completed status), late
   (planned end passed), due in the next 7 days, or planned. The page has no slicers: it always
   shows every energisation activity. */
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('data').textContent), M = D.metrics;
  var guids = M && M.energisation && M.energisation.guids;
  if (!guids || !guids.length) return;
  var C = window.Charts, A = window.Agg, el = C.el, FX = M.facts, today = FX.today, soon = A.addDays(today, 7);
  var WORD = /\benergi[sz]\w*\b/ig;

  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function groupOf(t) { return clean(clean(t.n).replace(WORD, '').replace(/^[\s\-–:,.()]+|[\s\-–:,.()]+$/g, '')) || 'Other'; }
  function day(iso) { return iso ? iso.slice(0, 10) : null; }
  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function range(a, b) {
    if (a === b) return C.fmtDate(a, true);
    var pa = a.split('-'), pb = b.split('-');
    if (pa[0] === pb[0] && pa[1] === pb[1]) return +pa[2] + '–' + C.fmtDate(b, true);
    if (pa[0] === pb[0]) return +pa[2] + ' ' + MON[+pa[1] - 1] + ' – ' + C.fmtDate(b, true);
    return C.fmtDate(a, true) + ' – ' + C.fmtDate(b, true);
  }

  /* ---- machines, groups and stages ---- */
  var want = {}; guids.forEach(function (g) { want[g] = 1; });
  var items = [], undated = 0;
  FX.tasks.forEach(function (t) {
    if (!want[t.g]) return;
    var pe = day(t.pe);
    if (!pe) { undated++; return; }
    var done = !!t.ae || /complet|finish|closed/i.test(t.st || '');
    var st = done ? 'done' : pe < today ? 'late' : pe <= soon ? 'due' : 'planned';
    items.push({ t: t, machine: clean(t.l) || clean(t.n), group: groupOf(t), pe: pe, st: st, late: st === 'late' ? daysBetween(pe, today) : 0 });
  });
  if (!items.length) return;
  var groups = {}, order = [];
  items.sort(function (x, y) { return x.pe.localeCompare(y.pe) || x.machine.localeCompare(y.machine); }).forEach(function (it) {
    var g = groups[it.group];
    if (!g) { g = groups[it.group] = { name: it.group, dates: [] }; order.push(g); }
    if (g.dates[g.dates.length - 1] !== it.pe) g.dates.push(it.pe);
    it.stage = g.dates.length;
  });
  var nStages = Math.max.apply(null, order.map(function (g) { return g.dates.length; }));
  var RANK = { late: 3, due: 2, planned: 1, done: 0 };
  function counts(list) {
    var c = { n: list.length, done: 0, late: 0, due: 0 };
    list.forEach(function (it) { if (c[it.st] !== undefined) c[it.st]++; });
    c.planned = c.n - c.done - c.late;
    var ds = list.map(function (it) { return it.pe; }).sort();
    c.from = ds[0]; c.to = ds[ds.length - 1];
    return c;
  }
  function describe(it) {
    var s = { done: 'done', late: it.late + ' days behind plan', due: 'due in the next 7 days', planned: 'planned' }[it.st];
    return it.machine + ' · ' + clean(it.t.n) + ' · planned end ' + C.fmtDate(it.pe, true) + ' · ' + s;
  }

  var panel = FRA20Pages.add('energisation', 'Energisation', '<path d="M9.2 1.6 3.6 9h4.1l-1 5.4L12.4 7H8.3z"/>');
  if (!panel) return;

  /* stage cards: all stages, then one per stage */
  var cards = el('div', 'en-stages');
  function card(label, list, all) {
    var c = counts(list), box = el('div', 'card en-stage' + (all ? ' en-all' : ''));
    var head = el('div', 'en-sh');
    head.appendChild(el('span', 'en-eyebrow', label));
    head.appendChild(el('span', 'en-pct', Math.round(100 * c.done / c.n) + '% done'));
    var big = el('div', 'en-big');
    big.appendChild(el('b', null, C.fmtNum(c.n))); big.appendChild(document.createTextNode(' machinery'));
    var bar = el('div', 'en-bar');
    [['done', c.done], ['late', c.late], ['planned', c.planned]].forEach(function (p) {
      if (p[1]) { var i = el('i', 'en-' + p[0]); i.style.flexGrow = p[1]; bar.appendChild(i); }
    });
    var chips = el('div', 'en-chips');
    [['done', c.done, 'Done'], ['late', c.late, 'Late'], ['planned', c.planned, 'Planned']].forEach(function (p) {
      var s = el('span', 'en-chip en-' + p[0]);
      s.appendChild(el('b', null, C.fmtNum(p[1]))); s.appendChild(document.createTextNode(' ' + p[2]));
      chips.appendChild(s);
    });
    [head, big, el('div', 'en-range', 'Planned end ' + range(c.from, c.to)), bar, chips].forEach(function (n) { box.appendChild(n); });
    cards.appendChild(box);
  }
  card('All stages', items, true);
  for (var s = 1; s <= nStages; s++) card('Stage ' + s, items.filter(function (it) { return it.stage === s; }));

  /* matrix: one row per group, one column per stage */
  var tot = counts(items);
  var mat = el('div', 'card en-matrix');
  var mh = el('div', 'card-head');
  mh.appendChild(el('h2', null, 'Machinery completion by stage'));
  mh.appendChild(el('span', 'en-desc', 'Planned end per stage · status at ' + C.fmtDate(today, true)
    + (undated ? ' · ' + undated + ' without a planned end not shown' : '')));
  var sum = el('span', 'en-sum');
  sum.innerHTML = 'Completed <b class="en-t-done"></b> · Late <b class="en-t-late"></b> · Due in 7 days <b class="en-t-due"></b>';
  sum.querySelector('.en-t-done').textContent = tot.done + '/' + tot.n;
  sum.querySelector('.en-t-late').textContent = tot.late;
  sum.querySelector('.en-t-due').textContent = tot.due;
  mh.appendChild(sum);
  mat.appendChild(mh);

  var wrap = el('div', 'table-wrap'), tbl = el('table', 'en-grid'), thead = el('thead'), hr = el('tr'), tbody = el('tbody');
  hr.appendChild(el('th', 'en-corner'));
  for (s = 1; s <= nStages; s++) hr.appendChild(el('th', null, 'Stage ' + s));
  thead.appendChild(hr);
  order.forEach(function (g) {
    var tr = el('tr');
    tr.appendChild(el('th', 'en-row', g.name));
    for (var k = 1; k <= nStages; k++) {
      var td = el('td'), here = items.filter(function (it) { return it.group === g.name && it.stage === k; });
      if (!here.length) { td.appendChild(el('div', 'en-cell en-empty', '—')); tr.appendChild(td); continue; }
      var worst = here.reduce(function (a, b) { return RANK[b.st] > RANK[a.st] ? b : a; });
      var cell = el('div', 'en-cell en-' + worst.st);
      cell.appendChild(el('div', 'en-name', here[0].machine + (here.length > 1 ? ' +' + (here.length - 1) : '')));
      var maxLate = Math.max.apply(null, here.map(function (it) { return it.late; }));
      cell.appendChild(el('div', 'en-date', C.fmtDate(here[0].pe, true) + (maxLate ? ' · +' + maxLate + 'd' : '')));
      C.attachTooltip(cell, here.map(describe).join('\n'));
      td.appendChild(cell); tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  tbl.appendChild(thead); tbl.appendChild(tbody); wrap.appendChild(tbl); mat.appendChild(wrap);

  var key = el('div', 'en-key');
  [['done', 'Completed'], ['late', 'Late (+days behind plan)'], ['due', 'Due in next 7 days'], ['planned', 'Planned'], ['empty', 'No task']].forEach(function (p) {
    var k = el('span'); k.appendChild(el('i', 'en-sw en-' + p[0])); k.appendChild(document.createTextNode(p[1])); key.appendChild(k);
  });
  mat.appendChild(key);

  var sec = el('section');
  var title = el('div', 'section-title'); title.appendChild(el('h2', null, 'Energisation'));
  [title, cards, mat].forEach(function (n) { sec.appendChild(n); });
  panel.appendChild(sec);
})();

/* FRA20 only. Trade performance page: each trade gets a score from 1 to 5, the average of four
   KPIs scored 1-5 (a KPI with no tasks in its week is NA and left out of the average):
     outstanding  delayed activities (Delay: construction, not started or not finished by its
                  planned date) with no open constraint linked, % of the trade's activities; lower is better
     missed       last week's planned activities (planned end Mon-Sun last week) not finished
                  that week (Planned PPC unsuccessful), % of them; lower is better
     workforce    next week's starts (planned start Mon-Sun next week) with a planned workforce
                  (extra_calc.py: totalPlannedWorkers above 0), % of them; higher is better
     prereq       next week's starts with a prerequisite selected, % of them; higher is better
   Weeks are ISO weeks around the data date. The page has no slicers. */
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('data').textContent), M = D.metrics;
  if (!M || !M.facts) return;
  var C = window.Charts, A = window.Agg, el = C.el, FX = M.facts, today = FX.today;
  var panel = FRA20Pages.add('trades', 'Trade performance', '<path d="M2.5 13.5h11"/><path d="M4 13.5V9.5h2.5v4"/><path d="M6.7 13.5V6h2.6v7.5"/><path d="M9.5 13.5V3h2.5v10.5"/>');
  if (!panel) return;

  var mon = A.mondayOf(today);
  var last = [A.addDays(mon, -7), A.addDays(mon, -1)], next = [A.addDays(mon, 7), A.addDays(mon, 13)];
  function day(iso) { return iso ? iso.slice(0, 10) : null; }
  function within(iso, w) { var d = day(iso); return !!d && d >= w[0] && d <= w[1]; }
  var openCons = {}, workforce = {};
  (FX.constraints || []).forEach(function (c) { if (c.g && !c.cp) openCons[c.g] = 1; });
  ((M.workforce && M.workforce.guids) || []).forEach(function (g) { workforce[g] = 1; });

  var KPIS = [
    { key: 'outstanding', label: 'Outstanding without constraints', short: 'of the trade’s activities are delayed with no open constraint', lower: true },
    { key: 'missed', label: 'Missed last week', short: 'of last week’s planned activities were not finished that week', lower: true },
    { key: 'workforce', label: 'Next week with workforce', short: 'of next week’s starts have a planned workforce', lower: false },
    { key: 'prereq', label: 'Next week with prerequisites', short: 'of next week’s starts have a prerequisite selected', lower: false }
  ];
  function scoreOf(k, pct) {
    if (pct === null) return null;
    if (k.lower) return pct === 0 ? 5 : pct <= 10 ? 4 : pct <= 25 ? 3 : pct <= 50 ? 2 : 1;
    return pct >= 90 ? 5 : pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 25 ? 2 : 1;
  }
  var BANDS = [{ min: 4, cls: 'good', name: 'Strong', range: '4.0 – 5.0' }, { min: 3, cls: 'fair', name: 'Fair', range: '3.0 – 3.9' },
               { min: 2, cls: 'weak', name: 'Weak', range: '2.0 – 2.9' }, { min: 0, cls: 'crit', name: 'Critical', range: 'below 2.0' }];
  function band(v) { for (var i = 0; i < BANDS.length; i++) if (v >= BANDS[i].min) return BANDS[i]; return BANDS[3]; }

  /* ---- per trade ---- */
  var by = {};
  FX.tasks.forEach(function (t) {
    var name = t.tr || 'No trade', r = by[name];
    if (!r) r = by[name] = { trade: name, outstanding: [0, 0], missed: [0, 0], workforce: [0, 0], prereq: [0, 0] };
    r.outstanding[1]++;
    if (t.dl && !openCons[t.g]) r.outstanding[0]++;
    if (within(t.pe, last)) { r.missed[1]++; if (!within(t.ae, last)) r.missed[0]++; }
    if (within(t.ps, next)) {
      r.workforce[1]++; r.prereq[1]++;
      if (workforce[t.g]) r.workforce[0]++;
      if (t.pq && t.pq.length) r.prereq[0]++;
    }
  });
  var rows = Object.keys(by).map(function (k) {
    var r = by[k], sum = 0, n = 0;
    KPIS.forEach(function (K) {
      var c = r[K.key], pct = c[1] ? 100 * c[0] / c[1] : null, sc = scoreOf(K, pct);
      r[K.key] = { n: c[0], of: c[1], pct: pct, score: sc };
      if (sc !== null) { sum += sc; n++; }
    });
    r.score = Math.round(10 * sum / n) / 10;   /* outstanding always has tasks, so n >= 1 */
    return r;
  }).sort(function (a, b) { return (a.score - b.score) || a.trade.localeCompare(b.trade); });

  /* ---- page ---- */
  var sec = el('section');
  var title = el('div', 'section-title');
  title.appendChild(el('h2', null, 'Trade performance'));
  title.appendChild(el('span', 'desc', 'Score 1–5 per trade · last week ' + C.fmtDate(last[0], true) + ' – ' + C.fmtDate(last[1], true)
    + ' · next week ' + C.fmtDate(next[0], true) + ' – ' + C.fmtDate(next[1], true)));
  sec.appendChild(title);

  /* how many trades in each band */
  var tiles = el('div', 'tp-bands');
  BANDS.forEach(function (B) {
    var n = rows.filter(function (r) { return band(r.score) === B; }).length;
    var tile = el('div', 'card tp-band tp-' + B.cls);
    tile.appendChild(el('div', 'tp-band-n', C.fmtNum(n)));
    tile.appendChild(el('div', 'tp-band-l', B.name + (n === 1 ? ' trade' : ' trades')));
    tile.appendChild(el('div', 'tp-band-r', 'score ' + B.range));
    tiles.appendChild(tile);
  });
  sec.appendChild(tiles);

  /* score table, weakest first */
  var card = el('div', 'card tp-card');
  var head = el('div', 'card-head');
  head.appendChild(el('h2', null, 'Trade score'));
  head.appendChild(el('span', 'desc', 'Weakest first · each KPI scored 1–5, the score is their average'));
  card.appendChild(head);
  var wrap = el('div', 'table-wrap'), tbl = el('table', 'tp-table'), thead = el('thead'), hr = el('tr'), tbody = el('tbody');
  hr.appendChild(el('th', null, 'Trade'));
  hr.appendChild(el('th', null, 'Score'));
  KPIS.forEach(function (K) {
    var th = el('th', 'tp-kpi-h'); th.appendChild(el('div', null, K.label));
    th.appendChild(el('div', 'tp-dir', K.lower ? 'lower is better' : 'higher is better'));
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  rows.forEach(function (r) {
    var tr = el('tr'), B = band(r.score);
    tr.appendChild(el('th', 'tp-trade', r.trade));
    var sc = el('td', 'tp-score');
    sc.appendChild(el('span', 'tp-pill tp-' + B.cls, r.score.toFixed(1)));
    sc.appendChild(el('span', 'tp-band-name', B.name));
    tr.appendChild(sc);
    KPIS.forEach(function (K) {
      var k = r[K.key], td = el('td', 'tp-kpi');
      if (k.score === null) {
        td.className += ' tp-na'; td.appendChild(el('span', 'tp-pct', 'NA'));
        C.attachTooltip(td, r.trade + ' · ' + K.label + ': no tasks in that week, not scored');
      } else {
        td.className += ' tp-s' + k.score;
        td.appendChild(el('span', 'tp-pct', Math.round(k.pct) + '%'));
        td.appendChild(el('span', 'tp-n', k.n + '/' + k.of));
        td.appendChild(el('span', 'tp-s', String(k.score)));
        C.attachTooltip(td, r.trade + ' · ' + K.label + '\n' + k.n + ' of ' + k.of + ' (' + C.fmtPct(k.pct) + ') ' + K.short + '\nKPI score ' + k.score + ' of 5');
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tbl.appendChild(thead); tbl.appendChild(tbody); wrap.appendChild(tbl); card.appendChild(wrap);

  /* criteria and colour key */
  var key = el('div', 'tp-key');
  var crit = el('table', 'tp-crit');
  crit.innerHTML = '<thead><tr><th>KPI score</th><th>Outstanding / missed</th><th>Workforce / prerequisites</th></tr></thead>'
    + '<tbody><tr><td>5</td><td>0%</td><td>&ge; 90%</td></tr><tr><td>4</td><td>&le; 10%</td><td>75–89%</td></tr>'
    + '<tr><td>3</td><td>&le; 25%</td><td>50–74%</td></tr><tr><td>2</td><td>&le; 50%</td><td>25–49%</td></tr>'
    + '<tr><td>1</td><td>&gt; 50%</td><td>&lt; 25%</td></tr></tbody>';
  key.appendChild(crit);
  var legend = el('div', 'tp-legend');
  BANDS.forEach(function (B) {
    var s = el('span'); s.appendChild(el('i', 'tp-sw tp-' + B.cls));
    s.appendChild(document.createTextNode(B.range + ' ' + B.name)); legend.appendChild(s);
  });
  legend.appendChild(el('span', null, 'NA = no tasks in that week, not scored'));
  if (!FX.constraints) legend.appendChild(el('span', null, 'No constraint feed: every delayed activity counts as outstanding'));
  key.appendChild(legend);
  card.appendChild(key);
  sec.appendChild(card);
  panel.appendChild(sec);
})();
