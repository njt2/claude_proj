/* app.js — 텍스트 Diff 도구 UI. DiffCore(인라인 코어)를 Worker 또는 메인 스레드에서 실행한다. */
(function () {
  'use strict';

  var Core = window.DiffCore;
  var CHUNK_ROWS = 500;
  var LINE_H = 20;
  var BIG_FILE = 50 * 1024 * 1024;
  var BINARY_SNIFF = 8192;
  var DEFAULT_NAMES = { old: '원본', new: '변경본' };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ───────────────────────────── 상태 ─────────────────────────────

  var state = {
    screen: 'input',
    sides: {
      // raw: 파일에서 읽은 원문, shown: 그것을 textarea에 넣은 뒤 읽은 값.
      // textarea의 value는 \r\n·\r을 \n으로 정규화하므로(HTML 명세), 내용이 그대로면 원문을 쓴다.
      old: { name: null, fromFile: false, raw: null, shown: null },
      new: { name: null, fromFile: false, raw: null, shown: null },
    },
    viewPref: 'auto',          // 'auto' | 'sbs' | 'unified' (사용자가 명시적으로 고르면 고정)
    result: null,              // 마지막 DiffResult (oldLines/newLines 포함)
    req: null,                 // 그 결과를 만든 요청 { oldText, newText, options, names }
    requestId: 0,
    expanded: new Set(),       // 펼친 조용한 구간 (구간 첫 블록 인덱스)
    expandAll: false,
    anchors: [],               // 유효 변경 블록 인덱스
    current: -1,
    patchAfterCompute: false,
  };

  var ui = {
    oldText: $('old-text'), newText: $('new-text'),
    diff: $('diff'), status: $('status'),
    summaryText: $('summary-text'), summaryBadges: $('summary-badges'),
    foldToggle: $('fold-toggle'), navPos: $('nav-pos'),
    optWs: $('opt-ws'), optCase: $('opt-case'), optBlank: $('opt-blank'), optContext: $('opt-context'),
    viewSbs: $('view-sbs'), viewUni: $('view-unified'),
  };
  var narrowMQ = window.matchMedia('(max-width: 767px)');

  function textArea(side) { return side === 'old' ? ui.oldText : ui.newText; }
  function sideText(side) {
    var s = state.sides[side], v = textArea(side).value;
    return s.raw !== null && v === s.shown ? s.raw : v;
  }
  function displayName(side) { return state.sides[side].name || DEFAULT_NAMES[side]; }
  function patchName(side) {
    var s = state.sides[side];
    return s.fromFile && s.name ? s.name : (side === 'old' ? 'a' : 'b');
  }

  function currentOptions() {
    return {
      ignoreWhitespace: ui.optWs.checked,
      ignoreCase: ui.optCase.checked,
      ignoreBlankLines: ui.optBlank.checked,
    };
  }
  function contextLines() {
    var v = ui.optContext.value;
    return v === 'all' ? Infinity : Number(v);
  }
  function effectiveView() {
    if (state.viewPref !== 'auto') return state.viewPref;
    return narrowMQ.matches ? 'unified' : 'sbs';
  }

  // ───────────────────────────── 계산 (Worker / 메인 스레드) ─────────────────────────────

  var engine = {
    forceMain: new URLSearchParams(location.search).get('worker') === '0',
    broken: false,
    url: null,
    worker: null,
    busy: false,
  };

  function workerMain() {
    self.onmessage = function (e) {
      var m = e.data;
      try {
        var r = DiffCore.diff(m.oldText, m.newText, m.options);
        // 줄 배열은 메인 스레드가 다시 자른다 (구조 복제 비용을 줄이기 위해)
        r.oldLines = null;
        r.newLines = null;
        self.postMessage({ requestId: m.requestId, result: r });
      } catch (err) {
        self.postMessage({ requestId: m.requestId, error: String((err && err.message) || err) });
      }
    };
  }

  function getWorker() {
    if (engine.forceMain || engine.broken) return null;
    if (engine.worker) return engine.worker;
    try {
      if (!engine.url) {
        // 빌드 시 인라인된 코어 소스를 그대로 Worker에 주입한다 (D13)
        var src = $('diff-core').textContent + '\n;(' + workerMain.toString() + ')();\n';
        engine.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      }
      var w = new Worker(engine.url);
      w.onmessage = onWorkerMessage;
      w.onerror = onWorkerError;
      engine.worker = w;
      return w;
    } catch (e) {
      engine.broken = true;
      return null;
    }
  }

  function compute() {
    var req = {
      oldText: sideText('old'),
      newText: sideText('new'),
      options: currentOptions(),
      names: { old: patchName('old'), new: patchName('new') },
      displayNames: { old: displayName('old'), new: displayName('new') },
      requestId: ++state.requestId,
    };
    state.pendingReq = req;
    showScreen('result');
    showStatus('busy');
    // 계산 중에 새 요청이 오면 기존 Worker를 버리고 새로 만든다
    if (engine.busy && engine.worker) {
      engine.worker.terminate();
      engine.worker = null;
      engine.busy = false;
    }
    var w = getWorker();
    if (w) {
      engine.busy = true;
      w.postMessage({ oldText: req.oldText, newText: req.newText, options: req.options, requestId: req.requestId });
    } else {
      runOnMain(req);
    }
  }

  function runOnMain(req) {
    // "비교 중…" 표시가 먼저 그려지도록 한 프레임 양보
    requestAnimationFrame(function () {
      setTimeout(function () {
        if (req.requestId !== state.requestId) return;
        var r;
        try {
          r = Core.diff(req.oldText, req.newText, req.options);
        } catch (e) {
          computeFailed(String((e && e.message) || e));
          return;
        }
        finish(req, r, 'main');
      }, 0);
    });
  }

  function onWorkerMessage(e) {
    engine.busy = false;
    var m = e.data;
    if (m.requestId !== state.requestId) return;
    if (m.error) computeFailed(m.error);
    else finish(state.pendingReq, m.result, 'worker');
  }

  function onWorkerError(e) {
    // Worker 스크립트를 실행할 수 없는 환경: 메인 스레드로 폴백
    if (e && e.preventDefault) e.preventDefault();
    engine.busy = false;
    engine.broken = true;
    if (engine.worker) engine.worker.terminate();
    engine.worker = null;
    if (state.pendingReq && state.pendingReq.requestId === state.requestId) runOnMain(state.pendingReq);
  }

  function finish(req, r, engineName) {
    if (!r.oldLines) r.oldLines = Core.splitLines(req.oldText).lines;
    if (!r.newLines) r.newLines = Core.splitLines(req.newText).lines;
    state.result = r;
    state.req = req;
    state.anchors = [];
    for (var i = 0; i < r.blocks.length; i++) {
      if (r.blocks[i].type === 'change' && !r.blocks[i].ignored) state.anchors.push(i);
    }
    state.current = -1;
    state.expanded = new Set();
    state.expandAll = false;
    document.body.dataset.engine = engineName;
    hideStatus();
    renderResult();
    if (state.patchAfterCompute) {
      state.patchAfterCompute = false;
      openPatch();
    }
  }

  function computeFailed(message) {
    engine.busy = false;
    showStatus('error', '비교 중 오류가 발생했습니다: ' + message);
  }

  // ───────────────────────────── 화면 전환·상태 표시 ─────────────────────────────

  function showScreen(name) {
    state.screen = name;
    document.body.dataset.screen = name;
    $('input-screen').hidden = name !== 'input';
    $('result-screen').hidden = name !== 'result';
  }

  function showStatus(kind, message) {
    var s = ui.status;
    s.hidden = false;
    s.className = 'status' + (kind === 'error' ? ' error' : '');
    s.replaceChildren();
    document.body.dataset.state = kind;
    if (kind === 'busy') {
      delete ui.summaryText.dataset.added;
      delete ui.summaryText.dataset.removed;
      delete ui.summaryText.dataset.changes;
      ui.diff.dataset.rendered = 'false';
      s.appendChild(el('span', 'spinner'));
      s.appendChild(document.createTextNode('비교 중…'));
      s.setAttribute('role', 'status');
      ui.diff.replaceChildren();
      ui.summaryText.replaceChildren();
      ui.summaryBadges.replaceChildren();
      updateNav();
    } else {
      s.setAttribute('role', 'alert');
      s.appendChild(document.createTextNode(message));
      var retry = el('button', 'small', '다시 시도');
      retry.type = 'button';
      retry.addEventListener('click', compute);
      s.appendChild(retry);
    }
  }
  function hideStatus() {
    ui.status.hidden = true;
    document.body.dataset.state = 'ready';
  }

  // ───────────────────────────── 행 모델 ─────────────────────────────
  // 행: {t:'e', o, n} equal / {t:'c', o, n, blk, ign, pair} 나란히 변경 / {t:'d'|'a', o|n, blk, ign, ranges} 통합 변경
  //     {t:'f', key, rows} 접힌 구간

  function pairMap(b) {
    var m = new Map();
    if (b.pairs) for (var i = 0; i < b.pairs.length; i++) m.set(b.pairs[i].oldIndex, b.pairs[i]);
    return m;
  }

  function pushChangeRows(out, b, blk, view) {
    var del = b.oldEnd - b.oldStart, add = b.newEnd - b.newStart;
    var pm = pairMap(b);
    var ign = !!b.ignored;
    var k, p;
    if (view === 'sbs') {
      var n = Math.max(del, add);
      for (k = 0; k < n; k++) {
        var o = k < del ? b.oldStart + k : -1;
        p = o >= 0 ? pm.get(o) : undefined;
        out.push({ t: 'c', o: o, n: k < add ? b.newStart + k : -1, blk: blk, ign: ign, pair: p, first: k === 0 });
      }
    } else {
      var byNew = new Map();
      pm.forEach(function (v) { byNew.set(v.newIndex, v); });
      for (k = 0; k < del; k++) {
        p = pm.get(b.oldStart + k);
        out.push({ t: 'd', o: b.oldStart + k, blk: blk, ign: ign, ranges: p && p.oldRanges, first: k === 0 });
      }
      for (k = 0; k < add; k++) {
        p = byNew.get(b.newStart + k);
        out.push({ t: 'a', n: b.newStart + k, blk: blk, ign: ign, ranges: p && p.newRanges, first: k === 0 && del === 0 });
      }
    }
  }

  function buildRows(r, view, context) {
    var rows = [];
    var blocks = r.blocks;
    var totalAnchors = state.anchors.length;
    var seen = 0;
    var i = 0;
    while (i < blocks.length) {
      var b = blocks[i];
      if (b.type === 'change' && !b.ignored) {
        pushChangeRows(rows, b, i, view);
        seen++;
        i++;
        continue;
      }
      // 조용한 구간: 유효 변경 사이의 equal 블록과 ignored 블록 (ignored는 접기 판단에서 변경이 아님 — D6)
      var key = i;
      var region = [];
      while (i < blocks.length && !(blocks[i].type === 'change' && !blocks[i].ignored)) {
        var q = blocks[i];
        if (q.type === 'equal') {
          for (var k = 0; k < q.oldEnd - q.oldStart; k++) region.push({ t: 'e', o: q.oldStart + k, n: q.newStart + k });
        } else {
          pushChangeRows(region, q, i, view);
        }
        i++;
      }
      var before = seen > 0 ? context : 0;
      var after = seen < totalAnchors ? context : 0;
      var hidden = region.length - before - after;
      if (context === Infinity || state.expandAll || state.expanded.has(key) || hidden < 2) {
        for (var a = 0; a < region.length; a++) rows.push(region[a]);
      } else {
        for (var x = 0; x < before; x++) rows.push(region[x]);
        rows.push({ t: 'f', key: key, rows: region.slice(before, region.length - after) });
        for (var y = region.length - after; y < region.length; y++) rows.push(region[y]);
      }
    }
    return rows;
  }

  // 행 목록 → 렌더링 단위: 500행 청크, 접힌 구간은 단독 단위 (펼칠 때 그 자리만 바꿔 끼운다)
  function toParts(rows) {
    var parts = [], cur = null;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.t === 'f') {
        cur = null;
        parts.push({ fold: row });
        continue;
      }
      if (!cur || cur.rows.length >= CHUNK_ROWS) {
        cur = { rows: [] };
        parts.push(cur);
      }
      cur.rows.push(row);
    }
    return parts;
  }

  // ───────────────────────────── 렌더링 ─────────────────────────────

  var render = { gen: 0, timer: 0, parts: null, idx: 0, view: 'sbs' };

  function appendText(parent, s, showCR) {
    if (!showCR || s.indexOf('\r') < 0) {
      parent.appendChild(document.createTextNode(s));
      return;
    }
    var bits = s.split('\r');
    for (var i = 0; i < bits.length; i++) {
      if (i) parent.appendChild(el('span', 'cr', '␍'));
      if (bits[i]) parent.appendChild(document.createTextNode(bits[i]));
    }
  }

  // 사용자 텍스트는 textContent/텍스트 노드로만 넣는다 (innerHTML 금지 — XSS 방지)
  function fillCode(cell, text, ranges, hlClass, showCR) {
    if (!ranges || !ranges.length) {
      appendText(cell, text, showCR);
      return;
    }
    var pos = 0;
    for (var i = 0; i < ranges.length; i++) {
      var rg = ranges[i];
      if (rg.start > pos) appendText(cell, text.slice(pos, rg.start), showCR);
      var s = el('span', hlClass);
      appendText(s, text.slice(rg.start, rg.end), showCR);
      cell.appendChild(s);
      pos = rg.end;
    }
    if (pos < text.length) appendText(cell, text.slice(pos), showCR);
  }

  function noEolMark(cell) {
    var m = el('span', 'noeol', '⏎ 없음');
    m.title = '파일 끝에 개행 없음';
    cell.appendChild(m);
  }

  function lnCell(num, cls) {
    return el('div', 'ln' + (cls ? ' ' + cls : ''), num >= 0 ? String(num + 1) : '');
  }

  function codeCell(side, idx, cls, ranges, showCR) {
    var r = state.result;
    var c = el('div', 'code' + (cls ? ' ' + cls : ''));
    if (idx < 0) return c;
    var text = side === 'old' ? r.oldLines[idx] : r.newLines[idx];
    fillCode(c, text, ranges, cls === 'del' ? 'hl-del' : 'hl-add', showCR);
    var last = side === 'old' ? r.oldLines.length - 1 : r.newLines.length - 1;
    var eol = side === 'old' ? r.oldEol : r.newEol;
    if (idx === last && !eol) noEolMark(c);
    return c;
  }

  function rowElement(row, view) {
    var e = el('div', 'row');
    var r = state.result;
    if (row.t === 'e') {
      e.dataset.oldLine = row.o + 1;
      e.dataset.newLine = row.n + 1;
      if (view === 'sbs') {
        e.appendChild(lnCell(row.o));
        e.appendChild(codeCell('old', row.o, ''));
        e.appendChild(lnCell(row.n, 'new'));
        e.appendChild(codeCell('new', row.n, ''));
      } else {
        e.appendChild(lnCell(row.o));
        e.appendChild(lnCell(row.n));
        var c = codeCell('old', row.o, '');
        // 통합 보기의 equal 줄은 왼쪽 원문 하나만 보이므로, 오른쪽 끝 개행 없음도 함께 표시
        if (row.n === r.newLines.length - 1 && !r.newEol && !(row.o === r.oldLines.length - 1 && !r.oldEol)) noEolMark(c);
        e.appendChild(c);
      }
      return e;
    }
    e.classList.add('chg');
    e.dataset.blk = row.blk;
    if (row.ign) e.classList.add('ign');
    if (row.t === 'c') {
      if (row.o >= 0) e.dataset.oldLine = row.o + 1;
      if (row.n >= 0) e.dataset.newLine = row.n + 1;
      var hasO = row.o >= 0, hasN = row.n >= 0;
      e.appendChild(lnCell(row.o, hasO ? 'del' : 'empty'));
      e.appendChild(codeCell('old', row.o, hasO ? 'del' : 'empty', row.pair && row.pair.oldRanges, true));
      e.appendChild(lnCell(row.n, 'new ' + (hasN ? 'add' : 'empty')));
      e.appendChild(codeCell('new', row.n, hasN ? 'add' : 'empty', row.pair && row.pair.newRanges, true));
    } else if (row.t === 'd') {
      e.dataset.oldLine = row.o + 1;
      e.appendChild(lnCell(row.o, 'del'));
      e.appendChild(lnCell(-1, 'del'));
      e.appendChild(codeCell('old', row.o, 'del', row.ranges, true));
    } else {
      e.dataset.newLine = row.n + 1;
      e.appendChild(lnCell(-1, 'add'));
      e.appendChild(lnCell(row.n, 'add'));
      e.appendChild(codeCell('new', row.n, 'add', row.ranges, true));
    }
    if (row.ign && row.first) {
      var cells = e.querySelectorAll('.code');
      cells[cells.length - 1].appendChild(el('span', 'ign-tag', '무시됨'));
    }
    return e;
  }

  function foldElement(fold) {
    var b = el('button', 'fold', '⋯ ' + fold.rows.length.toLocaleString('ko-KR') + '줄 숨김 (클릭해서 펼치기)');
    b.type = 'button';
    b.dataset.foldKey = fold.key;
    b.addEventListener('click', function () { expandFold(fold, b); });
    return b;
  }

  function chunkElement(rows, view) {
    var c = el('div', 'chunk');
    c.style.containIntrinsicSize = 'auto ' + rows.length * LINE_H + 'px';
    for (var i = 0; i < rows.length; i++) c.appendChild(rowElement(rows[i], view));
    return c;
  }

  function partElement(part, view) {
    return part.fold ? foldElement(part.fold) : chunkElement(part.rows, view);
  }

  function expandFold(fold, button) {
    state.expanded.add(fold.key);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < fold.rows.length; i += CHUNK_ROWS) {
      frag.appendChild(chunkElement(fold.rows.slice(i, i + CHUNK_ROWS), render.view));
    }
    button.replaceWith(frag);
  }

  function diffHeader(view) {
    var h = el('div', 'diff-head');
    var names = state.req ? state.req.displayNames : DEFAULT_NAMES;
    if (view === 'sbs') {
      h.appendChild(el('div', '', names.old));
      h.appendChild(el('div', '', names.new));
    } else {
      var d = el('div');
      d.appendChild(el('span', 'minus', '− '));
      d.appendChild(document.createTextNode(names.old + '   '));
      d.appendChild(el('span', 'plus', '+ '));
      d.appendChild(document.createTextNode(names.new));
      h.appendChild(d);
    }
    return h;
  }

  function renderResult() {
    var r = state.result;
    if (!r) return;
    renderSummary();
    renderDiff();
    updateNav();
    updateViewButtons();
  }

  function renderSummary() {
    var r = state.result, s = r.stats;
    var t = ui.summaryText;
    t.replaceChildren();
    t.dataset.added = s.added;
    t.dataset.removed = s.removed;
    t.dataset.changes = s.changes;
    if (r.identical) {
      t.appendChild(document.createTextNode('두 텍스트가 같습니다'));
    } else if (r.equivalent) {
      t.appendChild(document.createTextNode('차이 없음(무시 옵션 기준)'));
    } else {
      t.appendChild(el('span', 'plus', '+' + s.added.toLocaleString('ko-KR')));
      t.appendChild(document.createTextNode(' '));
      t.appendChild(el('span', 'minus', '−' + s.removed.toLocaleString('ko-KR')));
      t.appendChild(document.createTextNode(' · 변경 ' + s.changes.toLocaleString('ko-KR') + '곳'));
    }
    var b = ui.summaryBadges;
    b.replaceChildren();
    if (!r.minimal) {
      var w = el('span', 'badge warn', '대용량 입력이라 최소 diff가 아닐 수 있음');
      w.id = 'badge-nonminimal';
      b.appendChild(w);
    }
    var ignored = 0;
    for (var i = 0; i < r.blocks.length; i++) if (r.blocks[i].ignored) ignored++;
    if (ignored) b.appendChild(el('span', 'badge', '무시된 변경 ' + ignored + '곳'));
    if (r.identical || r.equivalent) b.appendChild(el('span', 'badge ok', '차이 없음'));
  }

  function renderDiff() {
    var r = state.result;
    var view = effectiveView();
    var context = contextLines();
    clearTimeout(render.timer);
    var gen = ++render.gen;
    render.view = view;
    ui.diff.dataset.rendered = 'false';

    var d = ui.diff;
    d.className = 'diff ' + (view === 'sbs' ? 'sbs' : 'uni');
    var digits = String(Math.max(r.oldLines.length, r.newLines.length, 1)).length;
    d.style.setProperty('--ln-w', (digits + 2) + 'ch');
    d.replaceChildren(diffHeader(view));

    ui.foldToggle.disabled = context === Infinity;
    ui.foldToggle.textContent = state.expandAll ? '모두 접기' : '모두 펼치기';

    if (r.blocks.length === 0) {
      d.appendChild(el('div', 'empty-note', '두 텍스트 모두 비어 있습니다'));
      render.parts = [];
      render.idx = 0;
      ui.diff.dataset.rendered = 'true';
      return;
    }

    render.parts = toParts(buildRows(r, view, context));
    render.idx = 0;
    // 첫 화면은 바로 그리고, 나머지는 작업을 잘게 나눠 메인 스레드를 막지 않는다
    var step = function () {
      if (gen !== render.gen) return;
      renderParts(12);
      if (render.idx < render.parts.length) render.timer = setTimeout(step, 0);
      else {
        ui.diff.dataset.rendered = 'true';
        applyCurrent(false);
      }
    };
    step();
  }

  function renderParts(budgetMs) {
    var t0 = performance.now();
    var frag = document.createDocumentFragment();
    while (render.idx < render.parts.length && performance.now() - t0 < budgetMs) {
      frag.appendChild(partElement(render.parts[render.idx++], render.view));
    }
    ui.diff.appendChild(frag);
  }

  // 아직 그리지 않은 블록으로 이동할 때는 그 블록까지 즉시 그린다
  function ensureBlockRendered(blk) {
    var sel = '[data-blk="' + blk + '"]';
    var found = ui.diff.querySelector(sel);
    while (!found && render.idx < render.parts.length) {
      renderParts(50);
      found = ui.diff.querySelector(sel);
    }
    return found;
  }

  // ───────────────────────────── 변경 간 이동 ─────────────────────────────

  function updateNav() {
    var total = state.result && state.screen === 'result' ? state.anchors.length : 0;
    ui.navPos.textContent = (state.current >= 0 ? state.current + 1 : 0) + ' / ' + total;
    $('nav-prev').disabled = total === 0;
    $('nav-next').disabled = total === 0;
  }

  function applyCurrent(scroll) {
    var prev = ui.diff.querySelectorAll('.row.current');
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove('current', 'current-first', 'current-last');
    if (state.current < 0) return;
    var blk = state.anchors[state.current];
    var first = ensureBlockRendered(blk);
    if (!first) return;
    var rows = ui.diff.querySelectorAll('[data-blk="' + blk + '"]');
    for (var j = 0; j < rows.length; j++) rows[j].classList.add('current');
    rows[0].classList.add('current-first');
    rows[rows.length - 1].classList.add('current-last');
    if (scroll) {
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      first.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'auto' });
      // content-visibility로 건너뛴 청크가 그려지며 위치가 바뀔 수 있어 한 번 더 맞춘다
      requestAnimationFrame(function () { first.scrollIntoView({ block: 'center' }); });
    }
  }

  function navigate(delta) {
    var n = state.anchors.length;
    if (!state.result || n === 0) return;
    if (state.current < 0) state.current = delta > 0 ? 0 : n - 1;
    else state.current = Math.max(0, Math.min(n - 1, state.current + delta));
    updateNav();
    applyCurrent(true);
  }

  // ───────────────────────────── 보기·옵션 ─────────────────────────────

  function updateViewButtons() {
    var v = effectiveView();
    ui.viewSbs.setAttribute('aria-pressed', String(v === 'sbs'));
    ui.viewUni.setAttribute('aria-pressed', String(v === 'unified'));
  }

  function setView(v) {
    state.viewPref = v;
    updateViewButtons();
    if (state.result && state.screen === 'result') {
      renderDiff();
    }
  }

  function onOptionChange() {
    // 결과 화면이면 자동 재계산 (D6/§6.2)
    if (state.screen === 'result' && state.req) compute();
  }

  // ───────────────────────────── patch ─────────────────────────────

  function currentPatch() {
    var r = state.result;
    return Core.makeUnifiedPatch(r, {
      oldName: state.req.names.old,
      newName: state.req.names.new,
      context: contextLines(),
    });
  }

  function openPatch() {
    var o0 = state.req && state.req.options, o1 = currentOptions();
    var dirty = !state.req || state.screen !== 'result' ||
      state.req.oldText !== sideText('old') || state.req.newText !== sideText('new') ||
      o0.ignoreWhitespace !== o1.ignoreWhitespace || o0.ignoreCase !== o1.ignoreCase ||
      o0.ignoreBlankLines !== o1.ignoreBlankLines;
    if (dirty) {
      state.patchAfterCompute = true;
      compute();
      return;
    }
    var patch = currentPatch();
    var o = state.req.options;
    $('patch-note').hidden = !(o.ignoreWhitespace || o.ignoreCase || o.ignoreBlankLines);
    $('patch-note').textContent = '무시 옵션이 켜져 있습니다. 컨텍스트 줄은 왼쪽 원문으로 쓰이고, 무시된 차이는 patch에 반영되지 않습니다.';
    $('patch-empty').hidden = patch !== '';
    // textarea는 \r을 정규화하므로 표시용으로만 쓰고, 복사·다운로드는 원래 문자열을 쓴다
    state.patchText = patch;
    $('patch-text').value = patch;
    $('patch-text').hidden = patch === '';
    $('patch-copy').disabled = patch === '';
    $('patch-download').disabled = patch === '';
    $('patch-msg').textContent = '';
    $('patch-dialog').showModal();
  }

  function patchFileName() {
    var s = state.sides.old;
    return s.fromFile && s.name ? s.name + '.diff' : 'changes.diff';
  }

  function downloadPatch() {
    var text = state.patchText;
    var url = URL.createObjectURL(new Blob([text], { type: 'text/x-diff;charset=utf-8' }));
    var a = el('a');
    a.href = url;
    a.download = patchFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    $('patch-msg').textContent = a.download + ' 저장';
  }

  function copyPatch() {
    var ta = $('patch-text');
    var msg = $('patch-msg');
    var text = state.patchText;
    var fallback = function () {
      // copy 이벤트에서 원문을 직접 넣는다 (textarea 선택을 복사하면 \r이 사라짐)
      var onCopy = function (e) {
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
      };
      document.addEventListener('copy', onCopy);
      var ok = false;
      try {
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
      } catch (e) { ok = false; }
      document.removeEventListener('copy', onCopy);
      if (ok) { msg.textContent = '복사했습니다'; return; }
      ta.focus();
      ta.select();
      msg.textContent = '직접 선택해서 복사하세요';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { msg.textContent = '복사했습니다'; }, fallback);
    } else {
      fallback();
    }
  }

  // ───────────────────────────── 입력 패널 ─────────────────────────────

  function countLines(t) {
    if (t === '') return 0;
    var n = 0, i = -1;
    while ((i = t.indexOf('\n', i + 1)) !== -1) n++;
    return t.charCodeAt(t.length - 1) === 10 ? n : n + 1;
  }

  function updatePane(side) {
    var t = sideText(side);
    $(side + '-name').textContent = displayName(side);
    var b = $(side + '-badges');
    b.replaceChildren();
    b.appendChild(el('span', 'badge', countLines(t).toLocaleString('ko-KR') + '줄'));
    if (t.indexOf('\r\n') !== -1) b.appendChild(el('span', 'badge', 'CRLF'));
    if (t.charCodeAt(0) === 0xfeff) b.appendChild(el('span', 'badge', 'BOM'));
    if (t !== '' && t.charCodeAt(t.length - 1) !== 10) b.appendChild(el('span', 'badge', '끝 개행 없음'));
  }

  var paneTimers = {};
  function schedulePaneUpdate(side) {
    if (paneTimers[side]) return;
    paneTimers[side] = requestAnimationFrame(function () {
      paneTimers[side] = 0;
      updatePane(side);
    });
  }

  function setSide(side, text, name, fromFile) {
    var ta = textArea(side);
    ta.value = text;
    state.sides[side] = { name: name || null, fromFile: !!fromFile, raw: text, shown: ta.value };
    setPaneMsg(side, '');
    updatePane(side);
  }

  function setPaneMsg(side, msg) { $(side + '-msg').textContent = msg; }

  function confirmBox(message, okLabel, cancelLabel) {
    // window.confirm 대신 페이지 안 확인 상자 (자동화 테스트를 막지 않도록)
    return new Promise(function (resolve) {
      var back = el('div', 'confirm-backdrop');
      var box = el('div', 'confirm-box');
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      box.appendChild(el('p', '', message));
      var actions = el('div', 'actions');
      var cancel = el('button', '', cancelLabel);
      var ok = el('button', 'primary', okLabel);
      cancel.type = ok.type = 'button';
      actions.appendChild(cancel);
      actions.appendChild(ok);
      box.appendChild(actions);
      back.appendChild(box);
      $('modal-root').appendChild(back);
      ok.focus();
      var done = function (v) { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
      document.addEventListener('keydown', onKey, true);
      ok.addEventListener('click', function () { done(true); });
      cancel.addEventListener('click', function () { done(false); });
    });
  }

  function loadFile(side, file) {
    setPaneMsg(side, '');
    var proceed = file.size > BIG_FILE
      ? confirmBox('"' + file.name + '" 파일이 큽니다 (' + (file.size / 1048576).toFixed(0) + ' MB). 불러오면 브라우저가 느려질 수 있습니다. 계속할까요?', '불러오기', '취소')
      : Promise.resolve(true);
    return proceed.then(function (ok) {
      if (!ok) return;
      return file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf);
        // D16: 앞 8KB에 NUL 바이트가 있으면 바이너리
        if (bytes.subarray(0, BINARY_SNIFF).indexOf(0) !== -1) {
          setPaneMsg(side, '"' + file.name + '"은(는) 바이너리 파일로 보여 비교할 수 없습니다.');
          return;
        }
        // D15: UTF-8 고정, BOM은 지우지 않는다
        var text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
        setSide(side, text, file.name, true);
      });
    }).catch(function (e) {
      setPaneMsg(side, '파일을 읽지 못했습니다: ' + ((e && e.message) || e));
    });
  }

  function loadDropped(files, side) {
    if (files.length >= 2) {
      loadFile('old', files[0]);
      loadFile('new', files[1]);
    } else if (files.length === 1) {
      var target = side || (sideText('old') === '' ? 'old' : 'new');
      loadFile(target, files[0]);
    }
  }

  function hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  function swapSides() {
    var o = ui.oldText.value, n = ui.newText.value;
    var so = state.sides.old, sn = state.sides.new;
    var mo = $('old-msg').textContent, mn = $('new-msg').textContent;
    ui.oldText.value = n;
    ui.newText.value = o;
    state.sides = { old: sn, new: so };
    setPaneMsg('old', mn);
    setPaneMsg('new', mo);
    updatePane('old');
    updatePane('new');
  }

  // ───────────────────────────── 이벤트 연결 ─────────────────────────────

  $('compare').addEventListener('click', compute);
  $('back').addEventListener('click', function () { showScreen('input'); updateNav(); });
  ui.viewSbs.addEventListener('click', function () { setView('sbs'); });
  ui.viewUni.addEventListener('click', function () { setView('unified'); });
  [ui.optWs, ui.optCase, ui.optBlank].forEach(function (c) { c.addEventListener('change', onOptionChange); });
  ui.optContext.addEventListener('change', function () {
    if (state.result && state.screen === 'result') renderDiff();
  });
  ui.foldToggle.addEventListener('click', function () {
    state.expandAll = !state.expandAll;
    if (!state.expandAll) state.expanded = new Set();
    renderDiff();
  });
  $('nav-prev').addEventListener('click', function () { navigate(-1); });
  $('nav-next').addEventListener('click', function () { navigate(1); });
  $('patch-open').addEventListener('click', openPatch);
  $('patch-copy').addEventListener('click', copyPatch);
  $('patch-download').addEventListener('click', downloadPatch);
  $('help-open').addEventListener('click', function () { $('help-dialog').showModal(); });
  document.querySelectorAll('dialog [data-close]').forEach(function (b) {
    b.addEventListener('click', function () { b.closest('dialog').close(); });
  });
  document.querySelectorAll('dialog').forEach(function (d) {
    // 바깥(배경) 클릭으로 닫기
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
  });

  $('theme').addEventListener('change', function (e) {
    // D17: 저장소에 남기지 않고 세션 동안만 유지
    var v = e.target.value;
    if (v === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = v;
  });

  narrowMQ.addEventListener('change', function () {
    if (state.viewPref !== 'auto') return;
    updateViewButtons();
    if (state.result && state.screen === 'result') renderDiff();
  });

  ['old', 'new'].forEach(function (side) {
    var ta = textArea(side);
    ta.addEventListener('input', function () { schedulePaneUpdate(side); });
    var fileInput = $(side + '-file');
    fileInput.addEventListener('change', function () {
      if (fileInput.files.length) loadFile(side, fileInput.files[0]);
      fileInput.value = '';
    });
  });

  document.querySelectorAll('[data-action]').forEach(function (b) {
    b.addEventListener('click', function () {
      var side = b.dataset.side;
      if (b.dataset.action === 'open') $(side + '-file').click();
      else if (b.dataset.action === 'clear') {
        setSide(side, '', null, false);
        textArea(side).focus();
      }
    });
  });
  $('swap').addEventListener('click', swapSides);

  document.querySelectorAll('.pane').forEach(function (pane) {
    var side = pane.dataset.side;
    pane.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      pane.classList.add('drop');
    });
    pane.addEventListener('dragleave', function (e) {
      if (!pane.contains(e.relatedTarget)) pane.classList.remove('drop');
    });
    pane.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      pane.classList.remove('drop');
      loadDropped(e.dataTransfer.files, side);
    });
  });
  document.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    document.querySelectorAll('.pane.drop').forEach(function (p) { p.classList.remove('drop'); });
    if (state.screen !== 'input') showScreen('input');
    loadDropped(e.dataTransfer.files, null);
  });

  function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    var tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(checkbox|radio|button|submit|reset|file|range|color)$/i.test(t.type);
    return false;
  }

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      compute();
      return;
    }
    if (document.querySelector('dialog[open]') || $('modal-root').firstChild) return;
    if (e.key === 'Escape') {
      if (state.screen === 'result') {
        e.preventDefault();
        showScreen('input');
        updateNav();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
    if (state.screen !== 'result') return;
    if (e.key === 'n' || e.key === 'j') { e.preventDefault(); navigate(1); }
    else if (e.key === 'p' || e.key === 'k') { e.preventDefault(); navigate(-1); }
  });

  // 초기 상태
  updatePane('old');
  updatePane('new');
  updateViewButtons();
  updateNav();
  showScreen('input');

  // 테스트·디버깅용 (UI 동작에는 쓰지 않음)
  window.DiffApp = { state: state, compute: compute };
})();
