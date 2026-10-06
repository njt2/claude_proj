// 시나리오 13 (모바일 프로젝트 전용): 가로 스크롤 없음, 기본 보기가 통합
import { test, expect } from '@playwright/test';
import { ENGINES, openApp, waitReady, fillAndCompare, CODE_A, CODE_B } from './util.mjs';

const LONG = 'x'.repeat(400) + ' ' + 'long-token-without-spaces-'.repeat(20);

async function noHorizontalScroll(page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(iw);
}

for (const engine of ENGINES) {
  test(`13. 모바일 [${engine.name}]: 가로 스크롤 없음, 기본 보기 통합`, async ({ page }) => {
    await openApp(page, engine);
    await noHorizontalScroll(page);
    await fillAndCompare(page, CODE_A + LONG + '\n', CODE_B + LONG + 'y\n');
    await expect(page.locator('#view-unified')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#diff')).toHaveClass(/uni/);
    await noHorizontalScroll(page);
    // 사용자가 나란히를 명시적으로 고르면 허용되고, 그래도 가로 스크롤은 없다
    await page.click('#view-sbs');
    await waitReady(page);
    await expect(page.locator('#diff')).toHaveClass(/sbs/);
    await noHorizontalScroll(page);
    await page.click('#patch-open');
    await expect(page.locator('#patch-dialog')).toBeVisible();
    await noHorizontalScroll(page);
  });
}
