// GNU diff/patch 탐지. check-env와 테스트(퍼징·회귀)가 함께 쓴다.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENV_FILE = path.join(ROOT, 'tmp', 'env.json');

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

// { node, diff, diffVersion, patch, patchVersion, problems: string[] }
export function detectEnv() {
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
  return {
    node: process.versions.node,
    diff: diff?.path, diffVersion: diff?.version,
    patch: patch?.path, patchVersion: patch?.version,
    problems,
  };
}

// tmp/env.json이 있으면 읽고, 없으면 탐지한다. GNU 도구가 없으면 throw (검사를 건너뛰지 않는다).
export function loadEnv() {
  let env = null;
  if (existsSync(ENV_FILE)) {
    env = JSON.parse(readFileSync(ENV_FILE, 'utf8'));
    if (!existsSync(env.diff) && spawnSync(env.diff, ['--version']).status !== 0) env = null;
  }
  if (!env) {
    env = detectEnv();
    if (env.problems.length) {
      throw new Error('GNU diff/patch가 필요합니다: ' + env.problems.join(' ') + ' — `npm run check-env` 참고');
    }
  }
  return env;
}

export const INSTALL_HELP = [
  '설치 방법:',
  '  Linux   : sudo apt install diffutils patch',
  '  macOS   : brew install diffutils gpatch',
  '  Windows : Git for Windows를 설치하고 <Git 설치 경로>\\usr\\bin 을 PATH에 추가',
  '  Node    : https://nodejs.org 에서 22 이상 설치',
].join('\n');
