// 시드 기반 퍼징 입력 생성기. 모든 케이스는 (seed, caseIndex)만으로 재현된다.
import { rngFor, int, pick } from '../prng.mjs';

// 줄 내용 풀 (§3.1): 빈 줄, 공백만, 탭, 끝 \r, 한글·이모지, patch 문법과 겹치는 줄, 대소문자·공백 변형
export const LINE_POOL = [
  '', ' ', '  ', '\t', ' \t ', '\r', ' \r',
  'a', 'b', 'c', 'A', 'B', 'a\r', 'b\r', 'x\r',
  'foo', 'Foo', 'FOO', 'foo bar', 'foo  bar', ' foo', 'foo ', '\tfoo', 'foo\tbar', 'Foo Bar\r',
  '}', '{', '  return x;', 'return x;', '  return  x;', '// 주석',
  '한글', '한 글', '한글 문장입니다.', '이모지 😀', '😀', '👨‍👩‍👧', 'é', 'é', 'ÄÖÜ', 'äöü',
  '-', '+', '\\', '-a', '+a', ' a', '--', '++', '---', '+++', '@@',
  '\\ No newline at end of file', '@@ -1 +1 @@', '@@ -0,0 +1,2 @@', '--- x', '+++ y', '--- a\tb',
];

const OPTION_KEYS = ['ignoreWhitespace', 'ignoreCase', 'ignoreBlankLines'];

function sample(rnd, k) {
  // 풀에서 서로 다른 줄 k개
  const pool = LINE_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k);
}

function randomLines(rnd, alphabet, n) {
  return Array.from({ length: n }, () => pick(rnd, alphabet));
}

function freshLine(rnd) {
  return pick(rnd, ['new ', 'line ', '새 줄 ', 'X']) + int(rnd, 0, 999);
}

function mutate(rnd, lines, alphabet) {
  const out = lines.slice();
  const ops = int(rnd, 1, 10);
  for (let k = 0; k < ops; k++) {
    const op = int(rnd, 0, 4);
    const pos = int(rnd, 0, out.length);
    const src = () => (rnd() < 0.6 ? pick(rnd, alphabet) : rnd() < 0.5 ? pick(rnd, LINE_POOL) : freshLine(rnd));
    if (op === 0) out.splice(pos, 0, src());                                      // 삽입
    else if (op === 1 && out.length) out.splice(Math.min(pos, out.length - 1), int(rnd, 1, 3)); // 삭제
    else if (op === 2 && out.length) out[Math.min(pos, out.length - 1)] = src();  // 치환
    else if (op === 3 && out.length > 1) {                                        // 줄 이동
      const [l] = out.splice(int(rnd, 0, out.length - 1), 1);
      out.splice(int(rnd, 0, out.length), 0, l);
    } else if (op === 4 && out.length) {                                          // 블록 복제
      const s = int(rnd, 0, out.length - 1), len = int(rnd, 1, Math.min(5, out.length - s));
      out.splice(int(rnd, 0, out.length), 0, ...out.slice(s, s + len));
    }
  }
  return out;
}

function toText(rnd, lines) {
  if (lines.length === 0) return '';
  // 마지막 개행 유무는 양쪽 독립적으로 무작위 (§3.1)
  return lines.join('\n') + (rnd() < 0.5 ? '\n' : '');
}

export function generateCase(seed, caseIndex) {
  const rnd = rngFor(seed, caseIndex);
  const strategyRoll = rnd();
  let a, b, strategy;
  if (strategyRoll < 0.4) {
    strategy = 'independent';
    const alphabet = sample(rnd, pick(rnd, [1, 2, 3, 5, 26]));
    a = randomLines(rnd, alphabet, int(rnd, 0, 40));
    b = randomLines(rnd, alphabet, int(rnd, 0, 40));
  } else if (strategyRoll < 0.9) {
    strategy = 'mutation';
    const alphabet = sample(rnd, pick(rnd, [2, 3, 5, 10, 26]));
    a = randomLines(rnd, alphabet, int(rnd, 0, 40));
    b = mutate(rnd, a, alphabet);
    if (rnd() < 0.5) [a, b] = [b, a];
  } else {
    strategy = 'extreme';
    const kind = int(rnd, 0, 4);
    const line = pick(rnd, LINE_POOL);
    const some = () => randomLines(rnd, sample(rnd, 5), int(rnd, 1, 30));
    if (kind === 0) { a = []; b = some(); }                                         // 빈 파일
    else if (kind === 1) { a = [pick(rnd, LINE_POOL)]; b = [pick(rnd, LINE_POOL)]; } // 1줄
    else if (kind === 2) { a = Array(int(rnd, 1, 40)).fill(line); b = Array(int(rnd, 0, 40)).fill(line); } // 모두 같은 줄
    else if (kind === 3) { a = some(); b = some().map((l) => l + '#' + int(rnd, 0, 9)); } // 완전히 다름
    else { a = some(); b = a.slice(); }                                             // 같은 줄들 (개행만 다를 수 있음)
    if (rnd() < 0.5) [a, b] = [b, a];
  }

  // 30%는 무작위 옵션 조합 (최소 1개 켬)
  let options = {};
  if (rnd() < 0.3) {
    do {
      options = {};
      for (const k of OPTION_KEYS) if (rnd() < 0.5) options[k] = true;
    } while (Object.keys(options).length === 0);
  }
  // 10%는 budget 1~4로 강제 휴리스틱
  const budget = rnd() < 0.1 ? int(rnd, 1, 4) : null;

  return { seed, caseIndex, strategy, options, budget, A: toText(rnd, a), B: toText(rnd, b) };
}
