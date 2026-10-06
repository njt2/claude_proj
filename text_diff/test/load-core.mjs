// 코어 파일(export 없는 단일 스크립트)을 Node vm으로 로드해 DiffCore 객체를 돌려준다.
// 경로를 인자로 받으므로 dist에서 추출한 코어도 같은 방식으로 검사할 수 있다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CORE = path.join(ROOT, 'src', 'core', 'diff-core.js');

export function loadCore(corePath = DEFAULT_CORE) {
  const abs = path.resolve(ROOT, corePath);
  const source = readFileSync(abs, 'utf8');
  // 브라우저·Worker와 같은 조건: 전역 객체만 있고 require/process/DOM은 없다
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: abs });
  if (!sandbox.DiffCore) throw new Error(`DiffCore가 정의되지 않음: ${abs}`);
  return sandbox.DiffCore;
}
