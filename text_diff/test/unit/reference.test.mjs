// GNU 도구 없이 최소성을 검증한다: O(NM) DP LCS 참조 구현과 엔진의 편집 수를 대조.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { D } from './helpers.mjs';
import { checkBlocks, checkPatchFormat, lcsLength, refKeys, sameNormalized } from '../checks.mjs';
import { rngFor, int, pick } from '../prng.mjs';

function makeText(rnd, alphabet, len) {
  const ls = Array.from({ length: len }, () => pick(rnd, alphabet));
  const eol = rnd() < 0.7;
  return ls.length ? ls.join('\n') + (eol ? '\n' : '') : (rnd() < 0.2 ? '' : '');
}

function check(a, b, opts) {
  const r = D.diff(a, b, opts);
  checkBlocks(r, opts);
  const ka = refKeys(a, opts), kb = refKeys(b, opts);
  const expectedEdits = ka.length + kb.length - 2 * lcsLength(ka, kb);
  const patch = D.makeUnifiedPatch(r);
  checkPatchFormat(patch, { oldCount: r.oldLines.length, newCount: r.newLines.length });
  const applied = D.applyUnifiedPatch(a, patch);
  return { r, expectedEdits, applied };
}

describe('Myers 최소성 — O(NM) LCS 참조 대조', () => {
  test('알파벳 1~4, 길이 0~30, 12,000 케이스', () => {
    const SEED = 1001;
    let n = 0;
    for (let i = 0; i < 12000; i++) {
      const rnd = rngFor(SEED, i);
      const alphabet = ['a', 'b', 'c', 'd'].slice(0, int(rnd, 1, 4));
      const a = makeText(rnd, alphabet, int(rnd, 0, 30));
      const b = makeText(rnd, alphabet, int(rnd, 0, 30));
      const { r, expectedEdits, applied } = check(a, b, {});
      assert.equal(r.minimal, true, `case ${i}`);
      assert.equal(r.stats.added + r.stats.removed, expectedEdits, `case ${i}: ${JSON.stringify([a, b])}`);
      assert.equal(applied, b, `case ${i}: ${JSON.stringify([a, b])}`);
      n++;
    }
    assert.equal(n, 12000);
  });

  test('공백·대소문자 무시에서도 정규화 키 기준 최소 (3,000 케이스)', () => {
    const alphabet = ['a', 'A', ' a', 'b', 'B ', '\tb', 'c'];
    for (let i = 0; i < 3000; i++) {
      const rnd = rngFor(1002, i);
      const opts = { ignoreWhitespace: rnd() < 0.5, ignoreCase: rnd() < 0.5 };
      const a = makeText(rnd, alphabet, int(rnd, 0, 25));
      const b = makeText(rnd, alphabet, int(rnd, 0, 25));
      const { r, expectedEdits, applied } = check(a, b, opts);
      assert.equal(r.stats.added + r.stats.removed, expectedEdits, `case ${i}: ${JSON.stringify([a, b, opts])}`);
      assert.ok(sameNormalized(applied, b, opts), `case ${i}`);
    }
  });
});

describe('강제 휴리스틱 — 항상 올바른 정렬', () => {
  test('budget 1~4, 길이 1~300, 알파벳 2, 3,000 케이스', () => {
    let nonMinimal = 0;
    for (let i = 0; i < 3000; i++) {
      const rnd = rngFor(1003, i);
      const budget = int(rnd, 1, 4);
      const a = makeText(rnd, ['0', '1'], int(rnd, 1, 300));
      const b = makeText(rnd, ['0', '1'], int(rnd, 1, 300));
      const { r, expectedEdits, applied } = check(a, b, { budget });
      if (!r.minimal) nonMinimal++;
      // 휴리스틱이어도 최소보다 적을 수는 없다
      assert.ok(r.stats.added + r.stats.removed >= expectedEdits, `case ${i}`);
      if (r.minimal) assert.equal(r.stats.added + r.stats.removed, expectedEdits, `case ${i}`);
      assert.equal(applied, b, `case ${i}`);
    }
    // 휴리스틱 경로가 실제로 충분히 실행되었는지 확인
    assert.ok(nonMinimal > 1000, `minimal=false 케이스 ${nonMinimal}개`);
  });
});
