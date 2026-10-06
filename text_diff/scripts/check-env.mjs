// 전제 도구 확인: Node ≥ 22, GNU diff, GNU patch.
// 찾은 경로를 tmp/env.json에 저장한다 (퍼징이 이 경로를 사용).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { detectEnv, ENV_FILE, INSTALL_HELP } from './env.mjs';

const env = detectEnv();

if (env.problems.length) {
  console.error('환경 확인 실패:');
  for (const p of env.problems) console.error('  - ' + p);
  console.error('\n' + INSTALL_HELP);
  process.exit(1);
}

const { problems, ...saved } = env;
mkdirSync(path.dirname(ENV_FILE), { recursive: true });
writeFileSync(ENV_FILE, JSON.stringify(saved, null, 2) + '\n');

console.log(`Node   ${env.node}`);
console.log(`diff   ${env.diff}  (${env.diffVersion})`);
console.log(`patch  ${env.patch}  (${env.patchVersion})`);
console.log('→ tmp/env.json 저장');
