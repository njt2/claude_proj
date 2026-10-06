import { expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadCore } from '../load-core.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PAGE_URL = pathToFileURL(path.join(ROOT, 'dist', 'diff.html')).href;
// 기대값 계산용: 배포본에서 추출한 코어 (빌드가 소스와 해시 일치를 보장)
export const D = loadCore(path.join(ROOT, 'tmp', 'dist-core.js'));

export const ENGINES = [
  { name: 'worker', query: '' },
  { name: 'main', query: '?worker=0' },
];

// 페이지를 열고 콘솔 에러·페이지 에러·다이얼로그·요청을 모은다
export async function openApp(page, engine) {
  const log = { errors: [], dialogs: 0, requests: [] };
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('dialog', async (d) => { log.dialogs++; await d.dismiss(); });
  page.on('request', (r) => log.requests.push(r.url()));
  await page.goto(PAGE_URL + engine.query);
  return log;
}

export async function waitReady(page) {
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#diff')).toHaveAttribute('data-rendered', 'true');
}

export async function fillAndCompare(page, a, b) {
  await page.fill('#old-text', a);
  await page.fill('#new-text', b);
  await page.keyboard.press('Control+Enter');
  await waitReady(page);
}

export const lines = (arr) => arr.map((l) => l + '\n').join('');

// 변경이 여러 군데 흩어진 샘플 (접기·이동 테스트용)
export function sample(n = 300, changeAt = [10, 150, 290]) {
  const a = [], b = [];
  for (let i = 1; i <= n; i++) {
    a.push(`line ${i} content`);
    b.push(changeAt.includes(i) ? `line ${i} CHANGED content` : `line ${i} content`);
  }
  return { a: lines(a), b: lines(b) };
}

export const CODE_A = lines([
  'function greet(name) {',
  '  const msg = "Hello, " + name;',
  '  console.log(msg);',
  '  return msg;',
  '}',
  '',
  'const 한글 = "안녕하세요";',
  'removed line',
]);
export const CODE_B = lines([
  'function greet(name, greeting) {',
  '  const msg = greeting + ", " + name;',
  '  console.log(msg);',
  '  return msg;',
  '}',
  '',
  'const 한글 = "반갑습니다";',
  'added line one',
  'added line two',
]);
