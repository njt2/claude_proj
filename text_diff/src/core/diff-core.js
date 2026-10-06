/*
 * diff-core.js — 텍스트 diff 엔진.
 *
 * DOM·브라우저 API를 쓰지 않는다. 브라우저 메인 스레드, Web Worker, Node(vm) 세 환경에서
 * 같은 소스가 그대로 돌아간다. export 구문 없이 globalThis.DiffCore 에 할당한다.
 * 빌드 시 <script id="diff-core">로 인라인되고, Worker에는 그 textContent가 주입된다.
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  // ───────────────────────────── 줄 분리 (D1, D2) ─────────────────────────────

  // '\n'으로만 자른다. '\r'은 줄 내용에 남는다.
  // 끝이 '\n'이면 eol=true이고 마지막 빈 조각은 줄로 치지 않는다.
  function splitLines(text) {
    if (text === '') return { lines: [], eol: false };
    var eol = text.charCodeAt(text.length - 1) === 10;
    var body = eol ? text.slice(0, -1) : text;
    return { lines: body.split('\n'), eol: eol };
  }

  // ───────────────────────────── 비교 키 (D3, D4, D5) ─────────────────────────────

  var WS_RE = /\s+/g;

  function makeNormalizer(opts) {
    var ws = !!opts.ignoreWhitespace;
    var ic = !!opts.ignoreCase;
    if (ws && ic) return function (s) { return s.replace(WS_RE, '').toLowerCase(); };
    if (ws) return function (s) { return s.replace(WS_RE, ''); };
    if (ic) return function (s) { return s.toLowerCase(); };
    return null;
  }

  // 각 줄에 정수 ID를 부여한다. 양쪽이 같은 Map을 공유하므로 ID가 같으면 비교 키가 같다.
  // D3: 개행 없이 끝나는 마지막 줄은 개행 있는 어떤 줄과도 다른 줄이다. 키에 표식 문자열을
  // 붙이면 그 표식을 내용으로 가진 줄과 충돌할 수 있으므로, 대신 별도 ID를 준다.
  // 양쪽 마지막 줄이 모두 개행 없고 키가 같을 때만 같은 ID를 공유한다.
  function buildIds(oldLines, oldEol, newLines, newEol, opts) {
    var norm = makeNormalizer(opts);
    var map = new Map();
    var next = 0;
    var N = oldLines.length, M = newLines.length;
    var a = new Int32Array(N), b = new Int32Array(M);
    var oldNoEol = !oldEol && N > 0, newNoEol = !newEol && M > 0;
    var nA = oldNoEol ? N - 1 : N, nB = newNoEol ? M - 1 : M;
    var i, key, id;
    for (i = 0; i < nA; i++) {
      key = norm ? norm(oldLines[i]) : oldLines[i];
      id = map.get(key);
      if (id === undefined) { id = next++; map.set(key, id); }
      a[i] = id;
    }
    for (i = 0; i < nB; i++) {
      key = norm ? norm(newLines[i]) : newLines[i];
      id = map.get(key);
      if (id === undefined) { id = next++; map.set(key, id); }
      b[i] = id;
    }
    if (oldNoEol) a[N - 1] = next++;
    if (newNoEol) {
      if (oldNoEol) {
        var ka = norm ? norm(oldLines[N - 1]) : oldLines[N - 1];
        var kb = norm ? norm(newLines[M - 1]) : newLines[M - 1];
        b[M - 1] = ka === kb ? a[N - 1] : next++;
      } else {
        b[M - 1] = next++;
      }
    }
    return { a: a, b: b, idCount: next };
  }

  // ───────────────────────────── Myers O(ND), 선형 공간 (D7, D8) ─────────────────────────────

  // 크기에 따른 기본 비용 상한 (근거·측정값은 PROGRESS.md Phase 4).
  // 상한을 넘는 병적 입력의 비용은 (N+M) × budget에 비례한다 (P3 실측 ≈ 4.7ns × (N+M) × budget).
  // 그래서 budget = WORK / (N+M)로 두어 최악 시간을 입력 크기와 무관하게 약 1초로 묶는다.
  //  - N+M ≤ 약 2만 줄: budget이 maxD보다 커서 휴리스틱이 개입하지 않음 (항상 최소 diff)
  //  - 10만 줄(P1·P3 규모): budget 2000 — P1 minimal(256 이상이면 충분), P3 약 1초 (목표 3초)
  //  - 하한 256: 아주 큰 입력에서도 P1 같은 "조금 바뀐 대용량"은 최소 diff를 유지
  var DEFAULT_BUDGET_MIN = 256;
  var DEFAULT_BUDGET_WORK = 2e8;
  function defaultBudget(totalLines) {
    if (!(totalLines > 0)) return DEFAULT_BUDGET_WORK;
    return Math.max(DEFAULT_BUDGET_MIN, Math.floor(DEFAULT_BUDGET_WORK / totalLines));
  }

  // 지역 상자 a[aLo..aHi) × b[bLo..bHi) 에서 middle snake를 찾아 out에 (x0,y0,x1,y1)을 쓴다.
  // 좌표는 상자 기준(지역). 비용 상한을 넘어 휴리스틱 분할을 했으면 true를 반환한다.
  function middleSnake(a, aLo, aHi, b, bLo, bHi, Vf, Vb, off, budget, out) {
    var N = aHi - aLo, M = bHi - bLo;
    var delta = N - M;
    var odd = (delta & 1) !== 0;
    var maxD = (N + M + 1) >> 1;
    var d, k, c, x, y, x0, y0, x1, y1;
    Vf[off + 1] = 0;
    Vb[off + 1] = N + 1;
    for (d = 0; d <= maxD; d++) {
      // D8: 이번 단계가 상한을 넘으면, 직전 단계 정방향 끝점 중 상자 안에서 가장 멀리 간 점으로 자른다.
      // 그 점까지의 비용은 d-1 이하이므로 앞쪽 하위 문제는 상한 안에서 정확히 풀린다.
      if (d > budget) {
        var best = -1, bx = 0, by = 0;
        for (k = -(d - 1); k <= d - 1; k += 2) {
          x = Vf[off + k];
          y = x - k;
          if (x >= 0 && x <= N && y >= 0 && y <= M &&
              !(x === 0 && y === 0) && !(x === N && y === M) && x + y > best) {
            best = x + y; bx = x; by = y;
          }
        }
        if (best >= 0) {
          out[0] = bx; out[1] = by; out[2] = bx; out[3] = by;
          return true;
        }
      }
      // 정방향: Vf[k] = 대각선 k(= x - y)에서 도달한 최대 x
      for (k = -d; k <= d; k += 2) {
        if (k === -d || (k !== d && Vf[off + k - 1] < Vf[off + k + 1])) x = Vf[off + k + 1];
        else x = Vf[off + k - 1] + 1;
        y = x - k;
        x0 = x; y0 = y;
        // 경계 조건 필수: 하위 문제에서 상자 밖 원소를 읽으면 잘못된 snake가 나온다 (부록 A-4)
        while (x < N && y < M && a[aLo + x] === b[bLo + y]) { x++; y++; }
        Vf[off + k] = x;
        if (odd) {
          c = k - delta;
          if (c >= -(d - 1) && c <= d - 1 && x >= Vb[off + c]) {
            out[0] = x0; out[1] = y0; out[2] = x; out[3] = y;
            return false;
          }
        }
      }
      // 역방향: Vb[c] (c = k - delta) = 대각선 k에서 (N,M)으로부터 거꾸로 도달한 최소 x
      for (c = -d; c <= d; c += 2) {
        k = c + delta;
        if (c === -d || (c !== d && Vb[off + c + 1] - 1 < Vb[off + c - 1])) x = Vb[off + c + 1] - 1;
        else x = Vb[off + c - 1];
        y = x - k;
        x1 = x; y1 = y;
        while (x > 0 && y > 0 && a[aLo + x - 1] === b[bLo + y - 1]) { x--; y--; }
        Vb[off + c] = x;
        if (!odd && k >= -d && k <= d && Vf[off + k] >= x) {
          out[0] = x; out[1] = y; out[2] = x1; out[3] = y1;
          return false;
        }
      }
    }
    throw new Error('DiffCore: middle snake를 찾지 못함 (N=' + N + ', M=' + M + ')');
  }

  // a, b(정수 ID 배열)의 최소 편집을 ca/cb(변경 표시)에 기록한다. 휴리스틱이 개입하면 false.
  // 재귀 대신 명시적 스택을 쓴다: 휴리스틱 분할은 한쪽으로 치우쳐 깊이가 O(N)이 될 수 있다.
  function myers(a, b, ca, cb, budget) {
    var N = a.length, M = b.length;
    if (N === 0 && M === 0) return true;
    var maxD = (N + M + 1) >> 1;
    var off = maxD + 1;
    // 최상위에서 한 번 할당해 모든 하위 문제가 재사용한다 (하위 문제의 maxD는 항상 이보다 작다)
    var Vf = new Int32Array(2 * maxD + 3);
    var Vb = new Int32Array(2 * maxD + 3);
    var snake = new Int32Array(4);
    var minimal = true;
    var stack = [0, N, 0, M];
    var aLo, aHi, bLo, bHi, i, n, m, x0, y0, x1, y1;
    while (stack.length) {
      bHi = stack.pop(); bLo = stack.pop(); aHi = stack.pop(); aLo = stack.pop();
      // 공통 prefix/suffix 제거 (equal로 확정)
      while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) { aLo++; bLo++; }
      while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) { aHi--; bHi--; }
      if (aLo === aHi) { for (i = bLo; i < bHi; i++) cb[i] = 1; continue; }
      if (bLo === bHi) { for (i = aLo; i < aHi; i++) ca[i] = 1; continue; }
      if (middleSnake(a, aLo, aHi, b, bLo, bHi, Vf, Vb, off, budget, snake)) minimal = false;
      x0 = snake[0]; y0 = snake[1]; x1 = snake[2]; y1 = snake[3];
      n = aHi - aLo; m = bHi - bLo;
      // 진전 보장: 분할점이 상자 안에서 순서대로 있고, 문제 전체를 그대로 돌려주지 않아야 한다
      if (!(0 <= x0 && x0 <= x1 && x1 <= n && 0 <= y0 && y0 <= y1 && y1 <= m) ||
          (x0 === 0 && y0 === 0 && x1 === n && y1 === m)) {
        throw new Error('DiffCore: 잘못된 분할점 (' + [x0, y0, x1, y1] + ') / (' + n + ',' + m + ')');
      }
      // 뒤쪽 → 앞쪽 순으로 넣어 앞쪽을 먼저 처리
      stack.push(aLo + x1, aHi, bLo + y1, bHi);
      stack.push(aLo, aLo + x0, bLo, bLo + y0);
    }
    return minimal;
  }

  // 전처리 2 — 상대편에 없는 줄 제거 후 Myers 실행.
  // 근거: 상대편에 없는 값은 어떤 공통 부분 수열에도 들어갈 수 없다. 그런 줄을 모두 변경으로
  // 확정하고 나머지만으로 LCS를 구해도 LCS 길이는 같으므로 최소성이 유지된다. 축약 배열에서
  // 변경되지 않은 원소들은 원래 배열에서도 같은 순서의 공통 부분 수열을 이룬다.
  function computeChanges(a, b, idCount, budget) {
    var N = a.length, M = b.length;
    var ca = new Uint8Array(N), cb = new Uint8Array(M);
    var inA = new Uint8Array(idCount), inB = new Uint8Array(idCount);
    var i, ra, rb, aMap, bMap, nA = 0, nB = 0;
    for (i = 0; i < N; i++) inA[a[i]] = 1;
    for (i = 0; i < M; i++) inB[b[i]] = 1;
    for (i = 0; i < N; i++) if (inB[a[i]]) nA++; else ca[i] = 1;
    for (i = 0; i < M; i++) if (inA[b[i]]) nB++; else cb[i] = 1;

    var minimal;
    if (nA === N && nB === M) {
      minimal = myers(a, b, ca, cb, budget);
    } else {
      ra = new Int32Array(nA); aMap = new Int32Array(nA);
      rb = new Int32Array(nB); bMap = new Int32Array(nB);
      var p = 0;
      for (i = 0; i < N; i++) if (!ca[i]) { ra[p] = a[i]; aMap[p++] = i; }
      p = 0;
      for (i = 0; i < M; i++) if (!cb[i]) { rb[p] = b[i]; bMap[p++] = i; }
      var rca = new Uint8Array(nA), rcb = new Uint8Array(nB);
      minimal = myers(ra, rb, rca, rcb, budget);
      for (i = 0; i < nA; i++) if (rca[i]) ca[aMap[i]] = 1;
      for (i = 0; i < nB; i++) if (rcb[i]) cb[bMap[i]] = 1;
    }
    return { ca: ca, cb: cb, minimal: minimal };
  }

  // ───────────────────────────── 경계 이동 (GNU diff shift_boundaries 이식) ─────────────────────────────

  // 같은 내용이 반복되는 구간에서 변경 구간을 위아래로 밀어 인접한 변경 구간과 합치고,
  // 합칠 것이 없으면 가능한 한 아래로, 상대편에 대응하는 변경 구간이 있으면 그쪽에 맞춘다.
  // 변경 구간 경계의 같은 줄끼리 맞바꾸는 것뿐이라 편집 수는 바뀌지 않는다.
  // ch*: 앞뒤로 0 한 칸씩 덧댄 배열 (논리 인덱스 i는 ch[i + 1]).
  function shiftBoundaries(eqA, chA, eqB, chB) {
    for (var f = 0; f < 2; f++) {
      var changed = f === 0 ? chA : chB;
      var other = f === 0 ? chB : chA;
      var equivs = f === 0 ? eqA : eqB;
      var iEnd = equivs.length;
      var i = 0, j = 0, start, runlength, corresponding;
      for (;;) {
        // 다음 변경 구간의 시작을 찾으며 상대편의 대응 위치 j를 따라간다
        while (i < iEnd && !changed[i + 1]) {
          while (other[(j++) + 1]) { /* 상대편 변경 줄 건너뜀 */ }
          i++;
        }
        if (i === iEnd) break;
        start = i;
        while (changed[(++i) + 1]) { /* 구간 끝 */ }
        while (other[j + 1]) j++;
        do {
          runlength = i - start;
          // 앞 줄이 구간 마지막 줄과 같으면 위로 민다 (앞 변경 구간과 합쳐짐)
          while (start && equivs[start - 1] === equivs[i - 1]) {
            changed[(--start) + 1] = 1;
            changed[(--i) + 1] = 0;
            while (changed[start]) start--;
            while (other[(--j) + 1]) { /* */ }
          }
          corresponding = other[j] ? i : iEnd;
          // 구간 첫 줄이 다음 줄과 같으면 아래로 민다 (뒤 변경 구간과 합쳐짐)
          while (i !== iEnd && equivs[start] === equivs[i]) {
            changed[(start++) + 1] = 0;
            changed[(i++) + 1] = 1;
            while (changed[i + 1]) i++;
            while (other[(++j) + 1]) corresponding = i;
          }
        } while (runlength !== i - start);
        // 가능하면 상대편 변경 구간과 맞닿는 위치로 되돌린다
        while (corresponding < i) {
          changed[(--start) + 1] = 1;
          changed[(--i) + 1] = 0;
          while (other[(--j) + 1]) { /* */ }
        }
      }
    }
  }

  function padded(arr) {
    var p = new Uint8Array(arr.length + 2);
    p.set(arr, 1);
    return p;
  }

  // ───────────────────────────── 줄 내부 diff (D9, D10) ─────────────────────────────

  // 단어(문자·결합 문자·숫자·_) / 공백 덩어리 / 기호 1개. u 플래그라 서로게이트 쌍을 자르지 않는다.
  var TOKEN_RE = /[\p{L}\p{M}\p{N}_]+|\s+|[^\p{L}\p{M}\p{N}_\s]/gu;
  var INTRALINE_MAX_LEN = 10000;
  var PAIR_MIN_SIMILARITY = 0.3;

  function tokenize(s) {
    return s.match(TOKEN_RE) || [];
  }

  // 변경된 토큰들을 UTF-16 구간으로 바꾸고 인접 구간을 병합한다.
  function tokenRanges(tokens, changed) {
    var ranges = [];
    var pos = 0, last = null;
    for (var i = 0; i < tokens.length; i++) {
      var len = tokens[i].length;
      if (changed[i]) {
        if (last && last.end === pos) last.end = pos + len;
        else { last = { start: pos, end: pos + len }; ranges.push(last); }
      }
      pos += len;
    }
    return ranges;
  }

  function diffTokens(aLine, bLine) {
    if (aLine === '' && bLine === '') return { a: [], b: [], similarity: 1 };
    var ta = tokenize(aLine), tb = tokenize(bLine);
    var na = ta.length, nb = tb.length, i, id;
    var ca = new Uint8Array(na), cb = new Uint8Array(nb);
    // 공통 앞뒤 토큰은 변경 없음으로 확정하고 가운데만 비교한다
    // (줄이 짝지어진 경우 대부분 가운데가 짧아서, 대용량 입력에서 토큰 diff 비용이 크게 준다)
    var pre = 0, suf = 0;
    while (pre < na && pre < nb && ta[pre] === tb[pre]) pre++;
    while (suf < na - pre && suf < nb - pre && ta[na - 1 - suf] === tb[nb - 1 - suf]) suf++;
    var ma = na - pre - suf, mb = nb - pre - suf;
    if (ma === 0 || mb === 0) {
      for (i = 0; i < ma; i++) ca[pre + i] = 1;
      for (i = 0; i < mb; i++) cb[pre + i] = 1;
    } else {
      var map = new Map(), next = 0;
      var ia = new Int32Array(ma), ib = new Int32Array(mb);
      for (i = 0; i < ma; i++) {
        id = map.get(ta[pre + i]);
        if (id === undefined) { id = next++; map.set(ta[pre + i], id); }
        ia[i] = id;
      }
      for (i = 0; i < mb; i++) {
        id = map.get(tb[pre + i]);
        if (id === undefined) { id = next++; map.set(tb[pre + i], id); }
        ib[i] = id;
      }
      var r = computeChanges(ia, ib, next, Infinity);
      ca.set(r.ca, pre);
      cb.set(r.cb, pre);
    }
    var common = 0;
    for (i = 0; i < na; i++) if (!ca[i]) common += ta[i].length;
    return {
      a: tokenRanges(ta, ca),
      b: tokenRanges(tb, cb),
      similarity: (2 * common) / (aLine.length + bLine.length),
    };
  }

  // ───────────────────────────── diff ─────────────────────────────

  function isBlankFn(ignoreWhitespace) {
    var re = /^\s*$/;
    return ignoreWhitespace ? function (s) { return re.test(s); } : function (s) { return s === ''; };
  }

  function diff(oldText, newText, options) {
    var opts = options || {};
    var ignoreBlankLines = !!opts.ignoreBlankLines;
    var intraline = opts.intraline !== false;

    var so = splitLines(oldText), sn = splitLines(newText);
    var oldLines = so.lines, newLines = sn.lines;
    var N = oldLines.length, M = newLines.length;
    var budget = typeof opts.budget === 'number' ? opts.budget : defaultBudget(N + M);

    var ids = buildIds(oldLines, so.eol, newLines, sn.eol, opts);
    var r = computeChanges(ids.a, ids.b, ids.idCount, budget);

    var chA = padded(r.ca), chB = padded(r.cb);
    shiftBoundaries(ids.a, chA, ids.b, chB);

    // 블록 구성: 두 변경 표시 배열을 함께 걷는다
    var blocks = [];
    var i = 0, j = 0, s0, s1;
    while (i < N || j < M) {
      if (i < N && j < M && !chA[i + 1] && !chB[j + 1]) {
        s0 = i; s1 = j;
        while (i < N && j < M && !chA[i + 1] && !chB[j + 1]) {
          // 둘 다 변경되지 않은 위치라면 같은 ID여야 한다
          if (ids.a[i] !== ids.b[j]) throw new Error('DiffCore: 정렬 불일치 at ' + i + '/' + j);
          i++; j++;
        }
        blocks.push({ type: 'equal', oldStart: s0, oldEnd: i, newStart: s1, newEnd: j });
      } else {
        s0 = i; s1 = j;
        while (i < N && chA[i + 1]) i++;
        while (j < M && chB[j + 1]) j++;
        if (i === s0 && j === s1) throw new Error('DiffCore: 빈 변경 블록 at ' + i + '/' + j);
        blocks.push({ type: 'change', oldStart: s0, oldEnd: i, newStart: s1, newEnd: j });
      }
    }

    // D6: 삭제·추가 줄이 전부 빈 줄인 변경 블록은 ignored
    if (ignoreBlankLines) {
      var isBlank = isBlankFn(!!opts.ignoreWhitespace);
      for (var bi = 0; bi < blocks.length; bi++) {
        var bl = blocks[bi];
        if (bl.type !== 'change') continue;
        var all = true, t;
        for (t = bl.oldStart; all && t < bl.oldEnd; t++) if (!isBlank(oldLines[t])) all = false;
        for (t = bl.newStart; all && t < bl.newEnd; t++) if (!isBlank(newLines[t])) all = false;
        bl.ignored = all;
      }
    }

    var added = 0, removed = 0, changes = 0;
    for (var q = 0; q < blocks.length; q++) {
      var B = blocks[q];
      if (B.type !== 'change' || B.ignored) continue;
      changes++;
      removed += B.oldEnd - B.oldStart;
      added += B.newEnd - B.newStart;
      if (intraline) B.pairs = linePairs(B, oldLines, newLines);
    }

    return {
      oldLines: oldLines, newLines: newLines,
      oldEol: so.eol, newEol: sn.eol,
      blocks: blocks,
      stats: { added: added, removed: removed, changes: changes },
      minimal: r.minimal,
      identical: oldText === newText,
      equivalent: changes === 0,
    };
  }

  // D10: 삭제 i번째와 추가 i번째를 위치 기준으로 짝짓는다
  function linePairs(block, oldLines, newLines) {
    var pairs = [];
    var n = Math.min(block.oldEnd - block.oldStart, block.newEnd - block.newStart);
    for (var i = 0; i < n; i++) {
      var oi = block.oldStart + i, ni = block.newStart + i;
      var a = oldLines[oi], b = newLines[ni];
      if (a.length > INTRALINE_MAX_LEN || b.length > INTRALINE_MAX_LEN) continue;
      var t = diffTokens(a, b);
      if (t.similarity < PAIR_MIN_SIMILARITY) continue;
      pairs.push({ oldIndex: oi, newIndex: ni, oldRanges: t.a, newRanges: t.b });
    }
    return pairs;
  }

  // ───────────────────────────── unified patch (D11, D12) ─────────────────────────────

  function hunkRange(start0, len) {
    if (len === 0) return start0 + ',0';
    if (len === 1) return String(start0 + 1);
    return (start0 + 1) + ',' + len;
  }

  function headerName(name, fallback) {
    var s = name === undefined || name === null || name === '' ? fallback : String(name);
    return s.replace(/[\r\n]/g, ' ');
  }

  var NO_EOL_MARK = '\\ No newline at end of file';

  // hunk 묶기: ignored 블록도 다른 변경 블록과 똑같이 취급해, 앞 변경의 끝과 다음 변경의 시작
  // 사이 old 줄 수가 2*context 이하면 같은 hunk로 묶는다. ignored 블록만으로 된 hunk는 출력하지 않는다.
  // 이렇게 하면 hunk 사이 간격이 항상 2*context+1 이상이라 앞뒤 컨텍스트가 파일 경계에서만 잘리고
  // hunk끼리 겹치지 않는다. (뒤 컨텍스트가 앞보다 짧은 hunk는 GNU patch가 "파일 끝에만 맞는 hunk"로
  // 해석해 거부한다 — PROGRESS.md 계획 변경 기록 참고)
  function makeUnifiedPatch(result, opts) {
    var o = opts || {};
    var context = o.context === undefined ? 3 : o.context;
    if (!(context >= 0)) context = 0;
    var blocks = result.blocks;
    var oldLines = result.oldLines, newLines = result.newLines;
    var N = oldLines.length, M = newLines.length;

    var groups = [], cur = null, prev = null;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type !== 'change') continue;
      if (cur && b.oldStart - prev.oldEnd <= 2 * context) {
        cur.last = i;
      } else {
        cur = { first: i, last: i, effective: false };
        groups.push(cur);
      }
      if (!b.ignored) cur.effective = true;
      prev = b;
    }

    var out = [];
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      if (!grp.effective) continue;
      var fb = blocks[grp.first], lb = blocks[grp.last];
      // 앞뒤 블록은 불변식상 equal(또는 없음)이고, 위 묶기 규칙 덕분에 context 줄 이상이다(파일 경계 제외)
      var pre = Math.min(context, fb.oldStart);
      var post = Math.min(context, N - lb.oldEnd);
      var oStart = fb.oldStart - pre, nStart = fb.newStart - pre;
      var oEnd = lb.oldEnd + post, nEnd = lb.newEnd + post;
      if (nStart < 0 || nEnd > M) throw new Error('DiffCore: hunk 컨텍스트 범위 오류');

      out.push('@@ -' + hunkRange(oStart, oEnd - oStart) + ' +' + hunkRange(nStart, nEnd - nStart) + ' @@');
      var k, t;
      var emitCtx = function (from, to) {
        for (var x = from; x < to; x++) {
          out.push(' ' + oldLines[x]);
          if (x === N - 1 && !result.oldEol) out.push(NO_EOL_MARK);
        }
      };
      emitCtx(oStart, fb.oldStart);
      for (k = grp.first; k <= grp.last; k++) {
        var blk = blocks[k];
        if (blk.type === 'equal') {
          emitCtx(blk.oldStart, blk.oldEnd);
        } else {
          for (t = blk.oldStart; t < blk.oldEnd; t++) {
            out.push('-' + oldLines[t]);
            if (t === N - 1 && !result.oldEol) out.push(NO_EOL_MARK);
          }
          for (t = blk.newStart; t < blk.newEnd; t++) {
            out.push('+' + newLines[t]);
            if (t === M - 1 && !result.newEol) out.push(NO_EOL_MARK);
          }
        }
      }
      emitCtx(lb.oldEnd, oEnd);
    }
    if (!out.length) return '';
    return '--- ' + headerName(o.oldName, 'a') + '\n+++ ' + headerName(o.newName, 'b') + '\n' +
      out.join('\n') + '\n';
  }

  // ───────────────────────────── patch 적용 (테스트용, 엄격) ─────────────────────────────

  var HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  function applyUnifiedPatch(oldText, patchText) {
    if (patchText === '') return oldText;
    if (patchText.charCodeAt(patchText.length - 1) !== 10) throw new Error('patch가 개행으로 끝나지 않음');
    var pl = patchText.slice(0, -1).split('\n');
    if (pl.length < 2 || pl[0].slice(0, 4) !== '--- ' || pl[1].slice(0, 4) !== '+++ ') {
      throw new Error('patch 헤더(---/+++)가 없음');
    }
    var so = splitLines(oldText);
    var old = so.lines, oldEol = so.eol, N = old.length;
    var out = [];
    var outNoEol = false;      // 결과의 마지막 줄이 "개행 없음"으로 확정됨 → 더 붙일 수 없음
    var pos = 0;               // old에서 다음 줄
    var p = 2;

    function fail(msg) { throw new Error('patch 적용 실패 (patch ' + (p + 1) + '번째 줄): ' + msg); }
    function push(s) {
      if (outNoEol) fail('개행 없음 표식 뒤에 줄이 더 있음');
      out.push(s);
    }

    if (p >= pl.length) fail('hunk가 없음');
    while (p < pl.length) {
      var m = HUNK_RE.exec(pl[p]);
      if (!m) fail('hunk 헤더가 아님: ' + JSON.stringify(pl[p]));
      var ol = m[2] === undefined ? 1 : +m[2];
      var nl = m[4] === undefined ? 1 : +m[4];
      var oStart0 = ol === 0 ? +m[1] : +m[1] - 1;
      if (oStart0 < pos) fail('hunk가 겹치거나 순서가 틀림');
      if (oStart0 + ol > N) fail('hunk가 원본 끝을 넘음');
      while (pos < oStart0) push(old[pos++]);
      p++;
      var oc = 0, nc = 0, needOldMark = false, last = '';
      while (p < pl.length) {
        var line = pl[p];
        var tag = line.charAt(0);
        if (tag === '\\') {
          if (line !== NO_EOL_MARK) fail('알 수 없는 \\ 줄');
          if (last === ' ' || last === '-') {
            if (!needOldMark) fail('원본 줄은 개행으로 끝나는데 개행 없음 표식이 있음');
            needOldMark = false;
            if (last === ' ') outNoEol = true;
          } else if (last === '+') {
            outNoEol = true;
          } else {
            fail('표식 앞에 줄이 없음');
          }
          last = '\\';
          p++;
          continue;
        }
        if (needOldMark) fail('원본 마지막 줄에 개행이 없는데 표식이 없음');
        if (oc === ol && nc === nl) break;
        var text = line.slice(1);
        if (tag === ' ' || tag === '-') {
          if (pos >= N) fail('원본 끝을 넘음');
          if (old[pos] !== text) fail('원본과 다름: ' + JSON.stringify(old[pos]) + ' ≠ ' + JSON.stringify(text));
          if (pos === N - 1 && !oldEol) needOldMark = true;
          if (tag === ' ') { push(text); nc++; }
          pos++; oc++;
        } else if (tag === '+') {
          push(text); nc++;
        } else {
          fail('알 수 없는 줄 종류: ' + JSON.stringify(line));
        }
        if (oc > ol || nc > nl) fail('hunk 헤더의 줄 수보다 많음');
        last = tag;
        p++;
      }
      if (needOldMark) fail('원본 마지막 줄에 개행이 없는데 표식이 없음');
      if (oc !== ol || nc !== nl) fail('hunk 헤더의 줄 수와 본문이 다름');
    }
    var copiedTail = pos < N;
    while (pos < N) push(old[pos++]);
    var eol = copiedTail ? oldEol : !outNoEol;
    if (!out.length) return '';
    return out.join('\n') + (eol ? '\n' : '');
  }

  global.DiffCore = {
    VERSION: VERSION,
    splitLines: splitLines,
    diff: diff,
    makeUnifiedPatch: makeUnifiedPatch,
    applyUnifiedPatch: applyUnifiedPatch,
    diffTokens: diffTokens,
    defaultBudget: defaultBudget,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
