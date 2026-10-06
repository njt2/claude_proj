import assert from 'node:assert/strict';
import { loadCore } from '../load-core.mjs';
import { checkBlocks, checkPatchFormat, sameNormalized } from '../checks.mjs';

export const D = loadCore();

const hasOptions = (o) => !!(o && (o.ignoreWhitespace || o.ignoreCase || o.ignoreBlankLines));

// diff → 불변식 검사 → patch → 형식 검사 → 적용 검사 (옵션 없으면 바이트 일치, 있으면 정규화 일치)
export function roundTrip(a, b, opts, patchOpts = {}) {
  const r = D.diff(a, b, opts);
  checkBlocks(r, opts);
  const context = patchOpts.context ?? 3;
  const patch = D.makeUnifiedPatch(r, patchOpts);
  checkPatchFormat(patch, { oldCount: r.oldLines.length, newCount: r.newLines.length, context });
  const applied = D.applyUnifiedPatch(a, patch);
  if (hasOptions(opts)) {
    assert.ok(sameNormalized(applied, b, opts), `정규화 비교 불일치\npatch:\n${patch}`);
  } else {
    assert.equal(applied, b, `patch 적용 결과가 다름\npatch:\n${patch}`);
  }
  return { r, patch, applied };
}

export function hunkHeaders(patch) {
  return patch.split('\n').filter((l) => l.startsWith('@@ '));
}

// 블록을 짧은 문자열로: e(old)(new) / c(old)(new) / i(...) = ignored
export function blockSig(r) {
  return r.blocks
    .map((b) => `${b.type === 'equal' ? 'e' : b.ignored ? 'i' : 'c'}${b.oldStart}-${b.oldEnd}/${b.newStart}-${b.newEnd}`)
    .join(' ');
}

export const lines = (...xs) => xs.map((x) => x + '\n').join('');
export const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
