// 퍼징 케이스 하나에 대한 전체 검사. 퍼저와 회귀 테스트가 같은 코드를 쓴다.
//   1) prepareCase  — 엔진만으로 하는 동기 검사 (불변식, 형식, 자체 적용, 옵션 속성, 줄 내부 속성)
//   2) gnuCheckCase — GNU patch 적용 일치, GNU diff --minimal 편집 수 일치 (비동기)
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CheckError, checkBlocks, checkPatchFormat, sameNormalized } from './checks.mjs';

export const hasOptions = (o) => !!(o && (o.ignoreWhitespace || o.ignoreCase || o.ignoreBlankLines));

// c = { A, B, options, budget }
export function prepareCase(D, c) {
  const opts = { ...(c.options || {}) };
  if (c.budget !== undefined && c.budget !== null) opts.budget = c.budget;
  const r = D.diff(c.A, c.B, opts);
  checkBlocks(r, c.options || {});   // 'blocks', 'intraline'
  const patch = D.makeUnifiedPatch(r);
  checkPatchFormat(patch, { oldCount: r.oldLines.length, newCount: r.newLines.length, context: 3 });
  let applied;
  try {
    applied = D.applyUnifiedPatch(c.A, patch);
  } catch (e) {
    throw Object.assign(new CheckError('self-apply', e.message), { patch });
  }
  if (hasOptions(c.options)) {
    if (!sameNormalized(applied, c.B, c.options)) {
      throw Object.assign(new CheckError('option-property', '정규화한 적용 결과가 B와 다름'), { patch, actual: applied });
    }
  } else if (applied !== c.B) {
    throw Object.assign(new CheckError('self-apply', '적용 결과가 B와 다름'), { patch, actual: applied });
  }
  return {
    r,
    patch,
    expected: hasOptions(c.options) ? applied : c.B,
    wantMinimal: !hasOptions(c.options) && r.minimal,
    edits: r.stats.added + r.stats.removed,
  };
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }));
  });
}

let workBase = null;
function workDir() {
  if (!workBase) {
    workBase = path.join(os.tmpdir(), 'text-diff-fuzz');
    mkdirSync(workBase, { recursive: true });
  }
  return mkdtempSync(path.join(workBase, 'c-'));
}

// normal 형식 diff 출력에서 '< ' / '> ' 로 시작하는 줄 수
function countNormalEdits(buf) {
  let n = 0, start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      if (i - start >= 2 && (buf[start] === 0x3c || buf[start] === 0x3e) && buf[start + 1] === 0x20) n++;
      start = i + 1;
    }
  }
  return n;
}

export async function gnuCheckCase(env, c, prep) {
  const dir = workDir();
  let ok = false;
  try {
    const A = Buffer.from(c.A, 'utf8');
    const expected = Buffer.from(prep.expected, 'utf8');
    writeFileSync(path.join(dir, 'A'), A);
    if (prep.patch === '') {
      if (!A.equals(expected)) {
        throw Object.assign(new CheckError('gnu-patch', 'patch가 비었는데 기대값이 A와 다름'), { actual: c.A });
      }
    } else {
      writeFileSync(path.join(dir, 'p.diff'), Buffer.from(prep.patch, 'utf8'));
      const res = await run(env.patch, ['-s', '--binary', '-F0', '-o', 'out', 'A', 'p.diff'], dir);
      if (res.code !== 0) {
        throw new CheckError('gnu-patch', `GNU patch exit ${res.code}: ${res.stderr.trim()}`);
      }
      const out = readFileSync(path.join(dir, 'out'));
      if (!out.equals(expected)) {
        throw Object.assign(new CheckError('gnu-patch', 'GNU patch 결과가 기대값과 다름'), { actual: out.toString('utf8') });
      }
    }
    if (prep.wantMinimal) {
      writeFileSync(path.join(dir, 'B'), Buffer.from(c.B, 'utf8'));
      const res = await run(env.diff, ['-a', '--minimal', 'A', 'B'], dir);
      if (res.code !== 0 && res.code !== 1) throw new CheckError('gnu-minimal', `GNU diff exit ${res.code}: ${res.stderr.trim()}`);
      const gnu = countNormalEdits(res.stdout);
      if (gnu !== prep.edits) {
        throw Object.assign(new CheckError('gnu-minimal', `편집 수 엔진 ${prep.edits} ≠ GNU ${gnu}`), { actual: res.stdout.toString('utf8') });
      }
    }
    ok = true;
  } finally {
    // 실패한 케이스의 작업 폴더는 조사용으로 남긴다
    if (ok) rmSync(dir, { recursive: true, force: true });
  }
}

// 실패 기록 형식 (§3.2): { seed, caseIndex, options, budget, A, B, patch, expected, actual, check }
export function failureRecord(c, err, prep) {
  return {
    seed: c.seed ?? null,
    caseIndex: c.caseIndex ?? null,
    options: c.options || {},
    budget: c.budget ?? null,
    A: c.A,
    B: c.B,
    patch: prep?.patch ?? err.patch ?? null,
    expected: prep?.expected ?? null,
    actual: err.actual ?? null,
    check: err.check || 'exception',
    message: err.message,
  };
}
