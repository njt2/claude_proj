// 시드 기반 PRNG. 단순 선형합동(LCG)은 쓰지 않는다 (연속 수열 간 상관 — 계획 §3.1).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// (seed, caseIndex) → 32비트 해시. 케이스마다 독립된 PRNG를 만들기 위해 쓴다.
export function hash2(seed, index) {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  h = Math.imul(h ^ (index >>> 0), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function rngFor(seed, index) {
  return mulberry32(hash2(seed, index));
}

export const int = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)); // [lo, hi]
export const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
