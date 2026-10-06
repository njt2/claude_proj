// test/regressions/*.json (퍼징에서 나온 실패 케이스)를 퍼징과 같은 검사로 다시 실행한다.
import { test } from 'node:test';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { D } from './helpers.mjs';
import { ROOT } from '../load-core.mjs';
import { loadEnv } from '../../scripts/env.mjs';
import { prepareCase, gnuCheckCase } from '../case-check.mjs';

const dir = path.join(ROOT, 'test', 'regressions');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];

if (files.length === 0) {
  test('회귀 케이스 없음', () => {});
} else {
  const env = loadEnv();
  for (const f of files) {
    test(f, async () => {
      const c = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const prep = prepareCase(D, c);
      await gnuCheckCase(env, c, prep);
    });
  }
}
