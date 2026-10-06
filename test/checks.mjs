// 단위 테스트·퍼징·회귀 테스트가 함께 쓰는 검사 함수들.
// 모든 검사는 실패 시 Error를 throw 한다 (메시지에 어떤 검사인지 포함).

export class CheckError extends Error {
  constructor(check, message) {
    super(`[${check}] ${message}`);
    this.check = check;
  }
}

function fail(check, message) {
  throw new CheckError(check, message);
}

// ───────────── 정규화 (D4, D5) — 엔진과 독립적으로 다시 구현 ─────────────

export function normalizer(opts = {}) {
  return (s) => {
    let t = s;
    if (opts.ignoreWhitespace) t = t.replace(/\s+/g, '');
    if (opts.ignoreCase) t = t.toLowerCase();
    return t;
  };
}

export function splitLinesRef(text) {
  if (text === '') return { lines: [], eol: false };
  const eol = text.endsWith('\n');
  return { lines: (eol ? text.slice(0, -1) : text).split('\n'), eol };
}

// ───────────── blocks 불변식 (§1.2) ─────────────

export function checkBlocks(r, opts = {}) {
  const C = 'blocks';
  const N = r.oldLines.length, M = r.newLines.length;
  const norm = normalizer(opts);
  const isBlank = opts.ignoreWhitespace ? (s) => /^\s*$/.test(s) : (s) => s === '';
  if (N === 0 && M === 0) {
    if (r.blocks.length !== 0) fail(C, '둘 다 비었는데 블록이 있음');
  } else if (r.blocks.length === 0) {
    fail(C, '블록이 없음');
  }
  let o = 0, n = 0, prevType = null;
  let added = 0, removed = 0, changes = 0;
  for (const [bi, b] of r.blocks.entries()) {
    const where = `블록 ${bi} ${JSON.stringify({ ...b, pairs: undefined })}`;
    if (b.type !== 'equal' && b.type !== 'change') fail(C, `${where}: 알 수 없는 type`);
    if (b.type === prevType) fail(C, `${where}: 같은 type이 연속`);
    prevType = b.type;
    if (b.oldStart !== o || b.newStart !== n) fail(C, `${where}: 빈틈 또는 겹침 (기대 old ${o}, new ${n})`);
    if (b.oldEnd < b.oldStart || b.newEnd < b.newStart) fail(C, `${where}: 구간이 뒤집힘`);
    if (b.type === 'equal') {
      const len = b.oldEnd - b.oldStart;
      if (len !== b.newEnd - b.newStart) fail(C, `${where}: equal 블록 길이가 다름`);
      if (len === 0) fail(C, `${where}: 빈 equal 블록`);
      if (b.ignored) fail(C, `${where}: equal 블록에 ignored`);
      for (let k = 0; k < len; k++) {
        const i = b.oldStart + k, j = b.newStart + k;
        if (norm(r.oldLines[i]) !== norm(r.newLines[j])) {
          fail(C, `${where}: equal인데 내용이 다름 old[${i}]=${JSON.stringify(r.oldLines[i])} new[${j}]=${JSON.stringify(r.newLines[j])}`);
        }
        // D3: 개행 없는 마지막 줄은 상대편의 개행 없는 마지막 줄과만 같을 수 있다
        const oNoEol = i === N - 1 && !r.oldEol;
        const nNoEol = j === M - 1 && !r.newEol;
        if (oNoEol !== nNoEol) fail(C, `${where}: 끝 개행 유무가 다른 줄을 equal로 봄 (old ${i}, new ${j})`);
      }
    } else {
      if (b.oldEnd === b.oldStart && b.newEnd === b.newStart) fail(C, `${where}: 빈 change 블록`);
      let allBlank = true;
      for (let i = b.oldStart; i < b.oldEnd; i++) if (!isBlank(r.oldLines[i])) allBlank = false;
      for (let j = b.newStart; j < b.newEnd; j++) if (!isBlank(r.newLines[j])) allBlank = false;
      const expectIgnored = !!opts.ignoreBlankLines && allBlank;
      if (!!b.ignored !== expectIgnored) fail(C, `${where}: ignored=${!!b.ignored}, 기대 ${expectIgnored}`);
      if (!b.ignored) {
        changes++;
        removed += b.oldEnd - b.oldStart;
        added += b.newEnd - b.newStart;
      }
      checkPairs(r, b, where, opts);
    }
    o = b.oldEnd; n = b.newEnd;
  }
  if (o !== N || n !== M) fail(C, `블록이 끝까지 덮지 않음 (old ${o}/${N}, new ${n}/${M})`);
  const s = r.stats;
  if (s.added !== added || s.removed !== removed || s.changes !== changes) {
    fail(C, `stats 불일치 ${JSON.stringify(s)} ≠ ${JSON.stringify({ added, removed, changes })}`);
  }
  if (r.equivalent !== (changes === 0)) fail(C, `equivalent=${r.equivalent}인데 유효 변경 ${changes}개`);
  return true;
}

// ───────────── 줄 내부 diff 속성 (D9, D10, Phase 3 줄 내부 속성) ─────────────

export function checkRanges(line, ranges, where) {
  const C = 'intraline';
  let prevEnd = -1;
  for (const rg of ranges) {
    if (!(rg.start < rg.end)) fail(C, `${where}: 빈 구간 ${JSON.stringify(rg)}`);
    if (rg.start < 0 || rg.end > line.length) fail(C, `${where}: 줄 밖 구간 ${JSON.stringify(rg)}`);
    if (rg.start <= prevEnd) fail(C, `${where}: 구간이 정렬·병합되지 않음`);
    prevEnd = rg.end;
    // 서로게이트 쌍 중간을 자르지 않는다
    for (const p of [rg.start, rg.end]) {
      if (p > 0 && p < line.length) {
        const hi = line.charCodeAt(p - 1), lo = line.charCodeAt(p);
        if (hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) fail(C, `${where}: 서로게이트 쌍을 자름 @${p}`);
      }
    }
  }
}

export function stripRanges(line, ranges) {
  let out = '', pos = 0;
  for (const rg of ranges) { out += line.slice(pos, rg.start); pos = rg.end; }
  return out + line.slice(pos);
}

function checkPairs(r, b, where, opts) {
  const C = 'intraline';
  if (!b.pairs) return;
  if (b.ignored) fail(C, `${where}: ignored 블록에 pairs`);
  let prev = -1;
  for (const p of b.pairs) {
    const w = `${where} pair ${p.oldIndex}/${p.newIndex}`;
    if (p.oldIndex <= prev) fail(C, `${w}: oldIndex 오름차순 아님`);
    prev = p.oldIndex;
    if (p.oldIndex < b.oldStart || p.oldIndex >= b.oldEnd) fail(C, `${w}: oldIndex가 블록 밖`);
    if (p.newIndex - b.newStart !== p.oldIndex - b.oldStart || p.newIndex >= b.newEnd) fail(C, `${w}: 위치 기준 짝이 아님`);
    const a = r.oldLines[p.oldIndex], bb = r.newLines[p.newIndex];
    if (a.length > 10000 || bb.length > 10000) fail(C, `${w}: 10,000자 초과 줄이 pairs에 있음`);
    checkRanges(a, p.oldRanges, w + ' old');
    checkRanges(bb, p.newRanges, w + ' new');
    if (stripRanges(a, p.oldRanges) !== stripRanges(bb, p.newRanges)) {
      fail(C, `${w}: 변경 구간을 뺀 나머지가 다름`);
    }
  }
}

// ───────────── unified patch 형식 검사 ─────────────

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/;

// 헤더 줄 수 == 본문 줄 수, 컨텍스트가 파일 경계가 아니면 정확히 context줄, hunk가 겹치지 않고 순서대로.
export function checkPatchFormat(patch, { oldCount, newCount, context = 3 } = {}) {
  const C = 'patch-format';
  if (patch === '') return { hunks: 0 };
  if (!patch.endsWith('\n')) fail(C, '마지막 줄이 개행으로 끝나지 않음');
  const lines = patch.slice(0, -1).split('\n');
  if (!lines[0].startsWith('--- ') || !lines[1]?.startsWith('+++ ')) fail(C, '---/+++ 헤더 없음');
  let p = 2, hunks = 0, prevOldEnd = -1, prevNewEnd = -1;
  if (p >= lines.length) fail(C, 'hunk 없음');
  while (p < lines.length) {
    const m = HUNK_RE.exec(lines[p]);
    if (!m) fail(C, `hunk 헤더 형식 아님: ${JSON.stringify(lines[p])}`);
    const os = +m[1], ol = m[2] === undefined ? 1 : +m[2];
    const ns = +m[3], nl = m[4] === undefined ? 1 : +m[4];
    if (m[2] === '1' || m[4] === '1') fail(C, `길이 1인데 생략 형식이 아님: ${lines[p]}`);
    if ((ol === 0) !== (m[2] === '0') || (ol > 0 && os === 0)) fail(C, `범위 형식 오류: ${lines[p]}`);
    const o0 = ol === 0 ? os : os - 1, n0 = nl === 0 ? ns : ns - 1;
    if (o0 <= prevOldEnd || n0 <= prevNewEnd) fail(C, `hunk가 겹치거나 붙어 있음: ${lines[p]}`);
    p++; hunks++;
    let oc = 0, nc = 0, last = '';
    const kinds = [];
    while (p < lines.length && !lines[p].startsWith('@@ ')) {
      const t = lines[p][0];
      if (t === ' ') { oc++; nc++; kinds.push(' '); }
      else if (t === '-') { oc++; kinds.push('-'); }
      else if (t === '+') { nc++; kinds.push('+'); }
      else if (t === '\\') {
        if (lines[p] !== '\\ No newline at end of file') fail(C, `알 수 없는 \\ 줄`);
        if (!last || last === '\\') fail(C, '표식 위치 오류');
      } else fail(C, `알 수 없는 줄: ${JSON.stringify(lines[p])}`);
      last = t;
      p++;
    }
    if (oc !== ol || nc !== nl) fail(C, `헤더 줄 수 불일치 -${ol}/+${nl} vs 본문 -${oc}/+${nc}`);
    const firstChange = kinds.findIndex((k) => k !== ' ');
    if (firstChange < 0) fail(C, '변경 줄이 없는 hunk');
    let lastChange = kinds.length - 1;
    while (kinds[lastChange] === ' ') lastChange--;
    const lead = firstChange, trail = kinds.length - 1 - lastChange;
    if (lead > context || trail > context) fail(C, `컨텍스트가 ${context}줄보다 많음 (앞 ${lead}, 뒤 ${trail})`);
    if (lead < context && o0 !== 0) fail(C, `파일 시작이 아닌데 앞 컨텍스트가 ${lead}줄`);
    if (oldCount !== undefined && trail < context && o0 + ol !== oldCount) {
      fail(C, `파일 끝이 아닌데 뒤 컨텍스트가 ${trail}줄`);
    }
    prevOldEnd = o0 + ol; prevNewEnd = n0 + nl;
    if (oldCount !== undefined && prevOldEnd > oldCount) fail(C, 'hunk가 원본 끝을 넘음');
    if (newCount !== undefined && prevNewEnd > newCount) fail(C, 'hunk가 대상 끝을 넘음');
  }
  return { hunks };
}

// ───────────── 참조 구현: O(NM) DP로 LCS 길이 ─────────────

export function lcsLength(a, b) {
  const n = a.length, m = b.length;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

// D3 규칙을 반영한 비교 키 배열 (참조 구현용). 개행 없는 마지막 줄은 별도 키.
export function refKeys(text, opts = {}) {
  const { lines, eol } = splitLinesRef(text);
  const norm = normalizer(opts);
  const keys = lines.map((l) => 'L' + norm(l));
  if (!eol && keys.length) keys[keys.length - 1] = 'N' + norm(lines[lines.length - 1]);
  return keys;
}

// ───────────── 옵션 속성: 정규화 후 줄 단위 비교 ─────────────

export function normalizedLines(text, opts) {
  const keys = refKeys(text, opts);
  if (!opts.ignoreBlankLines) return keys;
  const isBlank = opts.ignoreWhitespace ? (k) => /^[LN]\s*$/.test(k) : (k) => k === 'L' || k === 'N';
  // ignoreWhitespace면 정규화된 키에서 공백이 이미 빠졌으므로 'L'/'N'만 남는다
  return keys.filter((k) => !isBlank(k));
}

export function sameNormalized(aText, bText, opts) {
  const a = normalizedLines(aText, opts), b = normalizedLines(bText, opts);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
