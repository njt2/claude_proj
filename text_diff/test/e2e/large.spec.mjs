// 시나리오 12: P1 입력(10만 줄)을 파일로 넣고 비교 → 10초 이내 요약, 끝까지 스크롤하면 마지막 변경 블록이 보임
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ENGINES, ROOT, D, openApp } from './util.mjs';
import { genP1 } from '../perf/inputs.mjs';

const dir = path.join(ROOT, 'tmp', 'e2e');
const p1 = genP1();
mkdirSync(dir, { recursive: true });
const oldFile = path.join(dir, 'p1-old.txt');
const newFile = path.join(dir, 'p1-new.txt');
writeFileSync(oldFile, p1.a);
writeFileSync(newFile, p1.b);
const r = D.diff(p1.a, p1.b);
const lastBlk = r.blocks.map((b, i) => (b.type === 'change' && !b.ignored ? i : -1)).filter((i) => i >= 0).pop();

for (const engine of ENGINES) {
  test(`12. 대용량 10만 줄 [${engine.name}]`, async ({ page }) => {
    test.setTimeout(120_000);
    const log = await openApp(page, engine);
    // 5MB를 fill로 넣으면 느려 측정이 왜곡되므로 파일로 넣는다
    await page.setInputFiles('#old-file', oldFile);
    await page.setInputFiles('#new-file', newFile);
    await expect(page.locator('#new-badges')).toContainText('100,046줄');

    const t0 = Date.now();
    await page.click('#compare');
    await expect(page.locator('#summary-text')).toHaveAttribute('data-added', String(r.stats.added), { timeout: 10_000 });
    const elapsed = Date.now() - t0;
    test.info().annotations.push({ type: 'elapsed', description: `${elapsed} ms` });
    console.log(`  [${engine.name}] 비교 → 요약 표시 ${elapsed} ms`);
    expect(elapsed).toBeLessThan(10_000);
    await expect(page.locator('#summary-text')).toHaveAttribute('data-removed', String(r.stats.removed));
    expect(await page.evaluate(() => document.body.dataset.engine)).toBe(engine.name);

    const last = page.locator(`#diff [data-blk="${lastBlk}"]`).first();
    await expect(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(last).toBeInViewport({ timeout: 500 });
    }).toPass({ timeout: 30_000 });
    expect(log.errors).toEqual([]);
  });
}
