/* Chart renderers. Pure DOM/SVG, no library. Every function takes a container and data
   that calculation.py already computed; nothing here does metric math.

   - stackedTrack(el, segments)        one CSS flex track split into coloured segments
   - barRows(el, rows, opts)           ranked rows, each a track scaled to its share of the max
   - lineChart(svg, spec)              SVG viewBox 0 0 640 220, planned vs actual lines
   - columnChart(svg, spec)            SVG grouped columns on a 0-100% axis, target line, shaded band
   - gauge(svg, value, opts)           SVG half-circle score gauge
   - attachTooltip(el, text)           hover + focus tooltip, keyboard reachable
*/
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* ---------- tooltip: one floating element shared by every mark ---------- */
  var tip = null;
  function ensureTip() {
    if (tip) return tip;
    tip = el('div', 'tip');
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
    return tip;
  }
  function showTip(target, text) {
    var t = ensureTip();
    t.textContent = text;
    t.hidden = false;
    var r = target.getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top;
    t.style.left = '0px'; t.style.top = '0px';
    var tw = t.offsetWidth, th = t.offsetHeight;
    var left = Math.min(Math.max(8, x - tw / 2), window.innerWidth - tw - 8);
    var top = y - th - 8;
    if (top < 8) top = r.bottom + 8;
    t.style.left = left + window.scrollX + 'px';
    t.style.top = top + window.scrollY + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }

  function attachTooltip(target, text) {
    if (!text) return;
    target._tip = text;
    target.setAttribute('tabindex', '0');
    target.setAttribute('aria-label', text);
    target.addEventListener('mouseenter', function () { showTip(target, target._tip); });
    target.addEventListener('mouseleave', hideTip);
    target.addEventListener('focus', function () { showTip(target, target._tip); });
    target.addEventListener('blur', hideTip);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });

  /* a mark that opens the records behind it: pointer, keyboard (Enter / Space) and a hint */
  function pickable(node, fn) {
    if (!fn) return;
    node.classList.add('pick');
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    if (node._tip) { node._tip += ' · Click to list them'; node.setAttribute('aria-label', node._tip); }
    node.addEventListener('click', function (e) { e.stopPropagation(); hideTip(); fn(node); });
    node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideTip(); fn(node); } });
  }
  window.addEventListener('scroll', hideTip, { passive: true });

  /* ---------- stacked track ---------- */
  /* segments: [{label, count, share, cls, tip}] ; share in percent */
  function stackedTrack(container, segments) {
    container.innerHTML = '';
    var track = el('div', 'track');
    var total = 0;
    segments.forEach(function (s) { total += s.count || 0; });
    if (!total) {
      container.appendChild(el('div', 'empty', 'No activities to show.'));
      return;
    }
    segments.forEach(function (s) {
      if (!s.count) return;
      var seg = el('div', 'seg ' + (s.cls || ''));
      seg.style.flexGrow = String(s.count);
      attachTooltip(seg, s.tip || (s.label + ': ' + s.count + ' (' + fmtPct(s.share) + ')'));
      pickable(seg, s.pick);
      track.appendChild(seg);
    });
    container.appendChild(track);
  }

  /* ---------- ranked bar rows ---------- */
  /* rows: [{label, total, parts:[{count, cls, label}], value?, valueText?}]
     The row's track width is its total as a share of the largest total, so rows compare
     across the list while the stack stays proportional within the row. */
  function barRows(container, rows, opts) {
    opts = opts || {};
    container.innerHTML = '';
    if (!rows.length) {
      container.appendChild(el('div', 'empty', opts.emptyText || 'Nothing to rank.'));
      return;
    }
    var max = 0;
    rows.forEach(function (r) { if (r.total > max) max = r.total; });
    var list = el('div', 'bars');
    rows.forEach(function (r) {
      var row = el('div', 'bar-row');
      var label = el('div', 'bar-label', r.label);
      label.title = r.label;
      var trackWrap = el('div', 'bar-track-wrap');
      var track = el('div', 'track');
      track.style.width = max ? (100 * r.total / max).toFixed(2) + '%' : '0%';
      (r.parts || []).forEach(function (p) {
        if (!p.count) return;
        var seg = el('div', 'seg ' + (p.cls || ''));
        seg.style.flexGrow = String(p.count);
        attachTooltip(seg, r.label + ' · ' + p.label + ': ' + p.count);
        pickable(seg, p.pick);
        track.appendChild(seg);
      });
      trackWrap.appendChild(track);
      if (opts.rowCls) row.className += ' ' + opts.rowCls;
      if (r.title) label.title = r.title;
      if (r.pick) { attachTooltip(label, (r.title || r.label)); pickable(label, r.pick); label.removeAttribute('title'); }
      var val = el('div', 'bar-value' + (r.valueCls ? ' ' + r.valueCls : ''), r.valueText !== undefined ? r.valueText : String(r.total));
      row.appendChild(label); row.appendChild(trackWrap); row.appendChild(val);
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  /* ---------- line chart ---------- */
  /* spec: {x:[iso], series:[{name, values:[num|null], cls, area}], todayIndex, yMax} */
  function niceTicks(maxVal) {
    var target = Math.max(1, maxVal);
    var steps = [1, 2, 2.5, 5, 10];
    var mag = Math.pow(10, Math.floor(Math.log10(target / 4)));
    var step = steps[0] * mag;
    for (var i = 0; i < steps.length; i++) {
      step = steps[i] * mag;
      if (target / step <= 4) break;
    }
    var ticks = [];
    for (var v = 0; v <= target + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
    if (ticks[ticks.length - 1] < target) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  function lineChart(svg, spec) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var W = 640, H = 220, L = 42, R = 18, T = 14, B = 30;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    var n = spec.x.length;
    if (!n) {
      var t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'class': 'chart-empty' });
      t.textContent = 'No dated activities to draw.';
      svg.appendChild(t);
      return;
    }
    var yMax = spec.yMax || 100;
    var ticks = niceTicks(yMax);
    var yTop = ticks[ticks.length - 1];
    var iw = W - L - R, ih = H - T - B;
    var xAt = function (i) { return L + (n === 1 ? iw / 2 : iw * i / (n - 1)); };
    var yAt = function (v) { return T + ih - ih * v / yTop; };

    // grid + y labels
    ticks.forEach(function (v) {
      svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: yAt(v), y2: yAt(v), 'class': v === 0 ? 'axis' : 'grid' }));
      var lbl = svgEl('text', { x: L - 8, y: yAt(v) + 3.5, 'text-anchor': 'end', 'class': 'tick' });
      lbl.textContent = v + '%';
      svg.appendChild(lbl);
    });
    // x labels: first, a few in the middle, last
    var want = Math.min(6, n);
    for (var k = 0; k < want; k++) {
      var i = Math.round((n - 1) * k / Math.max(1, want - 1));
      var lx = svgEl('text', { x: xAt(i), y: H - 10, 'text-anchor': k === 0 ? 'start' : (k === want - 1 ? 'end' : 'middle'), 'class': 'tick' });
      lx.textContent = fmtMonth(spec.x[i]);
      svg.appendChild(lx);
    }
    // today marker
    if (spec.todayIndex !== null && spec.todayIndex !== undefined) {
      var tx = xAt(spec.todayIndex);
      svg.appendChild(svgEl('line', { x1: tx, x2: tx, y1: T, y2: T + ih, 'class': 'today' }));
      var tl = svgEl('text', { x: tx + 4, y: T + 10, 'class': 'tick today-label' });
      tl.textContent = 'Today';
      svg.appendChild(tl);
    }
    // series
    (spec.series || []).forEach(function (s) {
      var pts = [];
      s.values.forEach(function (v, i) { if (v !== null && v !== undefined) pts.push([xAt(i), yAt(v), v, i]); });
      if (!pts.length) return;
      var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      if (s.area) {
        var a = d + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + yAt(0).toFixed(1) + ' L' + pts[0][0].toFixed(1) + ' ' + yAt(0).toFixed(1) + ' Z';
        svg.appendChild(svgEl('path', { d: a, 'class': 'area ' + (s.cls || '') }));
      }
      svg.appendChild(svgEl('path', { d: d, 'class': 'line ' + (s.cls || '') }));
      var last = pts[pts.length - 1];
      var halo = svgEl('circle', { cx: last[0], cy: last[1], r: 5, 'class': 'marker ' + (s.cls || '') });
      svg.appendChild(halo);
      var lbl = svgEl('text', { x: Math.min(last[0] + 7, W - R - 2), y: last[1] + 4, 'class': 'end-label ' + (s.cls || ''), 'text-anchor': last[0] > W - R - 48 ? 'end' : 'start' });
      if (last[0] > W - R - 48) lbl.setAttribute('x', last[0] - 7);
      lbl.textContent = s.name + ' ' + fmtPct(last[2]);
      svg.appendChild(lbl);
    });
  }

  /* ---------- column chart ---------- */
  /* spec: {labels:[str], series:[{name, cls, values:[pct|null], tips:[str]}], band:[bool], target:num}
     Grouped columns on a 0-100% axis. band shades the columns that fall in the L6W window. */
  function columnChart(svg, spec) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var W = 640, H = 230, L = 42, R = 14, T = 16, B = 30;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var n = spec.labels.length, series = spec.series || [];
    var any = series.some(function (s) { return s.values.some(function (v) { return v !== null && v !== undefined; }); });
    if (!n || !any) {
      var t0 = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'class': 'chart-empty' });
      t0.textContent = 'No activities planned in these weeks.';
      svg.appendChild(t0);
      return;
    }
    var iw = W - L - R, ih = H - T - B, slot = iw / n;
    var yAt = function (v) { return T + ih - ih * v / 100; };
    (spec.band || []).forEach(function (on, i) {
      if (on) svg.appendChild(svgEl('rect', { x: L + slot * i, y: T, width: slot, height: ih, 'class': 'band' }));
    });
    [0, 25, 50, 75, 100].forEach(function (v) {
      svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: yAt(v), y2: yAt(v), 'class': v === 0 ? 'axis' : 'grid' }));
      var lbl = svgEl('text', { x: L - 8, y: yAt(v) + 3.5, 'text-anchor': 'end', 'class': 'tick' });
      lbl.textContent = v + '%';
      svg.appendChild(lbl);
    });
    var gap = Math.min(10, slot * 0.2), bw = Math.max(3, (slot - gap * 2) / Math.max(1, series.length));
    spec.labels.forEach(function (label, i) {
      series.forEach(function (s, k) {
        var v = s.values[i];
        if (v === null || v === undefined) return;
        var x = L + slot * i + gap + bw * k, y = yAt(v);
        var r = svgEl('rect', { x: x + 1, y: y, width: Math.max(1, bw - 2), height: Math.max(1, yAt(0) - y), rx: 2, 'class': 'col ' + (s.cls || '') });
        attachTooltip(r, (s.tips && s.tips[i]) || (s.name + ' ' + label + ': ' + fmtPct(v)));
        svg.appendChild(r);
        if (series.length === 1 && slot > 34) {
          var vl = svgEl('text', { x: x + bw / 2, y: y - 4, 'text-anchor': 'middle', 'class': 'col-label' });
          vl.textContent = Math.round(v) + '%';
          svg.appendChild(vl);
        }
      });
      var tx = svgEl('text', { x: L + slot * i + slot / 2, y: H - 10, 'text-anchor': 'middle', 'class': 'tick' });
      tx.textContent = label;
      svg.appendChild(tx);
    });
    if (spec.target !== null && spec.target !== undefined) {
      var ty = yAt(spec.target);
      // drawn over the columns; its label lives in the legend so it never collides with a bar
      svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: ty, y2: ty, 'class': 'target' }));
    }
  }

  /* ---------- column + line in one plot ---------- */
  /* spec: {labels:[str], band:[bool], columns:[{name, cls, values:[count|null], tips:[str]}],
            line:{name, cls, values:[pct|null], tips:[str], axis}, target:pct, axisTitles:[left, right]}
     Clustered columns on the left count axis and the rate as a line on the right 0-100% axis,
     the Power BI "line and clustered column" visual. A line with axis:'count' shares the
     columns' count axis instead; the % axis is drawn only when something uses it.
     stacked:true piles the columns into one column per label, with the total above it. */
  function countTicks(maxVal) {
    var target = Math.max(1, maxVal) / 4, mag = Math.pow(10, Math.floor(Math.log10(target)));
    var step = [1, 2, 2.5, 5, 10].map(function (s) { return s * mag; }).filter(function (s) { return s >= target; })[0] || 10 * mag;
    var out = [];
    for (var v = 0; v < maxVal + step; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }
  function comboChart(svg, spec) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    /* drawn at the element's real pixel width so text keeps its CSS size instead of scaling with the card */
    var measured = Math.round((svg.getBoundingClientRect() || {}).width || 0);
    /* height follows the width, so the plot keeps its proportions from a laptop to a wide monitor */
    var n = spec.labels.length, cols = spec.columns || [], line = spec.line;
    var lines = spec.lines || (line ? [line] : []);
    var pctAxis = (spec.target !== null && spec.target !== undefined) || lines.some(function (ln) { return ln.axis !== 'count'; });
    var W = measured >= 320 ? measured : 640, H = spec.height || Math.round(Math.min(440, Math.max(280, W * 0.24))), L = 44, R = pctAxis ? 52 : 16, T = 26, B = 28;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.style.height = H + 'px';
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    var any = cols.some(function (s) { return s.values.some(function (v) { return v; }); });
    if (!n || !any) {
      var t0 = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'class': 'chart-empty' });
      t0.textContent = spec.emptyText || 'No commitments in these weeks.';
      svg.appendChild(t0);
      return;
    }
    var iw = W - L - R, ih = H - T - B, slot = iw / n, bottom = T + ih;
    var maxV = 0;
    if (spec.stacked) spec.labels.forEach(function (x, i) { var t = 0; cols.forEach(function (s) { t += s.values[i] || 0; }); if (t > maxV) maxV = t; });
    else cols.forEach(function (s) { s.values.forEach(function (v) { if (v > maxV) maxV = v; }); });
    lines.forEach(function (ln) { if (ln.axis === 'count') ln.values.forEach(function (v) { if (v > maxV) maxV = v; }); });
    var ticks = countTicks(maxV), yTop = ticks[ticks.length - 1] || 1;
    var yL = function (v) { return bottom - ih * v / yTop; }, yR = function (v) { return bottom - ih * v / 100; };
    (spec.band || []).forEach(function (on, i) {
      if (on) svg.appendChild(svgEl('rect', { x: L + slot * i, y: T, width: slot, height: ih, 'class': 'band' }));
    });
    ticks.forEach(function (v) {
      svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: yL(v), y2: yL(v), 'class': v === 0 ? 'axis' : 'grid' }));
      var l1 = svgEl('text', { x: L - 8, y: yL(v) + 3.5, 'text-anchor': 'end', 'class': 'tick' }); l1.textContent = fmtNum(v); svg.appendChild(l1);
    });
    if (pctAxis) [0, 25, 50, 75, 100].forEach(function (v) {
      var l2 = svgEl('text', { x: W - R + 8, y: yR(v) + 3.5, 'text-anchor': 'start', 'class': 'tick' }); l2.textContent = v + '%'; svg.appendChild(l2);
    });
    var titles = spec.axisTitles || [];
    if (titles[0]) { var a1 = svgEl('text', { x: 2, y: T - 9, 'text-anchor': 'start', 'class': 'tick panel-title' }); a1.textContent = titles[0]; svg.appendChild(a1); }
    if (titles[1]) { var a2 = svgEl('text', { x: W - 2, y: T - 9, 'text-anchor': 'end', 'class': 'tick panel-title' }); a2.textContent = titles[1]; svg.appendChild(a2); }
    var gap = Math.max(4, Math.min(16, slot * 0.22)), bw = Math.max(3, Math.min(34, (slot - gap * 2) / Math.max(1, cols.length)));
    var groupW = bw * cols.length, x0 = (slot - groupW) / 2;
    var sw = Math.max(6, Math.min(56, slot - gap * 2));
    spec.labels.forEach(function (label, i) {
      if (spec.stacked) {
        var base = 0, sx = L + slot * i + (slot - sw) / 2;
        cols.forEach(function (s) {
          var v = s.values[i];
          if (!v) return;
          var y0 = yL(base), y1 = yL(base + v);
          var seg = svgEl('rect', { x: sx, y: y1, width: sw, height: Math.max(1, y0 - y1 - 1), rx: 2, 'class': 'col ' + (s.cls || '') });
          attachTooltip(seg, (s.tips && s.tips[i]) || (s.name + ' ' + label + ': ' + fmtNum(v)));
          pickable(seg, s.picks && s.picks[i]);
          svg.appendChild(seg);
          if (spec.showLabels && y0 - y1 >= 16 && sw >= 16) {
            var si = svgEl('text', { x: sx + sw / 2, y: (y0 + y1) / 2 + 4, 'text-anchor': 'middle', 'class': 'col-in' });
            si.textContent = fmtNum(v);
            svg.appendChild(si);
          }
          base += v;
        });
        if (base > 0) {
          var tl = svgEl('text', { x: sx + sw / 2, y: yL(base) - 5, 'text-anchor': 'middle', 'class': 'col-label col-total' });
          tl.textContent = fmtNum(base);
          svg.appendChild(tl);
        }
      } else cols.forEach(function (s, k) {
        var v = s.values[i];
        if (v === null || v === undefined) return;
        var x = L + slot * i + x0 + bw * k, y = yL(v);
        var r = svgEl('rect', { x: x + 1, y: v ? y : yL(0) - 1, width: Math.max(1, bw - 2), height: Math.max(1, yL(0) - y), rx: 3, 'class': 'col ' + (s.cls || '') });
        attachTooltip(r, (s.tips && s.tips[i]) || (s.name + ' ' + label + ': ' + fmtNum(v)));
        pickable(r, s.picks && s.picks[i]);
        svg.appendChild(r);
        if (spec.showLabels && v > 0 && bw >= 12) {
          /* counts sit at the foot of the column, clear of the PPC line that runs across the tops */
          var inside = yL(0) - y >= 18;
          var cl = svgEl('text', { x: x + bw / 2, y: inside ? yL(0) - 6 : y - 4, 'text-anchor': 'middle', 'class': inside ? 'col-in' : 'col-label' });
          cl.textContent = fmtNum(v);
          svg.appendChild(cl);
        }
      });
      var tx = svgEl('text', { x: L + slot * i + slot / 2, y: H - 8, 'text-anchor': 'middle', 'class': 'tick' });
      tx.textContent = n > 26 && i % Math.ceil(n / 26) ? '' : label;
      svg.appendChild(tx);
    });
    if (spec.target !== null && spec.target !== undefined) {
      svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: yR(spec.target), y2: yR(spec.target), 'class': 'target' }));
    }
    lines.forEach(function (line) {
      var pts = [], onCount = line.axis === 'count', yF = onCount ? yL : yR;
      line.values.forEach(function (v, i) { if (v !== null && v !== undefined) pts.push([L + slot * i + slot / 2, yF(v), v, i]); });
      if (pts.length) {
        var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
        svg.appendChild(svgEl('path', { d: d, 'class': 'line-halo' }));
        svg.appendChild(svgEl('path', { d: d, 'class': 'line ' + (line.cls || '') }));
        pts.forEach(function (p, i) {
          var m = svgEl('circle', { cx: p[0], cy: p[1], r: i === pts.length - 1 ? 5 : 4, 'class': 'marker ' + (line.cls || '') });
          attachTooltip(m, (line.tips && line.tips[p[3]]) || (line.name + ' ' + spec.labels[p[3]] + ': ' + (onCount ? fmtNum(p[2]) : fmtPct(p[2]))));
          pickable(m, line.picks && line.picks[p[3]]);
          svg.appendChild(m);
          if (!line.noLabels && (i === pts.length - 1 || (spec.showLabels && slot >= 30))) {
            var txt = onCount ? fmtNum(p[2]) : Math.round(p[2]) + '%', lw = 8 + txt.length * 6.6, ly = Math.max(T + 8, p[1] - 15);
            svg.appendChild(svgEl('rect', { x: p[0] - lw / 2, y: ly - 8, width: lw, height: 16, rx: 8, 'class': 'line-label-bg' }));
            var vl = svgEl('text', { x: p[0], y: ly + 4, 'text-anchor': 'middle', 'class': 'col-label line-label' });
            vl.textContent = txt;
            svg.appendChild(vl);
          }
        });
      }
    });
  }

  /* ---------- donut ---------- */
  /* slices: [{label, count, cls, tip}] ; opts: {center, centerSub, emptyText}
     Slices are drawn clockwise from 12 o'clock in the order given, with a 2px surface gap
     between them. A single slice draws as a full ring. The fill comes from the slice's class
     (the same .cat-N tokens the legend swatches use). */
  function donut(svg, slices, opts) {
    opts = opts || {};
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var S = 200, cx = 100, cy = 100, r1 = 92, r0 = 58;
    svg.setAttribute('viewBox', '0 0 ' + S + ' ' + S);
    var live = slices.filter(function (s) { return s.count > 0; });
    var total = live.reduce(function (a, s) { return a + s.count; }, 0);
    if (!total) {
      svg.appendChild(svgEl('circle', { cx: cx, cy: cy, r: (r0 + r1) / 2, fill: 'none', 'stroke-width': r1 - r0, 'class': 'donut-empty' }));
      var e = svgEl('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', 'class': 'donut-sub' });
      e.textContent = opts.emptyText || 'Nothing recorded';
      svg.appendChild(e);
      return;
    }
    function pt(r, a) { return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }
    var a = 0;
    live.forEach(function (s) {
      var sweep = 2 * Math.PI * s.count / total, node;
      if (live.length === 1) {
        node = svgEl('path', { d: 'M ' + (cx - r1) + ' ' + cy + ' a ' + r1 + ' ' + r1 + ' 0 1 0 ' + 2 * r1 + ' 0 a ' + r1 + ' ' + r1 + ' 0 1 0 ' + -2 * r1 + ' 0 '
          + 'M ' + (cx - r0) + ' ' + cy + ' a ' + r0 + ' ' + r0 + ' 0 1 1 ' + 2 * r0 + ' 0 a ' + r0 + ' ' + r0 + ' 0 1 1 ' + -2 * r0 + ' 0 Z', 'fill-rule': 'evenodd' });
      } else {
        var big = sweep > Math.PI ? 1 : 0, p1 = pt(r1, a), p2 = pt(r1, a + sweep), p3 = pt(r0, a + sweep), p4 = pt(r0, a);
        node = svgEl('path', { d: 'M ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2) + ' A ' + r1 + ' ' + r1 + ' 0 ' + big + ' 1 ' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2)
          + ' L ' + p3[0].toFixed(2) + ' ' + p3[1].toFixed(2) + ' A ' + r0 + ' ' + r0 + ' 0 ' + big + ' 0 ' + p4[0].toFixed(2) + ' ' + p4[1].toFixed(2) + ' Z' });
      }
      node.setAttribute('class', 'slice ' + (s.cls || ''));
      attachTooltip(node, s.tip || (s.label + ': ' + fmtNum(s.count) + ' (' + fmtPct(100 * s.count / total) + ')'));
      pickable(node, s.pick);
      svg.appendChild(node);
      a += sweep;
    });
    var num = svgEl('text', { x: cx, y: cy + 2, 'text-anchor': 'middle', 'class': 'donut-num' });
    num.textContent = opts.center !== undefined ? opts.center : fmtNum(total);
    svg.appendChild(num);
    if (opts.centerSub) {
      var sub = svgEl('text', { x: cx, y: cy + 20, 'text-anchor': 'middle', 'class': 'donut-sub' });
      sub.textContent = opts.centerSub;
      svg.appendChild(sub);
    }
  }

  /* ---------- gauge ---------- */
  /* A 180-degree arc from 0 to max; value null draws the empty track only. */
  function gauge(svg, value, opts) {
    opts = opts || {};
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var max = opts.max || 100, cx = 100, cy = 100, r = 80;
    svg.setAttribute('viewBox', '0 0 200 118');
    function arc(frac) {
      var a = Math.PI * (1 - frac);
      return 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy - r * Math.sin(a)).toFixed(2);
    }
    svg.appendChild(svgEl('path', { d: arc(1), fill: 'none', 'stroke-width': 16, 'class': 'g-track' }));
    if (value !== null && value !== undefined) {
      var f = Math.max(0.002, Math.min(1, value / max));
      svg.appendChild(svgEl('path', { d: arc(f), fill: 'none', 'stroke-width': 16, 'class': 'g-val tone-' + (opts.tone || 'inert') }));
    }
    var num = svgEl('text', { x: cx, y: cy - 6, 'text-anchor': 'middle', 'class': 'g-num' });
    num.textContent = value === null || value === undefined ? '—' : String(Math.round(value));
    svg.appendChild(num);
    var sub = svgEl('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', 'class': 'g-sub' });
    sub.textContent = opts.sub || 'of ' + max;
    svg.appendChild(sub);
  }

  /* ---------- formatting shared with app.js ---------- */
  var LOCALE = 'en-IN';
  function setLocale(l) { LOCALE = l || 'en-IN'; }
  function fmtNum(v) { return (v === null || v === undefined) ? '—' : Number(v).toLocaleString(LOCALE); }
  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    var s = Number(v).toFixed(1);
    if (s.slice(-2) === '.0') s = s.slice(0, -2);
    return s + '%';
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso, short) {
    if (!iso) return '—';
    var p = iso.slice(0, 10).split('-');
    if (p.length < 3) return iso;
    var y = short ? p[0].slice(2) : p[0];
    return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + y;
  }
  function fmtMonth(iso) {
    var p = iso.slice(0, 10).split('-');
    return MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0].slice(2);
  }

  global.Charts = {
    el: el, svgEl: svgEl, attachTooltip: attachTooltip, hideTip: hideTip, pickable: pickable,
    stackedTrack: stackedTrack, barRows: barRows, lineChart: lineChart, columnChart: columnChart, comboChart: comboChart, donut: donut, gauge: gauge,
    setLocale: setLocale, fmtNum: fmtNum, fmtPct: fmtPct, fmtDate: fmtDate, fmtMonth: fmtMonth
  };
})(window);
