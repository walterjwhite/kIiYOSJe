/**
 * Browser-side code for the Model Trace graph. This is a string injected into
 * the webview, so it is plain ES5-style JavaScript with no template literals.
 * All text from events goes in through textContent, never innerHTML.
 *
 * Messages in:  {type:'data', summary, signals, live}, {type:'ping', result}
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
  .edge.dest { stroke: var(--mind-green); }
  .node.dest:not(.sel):not(:hover) rect { stroke: var(--mind-green); }
  .edge.ghost { stroke: var(--vscode-widget-border, #666); animation: none; opacity: 0.6; }
  .edge.dim { opacity: 0.12; }
  .edge:hover { opacity: 1; }
  .pipe { fill: none; stroke: var(--vscode-widget-border, #666); stroke-width: 2; stroke-dasharray: 3 5; animation: flow 3s linear infinite; }
  @keyframes flow { to { stroke-dashoffset: -32; } }
  @media (prefers-reduced-motion: reduce) { .edge, .pipe { animation: none; } }
  .dot { pointer-events: none; }
  .chip { display: inline-block; margin-left: 8px; padding: 1px 10px; border-radius: 10px; background: var(--mind-accent); color: var(--mind-accent-fg); cursor: pointer; }
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
  // Evenly spaced, each box 118 wide with a 12 px gap, so labels never touch.
  var STEPS = [
    { id: 'signal', label: 'Signal', x: 80 },
    { id: 'match', label: 'Match', x: 248 },
    { id: 'classify', label: 'Classify', x: 416, op: true },
    { id: 'transform', label: 'Transform', x: 584, op: true },
    { id: 'draft', label: 'Draft', x: 752, op: true },
    { id: 'link', label: 'Link to goal', x: 920, op: true }
  ];
  // Three rows: pipeline steps, the model that served them, where signals ended up.
  var SY = 56, MY = 165, W = 118, H = 52;
  var CURVE = 30; // control-point offset for step -> model curves
  var BUS_Y = 246; // where model lines meet before fanning out to the outcomes
  var DY = 302, DW = 140, DH = 38, DSPACE = 156, MAX_GOALS = 3;
  var MODEL_CENTER = 500;
  var CHAR_PX = 7.4; // width of one bold 13px character, for sizing boxes to their text
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

  function modelLines(m) {
    return [
      m.provider + ' \u00b7 ' + m.model,
      m.count + ' calls \u00b7 avg ' + fmtMs(m.avgMs),
      m.inputTokens + ' in / ' + m.outputTokens + ' out tokens'
    ];
  }
  // A model box grows to fit its longest line (never narrower than 190).
  function modelWidth(m) {
    var longest = Math.max.apply(null, modelLines(m).map(function (l) { return l.length; }));
    return Math.max(190, Math.round(longest * CHAR_PX) + 28);
  }
  // Boxes sit side by side with a gap, centred under the pipeline.
  function modelPositions(models) {
    var pos = {};
    var gap = 24;
    var total = models.reduce(function (a, m) { return a + modelWidth(m); }, 0) + gap * Math.max(0, models.length - 1);
    var x = Math.max(10, MODEL_CENTER - total / 2);
    models.forEach(function (m) {
      var w = modelWidth(m);
      pos[m.key] = x + w / 2;
      x += w + gap;
    });
    return pos;
  }

  // Destinations to draw: the first MAX_GOALS goals by count, the rest as one "other goals" node.
  function shownDestinations() {
    var list = [];
    var goals = [];
    data.summary.destinations.forEach(function (d) { (d.kind === 'goal' ? goals : list).push(d); });
    goals.slice(0, MAX_GOALS).forEach(function (d) { list.push(d); });
    var rest = goals.slice(MAX_GOALS);
    if (rest.length) {
      list.push({
        key: 'goals-other', kind: 'goal', label: rest.length + ' other goal' + (rest.length === 1 ? '' : 's'),
        count: rest.reduce(function (a, d) { return a + d.count; }, 0),
        members: rest.map(function (d) { return d.key; })
      });
    }
    return list;
  }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }

  function setFilter(f) {
    filter = (filter && f && filter.type === f.type && filter.value === f.value) ? null : f;
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
        var x1 = stepX[op], x2 = MODEL_CENTER;
        mk('path', { d: 'M' + x1 + ' ' + (SY + H / 2) + ' C' + x1 + ' ' + (SY + CURVE) + ',' + x2 + ' ' + (MY - CURVE) + ',' + x2 + ' ' + (MY - H / 2), 'class': 'edge ghost', 'stroke-width': 2 }, edgesG);
      });
    }
    s.edges.forEach(function (e) {
      var x1 = stepX[e.operation];
      if (x1 === undefined) x1 = stepX.draft;
      var x2 = pos[e.modelKey];
      var d = 'M' + x1 + ' ' + (SY + H / 2) + ' C' + x1 + ' ' + (SY + CURVE) + ',' + x2 + ' ' + (MY - CURVE) + ',' + x2 + ' ' + (MY - H / 2);
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
      var cls = 'node' + (st.op && !o ? ' idle' : '') + (o && o.errors > 0 ? ' err' : '') + (filter && (filter.type === 'op' || filter.type === 'node') && filter.value === st.id ? ' sel' : '');
      var g = mk('g', { 'class': cls, 'data-node': st.id }, graph);
      mk('rect', { x: st.x - W / 2, y: SY - H / 2, width: W, height: H, rx: 8 }, g);
      txt(g, st.x, SY - 4, 't1', st.label);
      var sub = '';
      if (st.id === 'signal') sub = s.signals + ' processed';
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
        } else if (st.id === 'signal') lines.push(s.signals + ' signals processed', s.withoutModel + ' with no model call', 'click to list them');
        else if (st.id === 'match') lines.push('Direction matching runs locally, no model', 'click to list matched signals');
        else lines.push(s.signals + ' signals reached a decision', 'click to list them');
        return lines;
      });
      g.addEventListener('click', function () { setFilter({ type: st.op ? 'op' : 'node', value: st.id }); });
    });

    // Model nodes.
    if (models.length === 0) {
      var gg = mk('g', { 'class': 'node idle' }, graph);
      mk('rect', { x: MODEL_CENTER - 90, y: MY - H / 2, width: 180, height: H, rx: 8, 'stroke-dasharray': '5 4' }, gg);
      txt(gg, MODEL_CENTER, MY - 4, 't1', 'No model calls');
      txt(gg, MODEL_CENTER, MY + 13, 't2', 'in this range');
    }
    models.forEach(function (m) {
      var x = pos[m.key];
      var g = mk('g', { 'class': 'node model' + (m.errors > 0 ? ' err' : '') + (filter && filter.type === 'model' && filter.value === m.key ? ' sel' : ''), 'data-model': m.key }, graph);
      var w = modelWidth(m), lines = modelLines(m);
      mk('rect', { x: x - w / 2, y: MY - H / 2, width: w, height: H + 10, rx: 8 }, g);
      txt(g, x, MY - 6, 't1', lines[0]);
      txt(g, x, MY + 11, 't2', lines[1]);
      txt(g, x, MY + 25, 't2', lines[2]);
      hover(g, function () {
        return [m.provider + ' ' + m.model, m.endpoint || '(agent, no endpoint)', m.count + ' calls, ' + m.errors + ' failed',
          'avg ' + fmtMs(m.avgMs), m.inputTokens + ' tokens in, ' + m.outputTokens + ' out', 'click to filter calls'];
      });
      g.addEventListener('click', function () { setFilter({ type: 'model', value: m.key }); });
    });

    var sources = models.length === 0
      ? [{ x: MODEL_CENTER, y: MY + H / 2 }]
      : models.map(function (m) { return { x: pos[m.key], y: MY + H / 2 + 10 }; });
    drawDestinations(sources);
  }

  // Where signals went: a row under the model(s). Each model's line drops to a
  // shared point, then fans out to the outcomes. Which model served which
  // outcome is not recorded per signal, so the fan-out is not split by model.
  function drawDestinations(sources) {
    var dests = shownDestinations();
    if (dests.length === 0) return;
    var total = dests.length * DSPACE - (DSPACE - DW);
    var x0 = Math.max(10, Math.min(MODEL_CENTER - total / 2, 1000 - 10 - total));
    var busX = x0 + total / 2;
    sources.forEach(function (src) {
      mk('path', {
        d: 'M' + src.x + ' ' + src.y + ' C' + src.x + ' ' + (src.y + 25) + ',' + busX + ' ' + (BUS_Y - 25) + ',' + busX + ' ' + BUS_Y,
        'class': 'edge dest', 'stroke-width': 2
      }, graph);
    });
    var biggest = dests.reduce(function (a, d) { return Math.max(a, d.count); }, 1);
    dests.forEach(function (d, i) {
      var DX = x0 + i * DSPACE + DW / 2;
      var y = DY;
      var sel = filter && filter.type === 'dest' && filter.value === d.key;
      var dim = filter && filter.type === 'dest' && !sel;
      mk('path', {
        d: 'M' + busX + ' ' + BUS_Y + ' C' + busX + ' ' + (BUS_Y + 25) + ',' + DX + ' ' + (y - DH / 2 - 25) + ',' + DX + ' ' + (y - DH / 2),
        'class': 'edge dest' + (dim ? ' dim' : ''),
        'stroke-width': 2 + 8 * d.count / biggest
      }, graph);
      var g = mk('g', { 'class': 'node dest' + (sel ? ' sel' : ''), 'data-dest': d.key }, graph);
      mk('rect', { x: DX - DW / 2, y: y - DH / 2, width: DW, height: DH, rx: 8 }, g);
      var isGoal = d.kind === 'goal' && d.key !== 'goals-other';
      var title = isGoal ? d.label.replace(/^Goal \\u00b7 /, '') : d.label;
      txt(g, DX, y - 2, 't1', clip(title, Math.floor((DW - 16) / CHAR_PX)));
      txt(g, DX, y + 12, 't2', (isGoal ? 'goal \\u00b7 ' : '') + d.count + (d.count === 1 ? ' signal' : ' signals'));
      hover(g, function () {
        return [d.label, d.count + (d.count === 1 ? ' signal' : ' signals') + ' ended here', 'click to list them'];
      });
      g.addEventListener('click', function () { setFilter({ type: 'dest', value: d.key, members: d.members }); });
    });
  }

  function visibleCalls() {
    return data.summary.calls.filter(function (c) {
      if (!filter || filter.type === 'dest' || filter.type === 'node') return true;
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

  function who(signalId) {
    var s = signalId && data.signals ? data.signals[signalId] : null;
    if (!s) return signalId ? '(signal no longer stored)' : '';
    return s.sender + (s.subject ? ' \u2014 ' + s.subject : '');
  }

  function filterLabel() {
    if (!filter) return 'All model calls';
    if (filter.type === 'op') return filter.value + ' calls';
    if (filter.type === 'model') return 'Calls to ' + filter.value.split('|')[1];
    if (filter.type === 'dest') {
      var found = data.summary.destinations.filter(function (d) { return d.key === filter.value; })[0];
      return 'Signals that went to ' + (found ? found.label : 'other goals');
    }
    return { signal: 'Signals processed', match: 'Signals matched to a direction' }[filter.value];
  }

  function header(box, count, noun) {
    var head = document.createElement('div');
    head.className = 'toolbar';
    var title = document.createElement('strong');
    title.textContent = filterLabel();
    var n = document.createElement('span');
    n.className = 'meta';
    n.textContent = count + ' ' + noun + (count > 300 ? ' (showing 300)' : '');
    head.appendChild(title);
    head.appendChild(n);
    if (filter) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = 'clear \u2715';
      chip.addEventListener('click', function () { setFilter(filter); });
      head.appendChild(chip);
    }
    box.appendChild(head);
  }

  function table(box, columns) {
    var t = document.createElement('table');
    t.className = 'sortable';
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    columns.forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h[0];
      th.setAttribute('data-sort', h[1]);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = document.createElement('tbody');
    t.appendChild(tb);
    box.appendChild(t);
    return tb;
  }

  function openOnClick(tr, signalId) {
    if (!signalId) return;
    tr.className = 'clickable';
    tr.addEventListener('click', function () { post({ command: 'open', id: signalId }); });
  }

  function empty(box, text) {
    var p = document.createElement('p');
    p.className = 'empty';
    p.textContent = text;
    box.appendChild(p);
  }

  // Model calls, one row each. Clicking a row opens the signal behind it.
  function drawCalls(box) {
    var calls = visibleCalls();
    header(box, calls.length, 'model calls');
    if (calls.length === 0) return empty(box, 'No model calls in this range.');
    var tb = table(box, [['When', 'text'], ['Signal', 'text'], ['Step', 'text'], ['Model', 'text'], ['Time', 'num'], ['Tokens in / out', 'num'], ['Result', 'text']]);
    calls.slice(0, 300).forEach(function (c) {
      var tr = document.createElement('tr');
      openOnClick(tr, c.signalId);
      cell(tr, new Date(c.at).toLocaleString(), '', c.at);
      cell(tr, who(c.signalId));
      cell(tr, c.operation);
      cell(tr, c.provider + ' \u00b7 ' + c.model);
      cell(tr, fmtMs(c.durationMs), '', c.durationMs);
      cell(tr, (c.inputTokens === undefined ? '\u2014' : c.inputTokens) + ' / ' + (c.outputTokens === undefined ? '\u2014' : c.outputTokens), '', (c.inputTokens || 0) + (c.outputTokens || 0));
      cell(tr, c.ok ? 'ok' : 'failed: ' + (c.error || 'unknown error').slice(0, 120), c.ok ? 'ok' : 'bad-text');
      tb.appendChild(tr);
    });
  }

  // Processed signals, one row each, for the nodes that are not model steps.
  function drawRecords(box) {
    var recs = data.summary.records.filter(function (r) {
      if (filter.type === 'dest') return filter.members ? filter.members.indexOf(r.destination) >= 0 : r.destination === filter.value;
      return filter.value !== 'match' || (r.matchedBy && r.matchedBy !== 'fallback');
    });
    header(box, recs.length, 'signals');
    if (recs.length === 0) return empty(box, 'No signals to show.');
    var tb = table(box, [['When', 'text'], ['Signal', 'text'], ['Direction', 'text'], ['Matched by', 'text'], ['Outcome', 'text'], ['Went to', 'text'], ['Model calls', 'num'], ['Model time', 'num']]);
    recs.slice(0, 300).forEach(function (r) {
      var tr = document.createElement('tr');
      openOnClick(tr, r.signalId);
      cell(tr, new Date(r.at).toLocaleString(), '', r.at);
      cell(tr, who(r.signalId));
      cell(tr, r.directionId || '\u2014');
      cell(tr, r.matchedBy || '\u2014');
      cell(tr, r.disposition);
      cell(tr, r.destinationLabel);
      cell(tr, String(r.calls), '', r.calls);
      cell(tr, r.calls ? fmtMs(r.modelMs) : '\u2014', '', r.modelMs);
      tb.appendChild(tr);
    });
  }

  function drawTable() {
    var box = document.getElementById('calls');
    box.textContent = '';
    if (filter && (filter.type === 'node' || filter.type === 'dest')) drawRecords(box); else drawCalls(box);
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
      data = { summary: m.summary, ops: m.summary.ops, signals: m.signals || {} };
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
