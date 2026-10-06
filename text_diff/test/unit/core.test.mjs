import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { D, roundTrip, hunkHeaders, blockSig, lines, range } from './helpers.mjs';

describe('splitLines (D1, D2)', () => {
  const cases = [
    ['', [], false],
    ['\n', [''], true],
    ['a', ['a'], false],
    ['a\n', ['a'], true],
    ['a\n\n', ['a', ''], true],
    ['a\r\nb\r\n', ['a\r', 'b\r'], true],
    ['\n\n\n', ['', '', ''], true],
    ['한글\n😀 이모지\nZWJ 👨‍👩‍👧', ['한글', '😀 이모지', 'ZWJ 👨‍👩‍👧'], false],
    ['a\rb', ['a\rb'], false],
  ];
  for (const [text, expLines, expEol] of cases) {
    test(JSON.stringify(text), () => {
      const s = D.splitLines(text);
      assert.deepEqual([...s.lines], expLines);
      assert.equal(s.eol, expEol);
    });
  }
});

describe('기본 diff', () => {
  test('동일 입력', () => {
    for (const t of ['a\nb\n', 'x', '\n', '한글\r\n']) {
      const { r, patch } = roundTrip(t, t);
      assert.equal(r.identical, true);
      assert.equal(r.equivalent, true);
      assert.equal(r.blocks.length, 1);
      assert.equal(r.blocks[0].type, 'equal');
      assert.equal(patch, '');
    }
  });

  test('둘 다 빈 텍스트', () => {
    const { r, patch } = roundTrip('', '');
    assert.equal(r.identical, true);
    assert.deepEqual([...r.blocks], []);
    assert.equal(patch, '');
  });

  test('빈 → 내용 있음', () => {
    const { r, patch } = roundTrip('', lines('x', 'y', 'z'));
    assert.deepEqual({ ...r.stats }, { added: 3, removed: 0, changes: 1 });
    assert.deepEqual(hunkHeaders(patch), ['@@ -0,0 +1,3 @@']);
  });

  test('내용 있음 → 빈', () => {
    const { patch } = roundTrip(lines('x', 'y'), '');
    assert.deepEqual(hunkHeaders(patch), ['@@ -1,2 +0,0 @@']);
  });

  test('빈 → 개행 없는 한 줄', () => {
    const { patch } = roundTrip('', 'x');
    assert.equal(patch, '--- a\n+++ b\n@@ -0,0 +1 @@\n+x\n\\ No newline at end of file\n');
  });

  test('한 줄짜리 파일 변경 (길이 1 생략 형식)', () => {
    const { patch } = roundTrip('a\n', 'b\n');
    assert.equal(patch, '--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n');
  });

  test('마지막 개행만 다름: "a" → "a\\n"', () => {
    const { r, patch } = roundTrip('a', 'a\n');
    assert.equal(r.stats.changes, 1);
    assert.equal(r.identical, false);
    assert.equal(patch, '--- a\n+++ b\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+a\n');
    assert.equal(patch.split('\\ No newline').length - 1, 1);
  });

  test('마지막 개행만 다름: "a\\n" → "a"', () => {
    const { patch } = roundTrip('x\na\n', 'x\na');
    assert.equal(patch, '--- a\n+++ b\n@@ -1,2 +1,2 @@\n x\n-a\n+a\n\\ No newline at end of file\n');
  });

  test('양쪽 모두 개행 없이 끝나고 마지막 줄이 컨텍스트 → 표식 한 번', () => {
    const { patch } = roundTrip('a\nb\nc', 'A\nb\nc');
    assert.equal(patch, '--- a\n+++ b\n@@ -1,3 +1,3 @@\n-a\n+A\n b\n c\n\\ No newline at end of file\n');
  });

  test('양쪽 모두 개행 없이 끝나고 마지막 줄이 바뀜 → 표식 두 번', () => {
    const { patch } = roundTrip('a\nb', 'a\nc');
    assert.equal(patch.split('\\ No newline').length - 1, 2);
  });

  test('파일 시작/끝에 걸친 변경, 컨텍스트가 경계에서 잘림', () => {
    const a = lines(...range(1, 10));
    const b = lines('0', ...range(2, 9), '11');
    const { patch } = roundTrip(a, b);
    assert.deepEqual(hunkHeaders(patch), ['@@ -1,4 +1,4 @@', '@@ -7,4 +7,4 @@']);
  });

  test('"\\n" vs "" vs "\\n\\n"', () => {
    roundTrip('\n', '');
    roundTrip('', '\n');
    roundTrip('\n', '\n\n');
    roundTrip('\n\n', 'x');
  });
});

describe('hunk 병합 (부록 A-2)', () => {
  const base = range(1, 30);
  const withChanges = (idxs) => base.map((x, i) => (idxs.includes(i) ? x + '!' : x));
  const text = (arr) => lines(...arr);

  test('context=3, 사이 equal 6줄 → hunk 1개', () => {
    const { patch } = roundTrip(text(base), text(withChanges([5, 12])));
    assert.equal(hunkHeaders(patch).length, 1);
  });
  test('context=3, 사이 equal 7줄 → hunk 2개', () => {
    const { patch } = roundTrip(text(base), text(withChanges([5, 13])));
    assert.equal(hunkHeaders(patch).length, 2);
  });
  test('context=0, 사이 equal 1줄 → hunk 2개', () => {
    const { patch } = roundTrip(text(base), text(withChanges([5, 7])), undefined, { context: 0 });
    assert.deepEqual(hunkHeaders(patch), ['@@ -6 +6 @@', '@@ -8 +8 @@']);
  });
  test('context=0, 순수 삽입/삭제 범위 형식', () => {
    const a = lines('a', 'b', 'c');
    const { patch } = roundTrip(a, lines('a', 'X', 'b', 'c'), undefined, { context: 0 });
    assert.deepEqual(hunkHeaders(patch), ['@@ -1,0 +2 @@']);
    const { patch: p2 } = roundTrip(a, lines('a', 'c'), undefined, { context: 0 });
    assert.deepEqual(hunkHeaders(p2), ['@@ -2 +1,0 @@']);
    const { patch: p3 } = roundTrip(a, lines('X', 'a', 'b', 'c'), undefined, { context: 0 });
    assert.deepEqual(hunkHeaders(p3), ['@@ -0,0 +1 @@']);
  });
  test('context 1, 5, 10, 큰 값', () => {
    for (const context of [1, 5, 10, 1000]) {
      roundTrip(text(base), text(withChanges([0, 4, 15, 29])), undefined, { context });
    }
  });
  test('헤더 이름', () => {
    const r = D.diff('a\n', 'b\n');
    const p = D.makeUnifiedPatch(r, { oldName: 'old.txt', newName: 'new.txt' });
    assert.ok(p.startsWith('--- old.txt\n+++ new.txt\n'));
  });
});

describe('patch 문법과 겹치는 내용 줄', () => {
  test('-, +, 공백, \\, @@, ---, +++ 로 시작하는 줄', () => {
    const tricky = ['-a', '+b', ' c', '\\ No newline at end of file', '@@ -1 +1 @@', '--- x', '+++ y', '', ' ', '\t', '\\'];
    const a = lines(...tricky);
    const b = lines(...tricky.slice().reverse());
    roundTrip(a, b);
    roundTrip(b, a);
    roundTrip('', a);
    roundTrip(a.slice(0, -1), b);
  });
});

describe('CRLF', () => {
  test('CRLF vs LF: 옵션 없으면 전 줄 변경', () => {
    const { r } = roundTrip('a\r\nb\r\nc\r\n', 'a\nb\nc\n');
    assert.deepEqual({ ...r.stats }, { added: 3, removed: 3, changes: 1 });
  });
  test('CRLF vs LF: 공백 무시면 equivalent', () => {
    const { r, patch } = roundTrip('a\r\nb\r\nc\r\n', 'a\nb\nc\n', { ignoreWhitespace: true });
    assert.equal(r.equivalent, true);
    assert.equal(r.identical, false);
    assert.equal(patch, '');
  });
  test('혼합 줄 끝과 \\r만 다른 줄', () => {
    roundTrip('a\r\nb\nc\r', 'a\nb\r\nc');
    roundTrip('x\r\r\n', 'x\r\n');
  });
});

describe('경계 이동 (shift_boundaries)', () => {
  test('반복 줄 구간의 삽입은 아래쪽으로 정렬된다', () => {
    // a b b b c → a b b b b c : GNU diff처럼 마지막 b 다음 삽입으로
    const { r } = roundTrip(lines('a', 'b', 'b', 'b', 'c'), lines('a', 'b', 'b', 'b', 'b', 'c'));
    assert.equal(blockSig(r), 'e0-4/0-4 c4-4/4-5 e4-5/5-6');
  });
  test('흩어질 수 있는 변경이 하나로 합쳐진다', () => {
    const { r } = roundTrip(lines('x', 'a', 'x', 'a', 'x'), lines('x', 'a', 'x', 'a', 'x', 'a', 'x'));
    assert.equal(r.stats.changes, 1);
  });
});

describe('강제 휴리스틱 (D8)', () => {
  test('budget=1 이면 minimal=false 이고 patch는 정확', () => {
    const a = lines(...'abcabba'.split(''), ...range(1, 50));
    const b = lines(...'cbabac'.split(''), ...range(1, 50).reverse());
    const r = D.diff(a, b, { budget: 1 });
    assert.equal(r.minimal, false);
    roundTrip(a, b, { budget: 1 });
  });
  test('budget=0 도 정확', () => {
    roundTrip(lines('a', 'b', 'c', 'd'), lines('b', 'x', 'c', 'y'), { budget: 0 });
  });
  test('기본 budget에서 작은 입력은 minimal', () => {
    assert.equal(D.diff(lines('a', 'b'), lines('b', 'c')).minimal, true);
  });
});

describe('applyUnifiedPatch 엄격성', () => {
  test('컨텍스트 불일치 → throw', () => {
    const p = D.makeUnifiedPatch(D.diff('a\nb\nc\n', 'a\nB\nc\n'));
    assert.throws(() => D.applyUnifiedPatch('a\nX\nc\n', p));
    assert.throws(() => D.applyUnifiedPatch('z\nb\nc\n', p));
  });
  test('개행 없음 표식 불일치 → throw', () => {
    const p = D.makeUnifiedPatch(D.diff('a\nb\n', 'a\nc\n'));
    assert.throws(() => D.applyUnifiedPatch('a\nb', p));
    const p2 = D.makeUnifiedPatch(D.diff('a\nb', 'a\nc'));
    assert.throws(() => D.applyUnifiedPatch('a\nb\n', p2));
  });
  test('헤더 줄 수 불일치 → throw', () => {
    assert.throws(() => D.applyUnifiedPatch('a\n', '--- a\n+++ b\n@@ -1 +1,2 @@\n-a\n+b\n'));
  });
  test('빈 patch는 원문 그대로', () => {
    assert.equal(D.applyUnifiedPatch('abc', ''), 'abc');
  });
});
