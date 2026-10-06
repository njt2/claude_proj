// 성능 시나리오 입력 생성기 (perf.mjs와 e2e 대용량 시나리오가 함께 쓴다). 시드 고정이라 항상 같은 입력.
import { mulberry32, int, pick } from '../prng.mjs';

const COMMON = [
  '}', '', '  return x;', '{', '    }', '  }', '', 'end', '  break;', '  else {',
  '// ----', '    return null;', '  i++;', '#endif', '  },', ');', '  });', 'else', '    continue;', '*/',
];
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'value', 'result', 'index', 'count', 'item', 'node'];

function codeLine(rnd, i) {
  return `  const ${pick(rnd, WORDS)}${i} = compute(${i}, "${pick(rnd, WORDS)}");`;
}

export function genP1() {
  const rnd = mulberry32(101);
  const n = 100000;
  const a = [];
  for (let i = 0; i < n; i++) a.push(rnd() < 0.2 ? pick(rnd, COMMON) : codeLine(rnd, i));
  const b = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (r < 0.005) continue;                                         // 0.5% 삭제
    if (r < 0.01) b.push(`  // inserted ${i} ${pick(rnd, WORDS)}`);  // 0.5% 위치에 삽입
    if (r >= 0.01 && r < 0.02) b.push(a[i].replace(/compute\(/, 'computeFast(') + ' // changed'); // 1% 새 내용으로
    else b.push(a[i]);
  }
  return { a: a.join('\n') + '\n', b: b.join('\n') + '\n' };
}

export function genP2() {
  const n = 100000;
  const a = [], b = [];
  for (let i = 0; i < n; i++) { a.push(`left line ${i}`); b.push(`right line ${i}`); }
  return { a: a.join('\n') + '\n', b: b.join('\n') + '\n' };
}

export function genP3() {
  const rnd = mulberry32(303);
  const mk = () => Array.from({ length: 50000 }, () => (rnd() < 0.5 ? '0' : '1')).join('\n') + '\n';
  // 두 수열을 같은 PRNG에서 연속으로 뽑는다 (mulberry32라 상관 없음 — §3.1)
  return { a: mk(), b: mk() };
}

export function genP4() {
  const rnd = mulberry32(404);
  const a = [], b = [];
  for (let i = 0; i < 1000; i++) {
    let words = [];
    let len = 0;
    while (len < 5000) { const w = pick(rnd, WORDS) + int(rnd, 0, 99); words.push(w); len += w.length + 1; }
    let line = words.join(' ').slice(0, 5000);
    a.push(line);
    if (rnd() < 0.1) {
      const w = line.split(' ');
      for (let k = 0; k < 5; k++) w[int(rnd, 0, w.length - 1)] = 'CHANGED';
      line = w.join(' ');
    }
    b.push(line);
  }
  return { a: a.join('\n') + '\n', b: b.join('\n') + '\n' };
}
