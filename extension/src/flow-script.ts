/**
 * Browser-side renderer for the flow diagram (the same flowing-dashes style as
 * Model Trace). Plain ES5-style JavaScript injected into a webview, so no
 * template literals. All text goes in through textContent.
 *
 * Input: JSON in <script type="application/json" id="flow-data"> holding a
 * FlowGraph (see flow-model.ts). Output: post({command:'drilldown', ...filter})
 * when a node or a line is clicked.
 */

export const FLOW_STYLE = `
  #flow-wrap { position: relative; margin: 8px 0 16px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; background: var(--mind-row-alt); }
  #flow { width: 100%; height: auto; display: block; }
  #flow-tip { position: absolute; pointer-events: none; display: none; white-space: pre; z-index: 5; padding: 6px 10px; border-radius: 4px;
              background: var(--vscode-editorHoverWidget-background, #252526); color: var(--vscode-editorHoverWidget-foreground, inherit);
              border: 1px solid var(--vscode-editorHoverWidget-border, #454545); font-size: 0.9em; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }
  .fl-title { fill: var(--vscode-editor-foreground); opacity: 0.6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; text-anchor: middle; }
  .fl-node { cursor: default; }
  .fl-node.pick { cursor: pointer; }
  .fl-node rect { stroke: var(--vscode-editor-background); stroke-width: 1; transition: opacity 120ms; }
  .fl-node.pick:hover rect { stroke: var(--vscode-editor-foreground); stroke-width: 2; }
  .fl-node text { fill: var(--vscode-editor-foreground); font-size: 12px; pointer-events: none;
                  paint-order: stroke; stroke: var(--vscode-editor-background); stroke-width: 3px; stroke-linejoin: round; }
  .fl-node text.small { opacity: 0.7; font-size: 11px; }
  .fl-band { opacity: 0.22; transition: opacity 120ms; }
  .fl-link.pick { cursor: pointer; }
  .fl-link.pick:hover .fl-band { opacity: 0.45; }
  .fl-flow { fill: none; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 8 8; animation: flow 1.6s linear infinite; opacity: 0.85; pointer-events: none; }
  .fl-link.dim .fl-band, .fl-link.dim .fl-flow { opacity: 0.06; }
  .fl-node.dim { opacity: 0.35; }
  .tone-good { fill: var(--mind-green); }
  .tone-accent { fill: var(--mind-accent); }
  .tone-bad { fill: var(--mind-red); }
  .tone-muted { fill: var(--vscode-descriptionForeground, #888); }
  .fl-flow.tone-good { stroke: var(--mind-green); fill: none; }
  .fl-flow.tone-accent { stroke: var(--mind-accent); fill: none; }
  .fl-flow.tone-bad { stroke: var(--mind-red); fill: none; }
  .fl-flow.tone-muted { stroke: var(--vscode-descriptionForeground, #888); fill: none; }
  @keyframes flow { to { stroke-dashoffset: -32; } }
  @media (prefers-reduced-motion: reduce) { .fl-flow { animation: none; } }
`;

export const FLOW_SCRIPT = `
(function () {
  var dataEl = document.getElementById('flow-data');
  var svg = document.getElementById('flow');
  if (!dataEl || !svg) return;
  var graph = JSON.parse(dataEl.textContent);
  var NS = 'http://www.w3.org/2000/svg';
  var tip = document.getElementById('flow-tip');
  var wrap = document.getElementById('flow-wrap');
  var W = 900, TOP = 34, GAP = 10, NODE_W = 14, MIN_H = 18;
  var COLX = [170, 440, 710];

  function mk(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function pct(n) { return graph.total ? Math.round((n / graph.total) * 100) + '%' : ''; }
  function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + '\\u2026' : s; }
  function showTip(e, lines) {
    tip.textContent = lines.join('\\n');
    tip.style.display = 'block';
    var r = wrap.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 230) + 'px';
    tip.style.top = (e.clientY - r.top + 14) + 'px';
  }
  function hover(el, linesFn, onEnter, onLeave) {
    el.addEventListener('mousemove', function (e) { showTip(e, linesFn()); });
    el.addEventListener('mouseenter', function () { if (onEnter) onEnter(); });
    el.addEventListener('mouseleave', function () { tip.style.display = 'none'; if (onLeave) onLeave(); });
  }
  function pick(filter) {
    var msg = { command: 'drilldown', window: graph.window };
    for (var k in filter) if (Object.prototype.hasOwnProperty.call(filter, k)) msg[k] = filter[k];
    post(msg);
  }

  if (graph.total === 0) {
    svg.setAttribute('viewBox', '0 0 ' + W + ' 80');
    var t = mk('text', { x: W / 2, y: 44, 'class': 'fl-title' }, svg);
    t.textContent = 'No signals in this window';
    return;
  }

  // Size the diagram to the busiest column, then use one scale for every column
  // so a line is the same thickness at both of its ends.
  var most = 1;
  graph.columns.forEach(function (c) { most = Math.max(most, c.nodes.length); });
  var H = Math.max(240, TOP + most * 46 + 20);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  var avail = H - TOP - 16;
  var scale = Infinity;
  graph.columns.forEach(function (c) {
    var room = avail - GAP * Math.max(0, c.nodes.length - 1);
    scale = Math.min(scale, room / graph.total);
  });

  var nodes = {};
  graph.columns.forEach(function (c, ci) {
    var ts = mk('text', { x: COLX[ci] + NODE_W / 2, y: 18, 'class': 'fl-title' }, svg);
    ts.textContent = c.title;
    var sizes = c.nodes.map(function (n) { return Math.max(MIN_H, n.count * scale); });
    var used = sizes.reduce(function (a, b) { return a + b; }, 0) + GAP * Math.max(0, c.nodes.length - 1);
    var y = TOP + Math.max(0, (avail - used) / 2);
    c.nodes.forEach(function (n, i) {
      nodes[n.id] = { n: n, col: ci, x: COLX[ci], y: y, h: sizes[i], inOff: 0, outOff: 0 };
      y += sizes[i] + GAP;
    });
  });

  var linkG = mk('g', {}, svg);
  var nodeG = mk('g', {}, svg);
  var linkEls = [];

  graph.links.forEach(function (l) {
    var a = nodes[l.from], b = nodes[l.to];
    if (!a || !b) return;
    var wa = l.count * (a.h / a.n.count), wb = l.count * (b.h / b.n.count);
    var x0 = a.x + NODE_W, x1 = b.x;
    var y0 = a.y + a.outOff, y1 = b.y + b.inOff;
    a.outOff += wa; b.inOff += wb;
    var mx = (x0 + x1) / 2;
    var g = mk('g', { 'class': 'fl-link' + (l.filter ? ' pick' : '') }, linkG);
    var tone = 'tone-' + b.n.tone;
    mk('path', {
      d: 'M' + x0 + ' ' + y0 + ' C' + mx + ' ' + y0 + ',' + mx + ' ' + y1 + ',' + x1 + ' ' + y1 +
         ' L' + x1 + ' ' + (y1 + wb) + ' C' + mx + ' ' + (y1 + wb) + ',' + mx + ' ' + (y0 + wa) + ',' + x0 + ' ' + (y0 + wa) + ' Z',
      'class': 'fl-band ' + tone
    }, g);
    mk('path', {
      d: 'M' + x0 + ' ' + (y0 + wa / 2) + ' C' + mx + ' ' + (y0 + wa / 2) + ',' + mx + ' ' + (y1 + wb / 2) + ',' + x1 + ' ' + (y1 + wb / 2),
      'class': 'fl-flow ' + tone
    }, g);
    linkEls.push({ el: g, from: l.from, to: l.to });
    hover(g, function () {
      return [a.n.label + ' \\u2192 ' + b.n.label, l.count + ' signals (' + pct(l.count) + ')', l.filter ? 'click to list them' : ''].filter(Boolean);
    }, function () { focusOn(function (x) { return x === g; }, [l.from, l.to]); }, unfocus);
    if (l.filter) g.addEventListener('click', function () { pick(l.filter); });
  });

  function focusOn(keepLink, keepNodes) {
    linkEls.forEach(function (x) { x.el.classList.toggle('dim', !keepLink(x.el)); });
    for (var id in nodes) if (Object.prototype.hasOwnProperty.call(nodes, id)) {
      nodes[id].g.classList.toggle('dim', keepNodes.indexOf(id) < 0);
    }
  }
  function unfocus() {
    linkEls.forEach(function (x) { x.el.classList.remove('dim'); });
    for (var id in nodes) if (Object.prototype.hasOwnProperty.call(nodes, id)) nodes[id].g.classList.remove('dim');
  }

  for (var id in nodes) if (Object.prototype.hasOwnProperty.call(nodes, id)) (function (info) {
    var n = info.n;
    var g = mk('g', { 'class': 'fl-node' + (n.filter ? ' pick' : '') }, nodeG);
    info.g = g;
    mk('rect', { x: info.x, y: info.y, width: NODE_W, height: info.h, rx: 3, 'class': 'tone-' + n.tone }, g);
    var left = info.col === 0;
    var tx = left ? info.x - 8 : info.x + NODE_W + 8;
    var anchor = left ? 'end' : 'start';
    var cy = info.y + info.h / 2;
    var t1 = mk('text', { x: tx, y: cy - 1, 'text-anchor': anchor }, g);
    t1.textContent = clip(n.label, 24);
    var t2 = mk('text', { x: tx, y: cy + 12, 'text-anchor': anchor, 'class': 'small' }, g);
    t2.textContent = n.count + ' \\u00b7 ' + pct(n.count);
    hover(g, function () {
      return [n.label, n.count + ' signals (' + pct(n.count) + ')', n.filter ? 'click to list them' : ''].filter(Boolean);
    }, function () {
      var related = [n.id];
      graph.links.forEach(function (l) { if (l.from === n.id) related.push(l.to); if (l.to === n.id) related.push(l.from); });
      focusOn(function (el) {
        var hit = false;
        linkEls.forEach(function (x) { if (x.el === el && (x.from === n.id || x.to === n.id)) hit = true; });
        return hit;
      }, related);
    }, unfocus);
    if (n.filter) g.addEventListener('click', function () { pick(n.filter); });
  })(nodes[id]);
})();
`;
