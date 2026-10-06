// 스크린샷: 입력 화면, 나란히 결과, 통합 결과, patch 패널 × 프로젝트(라이트/다크 × 데스크톱/모바일)
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { ROOT, ENGINES, openApp, waitReady, fillAndCompare, sample } from './util.mjs';

const dir = path.join(ROOT, 'test-results', 'screens');

test('스크린샷', async ({ page }, info) => {
  const name = (s) => path.join(dir, `${info.project.name}-${s}.png`);
  const log = await openApp(page, ENGINES[0]);
  const s = sample(60, [3, 30]);
  const a = 'function greet(name) {\n  const msg = "Hello, " + name;\n  return msg;\n}\n\n' + s.a + 'const 한글 = "안녕하세요";\ntail\tline\n\n\nend';
  const b = 'function greet(name, greeting) {\n  const msg = greeting + ", " + name;\n  return msg;\n}\n' + s.b + 'const 한글 = "반갑습니다";\ntail line\n\nend\nextra';
  await page.fill('#old-text', a);
  await page.fill('#new-text', b);
  await page.screenshot({ path: name('1-input') });

  await page.check('#opt-blank');
  await page.keyboard.press('Control+Enter');
  await waitReady(page);
  await page.click('#view-sbs');
  await waitReady(page);
  await page.keyboard.press('n');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: name('2-sbs') });

  await page.click('#view-unified');
  await waitReady(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: name('3-unified') });

  await page.click('#patch-open');
  await expect(page.locator('#patch-dialog')).toBeVisible();
  await page.screenshot({ path: name('4-patch') });
  expect(log.errors).toEqual([]);
});
