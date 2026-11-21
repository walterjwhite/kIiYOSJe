/**
 * Browser-side code for the Model Trace graph. This is a string injected into
 * the webview, so it is plain ES5-style JavaScript with no template literals.
 * All text from events goes in through textContent, never innerHTML.
 *
 * Messages in:  {type:'data', summary, live}, {type:'ping', result}
 * Messages out: {command:'ready'}, {command:'open', id}
 */

export const TRACE_STYLE = `
  .stats { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 12px; }
  .stat { padding: 8px 14px; border-radius: 6px; background: var(--mind-row-alt); border-left: 3px solid var(--mind-accent); min-width: 90px; }
  .stat .n { font-size: 1.5em; font-weight: 700; }
  .stat.bad { border-left-color: var(--mind-red); }
  .stat.bad .n { color: var(--mind-red); }
  .stat.good { border-left-color: var(--mind-green); }
  #graph-wrap { position: relative; margin: 8px 0; border: 1px solid var(--vscode-widget-border); border-radius: 6px; background: var(--mind-row-alt); }
  #graph { width: 100%; height: auto; display: block; }
  #tip { position: absolute; pointer-events: none; display: none; white-space: pre; z-index: 5; padding: 6px 10px; border-radius: 4px;
         background: var(--vscode-editorHoverWidget-background, #252526); color: var(--vscode-editorHoverWidget-foreground, inherit);
         border: 1px solid var(--vscode-editorHoverWidget-border, #454545); font-size: 0.9em; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
  .node { cursor: pointer; }
  .node rect { fill: var(--vscode-editor-background); stroke: var(--vscode-widget-border, #666); stroke-width: 1.5; transition: stroke 120ms, stroke-width 120ms; }
  .node:hover rect, .node.sel rect { stroke: var(--mind-accent); stroke-width: 3; }
  .node.err rect { stroke: var(--mind-red); }
  .node.idle { opacity: 0.55; }
  .node.model rect { stroke: var(--mind-purple); }
  .node.glow rect { stroke: var(--mind-yellow); stroke-width: 4; }
  .node text { fill: var(--vscode-editor-foreground); pointer-events: none; text-anchor: middle; }
  .node .t1 { font-weight: 700; font-size: 13px; }
  .node .t2 { font-size: 11px; opacity: 0.75; }
  .edge { fill: none; stroke: var(--mind-accent); stroke-linecap: round; stroke-dasharray: 8 8; animation: flow 1.5s linear infinite; opacity: 0.8; cursor: pointer; }
  .edge.bad { stroke: var(--mind-red); }
  .edge.ghost { stroke: var(--vscode-widget-border, #666); animation: none; opacity: 0.6; }
  .edge.dim { opacity: 0.12; }
  .edge:hover { opacity: 1; }
  .pipe { fill: none; stroke: var(--vscode-widget-border, #666); stroke-width: 2; stroke-dasharray: 3 5; animation: flow 3s linear infinite; }
  @keyframes flow { to { stroke-dashoffset: -32; } }
  @media (prefers-reduced-motion: reduce) { .edge, .pipe { animation: none; } }
  .dot { pointer-events: none; }
  .chip { display: inline-block; margin-left: 8px; padding: 1px 10px; border-radius: 10px; background: var(--mind-accent); color: var(--mind-accent-fg); cursor: pointer; }
  #detail { margin: 8px 0; }
  tr.call-row { cursor: pointer; }
  tr.call-row.sel { outline: 2px solid var(--mind-accent); }
  .ok { color: var(--mind-green); }
  .bad-text { color: var(--mind-red); }
  .live-on { background: var(--mind-green-fill) !important; color: #fff !important; }
`;

export const TRACE_SCRIPT = `
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var data = null;
  var filter = null;
  var seen = {};
  var firstLoad = true;
  var selectedCall = null;
  var STEPS = [
    { id: 'signal', label: 'Signal', x: 70 },
    { id: 'match', label: 'Match', x: 195 },
    { id: 'classify', label: 'Classify', x: 330, op: true },
    { id: 'transform', label: 'Transform', x: 480, op: true },
    { id: 'draft', label: 'Draft', x: 650, op: true },
    { id: 'link', label: 'Link to goal', x: 780, op: true },
    { id: 'outcome', label: 'Queue / absorb', x: 890 }
  ];
  var SY = 70, MY = 270, W = 100, H = 52;
  var graph = document.getElementById('graph');
  var tip = document.getElementById('tip');
  var wrap = document.getElementById('graph-wrap');

  function mk(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(parent, x, y, cls, s) {
    var t = mk('text', { x: x, y: y, 'class': cls }, parent);
    t.textContent = s;
    return t;
  }
  function fmtMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms'; }
  function callKey(c) { return c.at + '|' + c.signalId + '|' + c.operation + '|' + c.durationMs; }

  function showTip(e, lines) {
    tip.textContent = lines.join('\\n');
    tip.style.display = 'block';
    var r = wrap.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 220) + 'px';
    tip.style.top = (e.clientY - r.top + 14) + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }
  function hover(target, linesFn) {
    target.addEventListener('mousemove', function (e) { showTip(e, linesFn()); });
    target.addEventListener('mouseleave', hideTip);
  }

  function modelPositions(models) {
    var pos = {};
    var n = models.length;
    models.forEach(function (m, i) { pos[m.key] = n === 1 ? 455 : 160 + i * (590 / (n - 1)); });
    return pos;
  }

  function setFilter(f) {
    filter = (filter && f && filter.type === f.type && filter.value === f.value) ? null : f;
    selectedCall = null;
    draw();
  }

  function opStat(op) {
    for (var i = 0; i < data.ops.length; i++) if (data.ops[i].operation === op) return data.ops[i];
    return null;
  }
  function skippedFor(op) {
    var n = 0;
    for (var k in data.summary.skipped) if (k.indexOf(op + ':') === 0) n += data.summary.skipped[k];
    return n;
  }

  function drawGraph() {
    while (graph.firstChild) graph.removeChild(graph.firstChild);
    var s = data.summary;
    var models = s.models;
    var pos = modelPositions(models);
    var stepX = {};
    STEPS.forEach(function (st) { stepX[st.id] = st.x; });

    // The pipeline spine.
    for (var i = 0; i < STEPS.length - 1; i++) {
      mk('line', { x1: STEPS[i].x + W / 2, y1: SY, x2: STEPS[i + 1].x - W / 2, y2: SY, 'class': 'pipe' }, graph);
    }

    // Edges from a step to the model that served it.
    var edgesG = mk('g', {}, graph);
    if (models.length === 0) {
      ['classify', 'transform', 'draft', 'link'].forEach(function (op) {
        var x1 = stepX[op], x2 = 455;
        mk('path', { d: 'M' + x1 + ' ' + (SY + H / 2) + ' C' + x1 + ' ' + (SY + 120) + ',' + x2 + ' ' + (MY - 120) + ',' + x2 + ' ' + (MY - H / 2), 'class': 'edge ghost', 'stroke-width': 2 }, edgesG);
      });
    }
    s.edges.forEach(function (e) {
      var x1 = stepX[e.operation];
      if (x1 === undefined) x1 = stepX.draft;
      var x2 = pos[e.modelKey];
      var d = 'M' + x1 + ' ' + (SY + H / 2) + ' C' + x1 + ' ' + (SY + 120) + ',' + x2 + ' ' + (MY - 120) + ',' + x2 + ' ' + (MY - H / 2);
      var dim = filter && ((filter.type === 'op' && filter.value !== e.operation) || (filter.type === 'model' && filter.value !== e.modelKey));
      var p = mk('path', {
        d: d,
        'class': 'edge' + (e.errors > 0 ? ' bad' : '') + (dim ? ' dim' : ''),
        'stroke-width': Math.min(14, 2 + Math.log(e.count + 1) * 2.2),
        'data-edge': e.operation + '>' + e.modelKey
      }, edgesG);
      p.style.animationDuration = Math.max(0.5, Math.min(6, e.avgMs / 1000)) + 's';
      hover(p, function () {
        return [e.operation + ' \\u2192 ' + e.modelKey.split('|')[1], e.count + ' calls, ' + e.errors + ' failed', 'avg ' + fmtMs(e.avgMs)];
      });
      p.addEventListener('click', function () { setFilter({ type: 'op', value: e.operation }); });
    });

    // Step nodes.
    STEPS.forEach(function (st) {
      var o = st.op ? opStat(st.id) : null;
      var cls = 'node' + (st.op && !o ? ' idle' : '') + (o && o.errors > 0 ? ' err' : '') + (filter && filter.type === 'op' && filter.value === st.id ? ' sel' : '');
      var g = mk('g', { 'class': cls, 'data-node': st.id }, graph);
      mk('rect', { x: st.x - W / 2, y: SY - H / 2, width: W, height: H, rx: 8 }, g);
      txt(g, st.x, SY - 4, 't1', st.label);
      var sub = '';
      if (st.id === 'signal') sub = s.signals + ' processed';
      else if (st.id === 'outcome') sub = s.withModel + ' used a model';
      else if (st.op) sub = o ? o.count + ' calls \\u00b7 ' + fmtMs(o.avgMs) : 'no calls';
      if (sub) txt(g, st.x, SY + 13, 't2', sub);
      hover(g, function () {
        var lines = [st.label];
        if (st.op) {
          lines.push(o ? o.count + ' calls, ' + o.errors + ' failed' : 'no model calls');
          if (o) lines.push('avg ' + fmtMs(o.avgMs) + ', max ' + fmtMs(o.maxMs));
          var k = skippedFor(st.id);
          if (k) lines.push('skipped on ' + k + ' signals');
          lines.push('click to filter calls');
        } else if (st.id === 'signal') lines.push(s.signals + ' signals processed', s.withoutModel + ' with no model call');
        else if (st.id === 'match') lines.push('Direction matching runs locally, no model');
        else lines.push(s.signals + ' signals reached a decision');
        return lines;
      });
      if (st.op) g.addEventListener('click', function () { setFilter({ type: 'op', value: st.id }); });
    });

    // Model nodes.
    if (models.length === 0) {
      var gg = mk('g', { 'class': 'node idle' }, graph);
      mk('rect', { x: 455 - 90, y: MY - H / 2, width: 180, height: H, rx: 8, 'stroke-dasharray': '5 4' }, gg);
      txt(gg, 455, MY - 4, 't1', 'No model calls');
      txt(gg, 455, MY + 13, 't2', 'in this range');
    }
    models.forEach(function (m) {
      var x = pos[m.key];
      var g = mk('g', { 'class': 'node model' + (m.errors > 0 ? ' err' : '') + (filter && filter.type === 'model' && filter.value === m.key ? ' sel' : ''), 'data-model': m.key }, graph);
      mk('rect', { x: x - 95, y: MY - H / 2, width: 190, height: H + 10, rx: 8 }, g);
      txt(g, x, MY - 6, 't1', m.provider + ' \\u00b7 ' + m.model);
      txt(g, x, MY + 11, 't2', m.count + ' calls \\u00b7 avg ' + fmtMs(m.avgMs));
      txt(g, x, MY + 25, 't2', m.inputTokens + ' in / ' + m.outputTokens + ' out tokens');
      hover(g, function () {
        return [m.provider + ' ' + m.model, m.endpoint || '(agent, no endpoint)', m.count + ' calls, ' + m.errors + ' failed',
          'avg ' + fmtMs(m.avgMs), m.inputTokens + ' tokens in, ' + m.outputTokens + ' out', 'click to filter calls'];
      });
      g.addEventListener('click', function () { setFilter({ type: 'model', value: m.key }); });
    });
  }

  function visibleCalls() {
    return data.summary.calls.filter(function (c) {
      if (!filter) return true;
      if (filter.type === 'op') return c.operation === filter.value;
      return (c.provider + '|' + c.model + '|' + (c.endpoint || '')) === filter.value;
    });
  }

  function cell(tr, text, cls, sortValue) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    if (sortValue !== undefined) td.setAttribute('data-sort-value', String(sortValue));
    tr.appendChild(td);
    return td;
  }

  function drawTable() {
    var box = document.getElementById('calls');
    box.textContent = '';
    var calls = visibleCalls();
    var head = document.createElement('div');
    head.className = 'toolbar';
    var count = document.createElement('span');
    count.className = 'meta';
    count.textContent = calls.length + ' model calls' + (calls.length > 300 ? ' (showing 300)' : '');
    head.appendChild(count);
    if (filter) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = 'filter: ' + (filter.type === 'op' ? filter.value : filter.value.split('|')[1]) + ' \\u2715';
      chip.addEventListener('click', function () { setFilter(filter); });
      head.appendChild(chip);
    }
    box.appendChild(head);
    if (calls.length === 0) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'No model calls to show. If signals were processed but none called a model, the reasons are listed above.';
      box.appendChild(p);
      return;
    }
    var table = document.createElement('table');
    table.className = 'sortable';
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    [['When', 'text'], ['Step', 'text'], ['Model', 'text'], ['Time', 'num'], ['Tokens in / out', 'num'], ['Result', 'text']].forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h[0];
      th.setAttribute('data-sort', h[1]);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = document.createElement('tbody');
    calls.slice(0, 300).forEach(function (c) {
      var tr = document.createElement('tr');
      tr.className = 'call-row' + (selectedCall === callKey(c) ? ' sel' : '');
      cell(tr, new Date(c.at).toLocaleString(), '', c.at);
      cell(tr, c.operation);
      cell(tr, c.provider + ' \\u00b7 ' + c.model);
      cell(tr, fmtMs(c.durationMs), '', c.durationMs);
      cell(tr, (c.inputTokens === undefined ? '\\u2014' : c.inputTokens) + ' / ' + (c.outputTokens === undefined ? '\\u2014' : c.outputTokens), '', (c.inputTokens || 0) + (c.outputTokens || 0));
      cell(tr, c.ok ? 'ok' : 'failed', c.ok ? 'ok' : 'bad-text');
      tr.addEventListener('click', function () { selectedCall = callKey(c); showDetail(c); drawTable(); });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);
  }

  function showDetail(c) {
    var d = document.getElementById('detail');
    d.textContent = '';
    var card = document.createElement('div');
    card.className = 'card';
    var lines = [
      c.operation + ' on ' + c.provider + ' ' + c.model + ' (' + c.transport + ')',
      'endpoint: ' + (c.endpoint || 'none, agent over ACP'),
      'took ' + fmtMs(c.durationMs) + ', prompt ' + c.promptChars + ' chars, response ' + c.responseChars + ' chars',
      c.ok ? 'succeeded' : 'failed: ' + (c.error || 'unknown error')
    ];
    lines.forEach(function (l) { var div = document.createElement('div'); div.textContent = l; card.appendChild(div); });
    if (c.signalId) {
      var b = document.createElement('button');
      b.textContent = 'Open signal';
      b.setAttribute('data-action', 'open');
      b.setAttribute('data-id', c.signalId);
      card.appendChild(b);
    }
    d.appendChild(card);
  }

  function drawStats() {
    var s = data.summary;
    var box = document.getElementById('stats');
    box.textContent = '';
    var total = s.calls.length;
    var errs = s.calls.filter(function (c) { return !c.ok; }).length;
    var avg = total ? s.calls.reduce(function (a, c) { return a + c.durationMs; }, 0) / total : 0;
    function stat(n, label, cls) {
      var d = document.createElement('div');
      d.className = 'stat' + (cls ? ' ' + cls : '');
      var a = document.createElement('div'); a.className = 'n'; a.textContent = String(n);
      var b = document.createElement('div'); b.className = 'meta'; b.textContent = label;
      d.appendChild(a); d.appendChild(b); box.appendChild(d);
    }
    stat(s.signals, 'signals processed');
    stat(s.withModel, 'used a model', s.withModel > 0 ? 'good' : 'bad');
    stat(s.withoutModel, 'no model call');
    stat(total, 'model calls');
    stat(errs, 'failed calls', errs > 0 ? 'bad' : '');
    stat(total ? fmtMs(avg) : '\\u2014', 'avg latency');

    var verdict = document.getElementById('verdict');
    verdict.textContent = '';
    if (total > 0) {
      var top = s.models.slice().sort(function (a, b) { return b.count - a.count; })[0];
      verdict.textContent = top.provider + ' ' + top.model + ' answered ' + top.count + ' of ' + total + ' calls in this range.';
    } else if (s.signals > 0) {
      verdict.textContent = 'Signals were processed but no model was contacted. Reasons: ' +
        Object.keys(s.skipped).map(function (k) { return k + ' (' + s.skipped[k] + ')'; }).join('; ');
    } else {
      verdict.textContent = 'No signals processed in this range.';
    }
  }

  // ---- animation: a dot travels step -> model and back, coloured by outcome.
  function pulse(c, delay) {
    setTimeout(function () {
      var key = c.operation + '>' + c.provider + '|' + c.model + '|' + (c.endpoint || '');
      var path = graph.querySelector('[data-edge="' + key.replace(/"/g, '') + '"]');
      if (!path) return;
      var len = path.getTotalLength();
      var dot = mk('circle', { r: 7, 'class': 'dot', fill: c.ok ? 'var(--mind-green)' : 'var(--mind-red)' }, graph);
      var modelNode = graph.querySelector('[data-model="' + (c.provider + '|' + c.model + '|' + (c.endpoint || '')).replace(/"/g, '') + '"]');
      var total = Math.max(900, Math.min(4000, c.durationMs + 600));
      var start = performance.now();
      if (modelNode) modelNode.classList.add('glow');
      function frame(now) {
        var t = (now - start) / total;
        if (t >= 1) {
          graph.removeChild(dot);
          if (modelNode) modelNode.classList.remove('glow');
          return;
        }
        var f = t < 0.4 ? t / 0.4 : t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
        var pt = path.getPointAtLength(len * f);
        dot.setAttribute('cx', pt.x);
        dot.setAttribute('cy', pt.y);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }, delay);
  }

  function replay() {
    var calls = visibleCalls().slice(0, 40).reverse();
    calls.forEach(function (c, i) { pulse(c, i * 350); });
  }

  function draw() {
    if (!data) return;
    drawStats();
    drawGraph();
    drawTable();
  }

  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (m.type === 'data') {
      data = { summary: m.summary, ops: m.summary.ops };
      var fresh = m.summary.calls.filter(function (c) { return !seen[callKey(c)]; });
      m.summary.calls.forEach(function (c) { seen[callKey(c)] = true; });
      draw();
      if (!firstLoad && m.live) fresh.reverse().forEach(function (c, i) { pulse(c, i * 300); });
      firstLoad = false;
    } else if (m.type === 'ping') {
      var box = document.getElementById('ping');
      box.textContent = '';
      var lines = m.result.lines || [];
      lines.forEach(function (l) {
        var d = document.createElement('div');
        d.textContent = l.text;
        if (l.bad) d.className = 'bad-text';
        box.appendChild(d);
      });
    }
  });

  document.getElementById('replay').addEventListener('click', replay);
  post({ command: 'ready' });
})();
`;
