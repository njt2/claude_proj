import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { D, roundTrip, hunkHeaders, blockSig, lines, range } from './helpers.mjs';

describe('공백 무시 (D4)', () => {
  test('공백 위치·개수·탭 차이는 equivalent', () => {
    const { r, patch } = roundTrip(lines('a b c', '  x', 'y\t'), lines('abc', 'x', ' y '), { ignoreWhitespace: true });
    assert.equal(r.equivalent, true);
    assert.equal(patch, '');
  });
  test('컨텍스트는 왼쪽 원문 (D12)', () => {
    const a = lines('a  ', 'b', 'c');
    const { patch } = roundTrip(a, lines('a', 'B', 'c'), { ignoreWhitespace: true });
    assert.equal(patch, '--- a\n+++ b\n@@ -1,3 +1,3 @@\n a  \n-b\n+B\n c\n');
  });
  test('개행 유무 차이는 공백 무시와 무관하게 항상 차이 (D3)', () => {
    const { r } = roundTrip('a\nb', 'a\nb\n', { ignoreWhitespace: true });
    assert.equal(r.stats.changes, 1);
  });
  test('양쪽 개행 없는 마지막 줄은 공백만 다르면 equal', () => {
    const { r } = roundTrip('a\nb ', 'a\n b', { ignoreWhitespace: true });
    assert.equal(r.equivalent, true);
  });
});

describe('대소문자 무시 (D5)', () => {
  test('대소문자만 다르면 equivalent', () => {
    const { r } = roundTrip(lines('Hello', 'WORLD', 'Ünïcödé'), lines('hello', 'world', 'üNÏCÖDÉ'), { ignoreCase: true });
    assert.equal(r.equivalent, true);
  });
  test('공백은 여전히 차이', () => {
    const { r } = roundTrip(lines('Hello'), lines('hel lo'), { ignoreCase: true });
    assert.equal(r.stats.changes, 1);
  });
  test('공백 + 대소문자 무시', () => {
    const { r } = roundTrip(lines('Hello World'), lines('helloworld'), { ignoreCase: true, ignoreWhitespace: true });
    assert.equal(r.equivalent, true);
  });
});

describe('빈 줄 무시 (D6)', () => {
  test('빈 줄만 추가된 블록은 ignored', () => {
    const { r, patch } = roundTrip(lines('a', 'b', 'c'), lines('a', '', '', 'b', 'c'), { ignoreBlankLines: true });
    assert.equal(blockSig(r), 'e0-1/0-1 i1-1/1-3 e1-3/3-5');
    assert.equal(r.equivalent, true);
    assert.deepEqual({ ...r.stats }, { added: 0, removed: 0, changes: 0 });
    assert.equal(patch, '');
  });
  test('빈 줄만 삭제된 블록도 ignored', () => {
    const { r } = roundTrip(lines('a', '', 'b'), lines('a', 'b'), { ignoreBlankLines: true });
    assert.equal(r.equivalent, true);
  });
  test('빈 줄과 내용 줄이 섞인 블록은 ignored 아님', () => {
    const { r } = roundTrip(lines('a', 'b'), lines('a', '', 'x', 'b'), { ignoreBlankLines: true });
    assert.equal(r.stats.changes, 1);
    assert.equal(r.blocks.some((b) => b.ignored), false);
  });
  test('공백만 있는 줄: 공백 무시가 꺼져 있으면 빈 줄 아님, 켜져 있으면 빈 줄', () => {
    const a = lines('a', 'b'), b = lines('a', '   ', '\t', 'b');
    assert.equal(roundTrip(a, b, { ignoreBlankLines: true }).r.equivalent, false);
    assert.equal(roundTrip(a, b, { ignoreBlankLines: true, ignoreWhitespace: true }).r.equivalent, true);
  });
  test('CRLF 빈 줄("\\r")은 공백 무시가 있어야 빈 줄', () => {
    const a = 'a\r\nb\r\n', b = 'a\r\n\r\nb\r\n';
    assert.equal(roundTrip(a, b, { ignoreBlankLines: true }).r.equivalent, false);
    assert.equal(roundTrip(a, b, { ignoreBlankLines: true, ignoreWhitespace: true }).r.equivalent, true);
  });
  test('옵션 없으면 빈 줄 추가도 변경', () => {
    const { r } = roundTrip(lines('a', 'b'), lines('a', '', 'b'));
    assert.equal(r.stats.added, 1);
  });
});

describe('빈 줄 무시 + hunk 병합 (변경된 규칙)', () => {
  const base = range(1, 40);
  // idx 위치 줄을 바꾸고, after 위치 뒤에 빈 줄을 넣는다
  const make = (changeIdx, blankAfter) => {
    const out = [];
    base.forEach((x, i) => {
      out.push(i === changeIdx ? x + '!' : x);
      if (i === blankAfter) out.push('');
    });
    return lines(...out);
  };
  const opts = { ignoreBlankLines: true };

  test('유효 변경 뒤 간격 ≤ 2*context인 ignored 블록은 같은 hunk에 + 로 출력', () => {
    // 줄 10 변경, 줄 13 뒤 빈 줄 → 간격 3 (11,12,13)
    const { patch } = roundTrip(lines(...base), make(9, 12), opts);
    assert.equal(hunkHeaders(patch).length, 1);
    assert.ok(patch.includes('\n+\n'), patch);
    // 뒤 컨텍스트가 빈 줄 삽입 뒤로 3줄 이어진다
    // 7~9 앞 컨텍스트, 10 변경, 11~13, 빈 줄 삽입, 14~16 뒤 컨텍스트
    assert.deepEqual(hunkHeaders(patch), ['@@ -7,10 +7,11 @@']);
  });
  test('간격 = 2*context (6줄)이면 포함, 7줄이면 제외', () => {
    const p6 = roundTrip(lines(...base), make(9, 15), opts).patch;
    assert.ok(p6.includes('\n+\n'));
    const p7 = roundTrip(lines(...base), make(9, 16), opts).patch;
    assert.ok(!p7.includes('\n+\n'), p7);
    assert.deepEqual(hunkHeaders(p7), ['@@ -7,7 +7,7 @@']);
  });
  test('ignored 블록이 앞에 있어도 같은 규칙', () => {
    const p = roundTrip(lines(...base), make(20, 15), opts).patch;
    assert.ok(p.includes('\n+\n'));
    const p2 = roundTrip(lines(...base), make(25, 15), opts).patch;
    assert.ok(!p2.includes('\n+\n'));
  });
  test('ignored 블록만 있으면 patch는 빈 문자열', () => {
    assert.equal(roundTrip(lines(...base), make(-1, 10), opts).patch, '');
  });
  test('유효-ignored-유효가 사슬로 이어지면 hunk 1개', () => {
    const out = base.slice();
    out[5] += '!';
    out.splice(11, 0, '');   // 6번 뒤 5줄 간격
    out[17] += '!';          // 빈 줄 뒤 5줄 간격
    const { patch } = roundTrip(lines(...base), lines(...out), opts);
    assert.equal(hunkHeaders(patch).length, 1);
  });
  test('context 0, 1, 5 에서도 형식 검사 통과', () => {
    for (const context of [0, 1, 5]) {
      for (const [c, bl] of [[9, 9], [9, 10], [9, 12], [9, 20], [0, 0], [39, 38]]) {
        roundTrip(lines(...base), make(c, bl), opts, { context });
      }
    }
  });
});

describe('옵션 조합', () => {
  const a = lines('Alpha  beta', '', 'GAMMA', 'delta', '', '', 'eps');
  const b = lines('alpha beta', 'gamma', '', ' DELTA ', 'eps', '');
  const combos = [];
  for (let m = 0; m < 8; m++) {
    combos.push({ ignoreWhitespace: !!(m & 1), ignoreCase: !!(m & 2), ignoreBlankLines: !!(m & 4) });
  }
  for (const o of combos) {
    test(JSON.stringify(o), () => {
      // equivalent 여부는 어떤 LCS가 골라지느냐에 달려 있어 단언하지 않는다 (GNU -B도 같음). 정규화 속성만 검사.
      roundTrip(a, b, o);
      roundTrip(b, a, o);
    });
  }
});
