/* Aggregation under the slicer filter context. Pure: facts in, view model out, no DOM.

   calculation.py (the universal logic) derives every per-row flag and embeds the rows as
   D.metrics.facts. This file is the "filter context" layer the Power BI report gets from its
   slicers: it slices those rows by the chosen date range and organisation / trade / location
   and re-aggregates them exactly as the DAX measures do. No flag is re-derived here.

   Filter semantics, as in the model's relationships:
   - the date range applies to tasks by plannedEndDate, to commitments by committedEndDate
     and to constraints by targetDate (the Calendar relationships);
   - organisation / trade / location come from the task; a commitment inherits its activity's
     values; a constraint inherits its linked activity's, or uses its own owner organisation /
     trade / location when it is not linked;
   - the "!!" measures carry CALCULATE(..., IsLastSixWeeks = "Yes"), which intersects the
     range with the last-six-weeks window: tiles and the running PPC use range ∩ window,
     everything else uses the range.

   Agg.run(facts, filters, data) -> view ; Agg.options(facts, data) ; Agg.extent(facts) */
(function (global) {
  'use strict';

  var DAY = 864e5;
  function toMs(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function fromMs(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(iso, n) { return fromMs(toMs(iso) + n * DAY); }
  function daysBetween(a, b) { return Math.round((toMs(b) - toMs(a)) / DAY); } /* b - a */
  function mondayOf(iso) { var wd = (new Date(toMs(iso)).getUTCDay() + 6) % 7; return addDays(iso, -wd); }
  function isoWeek(iso) {
    var d = new Date(toMs(iso));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var w = Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
    return d.getUTCFullYear() + '-' + (w < 10 ? '0' : '') + w;
  }
  function weekSpans(lo, hi) {
    var out = [], mon = mondayOf(lo);
    while (mon <= hi && out.length < 520) { out.push({ week: isoWeek(mon), start: mon, end: addDays(mon, 6) }); mon = addDays(mon, 7); }
    return out;
  }
  function inRange(d, lo, hi) { return !!d && (!lo || d >= lo) && (!hi || d <= hi); }
  function pct(n, d) { return d ? Math.round(1000 * n / d) / 10 : null; }
  function round1(x) { return x === null || x === undefined ? null : Math.round(x * 10) / 10; }
  function roundUp(x) { if (x === null || x === undefined) return null; var a = Math.ceil(Math.abs(x) - 1e-9); return x < 0 ? -a : a; }
  /* a constraint's outcome: closed on time / closed late / open, not yet due / open, overdue */
  function consState(r, today) {
    if (r.cp) return r.tg && r.cp > r.tg ? 'closedLate' : 'closedOnTime';
    return r.tg && r.tg < today ? 'openOverdue' : 'openNotDue';
  }
  var NOCAT = 'No category';
  function mean(xs) { var s = 0; xs.forEach(function (x) { s += x; }); return s / xs.length; }
  function get(obj, path, dflt) {
    var cur = obj; var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) { if (!cur || typeof cur !== 'object' || !(parts[i] in cur)) return dflt; cur = cur[parts[i]]; }
    return cur;
  }

  /* Tolerance_Limits: {good:[op,v], watch:[op,v]}; anything else is bad; null is inert. */
  var OPS = { '>=': function (a, b) { return a >= b; }, '>': function (a, b) { return a > b; }, '<=': function (a, b) { return a <= b; }, '<': function (a, b) { return a < b; } };
  function rag(value, rule) {
    if (value === null || value === undefined || !rule) return 'inert';
    var g = rule.good || [], w = rule.watch || [];
    if (OPS[g[0]] && OPS[g[0]](value, g[1])) return 'good';
    if (OPS[w[0]] && OPS[w[0]](value, w[1])) return 'warn';
    return 'bad';
  }

  /* TotalTask / Successful Task(C) / UnSuccessful Task(C): DISTINCTCOUNT over activities. */
  function block(items) {
    var total = {}, ok = {}, no = {};
    items.forEach(function (i) { total[i.g] = 1; if (i.ok) ok[i.g] = 1; else no[i.g] = 1; });
    var t = Object.keys(total).length, s = Object.keys(ok).length;
    return { total: t, successful: s, unsuccessful: Object.keys(no).length, pct: pct(s, t) };
  }
  function keyedCount(xs, key) { var m = {}; xs.forEach(function (x) { var k = key(x); m[k] = (m[k] || 0) + 1; }); return m; }

  /* ---------- filters ---------- */
  function makeFilter(F, UN) {
    var anyAttr = !!(F.org || F.trade || F.loc);
    function a(v) { return v || UN; }
    function taskOk(t) {
      return (!F.org || F.org[a(t.o)]) && (!F.trade || F.trade[a(t.tr)]) && (!F.loc || F.loc[a(t.l)]);
    }
    return {
      anyAttr: anyAttr,
      taskOk: taskOk,
      commOk: function (c, t) { return t ? taskOk(t) : !anyAttr; },
      consOk: function (r, t) {
        /* the Constraints page's own slicers: category, trade and owner as recorded on the constraint */
        if ((F.cat && !F.cat[r.c || NOCAT]) || (F.ctrade && !F.ctrade[a(r.tr)]) || (F.cown && !F.cown[a(r.ow)])) return false;
        if (t) return taskOk(t);
        return (!F.org || F.org[a(r.oo)]) && (!F.trade || F.trade[a(r.tr)]) && (!F.loc || F.loc[a(r.l)]);
      }
    };
  }

  function options(facts, data) {
    var UN = get(data, 'unassignedLabel', 'Unassigned');
    var sets = { org: {}, trade: {}, loc: {}, cat: {}, ctrade: {}, cown: {} };
    facts.tasks.forEach(function (t) { sets.org[t.o || UN] = 1; sets.trade[t.tr || UN] = 1; sets.loc[t.l || UN] = 1; });
    (facts.constraints || []).forEach(function (r) {
      if (!r.g) { sets.org[r.oo || UN] = 1; sets.trade[r.tr || UN] = 1; sets.loc[r.l || UN] = 1; }
      sets.cat[r.c || NOCAT] = 1; sets.ctrade[r.tr || UN] = 1; sets.cown[r.ow || UN] = 1;
    });
    function sorted(m) { return Object.keys(m).sort(function (x, y) { var lx = x === UN || x === NOCAT, ly = y === UN || y === NOCAT; return lx !== ly ? (lx ? 1 : -1) : x.localeCompare(y); }); }
    return { org: sorted(sets.org), trade: sorted(sets.trade), loc: sorted(sets.loc), cat: sorted(sets.cat), ctrade: sorted(sets.ctrade), cown: sorted(sets.cown) };
  }

  function extent(facts) {
    var lo = null, hi = null;
    function see(d) { if (!d) return; if (!lo || d < lo) lo = d; if (!hi || d > hi) hi = d; }
    facts.tasks.forEach(function (t) { see(t.pe); });
    (facts.commitments || []).forEach(function (c) { see(c.ce); });
    (facts.constraints || []).forEach(function (r) { see(r.tg); });
    return { from: lo ? mondayOf(lo) : null, to: hi ? addDays(mondayOf(hi), 6) : null };
  }

  /* ---------- the view model ---------- */
  function run(facts, F, data) {
    var UN = get(data, 'unassignedLabel', 'Unassigned');
    var today = facts.today, W = facts.window, tol = get(data, 'tolerance', {}) || {};
    var byGuid = {};
    facts.tasks.forEach(function (t) { byGuid[t.g] = t; });
    var flt = makeFilter(F, UN);
    var from = F.from || null, to = F.to || null;

    var tasksA = facts.tasks.filter(flt.taskOk);
    var tasksR = tasksA.filter(function (t) { return inRange(t.pe, from, to); });
    var comms = facts.commitments ? facts.commitments.filter(function (c) { return flt.commOk(c, byGuid[c.g]) && inRange(c.ce, from, to); }) : null;
    var cons = facts.constraints ? facts.constraints.filter(function (r) { return flt.consOk(r, r.g ? byGuid[r.g] : null) && inRange(r.tg, from, to); }) : null;

    /* IsLastSixWeeks ∩ range */
    var iFrom = from && from > W.from ? from : W.from, iTo = to && to < W.to ? to : W.to;
    var hasL6W = iFrom <= iTo;
    var tasksL = hasL6W ? tasksR.filter(function (t) { return inRange(t.pe, iFrom, iTo); }) : [];
    var commsL = comms ? (hasL6W ? comms.filter(function (c) { return inRange(c.ce, iFrom, iTo); }) : []) : null;
    var consL = cons ? (hasL6W ? cons.filter(function (r) { return inRange(r.tg, iFrom, iTo); }) : []) : null;

    function citems(list) { return list.map(function (c) { return { g: c.g, ok: c.ok }; }); }
    function within(list, s) { return list.filter(function (c) { return c.ce >= s.start && c.ce <= s.end; }); }

    /* ---- weekly committed PPC over the range (TotalTask / Successful / UnSuccessful per week) ---- */
    var axis = from && to ? { from: from, to: to } : facts.trend;
    var weeks = weekSpans(axis.from, axis.to).map(function (s) {
      return { week: s.week, start: s.start, end: s.end, inWindow: s.start >= W.from && s.start <= W.to,
               committed: comms ? block(citems(within(comms, s))) : null };
    });

    /* ---- !!PPC Avg (6wk Running): AVERAGEX over the window's weeks in the filter context ---- */
    var running = null;
    if (comms && hasL6W) {
      var l6 = weekSpans(W.from, W.to).filter(function (s) { return s.end >= iFrom && s.start <= iTo; });
      var any = false, sum = 0;
      l6.forEach(function (s) { var b = block(citems(within(commsL, s))); if (b.total) any = true; sum += b.pct || 0; });
      running = any && l6.length ? round1(sum / l6.length) : null;
    }
    var committedL6W = commsL ? block(citems(commsL)) : null;
    var committedAll = comms ? block(citems(comms)) : null;

    /* ---- activity measures over tasks with plannedEndDate in range ∩ window ---- */
    var due = tasksL.filter(function (t) { return t.due; }), late = due.filter(function (t) { return t.late; });
    var delays = tasksL.filter(function (t) { return t.dd !== null && t.dd !== undefined; }).map(function (t) { return t.dd; });
    var durs = tasksL.filter(function (t) { return t.d !== null && t.d !== undefined; }).map(function (t) { return t.d; });
    var perWeek = keyedCount(tasksL, function (t) { return t.pw; });
    var pwKeys = Object.keys(perWeek);
    var activity = {
      tasksInWindow: tasksL.length,
      delayedPct: tasksL.length ? pct(late.length, due.length) : null, delayedCount: late.length, dueCount: due.length,
      avgDelayDays: tasksL.length ? (delays.length ? roundUp(mean(delays)) : 0) : null,
      avgPlannedDuration: durs.length ? round1(mean(durs)) : null,
      avgPerWeek: pwKeys.length ? round1(tasksL.length / pwKeys.length) : null
    };

    /* ---- committed PPC by group (range ∩ window) ---- */
    var by = get(data, 'groupBy', 'organisation');
    var field = { organisation: 'o', trade: 'tr', location: 'l' }[by] || 'o';
    var topN = get(data, 'breakdown.topN', 10);
    var groups = {};
    (commsL || []).forEach(function (c) { var t = byGuid[c.g]; var k = (t && t[field]) || UN; (groups[k] = groups[k] || []).push({ g: c.g, ok: c.ok }); });
    var delayedByGroup = keyedCount(tasksL.filter(function (t) { return t.dl; }), function (t) { return t[field] || UN; });
    var brows = Object.keys(groups).map(function (k) { var b = block(groups[k]); b.label = k; b.delayed = delayedByGroup[k] || 0; return b; });
    brows.sort(function (x, y) { return y.total - x.total || x.label.localeCompare(y.label); });
    var breakdown = { by: by, byLabel: (get(data, 'groupByLabel', {}) || {})[by] || by, rows: brows.slice(0, topN), others: brows.slice(topN) };

    /* ---- performance per trade / organisation for the last complete committed week (range) ---- */
    function performance(by, key) {
      if (!comms) return null;
      var done = comms.filter(function (c) { return c.ce <= W.to; });
      if (!done.length) return { by: by, week: null, rows: [], groups: 0, belowTarget: 0, critical: 0, overall: null, previousOverall: null };
      var lastCe = done.reduce(function (m, c) { return c.ce > m ? c.ce : m; }, done[0].ce);
      var mon = mondayOf(lastCe), wk = isoWeek(mon), pwk = isoWeek(addDays(mon, -7));
      function items(k) { return comms.filter(function (c) { return c.cw === k; }).map(function (c) { var t = byGuid[c.g]; return { g: c.g, ok: c.ok, group: (t && t[key]) || UN }; }); }
      var cur = items(wk), prev = items(pwk);
      var rows = Object.keys(keyedCount(cur, function (i) { return i.group; })).sort().map(function (g) {
        var b = block(cur.filter(function (i) { return i.group === g; })), pb = block(prev.filter(function (i) { return i.group === g; }));
        return { label: g, total: b.total, successful: b.successful, unsuccessful: b.unsuccessful, pct: b.pct, previousPct: pb.pct, previousTotal: pb.total,
                 delta: b.pct === null || pb.pct === null ? null : round1(b.pct - pb.pct), tone: rag(b.pct, tol.ppc) };
      });
      rows.sort(function (x, y) { return (x.pct === null ? 101 : x.pct) - (y.pct === null ? 101 : y.pct) || y.unsuccessful - x.unsuccessful || x.label.toLowerCase().localeCompare(y.label.toLowerCase()); });
      return { by: by, week: wk, start: mon, end: addDays(mon, 6), previousWeek: pwk, overall: block(cur), previousOverall: block(prev), rows: rows, groups: rows.length,
               belowTarget: rows.filter(function (r) { return r.tone === 'warn' || r.tone === 'bad'; }).length, critical: rows.filter(function (r) { return r.tone === 'bad'; }).length };
    }
    var tp = performance('trade', 'tr'), op = performance('organisation', 'o');

    /* ---- reasons for variance by trade, activities that missed a commitment in the range ---- */
    var mapping = get(data, 'reasons.categories', {}) || {};
    function categoryOf(r) { for (var k in mapping) if (mapping[k].indexOf(r) >= 0) return k; return 'Unmapped'; }
    var rb = null;
    if (comms) {
      var missed = {}, without = 0;
      comms.forEach(function (c) { if (!c.ok) missed[c.g] = 1; });
      var catCount = {}, perTrade = {};
      Object.keys(missed).forEach(function (g) {
        var t = byGuid[g];
        if (!(t && t.rs && t.rs.length)) { without++; return; }   /* no recorded reason: left out of this visual */
        var cm = {}; t.rs.forEach(function (r) { cm[categoryOf(r)] = 1; });
        var cats = Object.keys(cm).sort();
        var row = perTrade[(t && t.tr) || UN] = perTrade[(t && t.tr) || UN] || { activities: 0, parts: {} };
        row.activities += 1;
        cats.forEach(function (c) { catCount[c] = (catCount[c] || 0) + 1; row.parts[c] = (row.parts[c] || 0) + 1; });
      });
      var ordered = Object.keys(catCount).sort(function (x, y) { return catCount[y] - catCount[x] || x.localeCompare(y); });
      rb = { missed: Object.keys(missed).length, activities: Object.keys(missed).length - without, withoutReason: without, categories: ordered.map(function (c) { return { label: c, count: catCount[c] }; }),
             rows: Object.keys(perTrade).map(function (tr) {
               var r = perTrade[tr];
               return { trade: tr, activities: r.activities, parts: ordered.filter(function (c) { return r.parts[c]; }).map(function (c) { return { label: c, count: r.parts[c] }; }) };
             }).sort(function (x, y) { return y.activities - x.activities || x.trade.localeCompare(y.trade); }) };
    }

    /* ---- reasons for variance over the range's tasks ---- */
    var cats = {}, withReason = 0;
    tasksR.forEach(function (t) {
      if (t.rs.length) withReason++;
      var seen = {};
      t.rs.forEach(function (r) {
        var cat = categoryOf(r);
        var e = cats[cat] = cats[cat] || { label: cat, tasks: 0, reasons: {} };
        e.reasons[r] = (e.reasons[r] || 0) + 1;
        if (!seen[cat]) { e.tasks++; seen[cat] = 1; }
      });
    });
    var reasonRows = Object.keys(cats).map(function (k) {
      var c = cats[k];
      return { label: c.label, tasks: c.tasks, reasons: Object.keys(c.reasons).map(function (r) { return { label: r, tasks: c.reasons[r] }; }).sort(function (x, y) { return y.tasks - x.tasks; }) };
    }).sort(function (x, y) { return y.tasks - x.tasks || x.label.localeCompare(y.label); });
    var events = {};
    (get(data, 'reasons.events', []) || []).forEach(function (e) { events[e[1]] = 0; });
    tasksR.forEach(function (t) { t.ev.forEach(function (e) { events[e] = (events[e] || 0) + 1; }); });
    var standard = keyedCount([].concat.apply([], tasksR.map(function (t) { return t.ss; })), function (s) { return s; });
    var reasons = {
      categories: reasonRows, tasksWithReason: withReason, tasks: tasksR.length,
      events: Object.keys(events).map(function (k) { return { label: k, tasks: events[k] }; }),
      standard: Object.keys(standard).map(function (k) { return { label: k, tasks: standard[k] }; }).sort(function (x, y) { return y.tasks - x.tasks || x.label.localeCompare(y.label); })
    };

    /* ---- status, totals, delayed list over the range's tasks ---- */
    var order = get(data, 'status.order', []) || [], labels = get(data, 'status.labels', {}) || {};
    var sc = keyedCount(tasksR, function (t) { return t.st || 'Unknown'; });
    var statusKeys = order.filter(function (s) { return sc[s]; }).concat(Object.keys(sc).filter(function (s) { return order.indexOf(s) < 0; }));
    var statusCounts = statusKeys.map(function (s) { return { status: s, label: labels[s] || s, count: sc[s], share: pct(sc[s], tasksR.length) }; });
    var types = keyedCount(tasksR, function (t) { return t.ty || '(none)'; });
    var totals = {
      tasks: tasksR.length, delayed: tasksR.filter(function (t) { return t.dl; }).length, complete: tasksR.filter(function (t) { return t.ae; }).length,
      byType: Object.keys(types).map(function (k) { return { type: k, count: types[k] }; }).sort(function (x, y) { return y.count - x.count; }),
      noPlannedEnd: tasksA.filter(function (t) { return !t.pe; }).length,
      allTasks: facts.tasks.length, attrTasks: tasksA.length,
      /* project totals for the top panel: the whole feed under the organisation, trade and location
         filters, not the date range. One task row is one unique activity from the task history. */
      project: {
        activities: tasksA.length,
        trades: Object.keys(keyedCount(tasksA.filter(function (t) { return t.tr; }), function (t) { return t.tr; })).length
      }
    };
    var limit = get(data, 'delayed.tableLimit', 25), bucketsCfg = get(data, 'delayed.buckets', [[1, 7], [8, 14], [15, 30], [31, 60], [61, null]]);
    var lateRows = tasksR.filter(function (t) { return t.dl; }).map(function (t) {
      return { id: t.id, name: t.n, trade: t.tr, organisation: t.o, location: t.l, status: t.st, plannedStart: t.ps, plannedEnd: t.pe, delayDays: t.dd, kind: t.dk };
    }).sort(function (x, y) { return (y.delayDays || 0) - (x.delayDays || 0) || x.name.localeCompare(y.name); });
    var delayed = {
      count: lateRows.length, rows: lateRows.slice(0, limit), more: Math.max(0, lateRows.length - limit),
      buckets: bucketsCfg.map(function (b) {
        var lo = b[0], hi = b[1];
        return { label: hi === null ? lo + '+ days' : lo + '-' + hi + ' days', min: lo, max: hi,
                 count: lateRows.filter(function (x) { return x.delayDays !== null && x.delayDays >= lo && (hi === null || x.delayDays <= hi); }).length };
      }),
      notStarted: lateRows.filter(function (x) { return x.kind === 'Not started'; }).length,
      notFinished: lateRows.filter(function (x) { return x.kind === 'Not finished'; }).length
    };

    /* ---- constraints (port of constraint_kpis) ---- */
    var constraints = null;
    if (cons) {
      var first = {}, uidOrder = [];
      cons.forEach(function (r) { if (!first[r.u]) { first[r.u] = r; uidOrder.push(r.u); } });
      var firsts = uidOrder.map(function (u) { return first[u]; });
      function doneBy(r, limitDate) { return !!r.cp && !!limitDate && r.cp <= limitDate; }
      function uids(list) { var m = {}; list.forEach(function (r) { m[r.u] = 1; }); return Object.keys(m).length; }
      var linkedRows = cons.filter(function (r) { return r.g; });
      var lags = {};
      cons.forEach(function (r) { if (r.cp && r.tg) { var v = daysBetween(r.tg, r.cp); if (!(r.u in lags) || v > lags[r.u]) lags[r.u] = v; } });
      var lagVals = Object.keys(lags).map(function (u) { return lags[u]; });
      var st = { Open: 0, Committed: 0, Closed: 0 };
      firsts.forEach(function (r) { st[r.s] = (st[r.s] || 0) + 1; });
      var catMap = keyedCount(firsts.filter(function (r) { return r.c; }), function (r) { return r.c; });
      var climit = get(data, 'constraints.tableLimit', 15);
      /* open = no completion date; overdue = open and the target date is before today */
      var overdue = firsts.filter(function (r) { return r.tg && r.tg < today && !r.cp; }).map(function (r) {
        return { title: r.t, category: r.c, status: r.s, owner: r.ow, target: r.tg, taskName: r.tn, overdueDays: daysBetween(r.tg, today) };
      }).sort(function (x, y) { return y.overdueDays - x.overdueDays || x.title.localeCompare(y.title); });
      var beforeStart = uids(linkedRows.filter(function (r) { return doneBy(r, r.tps); }));
      var cweeks = weekSpans(axis.from, axis.to).map(function (s) {
        var dueW = firsts.filter(function (r) { return inRange(r.tg, s.start, s.end); });
        var onTime = dueW.filter(function (r) { return doneBy(r, r.tg); }).length, open = dueW.filter(function (r) { return !r.cp; }).length;
        return { week: s.week, start: s.start, end: s.end, inWindow: s.start >= W.from && s.start <= W.to, due: dueW.length, onTime: onTime, late: dueW.length - onTime - open, open: open,
                 created: firsts.filter(function (r) { return inRange(r.cr, s.start, s.end); }).length,
                 completed: firsts.filter(function (r) { return inRange(r.cp, s.start, s.end); }).length };
      });
      var STATES = ['closedOnTime', 'closedLate', 'openNotDue', 'openOverdue'];
      var split = { closedOnTime: 0, closedLate: 0, openNotDue: 0, openOverdue: 0 };
      firsts.forEach(function (r) { split[consState(r, today)]++; });
      function grouped(key) {
        var g = {};
        firsts.forEach(function (r) {
          var k = key(r) || UN, row = g[k] = g[k] || { label: k, total: 0, closedOnTime: 0, closedLate: 0, openNotDue: 0, openOverdue: 0 };
          row.total++; row[consState(r, today)]++;
        });
        /* most open constraints first, then the most raised */
        return Object.keys(g).map(function (k) { return g[k]; }).sort(function (x, y) {
          return (y.openNotDue + y.openOverdue) - (x.openNotDue + x.openOverdue) || y.total - x.total || (x.label < y.label ? -1 : x.label > y.label ? 1 : 0);
        });
      }
      var openFirsts = firsts.filter(function (r) { return !r.cp; });
      var resolve = firsts.filter(function (r) { return r.cp && r.cr; }).map(function (r) { return daysBetween(r.cr, r.cp); });
      var ages = openFirsts.filter(function (r) { return r.cr; }).map(function (r) { return daysBetween(r.cr, today); });
      var ageing = (get(data, 'constraints.ageBuckets', null) || [[0, 7], [8, 14], [15, 30], [31, 60], [61, null]]).map(function (b) {
        var lo = b[0], hi = b[1];
        return { from: lo, to: hi, label: hi === null ? lo + '+ days' : lo + '–' + hi + ' days',
                 count: ages.filter(function (a) { return a >= lo && (hi === null || a <= hi); }).length };
      });
      var prioOrder = get(data, 'constraints.priorityOrder', null) || ['High', 'Medium', 'Low'];
      var prioMap = keyedCount(firsts, function (r) { return r.p || 'No priority'; });
      function prioRank(k) { var i = prioOrder.indexOf(k); return i >= 0 ? i : prioOrder.length + (k === 'No priority' ? 1 : 0); }
      constraints = {
        total: firsts.length, open: firsts.filter(function (r) { return !r.cp; }).length,
        status: Object.keys(st).map(function (k) { return { status: k, count: st[k] }; }),
        overduePct: consL.length ? pct(consL.filter(function (r) { return r.tg && r.tg < today && !r.cp; }).length, consL.length) : null,
        resolvedOnTimePct: uids(consL) ? pct(uids(consL.filter(function (r) { return doneBy(r, r.tg); })), uids(consL)) : null,
        unlinkedPct: pct(cons.filter(function (r) { return !r.g; }).length, cons.length),
        avgLagDays: lagVals.length ? roundUp(mean(lagVals)) : null,
        linked: uids(linkedRows), beforeStart: beforeStart, beforeStartPct: pct(beforeStart, uids(linkedRows)),
        unsuccessful: uids(linkedRows.filter(function (r) { return r.tg && r.tg < today && (!r.cp || !r.tps || r.cp > r.tps); })),
        beforeTarget: uids(cons.filter(function (r) { return doneBy(r, r.tg); })),
        categorised: firsts.filter(function (r) { return r.c; }).length,
        byCategory: Object.keys(catMap).map(function (k) { return { label: k, count: catMap[k] }; }).sort(function (x, y) { return y.count - x.count || x.label.localeCompare(y.label); }),
        weeks: cweeks, overdue: overdue.slice(0, climit), overdueCount: overdue.length,
        overdueDays: overdue.reduce(function (a, x) { return a + x.overdueDays; }, 0),
        split: split, states: STATES,
        /* mean days from creation to completion (closed), and from creation to today (open) */
        avgResolveDays: resolve.length ? round1(mean(resolve)) : null,
        avgOpenAgeDays: ages.length ? round1(mean(ages)) : null,
        ageing: ageing,
        byPriority: Object.keys(prioMap).map(function (k) { return { label: k, count: prioMap[k] }; })
          .sort(function (x, y) { return prioRank(x.label) - prioRank(y.label) || (x.label < y.label ? -1 : 1); }),
        /* the responsible owner and the trade as recorded on the constraint itself */
        byOwner: grouped(function (r) { return r.ow; }),
        byTrade: grouped(function (r) { return r.tr; })
      };
      constraints.notBeforeTarget = constraints.total - constraints.beforeTarget;
    }

    return {
      range: { from: axis.from, to: axis.to }, l6w: { from: iFrom, to: iTo, valid: hasL6W }, today: today,
      feeds: { committed: !!facts.commitments, constraints: !!facts.constraints },
      weeks: weeks, running: running, committed: committedL6W, committedAll: committedAll,
      commitmentRows: comms ? comms.length : null,
      activity: activity, breakdown: breakdown, tradePerformance: tp, orgPerformance: op, reasonsByTrade: rb, reasons: reasons,
      statusCounts: statusCounts, totals: totals, delayed: delayed, constraints: constraints,
      /* the filtered sets behind every measure, for records() */
      sets: { tasksA: tasksA, tasksR: tasksR, tasksL: tasksL, comms: comms, commsL: commsL, cons: cons, consL: consL, byGuid: byGuid, today: today, UN: UN },
      tones: {
        lastWeek: rag(tp && tp.overall ? tp.overall.pct : null, tol.ppc),
        ppcCommitted: rag(committedL6W ? committedL6W.pct : null, tol.ppc), ppcRunning: rag(running, tol.ppc),
        activityDelayed: rag(activity.delayedPct, tol.activityDelayed), avgDelay: rag(activity.avgDelayDays, tol.avgDelay),
        plannedDuration: rag(activity.avgPlannedDuration, tol.plannedDuration), weeklyPlanned: rag(activity.avgPerWeek, tol.weeklyPlanned),
        constraintsOverdue: rag(constraints ? constraints.overduePct : null, tol.constraintsOverdue),
        constraintsOnTime: rag(constraints ? constraints.resolvedOnTimePct : null, tol.constraintsOnTime),
        constraintLag: rag(constraints ? constraints.avgLagDays : null, tol.constraintLag),
        unlinked: rag(constraints ? constraints.unlinkedPct : null, tol.unlinked)
      }
    };
  }

  /* ---------- the records behind a mark, for the detail list ----------
     records(V, spec, data) -> rows. V is a run() result; the rows come from the same filtered sets
     the measures were computed from, so a list always matches the number that was clicked.
     spec.type:
       'commits'      commitments in the range (spec.l6w: range ∩ window), optional week, ok,
                      by ('trade' | 'organisation') + groups [values]
       'missed'       activities that missed a commitment in the range and have a recorded
                      reason (the reasons-by-trade visual), optional by + groups, categories
       'tasks'        activities planned to end in the range (spec.set 'l6w': range ∩ window),
                      spec.pred: all | late | delayDays | duration | reason | event | standard
       'constraints'  constraints with a target in the range (spec.l6w for the L6W tiles),
                      spec.pred: all | open | overdue | pastTarget | onTime | lag | unlinked |
                      beforeStart | status | category | week (+ start, end, state) */
  function records(V, spec, data) {
    var X = V.sets, UN = X.UN, today = X.today;
    var mapping = get(data, 'reasons.categories', {}) || {};
    function catOf(r) { for (var k in mapping) if (mapping[k].indexOf(r) >= 0) return k; return 'Unmapped'; }
    function cats(t) { var m = {}; ((t && t.rs) || []).forEach(function (r) { m[catOf(r)] = 1; }); return Object.keys(m).sort(); }
    function hit(list, want) { if (!want) return true; for (var i = 0; i < list.length; i++) if (want.indexOf(list[i]) >= 0) return true; return false; }
    var GK = { trade: 'tr', organisation: 'o', location: 'l' };
    function act(t, c) {
      return { kind: 'activity', g: t ? t.g : (c ? c.g : null), id: t ? t.id : null, name: t ? t.n : 'Activity not in the task feed', type: t ? t.ty : null,
               trade: t ? t.tr : null, organisation: t ? t.o : null, location: t ? t.l : null, status: t ? t.st : null,
               plannedStart: t ? t.ps : null, plannedEnd: t ? t.pe : null, actualStart: t ? t.as : null, actualEnd: t ? t.ae : null,
               committedWeek: c ? c.cw : null, committedEnd: c ? c.ce : null, kept: c ? !!c.ok : null,
               delayDays: t ? t.dd : null, delayKind: t ? t.dk : null, duration: t ? t.d : null,
               categories: cats(t), reasons: t ? t.rs : [], events: t ? t.ev : [] };
    }
    function byName(x, y) { return (x.name || '').localeCompare(y.name || ''); }

    if (spec.type === 'commits' || spec.type === 'missed') {
      var src = (spec.l6w ? X.commsL : X.comms) || [], seen = {}, out = [];
      src.forEach(function (c) {
        if (spec.week && c.cw !== spec.week) return;
        if (spec.type === 'missed' && c.ok) return;
        if (spec.ok !== undefined && spec.ok !== null && !!c.ok !== spec.ok) return;
        var t = X.byGuid[c.g];
        if (spec.by && spec.groups) { var gv = (t && t[GK[spec.by]]) || UN; if (spec.groups.indexOf(gv) < 0) return; }
        if (spec.type === 'missed' && (!t || !t.rs.length || !hit(cats(t), spec.categories))) return;
        /* DISTINCTCOUNT: one row per activity per committed week and outcome */
        var k = spec.type === 'missed' ? c.g : c.g + '|' + c.cw + '|' + (c.ok ? 1 : 0);
        if (seen[k]) return;
        seen[k] = 1;
        out.push(act(t, c));
      });
      return out.sort(function (x, y) {
        return (x.kept === y.kept ? 0 : (x.kept ? 1 : -1)) || (y.committedWeek || '').localeCompare(x.committedWeek || '')
          || (x.trade || '').localeCompare(y.trade || '') || byName(x, y);
      });
    }

    if (spec.type === 'tasks') {
      var base = spec.set === 'l6w' ? X.tasksL : X.tasksR;
      var P = {
        all: function () { return true; },
        late: function (t) { return t.due && t.late; },
        delayDays: function (t) { return t.dd !== null && t.dd !== undefined; },
        duration: function (t) { return t.d !== null && t.d !== undefined; },
        reason: function (t) { return t.rs.length > 0 && hit(cats(t), spec.categories); },
        event: function (t) { return spec.event ? t.ev.indexOf(spec.event) >= 0 : t.ev.length > 0; },
        standard: function (t) { return t.ss.indexOf(spec.group) >= 0; }
      }[spec.pred || 'all'];
      return base.filter(P).map(function (t) { return act(t, null); }).sort(function (x, y) {
        return ((y.delayDays || 0) - (x.delayDays || 0)) || (x.plannedEnd || '').localeCompare(y.plannedEnd || '') || byName(x, y);
      });
    }

    if (spec.type === 'constraints') {
      var rows = (spec.l6w ? X.consL : X.cons) || [];
      var Q = {
        all: function () { return true; },
        open: function (r) { return !r.cp; },
        closed: function (r) { return !!r.cp; },
        overdue: function (r) { return r.tg && r.tg < today && !r.cp; },
        pastTarget: function (r) { return r.tg && r.tg < today && !r.cp; },
        onTime: function (r) { return r.cp && r.tg && r.cp <= r.tg; },
        lag: function (r) { return r.cp && r.tg; },
        unlinked: function (r) { return !r.g; },
        beforeStart: function (r) { return r.g && r.cp && r.tps && r.cp <= r.tps; },
        status: function (r) { return r.s === spec.value; },
        category: function (r) { return r.c === spec.value; },
        noCategory: function (r) { return !r.c; },
        state: function (r) { return consState(r, today) === spec.value; },
        priority: function (r) { return (r.p || 'No priority') === spec.value; },
        owner: function (r) { return (r.ow || UN) === spec.value && (!spec.state || consState(r, today) === spec.state); },
        trade: function (r) { return (r.tr || UN) === spec.value && (!spec.state || consState(r, today) === spec.state); },
        age: function (r) { if (r.cp || !r.cr) return false; var a = daysBetween(r.cr, today); return a >= spec.from && (spec.to === null || a <= spec.to); },
        week: function (r) {
          if (!inRange(r.tg, spec.start, spec.end)) return false;
          if (spec.state === 'onTime') return r.cp && r.cp <= r.tg;
          if (spec.state === 'open') return !r.cp;
          if (spec.state === 'late') return r.cp && r.cp > r.tg;
          return true;
        }
      }[spec.pred || 'all'];
      var keep = {}, order = [], names = {};
      rows.forEach(function (r) {
        if (r.tn) (names[r.u] = names[r.u] || {})[r.tn] = 1;
        if (Q(r) && !keep[r.u]) { keep[r.u] = r; order.push(r.u); }
      });
      return order.map(function (u) {
        var r = keep[u];
        return { kind: 'constraint', id: u, title: r.t, category: r.c, priority: r.p, owner: r.ow, ownerOrganisation: r.oo, trade: r.tr, location: r.l, status: r.s,
                 created: r.cr, target: r.tg, commitment: r.cm, completion: r.cp,
                 activities: Object.keys(names[u] || {}),
                 overdueDays: r.tg && r.tg < today && !r.cp ? daysBetween(r.tg, today) : null,
                 lagDays: r.cp && r.tg ? daysBetween(r.tg, r.cp) : null };
      }).sort(function (x, y) { return ((y.overdueDays || -1) - (x.overdueDays || -1)) || (x.target || '').localeCompare(y.target || '') || (x.title || '').localeCompare(y.title || ''); });
    }
    return [];
  }

  /* ---------- PPC review (the export): weekly and rolling PPC, overall and per trade ----------
     review(facts, F, data) -> { V, rollingWeeks, weeks, trades, totals, latestRolling, activities }
     Weeks are the ISO weeks of the selected range. The rolling PPC of a week is the mean of the
     weekly committed PPC over the N weeks ending that week (data.ppc.rollingWeeks, default 6),
     looking back before the range start when the range is shorter than N:
       overall  a week with no commitments counts as 0, as the Power BI "PPC Avg (6wk Running)"
                does, so the last range week equals the "6-week rolling PPC" tile; the window
                never starts before the first week of the commitment feed;
       trade    only the weeks in which the trade had commitments count.
     Counts are DISTINCTCOUNT(activity), as everywhere else. */
  function review(facts, F, data) {
    var V = run(facts, F, data), X = V.sets, UN = X.UN;
    var N = Math.max(1, +get(data, 'ppc.rollingWeeks', 6) || 6);
    var tol = (get(data, 'tolerance', {}) || {}).ppc;
    var weeks = V.weeks;
    var empty = { V: V, rollingWeeks: N, weeks: [], trades: [], totals: null, latestRolling: null, latestTone: 'inert', activities: [] };
    if (!facts.commitments || !weeks.length) return empty;
    var flt = makeFilter(F, UN);
    var spans = weekSpans(addDays(weeks[0].start, -7 * (N - 1)), weeks[weeks.length - 1].end);
    var off = spans.length - weeks.length;
    var byWeek = {};
    spans.forEach(function (s) { byWeek[s.week] = { all: [], tr: {} }; });
    facts.commitments.forEach(function (c) {
      var t = X.byGuid[c.g];
      if (!flt.commOk(c, t)) return;
      var w = byWeek[c.cw];
      if (!w) return;
      var it = { g: c.g, ok: c.ok }, tr = (t && t.tr) || UN;
      w.all.push(it);
      (w.tr[tr] = w.tr[tr] || []).push(it);
    });
    /* the look-back never reaches before the first week of the commitment feed: weeks before
       commitments were recorded are not 0% weeks, they are weeks without a measurement */
    var firstWeek = facts.commitments.reduce(function (m, c) { return !m || c.cw < m ? c.cw : m; }, null);
    function windowOf(j) { return spans.slice(Math.max(0, j - N + 1), j + 1).filter(function (s) { return !firstWeek || s.week >= firstWeek; }); }
    function rollingAll(j) {
      var win = windowOf(j).map(function (s) { return block(byWeek[s.week].all); });
      if (!win.length || !win.some(function (b) { return b.total; })) return null;
      return round1(win.reduce(function (a, b) { return a + (b.pct || 0); }, 0) / win.length);
    }
    function rollingTrade(j, tr) {
      var win = windowOf(j).map(function (s) { return byWeek[s.week].tr[tr]; }).filter(Boolean).map(block);
      return win.length ? round1(win.reduce(function (a, b) { return a + b.pct; }, 0) / win.length) : null;
    }
    var rangeItems = [], tradeItems = {};
    var overall = weeks.map(function (w, i) {
      var j = i + off, bw = byWeek[spans[j].week];
      rangeItems = rangeItems.concat(bw.all);
      Object.keys(bw.tr).forEach(function (tr) { tradeItems[tr] = (tradeItems[tr] || []).concat(bw.tr[tr]); });
      var b = block(bw.all);
      return { week: w.week, start: w.start, end: w.end, inWindow: w.inWindow, total: b.total, successful: b.successful,
               unsuccessful: b.unsuccessful, pct: b.pct, rolling: rollingAll(j), tone: rag(b.pct, tol) };
    });
    var trades = Object.keys(tradeItems).map(function (tr) {
      var b = block(tradeItems[tr]), last = null;
      var ws = weeks.map(function (w, i) {
        var j = i + off, bb = block(byWeek[spans[j].week].tr[tr] || []), r = rollingTrade(j, tr);
        if (r !== null) last = r;
        return { week: w.week, total: bb.total, successful: bb.successful, pct: bb.pct, rolling: r, tone: rag(r, tol) };
      });
      return { trade: tr, total: b.total, successful: b.successful, unsuccessful: b.unsuccessful, pct: b.pct, weeks: ws,
               latestRolling: last, tone: rag(last, tol) };
    }).sort(function (x, y) {
      return (x.latestRolling === null ? 101 : x.latestRolling) - (y.latestRolling === null ? 101 : y.latestRolling) || y.total - x.total || x.trade.localeCompare(y.trade);
    });
    var latest = null;
    overall.forEach(function (w) { if (w.rolling !== null) latest = w.rolling; });
    var inRange = {};
    weeks.forEach(function (w) { inRange[w.week] = 1; });
    var order = {};
    trades.forEach(function (t, i) { order[t.trade] = i; });
    var acts = records(V, { type: 'commits' }, data).filter(function (r) { return inRange[r.committedWeek]; }).sort(function (x, y) {
      return (order[x.trade || UN] - order[y.trade || UN]) || (x.committedWeek || '').localeCompare(y.committedWeek || '')
        || (x.kept === y.kept ? 0 : (x.kept ? 1 : -1)) || (x.name || '').localeCompare(y.name || '');
    });
    var totals = block(rangeItems);
    return { V: V, rollingWeeks: N, weeks: overall, trades: trades, totals: totals, totalsTone: rag(totals.pct, tol),
             latestRolling: latest, latestTone: rag(latest, tol), activities: acts, unassigned: UN };
  }

  global.Agg = { run: run, records: records, review: review, options: options, extent: extent, isoWeek: isoWeek, mondayOf: mondayOf, addDays: addDays, weekSpans: weekSpans };
})(window);
