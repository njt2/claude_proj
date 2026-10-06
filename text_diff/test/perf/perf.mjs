// 성능 측정 (Phase 4). 시나리오마다 5회 실행해 중앙값을 목표와 비교한다.
//   node test/perf/perf.mjs [--core PATH] [--runs 5] [--sweep]
//   --sweep: P1/P3에 대해 budget별 소요 시간·minimal 여부를 출력 (DEFAULT_BUDGET 선택 근거용)
import os from 'node:os';
import { parseArgs } from 'node:util';
import { loadCore } from '../load-core.mjs';
import { genP1, genP2, genP3, genP4 } from './inputs.mjs';

const { values: args } = parseArgs({
  options: {
    core: { type: 'string', default: 'src/core/diff-core.js' },
    runs: { type: 'string', default: '5' },
    sweep: { type: 'boolean', default: false },
  },
});
const RUNS = Number(args.runs);
const D = loadCore(args.core);

// ───────────── 측정 ─────────────

function median(xs) {
  const s = xs.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function time(fn, runs = RUNS) {
  const times = [];
  let last;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    last = fn();
    times.push(performance.now() - t0);
  }
  return { ms: median(times), times, last };
}

const results = [];
function report(id, label, ms, targetMs, extra = '', ok = true) {
  const pass = ok && ms < targetMs;
  results.push({ id, label, ms, targetMs, pass, extra });
  console.log(`${pass ? '✔' : '✖'} ${id} ${label.padEnd(22)} ${ms.toFixed(1).padStart(8)} ms  (목표 < ${targetMs} ms) ${extra}`);
}

function verifyPatch(input, r, name) {
  const patch = D.makeUnifiedPatch(r);
  const applied = D.applyUnifiedPatch(input.a, patch);
  if (applied !== input.b) throw new Error(`${name}: patch 적용 결과가 다름`);
  return patch;
}

console.log(`Node ${process.versions.node} · ${os.cpus()[0].model.trim()} · ${os.cpus().length}스레드 · 코어 v${D.VERSION}`);
console.log(`각 시나리오 ${RUNS}회 중앙값\n`);

const p1 = genP1();
const p1Lines = [p1.a.split('\n').length - 1, p1.b.split('\n').length - 1];

if (args.sweep) {
  const p3 = genP3();
  console.log('budget 스윕 (각 3회 중앙값)');
  for (const budget of [128, 256, 512, 1024, 2048, 4096, 8192]) {
    const t1 = time(() => D.diff(p1.a, p1.b, { budget }), 3);
    const t3 = time(() => D.diff(p3.a, p3.b, { budget, intraline: false }), 3);
    console.log(`  budget ${String(budget).padStart(5)}: P1 ${t1.ms.toFixed(0).padStart(5)} ms minimal=${t1.last.minimal} · P3 ${t3.ms.toFixed(0).padStart(6)} ms minimal=${t3.last.minimal} 편집 ${t3.last.stats.added + t3.last.stats.removed}`);
  }
  process.exit(0);
}

// P1
{
  const t = time(() => D.diff(p1.a, p1.b));
  verifyPatch(p1, t.last, 'P1');
  const s = t.last.stats;
  report('P1', '유사 대용량 10만 줄', t.ms, 500,
    `minimal=${t.last.minimal} · ${p1Lines.join('/')}줄 · +${s.added} −${s.removed} · ${s.changes}곳 · budget ${D.defaultBudget(p1Lines[0] + p1Lines[1])}`,
    t.last.minimal === true);

  // P5: P1 결과로 patch 생성
  const t5 = time(() => D.makeUnifiedPatch(t.last));
  report('P5', 'patch 생성 (P1)', t5.ms, 200, `${(t5.last.length / 1024).toFixed(0)} KB`);
}

// P2
{
  const p2 = genP2();
  const t = time(() => D.diff(p2.a, p2.b));
  verifyPatch(p2, t.last, 'P2');
  report('P2', '완전 상이 10만 줄', t.ms, 1000, `+${t.last.stats.added} −${t.last.stats.removed}`);
}

// P3
{
  const p3 = genP3();
  const t = time(() => D.diff(p3.a, p3.b));
  verifyPatch(p3, t.last, 'P3');
  report('P3', '병적 입력 5만×5만 (0/1)', t.ms, 3000,
    `minimal=${t.last.minimal} · 편집 ${t.last.stats.added + t.last.stats.removed} · budget ${D.defaultBudget(100000)}`);
}

// P4
{
  const p4 = genP4();
  const t = time(() => D.diff(p4.a, p4.b));
  verifyPatch(p4, t.last, 'P4');
  const pairs = t.last.blocks.reduce((n, b) => n + (b.pairs ? b.pairs.length : 0), 0);
  report('P4', '긴 줄 1000×5000자', t.ms, 1000, `변경 ${t.last.stats.changes}곳 · 줄 내부 짝 ${pairs}`);
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n성능 목표 미달: ${failed.map((r) => r.id).join(', ')}` : '\n성능 목표 전부 충족');
process.exit(failed.length ? 1 : 0);
