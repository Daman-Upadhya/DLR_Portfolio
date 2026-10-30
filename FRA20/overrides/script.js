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

/* FRA20 only. Energisation page: the activities extra_calc.py flags (custom field "Discipline"
   is Energisation), one End Milestone per machine. The machine is the task name ("2HVM2"); its
   row is the machinery type read from the location ("P2_FO_L0.008 - HV Room" -> HV Room,
   "P1_FO_Gantry - Gen06" -> Generator, "R2" with task "Chiller 04 & 10" -> Chiller). In each row
   the machines are ordered by planned end, and each distinct planned-end date is the next stage,
   so stage 1 is every row's first. Status at the data date: done (actual end or a completed
   status), late (planned end passed), due in the next 7 days, or planned. The page has no
   slicers: it always shows every energisation activity.
   Interaction: the status buttons and the search dim the machines that do not match; hovering a
   stage highlights its column; a stage, a row name, a cell or "List" opens the machines behind it
   in the side panel (window.DLR.openRows). */
(function () {
  'use strict';
  var D = JSON.parse(document.getElementById('data').textContent), M = D.metrics;
  var src = M && M.energisation && M.energisation.items;
  if (!src || !src.length) return;
  var C = window.Charts, A = window.Agg, el = C.el, today = M.facts.today, soon = A.addDays(today, 7);
  /* machinery types, in this row order; anything else is named by the location's last part */
  var TYPES = [['HV Room', /\bHV Room\b/i], ['Generator', /\bGen(erator)?\s*\d*\b/i], ['Transformer', /\bTransformer\b/i],
               ['LV Room', /\bLV Room\b/i], ['Chiller', /\bChiller\b/i]];
  var ST = {
    late: { label: 'Late', tone: 'bad' }, due: { label: 'Due in 7 days', tone: 'warn' },
    planned: { label: 'Planned', tone: null }, done: { label: 'Completed', tone: 'good' }
  };
  var RANK = { late: 3, due: 2, planned: 1, done: 0 };

  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function groupOf(t) {
    var tail = clean(clean(t.l).split(/\s+-\s*|-\s+/).pop());
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i][1].test(tail)) return TYPES[i][0];
    for (i = 0; i < TYPES.length; i++) if (TYPES[i][1].test(clean(t.n))) return TYPES[i][0];
    return clean(tail.replace(/(\s+[A-Z]|\s*\d+)$/, '')) || 'Other';
  }
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
  function plural(n, one, many) { return C.fmtNum(n) + ' ' + (n === 1 ? one : many); }
  function stateText(it) {
    return it.st === 'late' ? it.late + ' d behind plan' : it.st === 'due' ? 'Due in ' + it.left + ' d'
      : it.st === 'done' ? 'Completed' : 'In ' + it.left + ' d';
  }
  /* a clickable node: pointer, Enter / Space */
  function act(node, fn, label) {
    node.classList.add('xp-pick'); node.setAttribute('role', 'button'); node.tabIndex = 0;
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', function (e) { e.stopPropagation(); fn(node); });
    node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(node); } });
  }

  /* ---- machines, rows and stages ---- */
  var items = [], undated = 0;
  src.forEach(function (t) {
    var pe = day(t.pe);
    if (!pe) { undated++; return; }
    var done = !!t.ae || /complet|finish|closed/i.test(t.st || '');
    var st = done ? 'done' : pe < today ? 'late' : pe <= soon ? 'due' : 'planned';
    items.push({ t: t, machine: clean(t.n), group: groupOf(t), pe: pe, st: st,
                 late: st === 'late' ? daysBetween(pe, today) : 0, left: st === 'done' ? 0 : Math.max(0, daysBetween(today, pe)) });
  });
  if (!items.length) return;
  var groups = {}, order = [];
  items.sort(function (x, y) { return x.pe.localeCompare(y.pe) || x.machine.localeCompare(y.machine); }).forEach(function (it) {
    var g = groups[it.group];
    if (!g) { g = groups[it.group] = { name: it.group, dates: [] }; order.push(g); }
    if (g.dates[g.dates.length - 1] !== it.pe) g.dates.push(it.pe);
    it.stage = g.dates.length;
  });
  var rank = TYPES.map(function (x) { return x[0]; });
  function rk(name) { var i = rank.indexOf(name); return i < 0 ? rank.length : i; }
  order.sort(function (a, b) { return rk(a.name) - rk(b.name) || a.dates[0].localeCompare(b.dates[0]); });
  var nStages = Math.max.apply(null, order.map(function (g) { return g.dates.length; }));
  function counts(list) {
    var c = { n: list.length, done: 0, late: 0, due: 0, planned: 0 };
    list.forEach(function (it) { c[it.st]++; });
    var ds = list.map(function (it) { return it.pe; }).sort();
    c.from = ds[0]; c.to = ds[ds.length - 1];
    return c;
  }
  function describe(it) {
    return it.machine + ' · ' + it.group + ' · stage ' + it.stage + '\nPlanned end ' + C.fmtDate(it.pe, true) + ' · ' + stateText(it);
  }
  /* drill-through: the machines in the side panel, most urgent first */
  function list(sel, title, opener) {
    var rows = sel.slice().sort(function (a, b) { return RANK[b.st] - RANK[a.st] || a.pe.localeCompare(b.pe) || a.machine.localeCompare(b.machine); })
      .map(function (it) {
        return { id: it.t.id, name: it.machine, trade: it.t.tr, location: it.t.l, status: it.t.st, plannedStart: it.t.ps,
                 plannedEnd: it.t.pe, actualEnd: it.t.ae, note: it.group + ' · stage ' + it.stage + ' · ' + stateText(it), tone: ST[it.st].tone };
      });
    var c = counts(sel);
    window.DLR.openRows(rows, title, plural(c.n, 'machine', 'machines') + ' · ' + c.done + ' completed · ' + c.late + ' late · ' + c.due + ' due in 7 days',
                        opener, 'Energisation');
  }

  var panel = FRA20Pages.add('energisation', 'Energisation', '<path d="M9.2 1.6 3.6 9h4.1l-1 5.4L12.4 7H8.3z"/>');
  if (!panel) return;
  var sec = el('section', 'en-page');
  var title = el('div', 'section-title');
  title.appendChild(el('h2', null, 'Energisation'));
  title.appendChild(el('span', 'desc', 'Machinery energisation milestones · status at ' + C.fmtDate(today, true)
    + (undated ? ' · ' + undated + ' without a planned end not shown' : '')));
  sec.appendChild(title);

  /* ---- hero: overall progress, then the next machines to energise ---- */
  var tot = counts(items), pct = Math.round(100 * tot.done / tot.n);
  var hero = el('div', 'card en-hero');
  var prog = el('div', 'en-prog');
  var big = el('div', 'en-prog-n'); big.appendChild(el('b', null, pct + '%')); big.appendChild(el('span', null, 'energised'));
  prog.appendChild(big);
  prog.appendChild(el('div', 'en-prog-sub', tot.done + ' of ' + plural(tot.n, 'machine', 'machines') + ' · planned end ' + range(tot.from, tot.to)));
  var bar = el('div', 'en-bar en-bar-lg');
  ['done', 'late', 'due', 'planned'].forEach(function (k) {
    if (!tot[k]) return;
    var i = el('i', 'en-' + k); i.style.flexGrow = tot[k];
    C.attachTooltip(i, ST[k].label + ': ' + plural(tot[k], 'machine', 'machines'));
    act(i, function (n) { list(items.filter(function (x) { return x.st === k; }), ST[k].label + ' machinery', n); });
    bar.appendChild(i);
  });
  prog.appendChild(bar);
  var stats = el('div', 'en-stats');
  ['done', 'late', 'due', 'planned'].forEach(function (k) {
    var b = el('div', 'en-stat en-' + k);
    b.appendChild(el('b', null, C.fmtNum(tot[k]))); b.appendChild(el('span', null, ST[k].label));
    if (tot[k]) act(b, function (n) { list(items.filter(function (x) { return x.st === k; }), ST[k].label + ' machinery', n); }, ST[k].label + ': list them');
    else b.classList.add('en-zero');
    stats.appendChild(b);
  });
  prog.appendChild(stats);
  hero.appendChild(prog);
  var nextBox = el('div', 'en-next');
  nextBox.appendChild(el('div', 'en-next-h', 'Next to energise'));
  var upcoming = items.filter(function (x) { return x.st !== 'done'; })
    .sort(function (a, b) { return a.pe.localeCompare(b.pe) || a.machine.localeCompare(b.machine); }).slice(0, 4);
  if (!upcoming.length) nextBox.appendChild(el('div', 'en-next-empty', 'Every machine is energised.'));
  upcoming.forEach(function (it) {
    var r = el('div', 'en-next-row en-' + it.st);
    var when = el('span', 'en-next-when', it.st === 'late' ? '+' + it.late + ' d' : it.left === 0 ? 'Today' : it.left + ' d');
    var what = el('span', 'en-next-what');
    what.appendChild(el('b', null, it.machine)); what.appendChild(el('span', null, it.group + ' · ' + C.fmtDate(it.pe, true)));
    r.appendChild(when); r.appendChild(what);
    act(r, function (n) { list([it], it.machine, n); }, it.machine + ', ' + stateText(it));
    nextBox.appendChild(r);
  });
  hero.appendChild(nextBox);
  sec.appendChild(hero);

  /* ---- stage strip: one card per stage ---- */
  var strip = el('div', 'en-strip');
  function stageCard(label, sel, stage) {
    var c = counts(sel), box = el('div', 'en-stage' + (stage ? '' : ' en-all'));
    var h = el('div', 'en-sh'); h.appendChild(el('span', 'en-eyebrow', label)); h.appendChild(el('span', 'en-pct', Math.round(100 * c.done / c.n) + '%'));
    var n = el('div', 'en-big'); n.appendChild(el('b', null, C.fmtNum(c.n))); n.appendChild(document.createTextNode(c.n === 1 ? ' machine' : ' machines'));
    var b = el('div', 'en-bar');
    ['done', 'late', 'due', 'planned'].forEach(function (k) { if (c[k]) { var i = el('i', 'en-' + k); i.style.flexGrow = c[k]; b.appendChild(i); } });
    var flags = el('div', 'en-flags');
    if (c.late) flags.appendChild(el('span', 'en-flag en-late', c.late + ' late'));
    if (c.due) flags.appendChild(el('span', 'en-flag en-due', c.due + ' due'));
    if (c.done) flags.appendChild(el('span', 'en-flag en-done', c.done + ' done'));
    [h, n, el('div', 'en-range', range(c.from, c.to)), b, flags].forEach(function (x) { box.appendChild(x); });
    act(box, function (node) { list(sel, label, node); }, label + ': ' + plural(c.n, 'machine', 'machines') + ', list them');
    if (stage) {
      box.addEventListener('mouseenter', function () { hiCol(stage, true); });
      box.addEventListener('mouseleave', function () { hiCol(stage, false); });
      box.addEventListener('focus', function () { hiCol(stage, true); });
      box.addEventListener('blur', function () { hiCol(stage, false); });
    }
    strip.appendChild(box);
  }
  stageCard('All stages', items, 0);
  for (var s = 1; s <= nStages; s++) stageCard('Stage ' + s, items.filter(function (it) { return it.stage === s; }), s);
  sec.appendChild(strip);

  /* ---- matrix with its toolbar ---- */
  var mat = el('div', 'card en-matrix');
  var mh = el('div', 'card-head en-mh');
  mh.appendChild(el('h2', null, 'Machinery by stage'));
  var tools = el('div', 'en-tools');
  var seg = el('div', 'xp-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Show status');
  var filter = 'all', query = '';
  [['all', 'All', tot.n], ['late', 'Late', tot.late], ['due', 'Due 7 d', tot.due], ['planned', 'Planned', tot.planned], ['done', 'Completed', tot.done]].forEach(function (f) {
    var b = el('button', 'xp-seg-b' + (f[0] === 'all' ? ' on' : '') + (f[0] !== 'all' ? ' en-' + f[0] : ''));
    b.type = 'button'; b.setAttribute('aria-pressed', f[0] === 'all' ? 'true' : 'false');
    b.appendChild(document.createTextNode(f[1] + ' ')); b.appendChild(el('span', 'xp-seg-n', C.fmtNum(f[2])));
    b.addEventListener('click', function () {
      filter = f[0];
      seg.querySelectorAll('button').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      apply();
    });
    seg.appendChild(b);
  });
  tools.appendChild(seg);
  var search = el('input', 'xp-search'); search.type = 'search'; search.placeholder = 'Find machinery…'; search.setAttribute('aria-label', 'Find machinery');
  search.addEventListener('input', function () { query = search.value.trim().toLowerCase(); apply(); });
  tools.appendChild(search);
  var listBtn = el('button', 'btn xp-list', 'List');
  listBtn.type = 'button'; listBtn.title = 'List the machines shown';
  listBtn.addEventListener('click', function () {
    var sel = items.filter(match);
    list(sel, filter === 'all' && !query ? 'All energisation machinery' : 'Energisation · ' + (filter === 'all' ? 'all' : ST[filter].label.toLowerCase()) + (query ? ' · "' + search.value.trim() + '"' : ''), listBtn);
  });
  tools.appendChild(listBtn);
  mh.appendChild(tools);
  mat.appendChild(mh);

  var wrap = el('div', 'table-wrap'), tbl = el('table', 'en-grid'), thead = el('thead'), hr = el('tr'), tbody = el('tbody');
  hr.appendChild(el('th', 'en-corner'));
  for (s = 1; s <= nStages; s++) { var th = el('th', null, 'Stage ' + s); th.setAttribute('data-stage', s); hr.appendChild(th); }
  thead.appendChild(hr);
  var cells = [];
  order.forEach(function (g) {
    var tr = el('tr'), mine = items.filter(function (it) { return it.group === g.name; });
    var rh = el('th', 'en-row'), gc = counts(mine);
    rh.appendChild(el('div', null, g.name));
    rh.appendChild(el('div', 'en-row-sub', gc.done + '/' + gc.n + ' done' + (gc.late ? ' · ' + gc.late + ' late' : '')));
    act(rh, function (n) { list(mine, g.name, n); }, g.name + ': list its machines');
    tr.appendChild(rh);
    for (var k = 1; k <= nStages; k++) {
      var td = el('td'), here = mine.filter(function (it) { return it.stage === k; });
      td.setAttribute('data-stage', k);
      if (!here.length) { td.appendChild(el('div', 'en-cell en-empty', '—')); tr.appendChild(td); continue; }
      var worst = here.reduce(function (a, b) { return RANK[b.st] > RANK[a.st] ? b : a; });
      var cell = el('div', 'en-cell en-' + worst.st);
      var nm = el('div', 'en-name'); nm.appendChild(el('span', 'en-dot')); nm.appendChild(document.createTextNode(here[0].machine));
      if (here.length > 1) nm.appendChild(el('span', 'en-more', '+' + (here.length - 1)));
      cell.appendChild(nm);
      var maxLate = Math.max.apply(null, here.map(function (it) { return it.late; }));
      cell.appendChild(el('div', 'en-date', C.fmtDate(here[0].pe, true) + (maxLate ? ' · +' + maxLate + ' d' : '')));
      C.attachTooltip(cell, here.map(describe).join('\n\n') + '\nClick to list ' + (here.length > 1 ? 'them' : 'it'));
      (function (sel, label) { act(cell, function (n) { list(sel, label, n); }); })(here, g.name + ' · stage ' + k);
      cells.push({ node: cell, items: here });
      td.appendChild(cell); tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  tbl.appendChild(thead); tbl.appendChild(tbody); wrap.appendChild(tbl); mat.appendChild(wrap);
  var empty = el('div', 'xp-empty', 'No machinery matches.'); empty.hidden = true; mat.appendChild(empty);

  var key = el('div', 'en-key');
  [['done', 'Completed'], ['late', 'Late (+days behind plan)'], ['due', 'Due in next 7 days'], ['planned', 'Planned'], ['empty', 'No machine']].forEach(function (p) {
    var k = el('span'); k.appendChild(el('i', 'en-sw en-' + p[0])); k.appendChild(document.createTextNode(p[1])); key.appendChild(k);
  });
  key.appendChild(el('span', 'en-key-hint', 'Hover a stage to find its column · click any machine, stage or row to list it'));
  mat.appendChild(key);
  sec.appendChild(mat);
  panel.appendChild(sec);

  function match(it) { return (filter === 'all' || it.st === filter) && (!query || it.machine.toLowerCase().indexOf(query) >= 0 || clean(it.t.l).toLowerCase().indexOf(query) >= 0); }
  function apply() {
    var any = 0;
    cells.forEach(function (c) {
      var hit = c.items.some(match);
      if (hit) any++;
      c.node.classList.toggle('en-dim', !hit);
      c.node.classList.toggle('en-hit', hit && !!query);
    });
    empty.hidden = !!any;
  }
  function hiCol(stage, on) {
    tbl.querySelectorAll('[data-stage="' + stage + '"]').forEach(function (n) { n.classList.toggle('en-col', on); });
  }
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
   Weeks are ISO weeks around the data date. The page has no slicers.
   Interaction: the band tiles filter the table (click again to clear), the search finds a
   trade, the column heads sort it; a KPI cell, a project-wide KPI card or a trade name opens the
   activities behind it in the side panel (window.DLR.openRows), the ones to act on first. */
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
  function wk(w) { return C.fmtDate(w[0], true) + ' – ' + C.fmtDate(w[1], true); }
  var openCons = {}, workforce = {};
  (FX.constraints || []).forEach(function (c) { if (c.g && !c.cp) openCons[c.g] = 1; });
  ((M.workforce && M.workforce.guids) || []).forEach(function (g) { workforce[g] = 1; });

  /* each KPI: which activities it counts (base), which of them it flags (hit), whether the flag is
     the bad side, and the note shown for an activity in the list */
  var KPIS = [
    { key: 'outstanding', label: 'Outstanding without constraints', short: 'Outstanding', lower: true,
      what: 'of the activities are delayed with no open constraint',
      base: function () { return true; }, hit: function (t) { return t.dl && !openCons[t.g]; },
      note: function (t) { return (t.dk || 'Delayed') + (t.dd ? ', ' + t.dd + ' d late' : '') + ' · no open constraint'; } },
    { key: 'missed', label: 'Missed last week', short: 'Missed', lower: true, sub: wk(last),
      what: 'of last week’s planned activities were not finished that week',
      base: function (t) { return within(t.pe, last); }, hit: function (t) { return !within(t.ae, last); },
      note: function (t, h) { return h ? (t.ae ? 'Finished ' + C.fmtDate(t.ae, true) + ', outside the week' : 'Not finished') : 'Finished ' + C.fmtDate(t.ae, true); } },
    { key: 'workforce', label: 'Next week with workforce', short: 'Workforce', lower: false, sub: wk(next),
      what: 'of next week’s starts have a planned workforce',
      base: function (t) { return within(t.ps, next); }, hit: function (t) { return !!workforce[t.g]; },
      note: function (t, h) { return h ? 'Workforce planned' : 'No planned workforce'; } },
    { key: 'prereq', label: 'Next week with prerequisites', short: 'Prerequisites', lower: false, sub: wk(next),
      what: 'of next week’s starts have a prerequisite selected',
      base: function (t) { return within(t.ps, next); }, hit: function (t) { return !!(t.pq && t.pq.length); },
      note: function (t, h) { return h ? t.pq.join(', ') : 'None selected'; } }
  ];
  function scoreOf(k, pct) {
    if (pct === null) return null;
    if (k.lower) return pct === 0 ? 5 : pct <= 10 ? 4 : pct <= 25 ? 3 : pct <= 50 ? 2 : 1;
    return pct >= 90 ? 5 : pct >= 75 ? 4 : pct >= 50 ? 3 : pct >= 25 ? 2 : 1;
  }
  var BANDS = [{ min: 4, cls: 'good', name: 'Strong', range: '4.0 – 5.0' }, { min: 3, cls: 'fair', name: 'Fair', range: '3.0 – 3.9' },
               { min: 2, cls: 'weak', name: 'Weak', range: '2.0 – 2.9' }, { min: 0, cls: 'crit', name: 'Critical', range: 'below 2.0' }];
  function band(v) { for (var i = 0; i < BANDS.length; i++) if (v >= BANDS[i].min) return BANDS[i]; return BANDS[3]; }
  function scoreCls(sc) { return sc >= 4 ? 'good' : sc === 3 ? 'fair' : sc === 2 ? 'weak' : 'crit'; }
  function act(node, fn, label) {
    node.classList.add('xp-pick'); node.setAttribute('role', 'button'); node.tabIndex = 0;
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', function (e) { e.stopPropagation(); C.hideTip(); fn(node); });
    node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); C.hideTip(); fn(node); } });
  }

  /* ---- per trade: the activities in each KPI's base, and the flagged ones ---- */
  var by = {};
  FX.tasks.forEach(function (t) {
    var name = t.tr || 'No trade', r = by[name];
    if (!r) { r = by[name] = { trade: name, k: {} }; KPIS.forEach(function (K) { r.k[K.key] = { base: [], hits: [] }; }); }
    KPIS.forEach(function (K) {
      if (!K.base(t)) return;
      var b = r.k[K.key]; b.base.push(t);
      if (K.hit(t)) b.hits.push(t);
    });
  });
  function measure(K, b) {
    var n = b.hits.length, of = b.base.length, pct = of ? 100 * n / of : null;
    return { n: n, of: of, pct: pct, score: scoreOf(K, pct), bad: K.lower ? n : of - n };
  }
  var rows = Object.keys(by).map(function (name) {
    var r = by[name], sum = 0, cnt = 0;
    r.m = {};
    KPIS.forEach(function (K) { var m = r.m[K.key] = measure(K, r.k[K.key]); if (m.score !== null) { sum += m.score; cnt++; } });
    r.score = Math.round(10 * sum / cnt) / 10;   /* outstanding always has activities, so cnt >= 1 */
    r.band = band(r.score);
    r.issues = issues(r);
    return r;
  });

  /* ---- drill-through ---- */
  function asRow(t, note, tone) {
    return { id: t.id, name: t.n, trade: t.tr, organisation: t.o, location: t.l, status: t.st,
             plannedStart: t.ps, plannedEnd: t.pe, actualEnd: t.ae, note: note, tone: tone };
  }
  /* one KPI: the bad side first (flagged for lower-is-better KPIs, unflagged otherwise); the outstanding KPI lists only its flagged ones */
  function kpiRows(K, base, hits) {
    var isHit = {}; hits.forEach(function (t) { isHit[t.g] = 1; });
    var src = K.key === 'outstanding' ? hits : base;
    return src.map(function (t) {
      var h = !!isHit[t.g], bad = K.lower ? h : !h;
      return { r: asRow(t, K.note(t, h), bad ? 'bad' : 'good'), bad: bad, t: t };
    }).sort(function (a, b) { return (b.bad - a.bad) || ((b.t.dd || 0) - (a.t.dd || 0)) || String(a.t.pe || a.t.ps).localeCompare(String(b.t.pe || b.t.ps)); })
      .map(function (x) { return x.r; });
  }
  function openKpi(K, trade, b, m, node) {
    var sub = m.of ? m.n + ' of ' + m.of + ' (' + C.fmtPct(m.pct) + ') ' + K.what + ' · KPI score ' + m.score + ' of 5' : 'No activities in that week';
    window.DLR.openRows(kpiRows(K, b.base, b.hits), (trade ? trade + ' · ' : 'All trades · ') + K.label, sub, node, K.short);
  }
  /* a trade's activities on the bad side of any KPI, once each, with every KPI it fails */
  function issues(r) {
    var seen = {}, out = [];
    KPIS.forEach(function (K) {
      var b = r.k[K.key], isHit = {};
      b.hits.forEach(function (t) { isHit[t.g] = 1; });
      (K.key === 'outstanding' ? b.hits : b.base).forEach(function (t) {
        var h = !!isHit[t.g];
        if (K.lower ? !h : h) return;
        var x = seen[t.g];
        if (!x) { x = seen[t.g] = { t: t, notes: [] }; out.push(x); }
        x.notes.push(K.short + ': ' + K.note(t, h));
      });
    });
    return out.sort(function (a, b) { return (b.notes.length - a.notes.length) || ((b.t.dd || 0) - (a.t.dd || 0)); });
  }
  function openTrade(r, node) {
    var out = r.issues;
    window.DLR.openRows(out.map(function (x) { return asRow(x.t, x.notes.join(' · '), 'bad'); }), r.trade + ' · activities to act on',
      'Score ' + r.score.toFixed(1) + ' (' + r.band.name + ') · ' + out.length + ' activities pull the score down', node, 'Why it is listed');
  }

  /* ---- page ---- */
  var sec = el('section', 'tp-page');
  var title = el('div', 'section-title');
  title.appendChild(el('h2', null, 'Trade performance'));
  title.appendChild(el('span', 'desc', 'Last week ' + wk(last) + ' · next week ' + wk(next) + ' · status at ' + C.fmtDate(today, true)));
  sec.appendChild(title);

  /* hero: average score; band tiles filter the table */
  var avg = Math.round(10 * rows.reduce(function (s, r) { return s + r.score; }, 0) / rows.length) / 10, AB = band(avg);
  var top = el('div', 'tp-top');
  var hero = el('div', 'card tp-hero tp-' + AB.cls);
  hero.appendChild(el('div', 'tp-hero-l', 'Average trade score'));
  var hv = el('div', 'tp-hero-v'); hv.appendChild(el('b', null, avg.toFixed(1))); hv.appendChild(el('span', null, '/ 5 · ' + AB.name));
  hero.appendChild(hv);
  var gauge = el('div', 'tp-gauge'), gi = el('i'); gi.style.width = (avg / 5 * 100) + '%'; gauge.appendChild(gi); hero.appendChild(gauge);
  hero.appendChild(el('div', 'tp-hero-s', rows.length + ' trades scored'));
  top.appendChild(hero);
  var bandFilter = null, bandTiles = [];
  BANDS.forEach(function (B) {
    var n = rows.filter(function (r) { return r.band === B; }).length;
    var tile = el('button', 'card tp-band tp-' + B.cls);
    tile.type = 'button'; tile.setAttribute('aria-pressed', 'false'); tile.disabled = !n;
    tile.appendChild(el('div', 'tp-band-n', C.fmtNum(n)));
    tile.appendChild(el('div', 'tp-band-l', B.name + (n === 1 ? ' trade' : ' trades')));
    tile.appendChild(el('div', 'tp-band-r', 'score ' + B.range));
    tile.title = 'Show only ' + B.name.toLowerCase() + ' trades (click again for all)';
    tile.addEventListener('click', function () {
      bandFilter = bandFilter === B ? null : B;
      bandTiles.forEach(function (t) { var on = t.b === bandFilter; t.n.classList.toggle('on', on); t.n.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      top.classList.toggle('tp-filtering', !!bandFilter);
      draw();
    });
    bandTiles.push({ b: B, n: tile });
    top.appendChild(tile);
  });
  sec.appendChild(top);

  /* project-wide KPI cards: each opens all trades' activities behind it */
  var kcards = el('div', 'tp-kpis');
  KPIS.forEach(function (K) {
    var b = { base: [], hits: [] };
    rows.forEach(function (r) { b.base = b.base.concat(r.k[K.key].base); b.hits = b.hits.concat(r.k[K.key].hits); });
    var m = measure(K, b), card = el('div', 'card tp-kc' + (m.score === null ? ' tp-na' : ' tp-' + scoreCls(m.score)));
    var h = el('div', 'tp-kc-h'); h.appendChild(el('span', null, K.label));
    if (m.score !== null) h.appendChild(el('span', 'tp-s', String(m.score)));
    card.appendChild(h);
    card.appendChild(el('div', 'tp-kc-v', m.score === null ? 'NA' : Math.round(m.pct) + '%'));
    card.appendChild(el('div', 'tp-kc-s', m.of ? m.n + ' of ' + C.fmtNum(m.of) + (K.sub ? ' · ' + K.sub : ' activities') : 'no activities' + (K.sub ? ' · ' + K.sub : '')));
    var worst = rows.filter(function (r) { return r.m[K.key].score !== null; })
      .sort(function (a, c) { return a.m[K.key].score - c.m[K.key].score || c.m[K.key].bad - a.m[K.key].bad; })[0];
    if (worst && worst.m[K.key].score < 5) card.appendChild(el('div', 'tp-kc-w', 'Weakest: ' + worst.trade + ' (' + Math.round(worst.m[K.key].pct) + '%)'));
    if (m.of) act(card, function (n) { openKpi(K, null, b, m, n); }, K.label + ', all trades: list the activities');
    kcards.appendChild(card);
  });
  sec.appendChild(kcards);

  /* score table */
  var card = el('div', 'card tp-card');
  var head = el('div', 'card-head tp-head');
  head.appendChild(el('h2', null, 'Trade score'));
  var hint = el('span', 'desc', 'Click a score to see the activities behind it');
  head.appendChild(hint);
  var search = el('input', 'xp-search'); search.type = 'search'; search.placeholder = 'Find a trade…'; search.setAttribute('aria-label', 'Find a trade');
  search.addEventListener('input', draw);
  head.appendChild(search);
  card.appendChild(head);
  var wrap = el('div', 'table-wrap'), tbl = el('table', 'tp-table'), thead = el('thead'), hr = el('tr'), tbody = el('tbody');
  var sort = { key: 'score', dir: 1 }, heads = [];
  function sortHead(label, key, cls, sub) {
    var th = el('th', cls || null), b = el('button', 'tp-sort');
    b.type = 'button'; b.appendChild(el('span', null, label)); b.appendChild(el('span', 'tp-arrow'));
    th.appendChild(b);
    if (sub) th.appendChild(el('div', 'tp-dir', sub));
    b.addEventListener('click', function () {
      sort = { key: key, dir: sort.key === key ? -sort.dir : (key === 'trade' ? 1 : key === 'score' ? 1 : KPIS.filter(function (K) { return K.key === key; })[0].lower ? -1 : 1) };
      draw();
    });
    heads.push({ th: th, key: key });
    hr.appendChild(th);
  }
  sortHead('Trade', 'trade');
  sortHead('Score', 'score');
  KPIS.forEach(function (K) { sortHead(K.label, K.key, 'tp-kpi-h', (K.lower ? 'lower is better' : 'higher is better') + (K.sub ? ' · ' + K.sub : '')); });
  thead.appendChild(hr);
  tbl.appendChild(thead); tbl.appendChild(tbody); wrap.appendChild(tbl); card.appendChild(wrap);
  var empty = el('div', 'xp-empty', 'No trade matches.'); empty.hidden = true; card.appendChild(empty);

  function val(r, key) {
    if (key === 'trade') return r.trade.toLowerCase();
    if (key === 'score') return r.score;
    var p = r.m[key].pct; return p === null ? null : p;
  }
  function draw() {
    var q = search.value.trim().toLowerCase();
    var list = rows.filter(function (r) { return (!bandFilter || r.band === bandFilter) && (!q || r.trade.toLowerCase().indexOf(q) >= 0); });
    list.sort(function (a, b) {
      var x = val(a, sort.key), y = val(b, sort.key);
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      var d = x === y ? 0 : (x < y ? -1 : 1);
      return d * sort.dir || (a.score - b.score) || a.trade.localeCompare(b.trade);
    });
    heads.forEach(function (h) {
      h.th.setAttribute('aria-sort', h.key === sort.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
      h.th.classList.toggle('tp-sorted', h.key === sort.key);
    });
    tbody.innerHTML = '';
    list.forEach(function (r) {
      var tr = el('tr');
      var tn = el('th', 'tp-trade');
      tn.appendChild(el('div', null, r.trade));
      tn.appendChild(el('div', 'tp-trade-sub', r.issues.length ? r.issues.length + (r.issues.length === 1 ? ' activity' : ' activities') + ' to act on' : 'Nothing to act on'));
      if (r.issues.length) act(tn, function (n) { openTrade(r, n); }, r.trade + ': list the activities to act on');
      tr.appendChild(tn);
      var sc = el('td', 'tp-score');
      var sw = el('div', 'tp-scorebar tp-' + r.band.cls);
      sw.appendChild(el('span', 'tp-pill', r.score.toFixed(1)));
      var g = el('span', 'tp-mini'), gi = el('i'); gi.style.width = (r.score / 5 * 100) + '%'; g.appendChild(gi); sw.appendChild(g);
      sc.appendChild(sw); sc.appendChild(el('div', 'tp-band-name', r.band.name));
      tr.appendChild(sc);
      KPIS.forEach(function (K) {
        var m = r.m[K.key], td = el('td', 'tp-kpi');
        if (m.score === null) {
          td.className += ' tp-na'; td.appendChild(el('span', 'tp-pct', 'NA'));
          C.attachTooltip(td, r.trade + ' · ' + K.label + '\nNo activities in that week, not scored');
        } else {
          td.className += ' tp-' + scoreCls(m.score);
          var cellTop = el('div', 'tp-cell');
          cellTop.appendChild(el('span', 'tp-pct', Math.round(m.pct) + '%'));
          cellTop.appendChild(el('span', 'tp-s', String(m.score)));
          td.appendChild(cellTop);
          td.appendChild(el('div', 'tp-n', m.n + ' of ' + m.of));
          C.attachTooltip(td, r.trade + ' · ' + K.label + '\n' + m.n + ' of ' + m.of + ' (' + C.fmtPct(m.pct) + ') ' + K.what + '\nKPI score ' + m.score + ' of 5 · click to list them');
          (function (K, b, m) { act(td, function (n) { openKpi(K, r.trade, b, m, n); }); })(K, r.k[K.key], m);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    empty.hidden = !!list.length;
  }
  draw();

  /* how the score works */
  var how = el('details', 'tp-how');
  how.appendChild(el('summary', null, 'How the score works'));
  var body = el('div', 'tp-key');
  var crit = el('table', 'tp-crit');
  crit.innerHTML = '<thead><tr><th>KPI score</th><th>Outstanding / missed</th><th>Workforce / prerequisites</th></tr></thead>'
    + '<tbody><tr><td>5</td><td>0%</td><td>&ge; 90%</td></tr><tr><td>4</td><td>&le; 10%</td><td>75–89%</td></tr>'
    + '<tr><td>3</td><td>&le; 25%</td><td>50–74%</td></tr><tr><td>2</td><td>&le; 50%</td><td>25–49%</td></tr>'
    + '<tr><td>1</td><td>&gt; 50%</td><td>&lt; 25%</td></tr></tbody>';
  body.appendChild(crit);
  var legend = el('div', 'tp-legend');
  legend.appendChild(el('span', 'tp-legend-t', 'The trade score is the average of its KPI scores.'));
  BANDS.forEach(function (B) {
    var s = el('span'); s.appendChild(el('i', 'tp-sw tp-' + B.cls));
    s.appendChild(document.createTextNode(B.range + ' ' + B.name)); legend.appendChild(s);
  });
  legend.appendChild(el('span', null, 'NA = no activities in that week, not scored'));
  if (!FX.constraints) legend.appendChild(el('span', null, 'No constraint feed: every delayed activity counts as outstanding'));
  body.appendChild(legend);
  how.appendChild(body);
  card.appendChild(how);
  sec.appendChild(card);
  panel.appendChild(sec);
})();
