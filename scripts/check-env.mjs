// 전제 도구 확인: Node ≥ 22, GNU diff, GNU patch.
// 찾은 경로를 tmp/env.json에 저장한다 (퍼징이 이 경로를 사용).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Git for Windows의 usr/bin에는 GNU diff/patch가 들어 있다.
// PATH에 없더라도(PowerShell, cmd에서 실행) git 위치로부터 찾아낸다.
function gitUsrBin() {
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return [];
  // 예: C:/Program Files/Git/mingw64/libexec/git-core → C:/Program Files/Git/usr/bin
  const usrBin = path.resolve(r.stdout.trim(), '..', '..', '..', 'usr', 'bin');
  return existsSync(usrBin) ? [usrBin] : [];
}

function findTool(candidates, marker) {
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout && r.stdout.includes(marker)) {
      return { path: cmd, version: r.stdout.split('\n')[0].trim() };
    }
  }
  return null;
}

const winBins = process.platform === 'win32' ? gitUsrBin() : [];
const diffCandidates = ['diff', 'gdiff', '/opt/homebrew/bin/diff', '/usr/local/bin/diff',
  ...winBins.map((d) => path.join(d, 'diff.exe'))];
const patchCandidates = ['patch', 'gpatch', '/opt/homebrew/bin/gpatch', '/usr/local/bin/gpatch',
  ...winBins.map((d) => path.join(d, 'patch.exe'))];

const problems = [];

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) problems.push(`Node ${process.versions.node} — 22 이상이 필요합니다.`);

const diff = findTool(diffCandidates, 'GNU diffutils');
if (!diff) problems.push('GNU diff를 찾지 못했습니다.');
const patch = findTool(patchCandidates, 'GNU patch');
if (!patch) problems.push('GNU patch를 찾지 못했습니다.');

if (problems.length) {
  console.error('환경 확인 실패:');
  for (const p of problems) console.error('  - ' + p);
  console.error('\n설치 방법:');
  console.error('  Linux   : sudo apt install diffutils patch');
  console.error('  macOS   : brew install diffutils gpatch');
  console.error('  Windows : Git for Windows를 설치하고 <Git 설치 경로>\\usr\\bin 을 PATH에 추가');
  console.error('  Node    : https://nodejs.org 에서 22 이상 설치');
  process.exit(1);
}

const env = { node: process.versions.node, diff: diff.path, diffVersion: diff.version,
  patch: patch.path, patchVersion: patch.version };
mkdirSync(path.join(root, 'tmp'), { recursive: true });
writeFileSync(path.join(root, 'tmp', 'env.json'), JSON.stringify(env, null, 2) + '\n');

console.log(`Node   ${env.node}`);
console.log(`diff   ${env.diff}  (${env.diffVersion})`);
console.log(`patch  ${env.patch}  (${env.patchVersion})`);
console.log('→ tmp/env.json 저장');
