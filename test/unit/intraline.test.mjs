import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { D, roundTrip, lines } from './helpers.mjs';
import { checkRanges, stripRanges } from '../checks.mjs';
import { mulberry32, int, pick } from '../prng.mjs';

const plain = (x) => JSON.parse(JSON.stringify(x));
// vm 컨텍스트에서 만든 배열은 프로토타입이 달라 deepStrictEqual이 실패하므로 Array.from으로 옮긴다
const sub = (s, ranges) => Array.from(ranges, (r) => s.slice(r.start, r.end));

describe('diffTokens (D9)', () => {
  test('단어 하나 변경', () => {
    const t = D.diffTokens('hello world foo', 'hello there foo');
    assert.deepEqual(plain(t.a), [{ start: 6, end: 11 }]);
    assert.deepEqual(plain(t.b), [{ start: 6, end: 11 }]);
    assert.equal(t.similarity, (2 * 10) / 30);
  });
  test('한글 단어 변경', () => {
    const t = D.diffTokens('오늘 날씨가 맑다', '오늘 날씨가 흐리다');
    assert.deepEqual(sub('오늘 날씨가 맑다', t.a), ['맑다']);
    assert.deepEqual(sub('오늘 날씨가 흐리다', t.b), ['흐리다']);
  });
  test('기호만 변경', () => {
    const t = D.diffTokens('a + b;', 'a - b;');
    assert.deepEqual(sub('a + b;', t.a), ['+']);
    assert.deepEqual(sub('a - b;', t.b), ['-']);
  });
  test('공백만 변경된 구간도 표시', () => {
    const t = D.diffTokens('a  b', 'a b');
    assert.deepEqual(sub('a  b', t.a), ['  ']);
    assert.deepEqual(sub('a b', t.b), [' ']);
  });
  test('인접 변경 토큰은 한 구간으로 병합', () => {
    const t = D.diffTokens('x = foo(bar);', 'x = baz[qux];');
    assert.deepEqual(sub('x = foo(bar);', t.a), ['foo(bar)']);
  });
  test('결합 문자는 단어에 포함 (\\p{M})', () => {
    const a = 'café ok', b = 'cafe ok';
    const t = D.diffTokens(a, b);
    assert.deepEqual(sub(a, t.a), ['café']);
  });
  test('이모지(서로게이트 쌍)를 자르지 않음', () => {
    const a = 'a 😀 b 👨‍👩‍👧', b = 'a 😁 b 👨‍👩‍👦';
    const t = D.diffTokens(a, b);
    checkRanges(a, t.a, 'a');
    checkRanges(b, t.b, 'b');
    assert.deepEqual(sub(a, t.a), ['😀', '👧']);
  });
  test('둘 다 빈 문자열이면 유사도 1', () => {
    assert.deepEqual(plain(D.diffTokens('', '')), { a: [], b: [], similarity: 1 });
  });
  test('한쪽만 빈 문자열', () => {
    const t = D.diffTokens('', 'abc def');
    assert.equal(t.similarity, 0);
    assert.deepEqual(plain(t.b), [{ start: 0, end: 7 }]);
  });
  test('무작위 문자열: 구간 밖 문자가 같고 서로게이트를 자르지 않음', () => {
    const rnd = mulberry32(7);
    const alphabet = ['a', 'b', ' ', '  ', '\t', '.', '_', '한', '글', '😀', 'é', 'é', '\ud800', '1', '-', '\r'];
    for (let n = 0; n < 3000; n++) {
      const mk = () => Array.from({ length: int(rnd, 0, 20) }, () => pick(rnd, alphabet)).join('');
      const a = mk(), b = mk();
      const t = D.diffTokens(a, b);
      checkRanges(a, t.a, 'a');
      checkRanges(b, t.b, 'b');
      assert.equal(stripRanges(a, t.a), stripRanges(b, t.b), JSON.stringify([a, b]));
      assert.ok(t.similarity >= 0 && t.similarity <= 1);
    }
  });
});

describe('줄 짝짓기 (D10)', () => {
  test('pairs는 위치 기준이고 oldIndex 오름차순', () => {
    const { r } = roundTrip(lines('x', 'let a = 1;', 'let b = 2;', 'y'), lines('x', 'let a = 10;', 'let b = 20;', 'y'));
    const blk = r.blocks.find((b) => b.type === 'change');
    assert.deepEqual(Array.from(blk.pairs, (p) => [p.oldIndex, p.newIndex]), [[1, 1], [2, 2]]);
  });
  test('삭제·추가 수가 다르면 남는 쪽은 짝 없음', () => {
    const { r } = roundTrip(lines('a', 'foo bar', 'foo baz', 'b'), lines('a', 'foo qux', 'b'));
    const blk = r.blocks.find((b) => b.type === 'change');
    assert.equal(blk.pairs.length, 1);
    assert.deepEqual([blk.pairs[0].oldIndex, blk.pairs[0].newIndex], [1, 1]);
  });
  test('유사도 0.3 미만이면 pairs에 넣지 않음', () => {
    const { r } = roundTrip(lines('a', 'completely different text', 'b'), lines('a', 'xyz', 'b'));
    const blk = r.blocks.find((b) => b.type === 'change');
    assert.equal(blk.pairs.length, 0);
  });
  test('10,000자 초과 줄은 짝 생략', () => {
    const long = 'w '.repeat(5001);
    const { r } = roundTrip(lines('a', long, 'b'), lines('a', long + 'x', 'b'));
    const blk = r.blocks.find((b) => b.type === 'change');
    assert.equal(blk.pairs.length, 0);
    const ok = 'w '.repeat(4999);
    const r2 = roundTrip(lines('a', ok, 'b'), lines('a', ok + 'x', 'b')).r;
    assert.equal(r2.blocks.find((b) => b.type === 'change').pairs.length, 1);
  });
  test('줄 내부 diff는 무시 옵션과 무관하게 원문 기준', () => {
    const { r } = roundTrip(lines('Hello World'), lines('Hello  Earth'), { ignoreWhitespace: true });
    const p = r.blocks.find((b) => b.type === 'change').pairs[0];
    assert.deepEqual(sub('Hello  Earth', p.newRanges), ['  Earth']);
  });
  test('intraline:false 면 pairs 없음', () => {
    const r = D.diff('a b\n', 'a c\n', { intraline: false });
    assert.equal(r.blocks[0].pairs, undefined);
  });
  test('ignored 블록에는 pairs 없음', () => {
    const r = D.diff('a\n\nb\n', 'a\n \nb\n', { ignoreBlankLines: true, ignoreWhitespace: true });
    for (const b of r.blocks) if (b.ignored) assert.equal(b.pairs, undefined);
  });
});
