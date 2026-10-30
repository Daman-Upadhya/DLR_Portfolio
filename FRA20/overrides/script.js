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
