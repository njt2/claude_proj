// GNU diff/patch 대조 퍼징.
//   node test/fuzz/fuzz.mjs [--cases N] [--seed S] [--random-seeds R] [--core PATH] [--jobs J]
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadCore, ROOT } from '../load-core.mjs';
import { loadEnv } from '../../scripts/env.mjs';
import { prepareCase, gnuCheckCase, failureRecord, hasOptions } from '../case-check.mjs';
import { generateCase } from './gen.mjs';

const FIXED_SEED = 20261002;

const { values: args } = parseArgs({
  options: {
    cases: { type: 'string', default: '5000' },
    seed: { type: 'string' },
    'random-seeds': { type: 'string', default: '1' },
    core: { type: 'string', default: 'src/core/diff-core.js' },
    jobs: { type: 'string', default: String(Math.min(12, os.availableParallelism?.() ?? os.cpus().length)) },
  },
});

const CASES = Number(args.cases);
const JOBS = Math.max(1, Number(args.jobs));
const seeds = args.seed !== undefined
  ? [Number(args.seed)]
  : [FIXED_SEED, ...Array.from({ length: Number(args['random-seeds']) }, () => randomInt(1, 2 ** 31))];

const D = loadCore(args.core);
const env = loadEnv();
const regDir = path.join(ROOT, 'test', 'regressions');

console.log(`코어: ${args.core} (v${D.VERSION})`);
console.log(`GNU: ${env.diffVersion} / ${env.patchVersion}`);
console.log(`seed: ${seeds.join(', ')} · seed당 ${CASES}케이스 · 동시 ${JOBS}`);

const failures = [];

function recordFailure(c, err, prep) {
  const rec = failureRecord(c, err, prep);
  mkdirSync(regDir, { recursive: true });
  const file = path.join(regDir, `${c.seed}-${c.caseIndex}.json`);
  writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
  failures.push({ file, rec });
  console.error(`\n✖ 실패 seed=${c.seed} case=${c.caseIndex} [${rec.check}] ${err.message}`);
  console.error(`  → ${path.relative(ROOT, file)}`);
}

async function runSeed(seed) {
  const t0 = performance.now();
  const s = { seed, cases: 0, optionCases: 0, heuristicCases: 0, nonMinimal: 0, minimalChecked: 0, gnuPatched: 0 };
  let next = 0, inflight = 0, stopped = false;
  const step = Math.max(1, Math.floor(CASES / 10));

  await new Promise((resolve) => {
    const finishIfDone = () => {
      if ((next >= CASES || stopped) && inflight === 0) resolve();
    };
    const pump = () => {
      while (!stopped && inflight < JOBS && next < CASES) {
        const c = generateCase(seed, next++);
        let prep;
        try {
          prep = prepareCase(D, c);
        } catch (e) {
          recordFailure(c, e, null);
          stopped = true;
          break;
        }
        if (hasOptions(c.options)) s.optionCases++;
        if (c.budget !== null) s.heuristicCases++;
        if (!prep.r.minimal) s.nonMinimal++;
        if (prep.wantMinimal) s.minimalChecked++;
        if (prep.patch !== '') s.gnuPatched++;
        inflight++;
        gnuCheckCase(env, c, prep)
          .catch((e) => { recordFailure(c, e, prep); stopped = true; })
          .finally(() => {
            inflight--;
            s.cases++;
            if (s.cases % step === 0) process.stdout.write(`  seed ${seed}: ${s.cases}/${CASES}\r`);
            pump();
            finishIfDone();
          });
      }
      finishIfDone();
    };
    pump();
  });
  process.stdout.write('\r' + ' '.repeat(40) + '\r');
  s.seconds = (performance.now() - t0) / 1000;
  return s;
}

const summary = [];
for (const seed of seeds) {
  const s = await runSeed(seed);
  summary.push(s);
  console.log(`seed ${seed}: ${s.cases}케이스 · 옵션 ${s.optionCases} · 강제 휴리스틱 ${s.heuristicCases} (minimal=false ${s.nonMinimal}) · GNU patch 적용 ${s.gnuPatched} · GNU 최소성 대조 ${s.minimalChecked} · ${s.seconds.toFixed(1)}s`);
  if (failures.length) break;
}

const total = summary.reduce((n, s) => n + s.cases, 0);
if (failures.length) {
  console.error(`\n퍼징 실패: ${failures.length}건 (총 ${total}케이스 실행)`);
  process.exit(1);
}
console.log(`\n퍼징 통과: 총 ${total}케이스, seed ${summary.map((s) => s.seed).join(', ')}`);
